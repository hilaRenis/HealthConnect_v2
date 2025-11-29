import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const loginSuccess = new Rate('login_success_rate');
const apiResponseTime = new Trend('api_response_time');

export const options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp up to 100
    { duration: '3m', target: 300 },  // Ramp up to 300
    { duration: '3m', target: 500 },  // Ramp up to 500
    { duration: '5m', target: 500 },  // Stay at 500 users (MEDIUM load)
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.10'],
    login_success_rate: ['rate>0.90'],
  },
};

const BASE_URL = 'http://localhost:8080';

export function setup() {
  console.log('=== MEDIUM LOAD TEST: 500 Concurrent Users ===');
  console.log('Monitor dashboards:');
  console.log('  Grafana: http://localhost:3001');
  console.log('  Prometheus: http://localhost:9091');
  console.log('Expected: Some degradation, possible bottlenecks');
  return { testStart: Date.now() };
}

export default function () {
  const rand = Math.random();

  if (rand < 0.5) {
    // 50% - Login as admin and make API calls
    const start = Date.now();
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({
        email: 'admin@healthconnect.com',
        password: 'adminpass'
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { scenario: 'admin_workflow' }
      }
    );

    apiResponseTime.add(Date.now() - start);

    const success = check(loginRes, {
      'login successful': (r) => r.status === 200,
      'has token': (r) => r.json('token') !== undefined,
    });

    loginSuccess.add(success ? 1 : 0);

    if (loginRes.status === 200) {
      const token = loginRes.json('token');

      // Check profile
      http.get(`${BASE_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
        tags: { scenario: 'profile_check' }
      });

      sleep(1);

      // Check health
      http.get(`${BASE_URL}/health`, {
        tags: { scenario: 'health_check' }
      });
    }

  } else if (rand < 0.7) {
    // 20% - Health checks only (simulating monitoring)
    http.get(`${BASE_URL}/health`, {
      tags: { scenario: 'health_monitor' }
    });

  } else {
    // 30% - Login and check metrics
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({
        email: 'admin@healthconnect.com',
        password: 'adminpass'
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { scenario: 'metrics_check' }
      }
    );

    if (loginRes.status === 200) {
      http.get(`${BASE_URL}/api/auth/metrics`, {
        tags: { scenario: 'view_metrics' }
      });
    }
  }

  sleep(Math.random() * 4 + 2); // 2-6 seconds think time
}

export function teardown(data) {
  const duration = (Date.now() - data.testStart) / 1000 / 60;
  console.log(`\n=== TEST COMPLETED ===`);
  console.log(`Duration: ${duration.toFixed(1)} minutes`);
  console.log(`Check Grafana for performance degradation patterns`);
}
