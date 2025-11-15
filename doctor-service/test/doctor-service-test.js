//Triger test
const assert = require('assert');

// Mock database
const mockDb = {
    queries: [],
    mockResults: {},
    query(sql, params) {
        this.queries.push({ sql, params });
        const sqlLower = sql.toLowerCase();

        // INSERT operations
        if (sqlLower.startsWith('insert')) {
            return Promise.resolve(this.mockResults['INSERT'] || { rows: [], rowCount: 0 });
        }

        // UPDATE operations
        if (sqlLower.startsWith('update')) {
            return Promise.resolve(this.mockResults['UPDATE'] || { rows: [], rowCount: 0 });
        }

        // SELECT operations
        if (sqlLower.startsWith('select')) {
            return Promise.resolve(this.mockResults['SELECT'] || { rows: [] });
        }

        return Promise.resolve({ rows: [], rowCount: 0 });
    },
    reset() {
        this.queries = [];
        this.mockResults = {};
    },
};

// Mock Kafka
const mockKafka = {
    publishedEvents: [],
    consumerStarted: false,
    publishEvent: function(topic, payload) {
        mockKafka.publishedEvents.push({ topic, payload });
        return Promise.resolve();
    },
    startConsumer: function() {
        mockKafka.consumerStarted = true;
        return Promise.resolve(null);
    },
    reset() {
        this.publishedEvents = [];
        this.consumerStarted = false;
    },
};

// Mock axios
const mockAxios = {
    post: async () => ({ data: { id: 'new-user-id', success: true } }),
};

// Mock axiosInstance
const mockAxiosInstance = {
    get: async () => ({ data: [] }),
    post: async () => ({ data: { success: true } }),
};

// Setup mocks
require.cache[require.resolve('../src/db')] = { exports: mockDb };
require.cache[require.resolve('../src/kafka')] = { exports: mockKafka };
require.cache[require.resolve('axios')] = { exports: mockAxios };
require.cache[require.resolve('../src/axiosInstance')] = { exports: mockAxiosInstance };

