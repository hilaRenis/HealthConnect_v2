// End-to-End Tests - 3 Critical Tests
// Uses ONLY built-in Node.js modules (http, assert)

const http = require('http');
const assert = require('assert');

const API_URL = process.env.API_URL || 'http://localhost:8080';
const USE_MOCK = process.env.USE_MOCK === 'true';

// Mock data (used when USE_MOCK=true)
const MOCK_RESPONSES = {
    '/api/auth/login': {
        admin: { status: 200, body: { token: 'mock-admin-token-123', role: 'admin', email: 'admin@example.com' }},
        doctor: { status: 200, body: { token: 'mock-doctor-token-456', role: 'doctor', email: 'doctor@example.com' }}
    },
    '/api/admin/doctors': {
        status: 200,
        body: { data: [{ id: '1', name: 'Dr. Mock', email: 'mock@doctor.com' }], total: 1 }
    },
    '/api/doctors/patients': {
        status: 200,
        body: { data: [{ id: '1', name: 'Mock Patient', email: 'patient@mock.com' }], total: 1 }
    }
};

// Helper function to make HTTP requests
function request(path, options = {}) {
    // If using mock mode, return mock data
    if (USE_MOCK) {
        return new Promise((resolve) => {
            // Mock login responses
            if (path === '/api/auth/login' && options.body) {
                const email = options.body.email;
                if (email === 'admin@example.com') {
                    return resolve(MOCK_RESPONSES['/api/auth/login'].admin);
                } else if (email === 'doctor@example.com') {
                    return resolve(MOCK_RESPONSES['/api/auth/login'].doctor);
                } else {
                    // Invalid credentials
                    return resolve({ status: 401, body: { error: 'Invalid credentials' } });
                }
            }

            // Mock admin routes - check authorization
            if (path === '/api/admin/doctors') {
                const authHeader = options.headers?.Authorization || '';
                if (!authHeader) {
                    return resolve({ status: 401, body: { error: 'No token provided' } });
                }
                if (authHeader.includes('mock-doctor-token')) {
                    return resolve({ status: 403, body: { error: 'Forbidden' } });
                }
                if (authHeader.includes('mock-admin-token')) {
                    return resolve(MOCK_RESPONSES['/api/admin/doctors']);
                }
            }

            // Mock doctor routes
            if (path === '/api/doctors/patients' || path === '/api/doctors/schedule/mine') {
                const authHeader = options.headers?.Authorization || '';
                if (!authHeader) {
                    return resolve({ status: 401, body: { error: 'No token provided' } });
                }
                if (path === '/api/doctors/patients') {
                    return resolve(MOCK_RESPONSES['/api/doctors/patients']);
                }
                return resolve({ status: 200, body: { data: [] } });
            }

            // Default mock response
            resolve({ status: 200, body: { success: true } });
        });
    }

    // Real HTTP request
    return new Promise((resolve, reject) => {
        const url = `${API_URL}${path}`;
        const urlObj = new URL(url);

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || 80,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const req = http.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: data ? JSON.parse(data) : null
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: data
                    });
                }
            });
        });

        req.on('error', reject);

        if (options.body) {
            req.write(JSON.stringify(options.body));
        }

        req.end();
    });
}

// Test Suite
let passedTests = 0;
let failedTests = 0;

function test(description, fn) {
    return async () => {
        try {
            await fn();
            console.log(` PASS: ${description}`);
            passedTests++;
        } catch (error) {
            console.log(` FAIL: ${description}`);
            console.log(`   Error: ${error.message}`);
            if (error.response) {
                console.log(`   HTTP Status: ${error.response.status}`);
                console.log(`   Response: ${JSON.stringify(error.response.body, null, 2)}`);
            }
            failedTests++;
        }
    };
}

// Test Cases (Only 3 Tests)

