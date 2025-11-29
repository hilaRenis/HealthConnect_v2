import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const loginSuccess = new Rate('login_success_rate');
const apiResponseTime = new Trend('api_response_time');

export const options = {
  stages: [
    { duration: '2m', target: 200 },  // Ramp up to 200
    { duration: '3m', target: 500 },  // Ramp up to 500
    { duration: '3m', target: 800 },  // Ramp up to 800
    { duration: '3m', target: 1000 }, // Ramp up to 1000
    { duration: '5m', target: 1000 }, // Stay at 1000 users (HIGH load)
    { duration: '3m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<10000'],
    http_req_failed: ['rate<0.20'],
    login_success_rate: ['rate>0.80'],
  },
};

const BASE_URL = 'http://localhost:8080';

export function setup() {
  console.log('=== HIGH LOAD TEST: 1000 Concurrent Users ===');
  console.log('WARNING: This test pushes system to limits!');
  console.log('Monitor dashboards:');
  console.log('  Grafana: http://localhost:3001');
  console.log('  Prometheus: http://localhost:9091');
  console.log('Expected: Significant degradation, possible failures');
  return { testStart: Date.now() };
}

export default function () {
  const rand = Math.random();

  if (rand < 0.4) {
    // 40% - Login and make API calls
    const start = Date.now();
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({
        email: 'admin@healthconnect.com',
        password: 'adminpass'
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { scenario: 'full_workflow' }
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
        tags: { scenario: 'auth_me' }
      });

      sleep(0.5);

      // Check health
      http.get(`${BASE_URL}/health`, {
        tags: { scenario: 'health' }
      });
    }

  } else if (rand < 0.6) {
    // 20% - Health checks only
    http.get(`${BASE_URL}/health`, {
      tags: { scenario: 'health_only' }
    });

  } else if (rand < 0.8) {
    // 20% - Login only
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({
        email: 'admin@healthconnect.com',
        password: 'adminpass'
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { scenario: 'login_only' }
      }
    );

    loginSuccess.add(loginRes.status === 200 ? 1 : 0);

  } else {
    // 20% - Metrics check
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({
        email: 'admin@healthconnect.com',
        password: 'adminpass'
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (loginRes.status === 200) {
      http.get(`${BASE_URL}/api/auth/metrics`, {
        tags: { scenario: 'metrics' }
      });
    }
  }

  sleep(Math.random() * 3 + 1); // 1-4 seconds think time (faster for stress)
}

export function teardown(data) {
  const duration = (Date.now() - data.testStart) / 1000 / 60;
  console.log(`\n=== TEST COMPLETED ===`);
  console.log(`Duration: ${duration.toFixed(1)} minutes`);
  console.log(`Check Grafana for system breaking points and bottlenecks`);
}
