const http = require('http');
const assert = require('assert');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

// Mock backend servers
let authServer, patientServer, doctorServer, apptServer, pharmacyServer, adminServer;
let gatewayProcess;

// Helper to create mock service
function createMockService(name, port) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            // Check for forwarded user header
            const xuHeader = req.headers['x-user'];
            let forwardedUser = null;
            if (xuHeader) {
                try {
                    forwardedUser = JSON.parse(xuHeader);
                } catch (e) {
                    // ignore parse errors
                }
            }

            // Auth service mock
            if (name === 'auth' && req.url === '/auth/login' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        if (data.email === 'test@example.com' && data.password === 'password123') {
                            const token = jwt.sign({ userId: '123', email: data.email, role: 'patient' }, JWT_SECRET);
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ token }));
                        } else {
                            res.writeHead(401, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Invalid credentials' }));
                        }
                    } catch (e) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Bad request' }));
                    }
                });
                return;
            }

            // Health check for all services
            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ service: name, ok: true }));
                return;
            }

            // Mock endpoints for various services
            if (name === 'patient' && req.url.startsWith('/')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    service: 'patient',
                    user: forwardedUser,
                    message: 'Patient data'
                }));
                return;
            }

            if (name === 'doctor' && req.url.startsWith('/')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    service: 'doctor',
                    user: forwardedUser,
                    message: 'Doctor data'
                }));
                return;
            }

            if (name === 'appointment' && req.url.startsWith('/')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    service: 'appointment',
                    user: forwardedUser,
                    message: 'Appointment data'
                }));
                return;
            }

            if (name === 'pharmacy' && req.url.startsWith('/')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    service: 'pharmacy',
                    user: forwardedUser,
                    message: 'Pharmacy data'
                }));
                return;
            }

            if (name === 'admin' && req.url.startsWith('/')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    service: 'admin',
                    user: forwardedUser,
                    message: 'Admin data'
                }));
                return;
            }

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        });

        server.listen(port, () => {
            console.log(`Mock ${name} service listening on ${port}`);
            resolve(server);
        });
    });
}

// Helper to make HTTP request
function makeRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data ? JSON.parse(data) : null
                    });
                } catch (e) {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data
                    });
                }
            });
        });

        req.on('error', reject);

        if (postData) {
            req.write(JSON.stringify(postData));
        }

        req.end();
    });
}

