const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');

let passed = 0;
let failed = 0;

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

// Mock database - store original query function for reset
const originalQuery = async function(sql, params) {
    mockDb.queries.push({ sql, params });
    const sqlLower = sql.toLowerCase();

    if (sqlLower.includes('insert')) {
        return mockDb.mockResults['INSERT'] || { rows: [], rowCount: 1 };
    }
    if (sqlLower.includes('update')) {
        return mockDb.mockResults['UPDATE'] || { rows: [], rowCount: 1 };
    }
    if (sqlLower.includes('select')) {
        return mockDb.mockResults['SELECT'] || { rows: [] };
    }

    return { rows: [], rowCount: 0 };
};

const mockDb = {
    queries: [],
    mockResults: {},
    query: originalQuery,
    reset() {
        mockDb.queries = [];
        mockDb.mockResults = {};
        mockDb.query = originalQuery; // Restore original query function
    }
};

// Mock Kafka
const mockKafka = {
    publishedEvents: [],
    publishEvent: async function(topic, payload, options) {
        mockKafka.publishedEvents.push({ topic, payload, options });
    },
    startConsumer: async function() {
        return {};
    },
    reset() {
        this.publishedEvents = [];
    }
};

// Setup mocks
require.cache[require.resolve('../src/db')] = { exports: mockDb };
require.cache[require.resolve('../src/kafka')] = { exports: mockKafka };
require.cache[require.resolve('nanoid')] = { exports: { nanoid: () => 'test-user-123' } };

// Set environment
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.JWT_SECRET = JWT_SECRET;
process.env.KAFKA_BROKERS = 'none';

// Load the service
delete require.cache[require.resolve('../src/index')];
require('../src/index');

