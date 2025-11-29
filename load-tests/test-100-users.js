import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const loginSuccess = new Rate('login_success_rate');
const apiResponseTime = new Trend('api_response_time');

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // Ramp up to 50
    { duration: '2m', target: 100 },  // Ramp up to 100
    { duration: '5m', target: 100 },  // Stay at 100 users (LOW load)
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.05'],
    login_success_rate: ['rate>0.95'],
  },
};

const BASE_URL = 'http://localhost:8080';

export function setup() {
  console.log('=== LOW LOAD TEST: 100 Concurrent Users ===');
  console.log('Monitor dashboards:');
  console.log('  Grafana: http://localhost:3001');
  console.log('  Prometheus: http://localhost:9091');
  return { testStart: Date.now() };
}

export default function () {
  const rand = Math.random();

  if (rand < 0.5) {
    // 50% - Login as admin and check health
    const start = Date.now();
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({
        email: 'admin@healthconnect.com',
        password: 'adminpass'
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { scenario: 'admin_login' }
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

      // Check own profile
      http.get(`${BASE_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
        tags: { scenario: 'check_profile' }
      });

      sleep(1);
    }

  } else if (rand < 0.8) {
    // 30% - Health check only
    http.get(`${BASE_URL}/health`, {
      tags: { scenario: 'health_check' }
    });

  } else {
    // 20% - Login and check metrics endpoint
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({
        email: 'admin@healthconnect.com',
        password: 'adminpass'
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (loginRes.status === 200) {
      // Check metrics (available to all)
      http.get(`${BASE_URL}/api/auth/metrics`, {
        tags: { scenario: 'check_metrics' }
      });
    }
  }

  sleep(Math.random() * 5 + 3); // 3-8 seconds think time
}

export function teardown(data) {
  const duration = (Date.now() - data.testStart) / 1000 / 60;
  console.log(`\n=== TEST COMPLETED ===`);
  console.log(`Duration: ${duration.toFixed(1)} minutes`);
  console.log(`Check Grafana for detailed metrics`);
}
