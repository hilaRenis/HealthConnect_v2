const assert = require('assert');

// Mock database
const mockDb = {
    queries: [],
    mockResults: {},
    selectCallCount: 0,
    query(sql, params) {
        this.queries.push({ sql, params });

        // Smarter query matching
        const sqlLower = sql.toLowerCase();

        // Check for schema query (check if time columns exist)
        if (sqlLower.includes('information_schema')) {
            return Promise.resolve({ rows: [{ column_name: 'starttime' }, { column_name: 'endtime' }] });
        }

        // For INSERT operations
        if (sqlLower.startsWith('insert')) {
            return Promise.resolve(this.mockResults['INSERT'] || { rows: [] });
        }

        // For UPDATE operations (includes soft deletes and RETURNING clauses)
        if (sqlLower.startsWith('update')) {
            return Promise.resolve(this.mockResults['UPDATE'] || { rows: [] });
        }

        // For SELECT operations - need to distinguish between conflict checks and data fetches
        if (sqlLower.startsWith('select')) {
            // Conflict check queries - these look for SELECT 1 or use OVERLAPS
            if (sqlLower.includes('select 1') || sqlLower.includes('overlaps')) {
                return Promise.resolve(this.mockResults['CONFLICT'] || { rows: [] });
            }

            return Promise.resolve(this.mockResults['SELECT'] || { rows: [] });
        }

        // Fallback
        const key = sql.split(' ')[0].toUpperCase();
        return Promise.resolve(this.mockResults[key] || { rows: [] });
    },
    reset() {
        this.queries = [];
        this.mockResults = {};
        this.selectCallCount = 0;
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

// Mock modules
require.cache[require.resolve('../src/db')] = {
    exports: mockDb,
};

require.cache[require.resolve('../src/kafka')] = {
    exports: mockKafka,
};

// Mock nanoid
require.cache[require.resolve('nanoid')] = {
    exports: { nanoid: () => 'test-appointment-id-123' },
};

// Load the module after mocks are set
const { createApp } = require('../src/http');

let app;
let server;

function makeRequest(method, path, options = {}) {
    return new Promise((resolve, reject) => {
        const { body, headers = {}, user } = options;

        if (user) {
            headers['x-user'] = JSON.stringify(user);
        }

        const req = require('http').request(
            {
                hostname: 'localhost',
                port: 3004,
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
    console.log('Starting appointment-service tests...\n');

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            mockDb.reset();
            mockKafka.reset();
            await fn();
            console.log(`${name}`);
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

    // Setup test server
    await test('Server setup', async () => {
        const routes = require('../src/index');
        // Server already started in index.js, we'll use that
        await new Promise((resolve) => setTimeout(resolve, 100));
    });

    // Health check
    await test('GET /health - should return service status', async () => {
        const res = await makeRequest('GET', '/health');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.service, 'appointment-service');
        assert.strictEqual(res.body.ok, true);
    });

    await test('POST / - fails without doctorUserId for patient', async () => {
        const res = await makeRequest('POST', '/', {
            user: { sub: 'patient-123', role: 'patient' },
            body: {
                date: '2025-12-01',
                slot: '10:00',
            },
        });

        assert.strictEqual(res.status, 400);
        assert(res.body.error.includes('doctorUserId'));
    });

    await test('POST / - fails without date/slot', async () => {
        const res = await makeRequest('POST', '/', {
            user: { sub: 'patient-123', role: 'patient' },
            body: {
                doctorUserId: 'doctor-456',
            },
        });

        assert.strictEqual(res.status, 400);
        assert(res.body.error.includes('date/slot'));
    });

    await test('POST / - detects time slot conflict', async () => {
        mockDb.mockResults.CONFLICT = { rows: [{ id: 'existing-appt' }] };
        mockDb.mockResults.SELECT = { rows: [] }; // Empty for final SELECT after insert

        const res = await makeRequest('POST', '/', {
            user: { sub: 'patient-123', role: 'patient' },
            body: {
                doctorUserId: 'doctor-456',
                date: '2025-12-01',
                slot: '10:00',
            },
        });

        assert.strictEqual(res.status, 409);
        assert(res.body.error.includes('already booked'));
    });

    await test('POST / - admin fails without patientUserId', async () => {
        const res = await makeRequest('POST', '/', {
            user: { sub: 'admin-123', role: 'admin' },
            body: {
                doctorUserId: 'doctor-456',
                date: '2025-12-01',
                slot: '10:00',
            },
        });

        assert.strictEqual(res.status, 400);
        assert(res.body.error.includes('patientUserId'));
    });

    // List appointments
    await test('GET / - admin lists all appointments', async () => {
        mockDb.mockResults.SELECT = {
            rows: [
                {
                    id: 'appt-1',
                    patientuserid: 'patient-123',
                    doctoruserid: 'doctor-456',
                    date: '2025-12-01',
                    slot: '10:00',
                    status: 'pending',
                    starttime: null,
                    endtime: null,
                },
                {
                    id: 'appt-2',
                    patientuserid: 'patient-789',
                    doctoruserid: 'doctor-456',
                    date: '2025-12-02',
                    slot: '14:00',
                    status: 'approved',
                    starttime: null,
                    endtime: null,
                },
            ],
        };

        const res = await makeRequest('GET', '/', {
            user: { sub: 'admin-123', role: 'admin' },
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.length, 2);
        assert.strictEqual(res.body[0].id, 'appt-1');
    });

    await test('GET / - non-admin is forbidden', async () => {
        const res = await makeRequest('GET', '/', {
            user: { sub: 'patient-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 403);
    });

    // List mine
    await test('GET /mine - lists user appointments', async () => {
        mockDb.mockResults.SELECT = {
            rows: [
                {
                    id: 'appt-1',
                    patientuserid: 'user-123',
                    doctoruserid: 'doctor-456',
                    date: '2025-12-01',
                    slot: '10:00',
                    status: 'pending',
                    starttime: null,
                    endtime: null,
                },
            ],
        };

        const res = await makeRequest('GET', '/mine', {
            user: { sub: 'user-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.length, 1);
        assert.strictEqual(res.body[0].id, 'appt-1');
    });

    // Get specific appointment
    await test('GET /:id - fetches appointment', async () => {
        mockDb.mockResults.SELECT = {
            rows: [
                {
                    id: 'appt-123',
                    patientuserid: 'patient-123',
                    doctoruserid: 'doctor-456',
                    date: '2025-12-01',
                    slot: '10:00',
                    status: 'pending',
                    starttime: null,
                    endtime: null,
                },
            ],
        };

        const res = await makeRequest('GET', '/appt-123', {
            user: { sub: 'patient-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.id, 'appt-123');
    });

    await test('GET /:id - 404 for non-existent appointment', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('GET', '/appt-999', {
            user: { sub: 'patient-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 404);
    });

    await test('GET /:id - 403 for unauthorized user', async () => {
        mockDb.mockResults.SELECT = {
            rows: [
                {
                    id: 'appt-123',
                    patientuserid: 'patient-123',
                    doctoruserid: 'doctor-456',
                    starttime: null,
                    endtime: null,
                },
            ],
        };

        const res = await makeRequest('GET', '/appt-123', {
            user: { sub: 'other-user', role: 'patient' },
        });

        assert.strictEqual(res.status, 403);
    });

    // Update appointment
    await test('PUT /:id - admin updates appointment', async () => {
        mockDb.mockResults.CONFLICT = { rows: [] }; // No conflicts
        mockDb.mockResults.SELECT = {
            rows: [
                {
                    id: 'appt-123',
                    patientuserid: 'patient-123',
                    doctoruserid: 'doctor-456',
                    date: '2025-12-01',
                    slot: '10:00',
                    status: 'pending',
                    starttime: null,
                    endtime: null,
                },
            ],
        };
        mockDb.mockResults.UPDATE = { rows: [] };

        const res = await makeRequest('PUT', '/appt-123', {
            user: { sub: 'admin-123', role: 'admin' },
            body: {
                status: 'approved',
                date: '2025-12-02',
                slot: '11:00',
            },
        });

        assert.strictEqual(res.status, 200);
    });

    await test('PUT /:id - 404 for non-existent appointment', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('PUT', '/appt-999', {
            user: { sub: 'admin-123', role: 'admin' },
            body: { status: 'approved' },
        });

        assert.strictEqual(res.status, 404);
    });

    await test('PUT /:id - non-admin is forbidden', async () => {
        const res = await makeRequest('PUT', '/appt-123', {
            user: { sub: 'patient-123', role: 'patient' },
            body: { status: 'approved' },
        });

        assert.strictEqual(res.status, 403);
    });

    // Delete appointment
    await test('DELETE /:id - admin deletes appointment', async () => {
        mockDb.mockResults.UPDATE = {
            rows: [
                {
                    id: 'appt-123',
                    patientuserid: 'patient-123',
                    doctoruserid: 'doctor-456',
                },
            ],
        };

        const res = await makeRequest('DELETE', '/appt-123', {
            user: { sub: 'admin-123', role: 'admin' },
        });

        assert.strictEqual(res.status, 204);
    });

    await test('DELETE /:id - 404 for non-existent appointment', async () => {
        mockDb.mockResults.UPDATE = { rows: [] };

        const res = await makeRequest('DELETE', '/appt-999', {
            user: { sub: 'admin-123', role: 'admin' },
        });

        assert.strictEqual(res.status, 404);
    });

    await test('DELETE /:id - non-admin is forbidden', async () => {
        const res = await makeRequest('DELETE', '/appt-123', {
            user: { sub: 'patient-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 403);
    });

    // Doctor actions
    await test('POST /:id/approve - doctor approves appointment', async () => {
        mockDb.mockResults.UPDATE = {
            rows: [
                {
                    id: 'appt-123',
                    patientuserid: 'patient-123',
                    doctoruserid: 'doctor-456',
                    status: 'approved',
                },
            ],
        };

        const res = await makeRequest('POST', '/appt-123/approve', {
            user: { sub: 'doctor-456', role: 'doctor' },
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, 'approved');
    });

    await test('POST /:id/approve - 404 for non-existent or unauthorized', async () => {
        mockDb.mockResults.UPDATE = { rows: [] };

        const res = await makeRequest('POST', '/appt-123/approve', {
            user: { sub: 'doctor-456', role: 'doctor' },
        });

        assert.strictEqual(res.status, 404);
    });

    await test('POST /:id/deny - doctor denies appointment', async () => {
        mockDb.mockResults.UPDATE = {
            rows: [
                {
                    id: 'appt-123',
                    patientuserid: 'patient-123',
                    doctoruserid: 'doctor-456',
                    status: 'denied',
                },
            ],
        };

        const res = await makeRequest('POST', '/appt-123/deny', {
            user: { sub: 'doctor-456', role: 'doctor' },
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, 'denied');
    });

    await test('POST /:id/cancel - patient cancels appointment', async () => {
        mockDb.mockResults.UPDATE = {
            rows: [
                {
                    id: 'appt-123',
                    patientuserid: 'patient-123',
                    doctoruserid: 'doctor-456',
                    status: 'cancelled',
                },
            ],
        };

        const res = await makeRequest('POST', '/appt-123/cancel', {
            user: { sub: 'patient-123', role: 'patient' },
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, 'cancelled');
    });

    await test('POST /:id/cancel - doctor cancels appointment', async () => {
        mockDb.mockResults.UPDATE = {
            rows: [
                {
                    id: 'appt-123',
                    patientuserid: 'patient-123',
                    doctoruserid: 'doctor-456',
                    status: 'cancelled',
                },
            ],
        };

        const res = await makeRequest('POST', '/appt-123/cancel', {
            user: { sub: 'doctor-456', role: 'doctor' },
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, 'cancelled');
    });

    await test('POST /:id/cancel - 404 for unauthorized user', async () => {
        mockDb.mockResults.UPDATE = { rows: [] };

        const res = await makeRequest('POST', '/appt-123/cancel', {
            user: { sub: 'other-user', role: 'patient' },
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