function makeRequest(method, path, options = {}) {
    return new Promise((resolve, reject) => {
        const { body, headers = {}, user } = options;

        if (user) {
            headers['x-user'] = JSON.stringify(user);
        }

        const req = http.request({
            hostname: 'localhost',
            port: 3001,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    body: data ? JSON.parse(data) : null
                });
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function test(name, fn) {
    try {
        mockDb.reset();
        mockKafka.reset();
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
    console.log('\n=== Auth Service Tests ===\n');

    await new Promise(resolve => setTimeout(resolve, 200));

    // Health check
    await test('GET /health', async () => {
        const res = await makeRequest('GET', '/health');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.service, 'auth-service');
    });

    // Register doctor
    await test('POST /auth/register-doctor - admin registers doctor', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('POST', '/auth/register-doctor', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'Dr. Smith', email: 'smith@test.com', password: 'pass123' }
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.id, 'test-user-123');
    });

    await test('POST /auth/register-doctor - fails without required fields', async () => {
        const res = await makeRequest('POST', '/auth/register-doctor', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'Dr. Smith' }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('POST /auth/register-doctor - 409 when email exists', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{ id: 'existing', email: 'smith@test.com' }]
        };

        const res = await makeRequest('POST', '/auth/register-doctor', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'Dr. Smith', email: 'smith@test.com', password: 'pass123' }
        });

        assert.strictEqual(res.status, 409);
    });

    await test('POST /auth/register-doctor - non-admin is forbidden', async () => {
        const res = await makeRequest('POST', '/auth/register-doctor', {
            user: { sub: 'doctor-1', role: 'doctor' },
            body: { name: 'Dr. Smith', email: 'smith@test.com', password: 'pass123' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Update user
    await test('PUT /auth/users/:id - admin updates user', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            const sqlLower = sql.toLowerCase();

            // First SELECT - get existing user
            if (callCount === 1) {
                return { rows: [{ id: 'user-1', role: 'doctor', name: 'Dr. Smith', email: 'smith@test.com' }] };
            }
            // Second SELECT - check if new email exists (should be empty for no conflict)
            if (callCount === 2) {
                return { rows: [] };
            }
            // UPDATE
            if (sqlLower.includes('update')) {
                return { rows: [{ id: 'user-1', role: 'doctor', name: 'Dr. John Smith', email: 'john.smith@test.com' }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        };

        const res = await makeRequest('PUT', '/auth/users/user-1', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'Dr. John Smith', email: 'john.smith@test.com' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.name, 'Dr. John Smith');
    });

    await test('PUT /auth/users/:id - updates with password', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{ id: 'user-1', role: 'doctor', name: 'Dr. Smith', email: 'smith@test.com' }]
        };
        mockDb.mockResults.UPDATE = {
            rows: [{ id: 'user-1', role: 'doctor', name: 'Dr. Smith', email: 'smith@test.com' }]
        };

        const res = await makeRequest('PUT', '/auth/users/user-1', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'Dr. Smith', email: 'smith@test.com', password: 'newpass' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('PUT /auth/users/:id - fails without required fields', async () => {
        const res = await makeRequest('PUT', '/auth/users/user-1', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'Dr. Smith' }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('PUT /auth/users/:id - 404 when user not found', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('PUT', '/auth/users/user-999', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'Dr. Smith', email: 'smith@test.com' }
        });

        assert.strictEqual(res.status, 404);
    });

    await test('PUT /auth/users/:id - 409 when email exists', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            if (callCount === 1) {
                return { rows: [{ id: 'user-1', email: 'old@test.com' }] };
            }
            return { rows: [{ id: '1' }] };
        };

        const res = await makeRequest('PUT', '/auth/users/user-1', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'Dr. Smith', email: 'new@test.com' }
        });

        assert.strictEqual(res.status, 409);
    });

    await test('PUT /auth/users/:id - non-admin is forbidden', async () => {
        const res = await makeRequest('PUT', '/auth/users/user-1', {
            user: { sub: 'doctor-1', role: 'doctor' },
            body: { name: 'Dr. Smith', email: 'smith@test.com' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Delete user
    await test('DELETE /auth/users/:id - admin deletes user', async () => {
        mockDb.mockResults.UPDATE = {
            rows: [{ id: 'user-1', role: 'doctor' }],
            rowCount: 1
        };

        const res = await makeRequest('DELETE', '/auth/users/user-1', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 204);
    });

    await test('DELETE /auth/users/:id - 404 when not found', async () => {
        mockDb.mockResults.UPDATE = { rows: [], rowCount: 0 };

        const res = await makeRequest('DELETE', '/auth/users/user-999', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 404);
    });

    await test('DELETE /auth/users/:id - non-admin is forbidden', async () => {
        const res = await makeRequest('DELETE', '/auth/users/user-1', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Register patient
    await test('POST /auth/register-patient - doctor registers patient', async () => {
        mockDb.query = async function(sql) {
            // Check if email exists - should be empty
            if (sql.toLowerCase().includes('select')) {
                return { rows: [] };
            }
            // INSERT
            return { rows: [], rowCount: 1 };
        };

        const res = await makeRequest('POST', '/auth/register-patient', {
            user: { sub: 'doctor-1', role: 'doctor' },
            body: { name: 'John Doe', email: 'john@test.com', password: 'pass123' }
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.id, 'test-user-123');
    });

    await test('POST /auth/register-patient - admin registers patient', async () => {
        mockDb.query = async function(sql) {
            // Check if email exists - should be empty
            if (sql.toLowerCase().includes('select')) {
                return { rows: [] };
            }
            // INSERT
            return { rows: [], rowCount: 1 };
        };

        const res = await makeRequest('POST', '/auth/register-patient', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'John Doe', email: 'john@test.com', password: 'pass123' }
        });

        assert.strictEqual(res.status, 201);
    });

    await test('POST /auth/register-patient - fails without required fields', async () => {
        const res = await makeRequest('POST', '/auth/register-patient', {
            user: { sub: 'doctor-1', role: 'doctor' },
            body: { name: 'John Doe' }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('POST /auth/register-patient - 409 when email exists', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{ id: 'existing', email: 'john@test.com' }]
        };

        const res = await makeRequest('POST', '/auth/register-patient', {
            user: { sub: 'doctor-1', role: 'doctor' },
            body: { name: 'John Doe', email: 'john@test.com', password: 'pass123' }
        });

        assert.strictEqual(res.status, 409);
    });

    await test('POST /auth/register-patient - non-doctor/admin is forbidden', async () => {
        const res = await makeRequest('POST', '/auth/register-patient', {
            user: { sub: 'patient-1', role: 'patient' },
            body: { name: 'John Doe', email: 'john@test.com', password: 'pass123' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Login
    await test('POST /auth/login - successful login', async () => {
        mockDb.query = async function(sql) {
            // SELECT user by email
            return {
                rows: [{
                    id: 'user-1',
                    role: 'patient',
                    name: 'John Doe',
                    email: 'john@test.com',
                    passwordhash: 'pass123'
                }]
            };
        };

        const res = await makeRequest('POST', '/auth/login', {
            body: { email: 'john@test.com', password: 'pass123' }
        });

        assert.strictEqual(res.status, 200);
        assert(res.body.token);

        const decoded = jwt.verify(res.body.token, JWT_SECRET);
        assert.strictEqual(decoded.sub, 'user-1');
        assert.strictEqual(decoded.role, 'patient');
    });

    await test('POST /auth/login - 401 for invalid credentials', async () => {
        mockDb.query = async function() {
            return { rows: [] };
        };

        const res = await makeRequest('POST', '/auth/login', {
            body: { email: 'john@test.com', password: 'wrongpass' }
        });

        assert.strictEqual(res.status, 401);
    });

    // Get me
    await test('GET /auth/me - returns user from valid token', async () => {
        const token = jwt.sign({
            sub: 'user-1',
            role: 'patient',
            name: 'John Doe',
            email: 'john@test.com'
        }, JWT_SECRET, { expiresIn: '2h' });

        const res = await makeRequest('GET', '/auth/me', {
            headers: { Authorization: `Bearer ${token}` }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.sub, 'user-1');
        assert.strictEqual(res.body.role, 'patient');
    });

    await test('GET /auth/me - 401 without token', async () => {
        const res = await makeRequest('GET', '/auth/me');
        assert.strictEqual(res.status, 401);
    });

    await test('GET /auth/me - 401 with invalid token', async () => {
        const res = await makeRequest('GET', '/auth/me', {
            headers: { Authorization: 'Bearer invalidtoken' }
        });

        assert.strictEqual(res.status, 401);
    });

    await test('GET /auth/me - 401 with non-Bearer token', async () => {
        const res = await makeRequest('GET', '/auth/me', {
            headers: { Authorization: 'Basic sometoken' }
        });

        assert.strictEqual(res.status, 401);
    });

    // authGuard with Bearer token (not x-user)
    await test('authGuard - validates Bearer token when no x-user', async () => {
        const token = jwt.sign({ sub: 'admin-1', role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });

        mockDb.query = async function(sql) {
            // Check if email exists - should be empty
            if (sql.toLowerCase().includes('select')) {
                return { rows: [] };
            }
            // INSERT
            return { rows: [], rowCount: 1 };
        };

        const res = await makeRequest('POST', '/auth/register-doctor', {
            headers: { Authorization: `Bearer ${token}` },
            body: { name: 'Dr. Smith', email: 'smith@test.com', password: 'pass123' }
        });

        assert.strictEqual(res.status, 201);
    });

    await test('authGuard - 401 with invalid Bearer token', async () => {
        const res = await makeRequest('POST', '/auth/register-doctor', {
            headers: { Authorization: 'Bearer invalidtoken' },
            body: { name: 'Dr. Smith', email: 'smith@test.com', password: 'pass123' }
        });

        assert.strictEqual(res.status, 401);
    });

    // Summary
    console.log(`\n=== Test Summary ===`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);

    process.exit(failed > 0 ? 1 : 0);
}

setTimeout(() => {
    runTests().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}, 300);