// Test 1: Authentication Flow (Admin & Doctor)
const testAuthenticationFlow = test('Authentication flow works for admin and doctor', async () => {
    // Test Admin Login
    const adminLoginRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'admin@example.com', password: 'admin123' }
    });

    if (adminLoginRes.status !== 200) {
        const error = new Error('Admin should login successfully');
        error.response = adminLoginRes;
        throw error;
    }

    assert.ok(adminLoginRes.body && adminLoginRes.body.token, 'Should receive admin auth token');

    // Test Doctor Login
    const doctorLoginRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'doctor@example.com', password: 'doctor123' }
    });

    if (doctorLoginRes.status !== 200) {
        const error = new Error('Doctor should login successfully');
        error.response = doctorLoginRes;
        throw error;
    }

    assert.ok(doctorLoginRes.body && doctorLoginRes.body.token, 'Should receive doctor auth token');

    // Test Invalid Login
    const invalidLoginRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'wrong@example.com', password: 'wrongpass' }
    });
    assert.ok([401, 400].includes(invalidLoginRes.status), 'Invalid login should fail');
});

// Test 2: Role-Based Access Control
const testAccessControl = test('Role-based access control works correctly', async () => {
    // Admin Login
    const adminLoginRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'admin@example.com', password: 'admin123' }
    });
    const adminToken = adminLoginRes.body.token;

    // Doctor Login
    const doctorLoginRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'doctor@example.com', password: 'doctor123' }
    });
    const doctorToken = doctorLoginRes.body.token;

    // Test 1: Admin can access admin routes
    const adminAccessRes = await request('/api/admin/doctors', {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminAccessRes.status, 200, 'Admin should access admin routes');

    // Test 2: Doctor cannot access admin routes
    const doctorAdminRes = await request('/api/admin/doctors', {
        headers: { Authorization: `Bearer ${doctorToken}` }
    });
    assert.strictEqual(doctorAdminRes.status, 403, 'Doctor should not access admin routes');

    // Test 3: Unauthorized access should fail
    const noTokenRes = await request('/api/admin/doctors');
    assert.strictEqual(noTokenRes.status, 401, 'Should reject request without token');
});

// Test 3: Core Workflow - Doctor manages patients
const testDoctorWorkflow = test('Doctor can view and manage patients', async () => {
    // Step 1: Doctor Login
    const loginRes = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'doctor@example.com', password: 'doctor123' }
    });
    assert.strictEqual(loginRes.status, 200, 'Doctor should login successfully');
    const doctorToken = loginRes.body.token;

    // Step 2: Get doctor's patients
    const getPatientsRes = await request('/api/doctors/patients', {
        headers: { Authorization: `Bearer ${doctorToken}` }
    });
    assert.strictEqual(getPatientsRes.status, 200, 'Should retrieve patients list');

    // Step 3: Get doctor's schedule
    const getScheduleRes = await request('/api/doctors/schedule/mine', {
        headers: { Authorization: `Bearer ${doctorToken}` }
    });
    assert.strictEqual(getScheduleRes.status, 200, 'Should retrieve schedule');
});

// Main test runner
async function runTests() {
    console.log('\n Starting E2E Tests for Healthcare Management System');
    console.log('=' .repeat(60));
    console.log(`API URL: ${API_URL}`);
    console.log(`Mode: ${USE_MOCK ? '🎭 MOCK (No Docker Required)' : '🐳 REAL (Docker Required)'}`);
    console.log('=' .repeat(60));
    console.log('');

    const startTime = Date.now();

    // Run all tests
    await testAuthenticationFlow();
    await testAccessControl();
    await testDoctorWorkflow();

    // Print summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const totalTests = passedTests + failedTests;

    console.log('');
    console.log('=' .repeat(60));
    console.log(' TEST SUMMARY');
    console.log('=' .repeat(60));
    console.log(`Total Tests:     ${totalTests}`);
    console.log(`Passed:          ${passedTests} `);
    console.log(`Failed:          ${failedTests} `);
    console.log(`Success Rate:    ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    console.log(`Duration:        ${duration}s`);
    console.log('=' .repeat(60));

    if (USE_MOCK) {
        console.log('\n💡 TIP: Run with real services using: node web-client\\test\\frontend-test.js');
    } else {
        console.log('\n💡 TIP: Run without Docker using: USE_MOCK=true node web-client\\test\\frontend-test.js');
    }

    if (failedTests > 0) {
        console.log('\n⚠️  Some tests failed. Please review the errors above.');
        process.exit(1);
    } else {
        console.log('\n🎉 All E2E tests passed successfully!');
        process.exit(0);
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    runTests().catch(error => {
        console.error('\n Fatal error running tests:', error.message);
        process.exit(1);
    });
}

module.exports = { runTests, request };