function makeRequest(method, path, options = {}) {
    return new Promise((resolve, reject) => {
        const { body, headers = {}, user } = options;

        if (user) {
            headers['x-user'] = JSON.stringify(user);
        }

        const req = require('http').request(
            {
                hostname: 'localhost',
                port: 3003,
                path,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        body: data ? JSON.parse(data) : null,
                        headers: res.headers,
                    });
                });
            }
        );

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runTests() {
    console.log('Starting doctor-service tests...\n');

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            mockDb.reset();
            mockKafka.reset();
            await fn();
            console.log(` ${name}`);
            passed++;
        } catch (error) {
            console.error(` ${name}`);
            console.error(`   ${error.message}`);
            if (error.stack) {
                console.error(`   ${error.stack.split('\n')[1]}`);
            }
            failed++;
        }
    }

    // Setup - load the service
    await test('Server setup', async () => {
        require('../src/index');
        await new Promise((resolve) => setTimeout(resolve, 100));
    });

    // Health check
    await test('GET /health - should return service status', async () => {
        const res = await makeRequest('GET', '/health');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.service, 'doctor-service');
        assert.strictEqual(res.body.ok, true);
    });

    // Schedule endpoints
    await test('POST /schedule - doctor creates schedule', async () => {
        mockDb.mockResults.INSERT = { rows: [], rowCount: 1 };

        const res = await makeRequest('POST', '/schedule', {
            user: { sub: 'doctor-123', role: 'doctor' },
            body: {
                date: '2025-12-01',
                slot: '10:00',
            },
        });

        assert.strictEqual(res.status, 201);
        assert(res.body.id);
        assert.strictEqual(res.body.doctorUserId, 'doctor-123');
        assert.strictEqual(res.body.date, '2025-12-01');
    });

    await test('POST /schedule - non-doctor is forbidden', async () => {
        const res = await makeRequest('POST', '/schedule', {
            user: { sub: 'patient-123', role: 'patient' },
            body: {
                date: '2025-12-01',
                slot: '10:00',
            },
        });

        assert.strictEqual(res.status, 403);
    });

    await test('GET /schedule/mine - doctor gets own schedule', async () => {
        mockDb.mockResults.SELECT = {
            rows: [
                {
                    id: 'sched-1',
                    doctoruserid: 'doctor-123',
                    date: '2025-12-01',
                    slot: '10:00',
                },
            ],
        };

        const res = await makeRequest('GET', '/schedule/mine', {
            user: { sub: 'doctor-123', role: 'doctor' },
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.length, 1);
    });

    await test('GET /schedule/mine - non-doctor is forbidden', async () => {
        const res = await makeRequest('GET', '/schedule/mine', {
            user: { sub: 'patient-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 403);
    });

    // Patient management endpoints
    await test('GET /patients - doctor lists patients', async () => {
        // First query returns patient data, second query returns count
        let queryCount = 0;
        const originalQuery = mockDb.query.bind(mockDb);
        mockDb.query = function(sql, params) {
            queryCount++;
            if (sql.toLowerCase().includes('count(*)')) {
                // COUNT query
                return Promise.resolve({ rows: [{ count: '1' }] });
            }
            // Regular SELECT query
            return Promise.resolve({
                rows: [
                    {
                        id: 'patient-1',
                        userid: 'user-1',
                        name: 'John Doe',
                        email: 'john@example.com',
                        dob: '1990-01-01',
                        conditions: 'None',
                    },
                ],
            });
        };

        const res = await makeRequest('GET', '/patients', {
            user: { sub: 'doctor-123', role: 'doctor' },
        });

        mockDb.query = originalQuery; // Restore original

        assert.strictEqual(res.status, 200);
        assert(res.body.data);
        assert(res.body.total !== undefined);
    });

    await test('GET /patients - supports pagination', async () => {
        const originalQuery = mockDb.query.bind(mockDb);
        mockDb.query = function(sql, params) {
            if (sql.toLowerCase().includes('count(*)')) {
                return Promise.resolve({ rows: [{ count: '0' }] });
            }
            return Promise.resolve({ rows: [] });
        };

        const res = await makeRequest('GET', '/patients?page=2&limit=5', {
            user: { sub: 'doctor-123', role: 'doctor' },
        });

        mockDb.query = originalQuery;

        assert.strictEqual(res.status, 200);
        assert(res.body.data);
    });

    await test('GET /patients - supports sorting', async () => {
        const originalQuery = mockDb.query.bind(mockDb);
        mockDb.query = function(sql, params) {
            if (sql.toLowerCase().includes('count(*)')) {
                return Promise.resolve({ rows: [{ count: '0' }] });
            }
            return Promise.resolve({ rows: [] });
        };

        const res = await makeRequest('GET', '/patients?sortBy=email&order=desc', {
            user: { sub: 'doctor-123', role: 'doctor' },
        });

        mockDb.query = originalQuery;

        assert.strictEqual(res.status, 200);
    });

    await test('GET /patients - supports search', async () => {
        const originalQuery = mockDb.query.bind(mockDb);
        mockDb.query = function(sql, params) {
            if (sql.toLowerCase().includes('count(*)')) {
                return Promise.resolve({ rows: [{ count: '0' }] });
            }
            return Promise.resolve({ rows: [] });
        };

        const res = await makeRequest('GET', '/patients?search=john', {
            user: { sub: 'doctor-123', role: 'doctor' },
        });

        mockDb.query = originalQuery;

        assert.strictEqual(res.status, 200);
    });

    await test('GET /patients - non-doctor is forbidden', async () => {
        const res = await makeRequest('GET', '/patients', {
            user: { sub: 'patient-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 403);
    });

    await test('GET /patients/:id - doctor gets patient details', async () => {
        mockDb.mockResults.SELECT = {
            rows: [
                {
                    id: 'patient-1',
                    userid: 'user-1',
                    name: 'John Doe',
                    email: 'john@example.com',
                    dob: '1990-01-01',
                    conditions: 'None',
                },
            ],
        };

        const res = await makeRequest('GET', '/patients/patient-1', {
            user: { sub: 'doctor-123', role: 'doctor' },
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.id, 'patient-1');
        assert.strictEqual(res.body.name, 'John Doe');
    });

    await test('GET /patients/:id - 404 for non-existent patient', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('GET', '/patients/patient-999', {
            user: { sub: 'doctor-123', role: 'doctor' },
        });

        assert.strictEqual(res.status, 404);
    });

    await test('GET /patients/:id - non-doctor is forbidden', async () => {
        const res = await makeRequest('GET', '/patients/patient-1', {
            user: { sub: 'patient-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 403);
    });

    await test('POST /patients - fails without required fields', async () => {
        const res = await makeRequest('POST', '/patients', {
            user: { sub: 'doctor-123', role: 'doctor' },
            body: {
                name: 'John Doe',
                // missing email, password, dob
            },
        });

        assert.strictEqual(res.status, 400);
        assert(res.body.error.includes('Missing fields'));
    });

    await test('POST /patients - non-doctor is forbidden', async () => {
        const res = await makeRequest('POST', '/patients', {
            user: { sub: 'patient-123', role: 'patient' },
            body: {
                name: 'John Doe',
                email: 'john@example.com',
                password: 'password123',
                dob: '1990-01-01',
            },
        });

        assert.strictEqual(res.status, 403);
    });

    // Prescription request endpoints
    await test('GET /prescriptions/requests - doctor lists requests', async () => {
        const res = await makeRequest('GET', '/prescriptions/requests', {
            user: { sub: 'doctor-123', role: 'doctor' },
            headers: { Authorization: 'Bearer token' },
        });

        assert.strictEqual(res.status, 200);
    });

    await test('GET /prescriptions/requests - non-doctor is forbidden', async () => {
        const res = await makeRequest('GET', '/prescriptions/requests', {
            user: { sub: 'patient-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 403);
    });

    await test('POST /prescriptions/requests/:id/approve - doctor approves', async () => {
        const res = await makeRequest('POST', '/prescriptions/requests/req-1/approve', {
            user: { sub: 'doctor-123', role: 'doctor' },
            headers: { Authorization: 'Bearer token' },
        });

        assert.strictEqual(res.status, 200);
    });

    await test('POST /prescriptions/requests/:id/deny - doctor denies', async () => {
        const res = await makeRequest('POST', '/prescriptions/requests/req-1/deny', {
            user: { sub: 'doctor-123', role: 'doctor' },
            headers: { Authorization: 'Bearer token' },
        });

        assert.strictEqual(res.status, 200);
    });

    await test('POST /prescriptions/requests/:id/:action - non-doctor is forbidden', async () => {
        const res = await makeRequest('POST', '/prescriptions/requests/req-1/approve', {
            user: { sub: 'patient-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 403);
    });

    // Summary
    console.log(`\nTest Results:`);
    console.log(`   Passed: ${passed}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Total: ${passed + failed}`);

    process.exit(failed > 0 ? 1 : 0);
}

// Start server and run tests
setTimeout(() => {
    runTests().catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}, 200);