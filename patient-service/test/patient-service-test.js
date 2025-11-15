//Triger test1
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
    publishEvent: function(topic, payload) {
        mockKafka.publishedEvents.push({ topic, payload });
        return Promise.resolve();
    },
    startConsumer: function() {
        return Promise.resolve(null);
    },
    reset() {
        this.publishedEvents = [];
    },
};

// Mock nanoid
require.cache[require.resolve('nanoid')] = {
    exports: { nanoid: () => 'test-patient-id-123' },
};

// Setup mocks
require.cache[require.resolve('../src/db')] = { exports: mockDb };
require.cache[require.resolve('../src/kafka')] = { exports: mockKafka };

function makeRequest(method, path, options = {}) {
    return new Promise((resolve, reject) => {
        const { body, headers = {}, user } = options;

        if (user) {
            headers['x-user'] = JSON.stringify(user);
        }

        const req = require('http').request(
            {
                hostname: 'localhost',
                port: 3002,
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
    console.log('Starting patient-service tests...\n');

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            mockDb.reset();
            mockKafka.reset();
            await fn();
            console.log(`  ${name}`);
            passed++;
        } catch (error) {
            console.error(`  ${name}`);
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
        assert.strictEqual(res.body.service, 'patient-service');
        assert.strictEqual(res.body.ok, true);
    });

    // Profile creation tests
    await test('POST /profiles - patient creates own profile', async () => {
        mockDb.mockResults.SELECT = { rows: [] }; // No existing profile
        mockDb.mockResults.INSERT = { rows: [], rowCount: 1 };

        const res = await makeRequest('POST', '/profiles', {
            user: { sub: 'user-123', role: 'patient' },
            body: {
                name: 'John Doe',
                dob: '1990-01-01',
            },
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.id, 'test-patient-id-123');
        assert.strictEqual(res.body.userId, 'user-123');
        assert.strictEqual(res.body.name, 'John Doe');
    });

    await test('POST /profiles - admin creates profile for user', async () => {
        mockDb.mockResults.SELECT = { rows: [] };
        mockDb.mockResults.INSERT = { rows: [], rowCount: 1 };

        const res = await makeRequest('POST', '/profiles', {
            user: { sub: 'admin-123', role: 'admin' },
            body: {
                userId: 'user-456',
                name: 'Jane Doe',
                dob: '1985-05-15',
            },
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.userId, 'user-456');
    });

    await test('POST /profiles - doctor creates profile for patient', async () => {
        mockDb.mockResults.SELECT = { rows: [] };
        mockDb.mockResults.INSERT = { rows: [], rowCount: 1 };

        const res = await makeRequest('POST', '/profiles', {
            user: { sub: 'doctor-123', role: 'doctor' },
            body: {
                userId: 'patient-789',
                name: 'Bob Smith',
                dob: '1995-08-20',
            },
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.userId, 'patient-789');
    });

    await test('POST /profiles - fails when profile already exists', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{ id: 'existing-id', userid: 'user-123' }]
        };

        const res = await makeRequest('POST', '/profiles', {
            user: { sub: 'user-123', role: 'patient' },
            body: {
                name: 'John Doe',
                dob: '1990-01-01',
            },
        });

        assert.strictEqual(res.status, 409);
        assert(res.body.error.includes('exists'));
    });

    await test('POST /profiles - doctor fails without userId', async () => {
        const res = await makeRequest('POST', '/profiles', {
            user: { sub: 'doctor-123', role: 'doctor' },
            body: {
                name: 'Patient Name',
                dob: '1990-01-01',
            },
        });

        assert.strictEqual(res.status, 400);
        assert(res.body.error.includes('Missing target user'));
    });

    await test('POST /profiles - fails without user context', async () => {
        const res = await makeRequest('POST', '/profiles', {
            body: {
                name: 'John Doe',
                dob: '1990-01-01',
            },
        });

        assert.strictEqual(res.status, 401);
        assert(res.body.error.includes('No user'));
    });

    // Get profile tests
    await test('GET /profiles/me - patient gets own profile', async () => {
        mockDb.mockResults.SELECT = {
            rows: [
                {
                    id: 'patient-1',
                    userid: 'user-123',
                    name: 'John Doe',
                    dob: '1990-01-01',
                    conditions: [],
                },
            ],
        };

        const res = await makeRequest('GET', '/profiles/me', {
            user: { sub: 'user-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.id, 'patient-1');
        assert.strictEqual(res.body.name, 'John Doe');
    });

    await test('GET /profiles/me - 404 when profile not found', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('GET', '/profiles/me', {
            user: { sub: 'user-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 404);
    });

    await test('GET /profiles/me - 401 without user', async () => {
        const res = await makeRequest('GET', '/profiles/me');

        assert.strictEqual(res.status, 401);
    });

    // Delete profile tests
    await test('DELETE /profiles/me - patient deletes own profile', async () => {
        mockDb.mockResults.UPDATE = {
            rows: [{ id: 'patient-1', userid: 'user-123' }],
            rowCount: 1,
        };

        const res = await makeRequest('DELETE', '/profiles/me', {
            user: { sub: 'user-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.ok, true);
        assert.strictEqual(res.body.deleted, true);
    });

    await test('DELETE /profiles/me - returns false when no profile', async () => {
        mockDb.mockResults.UPDATE = { rows: [], rowCount: 0 };

        const res = await makeRequest('DELETE', '/profiles/me', {
            user: { sub: 'user-123', role: 'patient' },
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
            rows: [{ id: 'patient-123', userid: 'user-456' }],
            rowCount: 1,
        };

        const res = await makeRequest('DELETE', '/profiles/patient-123', {
            user: { sub: 'admin-123', role: 'admin' },
        });

        assert.strictEqual(res.status, 204);
    });

    await test('DELETE /profiles/:id - 404 when profile not found', async () => {
        mockDb.mockResults.UPDATE = { rows: [], rowCount: 0 };

        const res = await makeRequest('DELETE', '/profiles/patient-999', {
            user: { sub: 'admin-123', role: 'admin' },
        });

        assert.strictEqual(res.status, 404);
    });

    await test('DELETE /profiles/:id - non-admin is forbidden', async () => {
        const res = await makeRequest('DELETE', '/profiles/patient-123', {
            user: { sub: 'patient-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 403);
    });

    // Prescription request tests
    await test('POST /prescriptions/requests - patient creates request', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{ id: 'patient-1', userid: 'user-123' }],
        };
        mockDb.mockResults.INSERT = { rows: [], rowCount: 1 };

        const res = await makeRequest('POST', '/prescriptions/requests', {
            user: { sub: 'user-123', role: 'patient' },
            body: {
                medication: 'Aspirin',
                notes: 'Daily use',
            },
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.id, 'test-patient-id-123');
        assert.strictEqual(res.body.medication, 'Aspirin');
        assert.strictEqual(res.body.status, 'pending');
    });

    await test('POST /prescriptions/requests - fails without profile', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('POST', '/prescriptions/requests', {
            user: { sub: 'user-123', role: 'patient' },
            body: {
                medication: 'Aspirin',
                notes: 'Daily use',
            },
        });

        assert.strictEqual(res.status, 400);
        assert(res.body.error.includes('profile first'));
    });

    await test('POST /prescriptions/requests - non-patient is forbidden', async () => {
        const res = await makeRequest('POST', '/prescriptions/requests', {
            user: { sub: 'doctor-123', role: 'doctor' },
            body: {
                medication: 'Aspirin',
                notes: 'Daily use',
            },
        });

        assert.strictEqual(res.status, 403);
    });

    await test('GET /prescriptions/requests/mine - patient lists own requests', async () => {
        mockDb.mockResults.SELECT = {
            rows: [
                {
                    id: 'patient-1',
                    userid: 'user-123',
                },
            ],
        };

        // Second query for prescription requests
        const originalQuery = mockDb.query.bind(mockDb);
        let queryCount = 0;
        mockDb.query = function(sql, params) {
            queryCount++;
            if (queryCount === 1) {
                return Promise.resolve({
                    rows: [{ id: 'patient-1', userid: 'user-123' }],
                });
            }
            return Promise.resolve({
                rows: [
                    {
                        id: 'req-1',
                        patientid: 'patient-1',
                        medication: 'Aspirin',
                        status: 'pending',
                    },
                ],
            });
        };

        const res = await makeRequest('GET', '/prescriptions/requests/mine', {
            user: { sub: 'user-123', role: 'patient' },
        });

        mockDb.query = originalQuery;

        assert.strictEqual(res.status, 200);
        assert(Array.isArray(res.body));
    });

    await test('GET /prescriptions/requests/mine - non-patient is forbidden', async () => {
        const res = await makeRequest('GET', '/prescriptions/requests/mine', {
            user: { sub: 'admin-123', role: 'admin' },
        });

        assert.strictEqual(res.status, 403);
    });

    // Internal endpoints tests
    await test('GET /internal/prescriptions/requests - lists all requests', async () => {
        mockDb.mockResults.SELECT = {
            rows: [
                {
                    id: 'req-1',
                    patientid: 'patient-1',
                    medication: 'Aspirin',
                    status: 'pending',
                },
            ],
        };

        const res = await makeRequest('GET', '/internal/prescriptions/requests');

        assert.strictEqual(res.status, 200);
        assert(Array.isArray(res.body));
    });

    await test('POST /internal/prescriptions/requests/:id/status - updates status', async () => {
        mockDb.mockResults.UPDATE = {
            rows: [
                {
                    id: 'req-1',
                    patientid: 'patient-1',
                    status: 'approved',
                },
            ],
            rowCount: 1,
        };

        const res = await makeRequest('POST', '/internal/prescriptions/requests/req-1/status', {
            body: {
                status: 'approved',
            },
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, 'approved');
    });

    await test('POST /internal/prescriptions/requests/:id/status - 404 when not found', async () => {
        mockDb.mockResults.UPDATE = { rows: [], rowCount: 0 };

        const res = await makeRequest('POST', '/internal/prescriptions/requests/req-999/status', {
            body: {
                status: 'approved',
            },
        });

        assert.strictEqual(res.status, 404);
    });

    // Summary
    console.log(`\n Test Results:`);
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