//Trigger test1
const assert = require('assert');
const http = require('http');

let passed = 0;
let failed = 0;

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

// Mock axios
const mockAxios = {
    post: async () => ({ data: { id: 'new-id', success: true } }),
    get: async () => ({ data: [] })
};

// Mock axiosInstance
const mockAxiosInstance = {
    get: async () => ({ data: [] }),
    post: async () => ({ data: { success: true } })
};

// Setup mocks
require.cache[require.resolve('../src/db')] = { exports: mockDb };
require.cache[require.resolve('../src/kafka')] = { exports: mockKafka };
require.cache[require.resolve('axios')] = { exports: mockAxios };
require.cache[require.resolve('../src/axiosInstance')] = { exports: mockAxiosInstance };

// Set environment
process.env.PORT = '3003';
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
            port: 3003,
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
    console.log('\n=== Doctor Service Tests ===\n');

    await new Promise(resolve => setTimeout(resolve, 200));

    // Health check
    await test('GET /health', async () => {
        const res = await makeRequest('GET', '/health');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.service, 'doctor-service');
    });

    // Schedule endpoints
    await test('POST /schedule - doctor creates schedule', async () => {
        const res = await makeRequest('POST', '/schedule', {
            user: { sub: 'doctor-1', role: 'doctor' },
            body: { date: '2025-12-01', slot: '10:00' }
        });

        assert.strictEqual(res.status, 201);
        assert(res.body.id);
        assert.strictEqual(res.body.doctorUserId, 'doctor-1');
    });

    await test('POST /schedule - non-doctor is forbidden', async () => {
        const res = await makeRequest('POST', '/schedule', {
            user: { sub: 'patient-1', role: 'patient' },
            body: { date: '2025-12-01', slot: '10:00' }
        });

        assert.strictEqual(res.status, 403);
    });

    await test('GET /schedule/mine - doctor gets schedule', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{ id: 'sched-1', doctoruserid: 'doctor-1', date: '2025-12-01', slot: '10:00' }]
        };

        const res = await makeRequest('GET', '/schedule/mine', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 200);
        assert(Array.isArray(res.body));
    });

    await test('GET /schedule/mine - non-doctor is forbidden', async () => {
        const res = await makeRequest('GET', '/schedule/mine', {
            user: { sub: 'patient-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Patient management
    await test('GET /patients - doctor lists patients', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            if (sql.toLowerCase().includes('count(*)')) {
                return { rows: [{ count: '1' }] };
            }
            return {
                rows: [{
                    id: 'pat-1',
                    userid: 'user-1',
                    name: 'John Doe',
                    email: 'john@test.com',
                    dob: '1990-01-01',
                    conditions: []
                }]
            };
        };

        const res = await makeRequest('GET', '/patients', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 200);
        assert(Array.isArray(res.body.data));
        assert.strictEqual(res.body.total, 1);
    });

    await test('GET /patients - supports pagination', async () => {
        let callCount = 0;
        mockDb.query = async function() {
            callCount++;
            return callCount === 1 ? { rows: [] } : { rows: [{ count: '0' }] };
        };

        const res = await makeRequest('GET', '/patients?page=2&limit=5', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('GET /patients - supports sorting', async () => {
        let callCount = 0;
        mockDb.query = async function() {
            callCount++;
            return callCount === 1 ? { rows: [] } : { rows: [{ count: '0' }] };
        };

        const res = await makeRequest('GET', '/patients?sortBy=email&order=desc', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('GET /patients - supports search', async () => {
        let callCount = 0;
        mockDb.query = async function() {
            callCount++;
            return callCount === 1 ? { rows: [] } : { rows: [{ count: '0' }] };
        };

        const res = await makeRequest('GET', '/patients?search=john', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('GET /patients - non-doctor is forbidden', async () => {
        const res = await makeRequest('GET', '/patients', {
            user: { sub: 'patient-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Get patient by ID
    await test('GET /patients/:id - doctor gets patient', async () => {
        mockDb.query = async function() {
            return {
                rows: [{
                    id: 'pat-1',
                    userid: 'user-1',
                    name: 'John Doe',
                    email: 'john@test.com',
                    dob: '1990-01-01',
                    conditions: []
                }]
            };
        };

        const res = await makeRequest('GET', '/patients/pat-1', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.id, 'pat-1');
    });

    await test('GET /patients/:id - 404 when not found', async () => {
        mockDb.query = async function() {
            return { rows: [] };
        };

        const res = await makeRequest('GET', '/patients/pat-999', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 404);
    });

    await test('GET /patients/:id - non-doctor is forbidden', async () => {
        const res = await makeRequest('GET', '/patients/pat-1', {
            user: { sub: 'patient-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Create patient
    await test('POST /patients - doctor creates patient', async () => {
        const res = await makeRequest('POST', '/patients', {
            user: { sub: 'doctor-1', role: 'doctor' },
            body: {
                name: 'John Doe',
                email: 'john@test.com',
                password: 'pass123',
                dob: '1990-01-01'
            }
        });

        assert.strictEqual(res.status, 201);
    });

    await test('POST /patients - fails without required fields', async () => {
        const res = await makeRequest('POST', '/patients', {
            user: { sub: 'doctor-1', role: 'doctor' },
            body: { name: 'John Doe' }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('POST /patients - non-doctor is forbidden', async () => {
        const res = await makeRequest('POST', '/patients', {
            user: { sub: 'patient-1', role: 'patient' },
            body: {
                name: 'John Doe',
                email: 'john@test.com',
                password: 'pass123',
                dob: '1990-01-01'
            }
        });

        assert.strictEqual(res.status, 403);
    });

    // Prescription requests
    await test('GET /prescriptions/requests - doctor lists requests', async () => {
        const res = await makeRequest('GET', '/prescriptions/requests', {
            user: { sub: 'doctor-1', role: 'doctor' },
            headers: { Authorization: 'Bearer token' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('GET /prescriptions/requests - non-doctor is forbidden', async () => {
        const res = await makeRequest('GET', '/prescriptions/requests', {
            user: { sub: 'patient-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 403);
    });

    await test('POST /prescriptions/requests/:id/approve - doctor approves', async () => {
        const res = await makeRequest('POST', '/prescriptions/requests/req-1/approve', {
            user: { sub: 'doctor-1', role: 'doctor' },
            headers: { Authorization: 'Bearer token' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('POST /prescriptions/requests/:id/deny - doctor denies', async () => {
        const res = await makeRequest('POST', '/prescriptions/requests/req-1/deny', {
            user: { sub: 'doctor-1', role: 'doctor' },
            headers: { Authorization: 'Bearer token' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('POST /prescriptions/requests/:id/:action - non-doctor is forbidden', async () => {
        const res = await makeRequest('POST', '/prescriptions/requests/req-1/approve', {
            user: { sub: 'patient-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 403);
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