// Test suite
async function runTests() {
    console.log('Starting Enhanced API Gateway Tests...\n');

    let passedTests = 0;
    let failedTests = 0;

    try {
        // Setup: Start mock services
        console.log('Setting up mock services...');
        authServer = await createMockService('auth', 3001);
        patientServer = await createMockService('patient', 3002);
        doctorServer = await createMockService('doctor', 3003);
        apptServer = await createMockService('appointment', 3004);
        pharmacyServer = await createMockService('pharmacy', 3005);
        adminServer = await createMockService('admin', 3006);

        // Start API Gateway
        console.log('Starting API Gateway...');
        const { spawn } = require('child_process');

        gatewayProcess = spawn('node', ['api-gateway/src/index.js'], {
            env: {
                ...process.env,
                PORT: '8080',
                JWT_SECRET: 'devsecret',
                AUTH_URL: 'http://localhost:3001',
                PATIENT_URL: 'http://localhost:3002',
                DOCTOR_URL: 'http://localhost:3003',
                APPT_URL: 'http://localhost:3004',
                PHARMACY_URL: 'http://localhost:3005',
                ADMIN_URL: 'http://localhost:3006'
            }
        });

        gatewayProcess.stdout.on('data', (data) => {
            console.log(`Gateway: ${data}`);
        });

        gatewayProcess.stderr.on('data', (data) => {
            console.error(`Gateway Error: ${data}`);
        });

        // Wait for gateway to start
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Test 1: Health check
        console.log('\n--- Test 1: Health Check ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/health',
                method: 'GET'
            });

            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(response.body.gateway, true);
            assert.strictEqual(response.body.ok, true);
            console.log('✓ Health check passed');
            passedTests++;
        } catch (error) {
            console.error('✗ Health check failed:', error.message);
            failedTests++;
        }

        // Test 2: Login (public endpoint)
        console.log('\n--- Test 2: Login Authentication ---');
        let token;
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/auth/login',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            }, {
                email: 'test@example.com',
                password: 'password123'
            });

            assert.strictEqual(response.statusCode, 200);
            assert.ok(response.body.token);
            token = response.body.token;
            console.log('✓ Login successful');
            passedTests++;
        } catch (error) {
            console.error('✗ Login failed:', error.message);
            failedTests++;
        }

        // Test 3: Unauthorized access without token
        console.log('\n--- Test 3: Unauthorized Access (No Token) ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/patients',
                method: 'GET'
            });

            assert.strictEqual(response.statusCode, 401);
            assert.ok(response.body.error);
            console.log('✓ Unauthorized access blocked correctly');
            passedTests++;
        } catch (error) {
            console.error('✗ Unauthorized access test failed:', error.message);
            failedTests++;
        }

        // Test 4: Access with valid token
        console.log('\n--- Test 4: Authorized Access (Valid Token) ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/patients',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(response.body.service, 'patient');
            assert.ok(response.body.user);
            assert.strictEqual(response.body.user.email, 'test@example.com');
            console.log('✓ Authorized access successful with user forwarding');
            passedTests++;
        } catch (error) {
            console.error('✗ Authorized access test failed:', error.message);
            failedTests++;
        }

        // Test 5: Invalid token
        console.log('\n--- Test 5: Invalid Token ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/patients',
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer invalidtoken123'
                }
            });

            assert.strictEqual(response.statusCode, 401);
            assert.ok(response.body.error);
            console.log('✓ Invalid token rejected correctly');
            passedTests++;
        } catch (error) {
            console.error('✗ Invalid token test failed:', error.message);
            failedTests++;
        }

        // Test 6: Appointment service proxy
        console.log('\n--- Test 6: Appointment Service Proxy ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/appointments',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(response.body.service, 'appointment');
            assert.ok(response.body.user);
            console.log('✓ Appointment service proxy working');
            passedTests++;
        } catch (error) {
            console.error('✗ Appointment service proxy test failed:', error.message);
            failedTests++;
        }

        // Test 7: Pharmacy service proxy
        console.log('\n--- Test 7: Pharmacy Service Proxy ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/pharmacies',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(response.body.service, 'pharmacy');
            console.log('✓ Pharmacy service proxy working');
            passedTests++;
        } catch (error) {
            console.error('✗ Pharmacy service proxy test failed:', error.message);
            failedTests++;
        }

        // Test 8: Admin service proxy
        console.log('\n--- Test 8: Admin Service Proxy ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/admin',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(response.body.service, 'admin');
            console.log('✓ Admin service proxy working');
            passedTests++;
        } catch (error) {
            console.error('✗ Admin service proxy test failed:', error.message);
            failedTests++;
        }

        // Test 9: Role-based access control (doctor endpoint with patient role)
        console.log('\n--- Test 9: Role-Based Access Control ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/doctors',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            assert.strictEqual(response.statusCode, 403);
            assert.ok(response.body.error);
            console.log('✓ Role-based access control working');
            passedTests++;
        } catch (error) {
            console.error('✗ Role-based access control test failed:', error.message);
            failedTests++;
        }

        // Test 10: Doctor role access
        console.log('\n--- Test 10: Doctor Role Access ---');
        try {
            const doctorToken = jwt.sign({
                userId: '456',
                email: 'doctor@example.com',
                role: 'doctor'
            }, JWT_SECRET);

            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/doctors',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${doctorToken}`
                }
            });

            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(response.body.service, 'doctor');
            console.log('✓ Doctor role can access doctor endpoints');
            passedTests++;
        } catch (error) {
            console.error('✗ Doctor role access test failed:', error.message);
            failedTests++;
        }

        // Test 11: Invalid login credentials
        console.log('\n--- Test 11: Invalid Login Credentials ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/auth/login',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            }, {
                email: 'wrong@example.com',
                password: 'wrongpassword'
            });

            assert.strictEqual(response.statusCode, 401);
            assert.ok(response.body.error);
            console.log('✓ Invalid credentials rejected');
            passedTests++;
        } catch (error) {
            console.error('✗ Invalid credentials test failed:', error.message);
            failedTests++;
        }

        // Test 12: Missing Authorization header
        console.log('\n--- Test 12: Missing Authorization Header ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/patients',
                method: 'GET',
                headers: {}
            });

            assert.strictEqual(response.statusCode, 401);
            console.log('✓ Missing authorization header handled correctly');
            passedTests++;
        } catch (error) {
            console.error('✗ Missing authorization header test failed:', error.message);
            failedTests++;
        }

        // Test 13: Authorization header without "Bearer " prefix
        console.log('\n--- Test 13: Invalid Authorization Format ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/patients',
                method: 'GET',
                headers: {
                    'Authorization': 'InvalidFormat token123'
                }
            });

            assert.strictEqual(response.statusCode, 401);
            console.log('✓ Invalid authorization format rejected');
            passedTests++;
        } catch (error) {
            console.error('✗ Invalid authorization format test failed:', error.message);
            failedTests++;
        }

        // Test 14: POST request to patient service
        console.log('\n--- Test 14: POST Request Proxying ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/patients',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }, {
                name: 'Test Patient',
                dob: '1990-01-01'
            });

            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(response.body.service, 'patient');
            console.log('✓ POST request proxying working');
            passedTests++;
        } catch (error) {
            console.error('✗ POST request proxying test failed:', error.message);
            failedTests++;
        }

        // Test 15: PUT request to appointment service
        console.log('\n--- Test 15: PUT Request Proxying ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/appointments/123',
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }, {
                status: 'confirmed'
            });

            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(response.body.service, 'appointment');
            console.log('✓ PUT request proxying working');
            passedTests++;
        } catch (error) {
            console.error('✗ PUT request proxying test failed:', error.message);
            failedTests++;
        }

        // Test 16: DELETE request to admin service
        console.log('\n--- Test 16: DELETE Request Proxying ---');
        try {
            const adminToken = jwt.sign({
                userId: '789',
                email: 'admin@example.com',
                role: 'admin'
            }, JWT_SECRET);

            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/admin/patient/123',
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                }
            });

            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(response.body.service, 'admin');
            console.log('✓ DELETE request proxying working');
            passedTests++;
        } catch (error) {
            console.error('✗ DELETE request proxying test failed:', error.message);
            failedTests++;
        }

        // Test 17: Test auth service path rewrite
        console.log('\n--- Test 17: Auth Service Path Rewrite ---');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/auth/login',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            }, {
                email: 'test@example.com',
                password: 'password123'
            });

            assert.strictEqual(response.statusCode, 200);
            console.log('✓ Auth service path rewrite working');
            passedTests++;
        } catch (error) {
            console.error('✗ Auth service path rewrite test failed:', error.message);
            failedTests++;
        }

    } catch (error) {
        console.error('\n✗ Test suite error:', error);
        failedTests++;
    } finally {
        // Cleanup
        console.log('\n\nCleaning up...');

        if (authServer) authServer.close();
        if (patientServer) patientServer.close();
        if (doctorServer) doctorServer.close();
        if (apptServer) apptServer.close();
        if (pharmacyServer) pharmacyServer.close();
        if (adminServer) adminServer.close();
        if (gatewayProcess) gatewayProcess.kill();

        // Summary
        console.log('\n' + '='.repeat(50));
        console.log('API GATEWAY TEST SUMMARY');
        console.log('='.repeat(50));
        console.log(`Total Tests: ${passedTests + failedTests}`);
        console.log(`Passed: ${passedTests}`);
        console.log(`Failed: ${failedTests}`);
        console.log('='.repeat(50));

        if (failedTests > 0) {
            process.exit(1);
        }
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});