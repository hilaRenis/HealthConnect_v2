const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');

let passed = 0;
let failed = 0;

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

// Mock backend servers
let authServer, patientServer, doctorServer, apptServer, pharmacyServer, adminServer;

function createMockService(name, port) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const xuHeader = req.headers['x-user'];
            let forwardedUser = null;
            if (xuHeader) {
                try {
                    forwardedUser = JSON.parse(xuHeader);
                } catch (e) {}
            }

            // Auth service
            if (name === 'auth' && req.url === '/auth/login' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        if (data.email === 'test@test.com' && data.password === 'pass123') {
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

            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ service: name, ok: true }));
                return;
            }

            if (name === 'patient' && req.url.startsWith('/')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ service: 'patient', user: forwardedUser, message: 'Patient data' }));
                return;
            }

            if (name === 'doctor' && req.url.startsWith('/')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ service: 'doctor', user: forwardedUser, message: 'Doctor data' }));
                return;
            }

            if (name === 'appointment' && req.url.startsWith('/')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ service: 'appointment', user: forwardedUser }));
                return;
            }

            if (name === 'pharmacy' && req.url.startsWith('/')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ service: 'pharmacy', user: forwardedUser }));
                return;
            }

            if (name === 'admin' && req.url.startsWith('/')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ service: 'admin', user: forwardedUser }));
                return;
            }

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        });

        server.listen(port, () => {
            console.log(`Mock ${name} service on ${port}`);
            resolve(server);
        });
    });
}

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
        if (postData) req.write(JSON.stringify(postData));
        req.end();
    });
}

async function test(name, fn) {
    try {
        await fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (error) {
        console.error(`✗ ${name}`);
        console.error(`  ${error.message}`);
        failed++;
    }
}

async function runTests() {
    console.log('\n=== API Gateway Tests ===\n');

    try {
        // Setup mock services
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
        const path = require('path');
        const gatewayIndexPath = path.join(__dirname, '..', 'src', 'index.js');
        const gatewayProcess = spawn('node', [gatewayIndexPath], {
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

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Health check
        await test('GET /health', async () => {
            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/health',
                method: 'GET'
            });

            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.body.gateway, true);
        });

        // Login (public endpoint)
        let token;
        await test('POST /api/auth/login - successful login', async () => {
            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/auth/login',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, {
                email: 'test@test.com',
                password: 'pass123'
            });

            assert.strictEqual(res.statusCode, 200);
            assert(res.body.token);
            token = res.body.token;
        });

        await test('POST /api/auth/login - invalid credentials', async () => {
            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/auth/login',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, {
                email: 'wrong@test.com',
                password: 'wrongpass'
            });

            assert.strictEqual(res.statusCode, 401);
        });

        // Unauthorized access
        await test('GET /api/patients - 401 without token', async () => {
            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/patients',
                method: 'GET'
            });

            assert.strictEqual(res.statusCode, 401);
        });

        // Authorized access
        await test('GET /api/patients - 200 with valid token', async () => {
            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/patients',
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.body.service, 'patient');
            assert(res.body.user);
        });

        // Invalid token
        await test('GET /api/patients - 401 with invalid token', async () => {
            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/patients',
                method: 'GET',
                headers: { 'Authorization': 'Bearer invalidtoken' }
            });

            assert.strictEqual(res.statusCode, 401);
        });

        // Missing Bearer prefix
        await test('GET /api/patients - 401 without Bearer prefix', async () => {
            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/patients',
                method: 'GET',
                headers: { 'Authorization': 'Basic sometoken' }
            });

            assert.strictEqual(res.statusCode, 401);
        });

        // Appointment service
        await test('GET /api/appointments - proxies to appointment service', async () => {
            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/appointments',
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.body.service, 'appointment');
        });

        // Pharmacy service
        await test('GET /api/pharmacies - proxies to pharmacy service', async () => {
            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/pharmacies',
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.body.service, 'pharmacy');
        });

        // Admin service
        await test('GET /api/admin - proxies to admin service', async () => {
            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/admin',
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.body.service, 'admin');
        });

        // Role-based access control
        await test('GET /api/doctors - 403 for patient role', async () => {
            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/doctors',
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            assert.strictEqual(res.statusCode, 403);
        });

        await test('GET /api/doctors - 200 for doctor role', async () => {
            const doctorToken = jwt.sign({
                userId: '456',
                email: 'doctor@test.com',
                role: 'doctor'
            }, JWT_SECRET);

            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/doctors',
                method: 'GET',
                headers: { 'Authorization': `Bearer ${doctorToken}` }
            });

            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.body.service, 'doctor');
        });

        // POST request
        await test('POST /api/patients - proxies POST requests', async () => {
            const res = await makeRequest({
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

            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.body.service, 'patient');
        });

        // PUT request
        await test('PUT /api/appointments/123 - proxies PUT requests', async () => {
            const res = await makeRequest({
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

            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.body.service, 'appointment');
        });

        // DELETE request
        await test('DELETE /api/admin/123 - proxies DELETE requests', async () => {
            const adminToken = jwt.sign({
                userId: '789',
                email: 'admin@test.com',
                role: 'admin'
            }, JWT_SECRET);

            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/admin/123',
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });

            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.body.service, 'admin');
        });

        // Auth path rewrite
        await test('Auth path rewrite - /api/auth/login → /auth/login', async () => {
            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/auth/login',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, {
                email: 'test@test.com',
                password: 'pass123'
            });

            assert.strictEqual(res.statusCode, 200);
        });

        // X-User header forwarding
        await test('Forwards x-user header to backend services', async () => {
            const res = await makeRequest({
                hostname: 'localhost',
                port: 8080,
                path: '/api/patients',
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            assert.strictEqual(res.statusCode, 200);
            assert(res.body.user);
            assert.strictEqual(res.body.user.email, 'test@test.com');
        });

        // Cleanup
        console.log('\nCleaning up...');
        if (authServer) authServer.close();
        if (patientServer) patientServer.close();
        if (doctorServer) doctorServer.close();
        if (apptServer) apptServer.close();
        if (pharmacyServer) pharmacyServer.close();
        if (adminServer) adminServer.close();
        if (gatewayProcess) gatewayProcess.kill();

    } catch (error) {
        console.error('\nFatal error:', error);
        failed++;
    }

    // Summary
    console.log(`\n=== Test Summary ===`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);

    process.exit(failed > 0 ? 1 : 0);
}

runTests();