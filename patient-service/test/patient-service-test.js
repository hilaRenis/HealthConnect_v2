const assert = require('assert');
const http = require('http');

let passed = 0;
let failed = 0;

// Mock database
const mockDb = {
    queries: [],
    mockResults: {},
    query: async function(sql, params) {
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
    },
    reset() {
        mockDb.queries = [];
        mockDb.mockResults = {};
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
require.cache[require.resolve('nanoid')] = { exports: { nanoid: () => 'test-patient-123' } };

// Set environment
process.env.PORT = '3002';
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
            port: 3002,
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
    console.log('\n=== Patient Service Tests ===\n');

    await new Promise(resolve => setTimeout(resolve, 200));

    // Health check
    await test('GET /health', async () => {
        const res = await makeRequest('GET', '/health');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.service, 'patient-service');
    });

    // Profile creation
    await test('POST /profiles - patient creates own profile', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('POST', '/profiles', {
            user: { sub: 'user-1', role: 'patient' },
            body: { name: 'John Doe', dob: '1990-01-01' }
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.id, 'test-patient-123');
        assert.strictEqual(res.body.userId, 'user-1');
    });

    await test('POST /profiles - admin creates profile', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('POST', '/profiles', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { userId: 'user-2', name: 'Jane Doe', dob: '1985-05-15' }
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.userId, 'user-2');
    });

    await test('POST /profiles - doctor creates profile', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('POST', '/profiles', {
            user: { sub: 'doctor-1', role: 'doctor' },
            body: { userId: 'patient-1', name: 'Bob Smith', dob: '1995-08-20' }
        });

        assert.strictEqual(res.status, 201);
    });

    await test('POST /profiles - 409 when profile exists', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{ id: 'existing-id', userid: 'user-1' }]
        };

        const res = await makeRequest('POST', '/profiles', {
            user: { sub: 'user-1', role: 'patient' },
            body: { name: 'John Doe', dob: '1990-01-01' }
        });

        assert.strictEqual(res.status, 409);
    });

    await test('POST /profiles - doctor fails without userId', async () => {
        const res = await makeRequest('POST', '/profiles', {
            user: { sub: 'doctor-1', role: 'doctor' },
            body: { name: 'Patient', dob: '1990-01-01' }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('POST /profiles - 401 without user', async () => {
        const res = await makeRequest('POST', '/profiles', {
            body: { name: 'John Doe', dob: '1990-01-01' }
        });

        assert.strictEqual(res.status, 401);
    });

    // Get profile
    await test('GET /profiles/me - patient gets own profile', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{
                id: 'pat-1',
                userid: 'user-1',
                name: 'John Doe',
                dob: '1990-01-01',
                conditions: []
            }]
        };

        const res = await makeRequest('GET', '/profiles/me', {
            user: { sub: 'user-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.id, 'pat-1');
    });

    await test('GET /profiles/me - 404 when not found', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('GET', '/profiles/me', {
            user: { sub: 'user-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 404);
    });

    await test('GET /profiles/me - 401 without user', async () => {
        const res = await makeRequest('GET', '/profiles/me');
        assert.strictEqual(res.status, 401);
    });

    // Delete profile
    await test('DELETE /profiles/me - patient deletes own profile', async () => {
        mockDb.mockResults.UPDATE = {
            rows: [{ id: 'pat-1', userid: 'user-1' }],
            rowCount: 1
        };

        const res = await makeRequest('DELETE', '/profiles/me', {
            user: { sub: 'user-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.deleted, true);
    });

    await test('DELETE /profiles/me - returns false when no profile', async () => {
        mockDb.mockResults.UPDATE = { rows: [], rowCount: 0 };

        const res = await makeRequest('DELETE', '/profiles/me', {
            user: { sub: 'user-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.deleted, false);
    });

    await test('DELETE /profiles/me - 401 without user', async () => {
        const res = await makeRequest('DELETE', '/profiles/me');
        assert.strictEqual(res.status, 401);
    });

    await test('DELETE /profiles/:id - admin deletes profile', async () => {
        mockDb.mockResults.UPDATE = {
            rows: [{ id: 'pat-1', userid: 'user-2' }],
            rowCount: 1
        };

        const res = await makeRequest('DELETE', '/profiles/pat-1', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 204);
    });

    await test('DELETE /profiles/:id - 404 when not found', async () => {
        mockDb.mockResults.UPDATE = { rows: [], rowCount: 0 };

        const res = await makeRequest('DELETE', '/profiles/pat-999', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 404);
    });

    await test('DELETE /profiles/:id - non-admin is forbidden', async () => {
        const res = await makeRequest('DELETE', '/profiles/pat-1', {
            user: { sub: 'patient-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Prescription requests
    await test('POST /prescriptions/requests - patient creates request', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{ id: 'pat-1', userid: 'user-1' }]
        };

        const res = await makeRequest('POST', '/prescriptions/requests', {
            user: { sub: 'user-1', role: 'patient' },
            body: { medication: 'Aspirin', notes: 'Daily use' }
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.medication, 'Aspirin');
        assert.strictEqual(res.body.status, 'pending');
    });

    await test('POST /prescriptions/requests - fails without profile', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('POST', '/prescriptions/requests', {
            user: { sub: 'user-1', role: 'patient' },
            body: { medication: 'Aspirin' }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('POST /prescriptions/requests - non-patient is forbidden', async () => {
        const res = await makeRequest('POST', '/prescriptions/requests', {
            user: { sub: 'doctor-1', role: 'doctor' },
            body: { medication: 'Aspirin' }
        });

        assert.strictEqual(res.status, 403);
    });

    await test('GET /prescriptions/requests/mine - patient lists requests', async () => {
        let callCount = 0;
        mockDb.query = async function() {
            callCount++;
            if (callCount === 1) {
                return { rows: [{ id: 'pat-1', userid: 'user-1' }] };
            }
            return { rows: [{ id: 'req-1', patientid: 'pat-1', medication: 'Aspirin', status: 'pending' }] };
        };

        const res = await makeRequest('GET', '/prescriptions/requests/mine', {
            user: { sub: 'user-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 200);
        assert(Array.isArray(res.body));
    });

    await test('GET /prescriptions/requests/mine - non-patient is forbidden', async () => {
        const res = await makeRequest('GET', '/prescriptions/requests/mine', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Internal endpoints
    await test('GET /internal/prescriptions/requests - lists all', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{ id: 'req-1', patientid: 'pat-1', medication: 'Aspirin', status: 'pending' }]
        };

        const res = await makeRequest('GET', '/internal/prescriptions/requests');

        assert.strictEqual(res.status, 200);
        assert(Array.isArray(res.body));
    });

    await test('POST /internal/prescriptions/requests/:id/status - updates status', async () => {
        mockDb.mockResults.UPDATE = {
            rows: [{ id: 'req-1', patientid: 'pat-1', status: 'approved' }],
            rowCount: 1
        };

        const res = await makeRequest('POST', '/internal/prescriptions/requests/req-1/status', {
            body: { status: 'approved' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, 'approved');
    });

    await test('POST /internal/prescriptions/requests/:id/status - 404 when not found', async () => {
        mockDb.mockResults.UPDATE = { rows: [], rowCount: 0 };

        const res = await makeRequest('POST', '/internal/prescriptions/requests/req-999/status', {
            body: { status: 'approved' }
        });

        assert.strictEqual(res.status, 404);
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