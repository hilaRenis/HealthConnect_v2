
const assert = require('assert');
const http = require('http');

let passed = 0;
let failed = 0;

// Mock database - store original query function for reset
const originalQuery = async function(sql, params) {
    mockDb.queries.push({ sql, params });
    const sqlLower = sql.toLowerCase();

    if (sqlLower.includes('information_schema')) {
        return { rows: [{ column_name: 'starttime' }, { column_name: 'endtime' }] };
    }

    if (sqlLower.includes('insert')) {
        return mockDb.mockResults['INSERT'] || { rows: [], rowCount: 1 };
    }
    if (sqlLower.includes('update')) {
        return mockDb.mockResults['UPDATE'] || { rows: [], rowCount: 1 };
    }
    if (sqlLower.includes('select 1') || sqlLower.includes('overlaps')) {
        return mockDb.mockResults['CONFLICT'] || { rows: [] };
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
require.cache[require.resolve('nanoid')] = { exports: { nanoid: () => 'test-appt-123' } };

// Set environment
process.env.PORT = '3004';
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
            port: 3004,
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
    console.log('\n=== Appointment Service Tests ===\n');

    await new Promise(resolve => setTimeout(resolve, 200));

    // Health check
    await test('GET /health', async () => {
        const res = await makeRequest('GET', '/health');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.service, 'appointment-service');
    });

    // Create appointment - patient
    await test('POST / - patient creates appointment', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            if (callCount === 1) return { rows: [{ column_name: 'starttime' }] };
            if (callCount === 2) return { rows: [] };
            if (callCount === 3) return { rows: [], rowCount: 1 };
            return {
                rows: [{
                    id: 'test-appt-123',
                    patientuserid: 'patient-1',
                    doctoruserid: 'doctor-1',
                    date: '2025-12-01',
                    slot: '10:00',
                    status: 'pending',
                    starttime: '2025-12-01T10:00:00Z',
                    endtime: '2025-12-01T10:30:00Z'
                }]
            };
        };

        const res = await makeRequest('POST', '/', {
            user: { sub: 'patient-1', role: 'patient' },
            body: {
                doctorUserId: 'doctor-1',
                date: '2025-12-01',
                slot: '10:00',
                startTime: '2025-12-01T10:00:00Z',
                endTime: '2025-12-01T10:30:00Z'
            }
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.id, 'test-appt-123');
    });

    await test('POST / - admin creates appointment', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            // Column check
            if (callCount === 1) return { rows: [] };
            // Conflict check - no conflicts
            if (callCount === 2) return { rows: [] };
            // Insert with RETURNING - returns the complete inserted appointment
            return {
                rows: [{
                    id: 'test-appt-123',
                    patientuserid: 'patient-1',
                    doctoruserid: 'doctor-1',
                    date: '2025-12-01',
                    slot: '10:00',
                    status: 'pending',
                    starttime: null,
                    endtime: null
                }],
                rowCount: 1
            };
        };

        const res = await makeRequest('POST', '/', {
            user: { sub: 'admin-1', role: 'admin' },
            body: {
                patientUserId: 'patient-1',
                doctorUserId: 'doctor-1',
                date: '2025-12-01',
                slot: '10:00'
            }
        });

        assert.strictEqual(res.status, 201);
    });

    await test('POST / - doctor creates appointment', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            // Column check
            if (callCount === 1) return { rows: [] };
            // Conflict check - no conflicts
            if (callCount === 2) return { rows: [] };
            // Insert with RETURNING - returns the complete inserted appointment
            return {
                rows: [{
                    id: 'test-appt-123',
                    patientuserid: 'patient-1',
                    doctoruserid: 'doctor-1',
                    date: '2025-12-01',
                    slot: '10:00',
                    status: 'pending',
                    starttime: null,
                    endtime: null
                }],
                rowCount: 1
            };
        };

        const res = await makeRequest('POST', '/', {
            user: { sub: 'doctor-1', role: 'doctor' },
            body: {
                patientUserId: 'patient-1',
                date: '2025-12-01',
                slot: '10:00'
            }
        });

        assert.strictEqual(res.status, 201);
    });

    await test('POST / - fails without patientUserId for admin', async () => {
        const res = await makeRequest('POST', '/', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { doctorUserId: 'doctor-1', date: '2025-12-01', slot: '10:00' }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('POST / - fails without doctorUserId', async () => {
        const res = await makeRequest('POST', '/', {
            user: { sub: 'patient-1', role: 'patient' },
            body: { date: '2025-12-01', slot: '10:00' }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('POST / - fails without date/slot', async () => {
        const res = await makeRequest('POST', '/', {
            user: { sub: 'patient-1', role: 'patient' },
            body: { doctorUserId: 'doctor-1' }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('POST / - 409 on conflict (time columns)', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            if (callCount === 1) return { rows: [{ column_name: 'starttime' }] };
            return { rows: [{ id: 'existing' }] };
        };

        const res = await makeRequest('POST', '/', {
            user: { sub: 'patient-1', role: 'patient' },
            body: {
                doctorUserId: 'doctor-1',
                date: '2025-12-01',
                slot: '10:00',
                startTime: '2025-12-01T10:00:00Z',
                endTime: '2025-12-01T10:30:00Z'
            }
        });

        assert.strictEqual(res.status, 409);
    });

    await test('POST / - 409 on conflict (no time columns)', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            // Column check - no time columns
            if (callCount === 1) return { rows: [] };
            // Conflict check - has conflict, should stop here and return 409
            if (callCount === 2) return { rows: [{ id: 'existing' }] };
            // If INSERT is attempted after conflict, return empty to ensure it fails
            return { rows: [], rowCount: 0 };
        };

        const res = await makeRequest('POST', '/', {
            user: { sub: 'patient-1', role: 'patient' },
            body: {
                doctorUserId: 'doctor-1',
                date: '2025-12-01',
                slot: '10:00'
            }
        });

        assert.strictEqual(res.status, 409);
    });

    // List all appointments (admin)
    await test('GET / - admin lists appointments', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            if (callCount === 1) return { rows: [] };
            return {
                rows: [{
                    id: 'appt-1',
                    patientuserid: 'patient-1',
                    doctoruserid: 'doctor-1',
                    status: 'pending',
                    date: '2025-12-01',
                    slot: '10:00'
                }]
            };
        };

        const res = await makeRequest('GET', '/', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 200);
        assert(Array.isArray(res.body));
    });

    await test('GET / - forbidden for non-admin', async () => {
        const res = await makeRequest('GET', '/', {
            user: { sub: 'patient-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 403);
    });

    // List my appointments
    await test('GET /mine - user lists own appointments', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            if (callCount === 1) return { rows: [] };
            return { rows: [{ id: 'appt-1', patientuserid: 'patient-1' }] };
        };

        const res = await makeRequest('GET', '/mine', {
            user: { sub: 'patient-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 200);
        assert(Array.isArray(res.body));
    });

    // Get appointment by ID
    await test('GET /:id - patient gets own appointment', async () => {
        mockDb.query = async function() {
            return {
                rows: [{
                    id: 'appt-1',
                    patientuserid: 'patient-1',
                    doctoruserid: 'doctor-1',
                    status: 'pending'
                }]
            };
        };

        const res = await makeRequest('GET', '/appt-1', {
            user: { sub: 'patient-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('GET /:id - doctor gets appointment', async () => {
        mockDb.query = async function() {
            return {
                rows: [{
                    id: 'appt-1',
                    patientuserid: 'patient-1',
                    doctoruserid: 'doctor-1',
                    status: 'pending'
                }]
            };
        };

        const res = await makeRequest('GET', '/appt-1', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('GET /:id - admin gets any appointment', async () => {
        mockDb.query = async function() {
            return {
                rows: [{ id: 'appt-1', patientuserid: 'patient-1', doctoruserid: 'doctor-1' }]
            };
        };

        const res = await makeRequest('GET', '/appt-1', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('GET /:id - 404 when not found', async () => {
        mockDb.query = async function() {
            return { rows: [] };
        };

        const res = await makeRequest('GET', '/appt-999', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 404);
    });

    await test('GET /:id - 403 for unauthorized user', async () => {
        mockDb.query = async function() {
            return {
                rows: [{ id: 'appt-1', patientuserid: 'patient-1', doctoruserid: 'doctor-1' }]
            };
        };

        const res = await makeRequest('GET', '/appt-1', {
            user: { sub: 'other-user', role: 'patient' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Update appointment
    await test('PUT /:id - admin updates appointment', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            const sqlLower = sql.toLowerCase();

            // Get existing appointment (SELECT ... WHERE id = ...)
            if (sqlLower.includes('select') && sqlLower.includes('from appointments') && callCount === 1) {
                return {
                    rows: [{
                        id: 'appt-1',
                        patientuserid: 'patient-1',
                        doctoruserid: 'doctor-1',
                        date: '2025-12-01',
                        slot: '10:00',
                        status: 'pending',
                        starttime: null,
                        endtime: null
                    }]
                };
            }
            // Column check (information_schema)
            if (sqlLower.includes('information_schema') || callCount === 2) {
                return { rows: [] };
            }
            // Conflict check (SELECT 1 or overlaps check)
            if ((sqlLower.includes('select 1') || sqlLower.includes('overlaps')) && callCount === 3) {
                return { rows: [] };
            }
            // Update with RETURNING
            if (sqlLower.includes('update')) {
                return {
                    rows: [{
                        id: 'appt-1',
                        patientuserid: 'patient-1',
                        doctoruserid: 'doctor-1',
                        date: '2025-12-01',
                        slot: '10:00',
                        status: 'confirmed',
                        starttime: '2025-12-01T10:00:00Z',
                        endtime: '2025-12-01T11:00:00Z'
                    }],
                    rowCount: 1
                };
            }
            // Default - return complete data just in case
            return {
                rows: [{
                    id: 'appt-1',
                    patientuserid: 'patient-1',
                    doctoruserid: 'doctor-1',
                    date: '2025-12-01',
                    slot: '10:00',
                    status: 'confirmed',
                    starttime: '2025-12-01T10:00:00Z',
                    endtime: '2025-12-01T11:00:00Z'
                }]
            };
        };

        const res = await makeRequest('PUT', '/appt-1', {
            user: { sub: 'admin-1', role: 'admin' },
            body: {
                patientUserId: 'patient-1',
                doctorUserId: 'doctor-1',
                startTime: '2025-12-01T10:00:00Z',
                endTime: '2025-12-01T11:00:00Z',
                status: 'confirmed'
            }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('PUT /:id - 404 when not found', async () => {
        mockDb.query = async function() {
            return { rows: [] };
        };

        const res = await makeRequest('PUT', '/appt-999', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { status: 'confirmed' }
        });

        assert.strictEqual(res.status, 404);
    });

    await test('PUT /:id - fails without required fields', async () => {
        mockDb.query = async function() {
            return {
                rows: [{ id: 'appt-1', patientuserid: 'patient-1', doctoruserid: 'doctor-1' }]
            };
        };

        const res = await makeRequest('PUT', '/appt-1', {
            user: { sub: 'admin-1', role: 'admin' },
            body: {}
        });

        assert.strictEqual(res.status, 400);
    });

    await test('PUT /:id - non-admin is forbidden', async () => {
        const res = await makeRequest('PUT', '/appt-1', {
            user: { sub: 'patient-1', role: 'patient' },
            body: { status: 'confirmed' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Delete appointment
    await test('DELETE /:id - admin deletes appointment', async () => {
        mockDb.query = async function(sql) {
            const sqlLower = sql.toLowerCase();
            if (sqlLower.includes('update')) {
                return {
                    rows: [{ id: 'appt-1', patientuserid: 'patient-1', doctoruserid: 'doctor-1' }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 0 };
        };

        const res = await makeRequest('DELETE', '/appt-1', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 204);
    });

    await test('DELETE /:id - 404 when not found', async () => {
        mockDb.query = async function() {
            return { rows: [], rowCount: 0 };
        };

        const res = await makeRequest('DELETE', '/appt-999', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 404);
    });

    await test('DELETE /:id - non-admin is forbidden', async () => {
        const res = await makeRequest('DELETE', '/appt-1', {
            user: { sub: 'patient-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Doctor actions
    await test('POST /:id/approve - doctor approves', async () => {
        mockDb.query = async function(sql) {
            const sqlLower = sql.toLowerCase();
            if (sqlLower.includes('update')) {
                return {
                    rows: [{ id: 'appt-1', status: 'approved' }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 0 };
        };

        const res = await makeRequest('POST', '/appt-1/approve', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, 'approved');
    });

    await test('POST /:id/approve - 404 when not found', async () => {
        mockDb.query = async function() {
            return { rows: [], rowCount: 0 };
        };

        const res = await makeRequest('POST', '/appt-999/approve', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 404);
    });

    await test('POST /:id/approve - non-doctor is forbidden', async () => {
        const res = await makeRequest('POST', '/appt-1/approve', {
            user: { sub: 'patient-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 403);
    });

    await test('POST /:id/deny - doctor denies', async () => {
        mockDb.query = async function(sql) {
            const sqlLower = sql.toLowerCase();
            if (sqlLower.includes('update')) {
                return {
                    rows: [{ id: 'appt-1', status: 'denied' }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 0 };
        };

        const res = await makeRequest('POST', '/appt-1/deny', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, 'denied');
    });

    await test('POST /:id/deny - non-doctor is forbidden', async () => {
        const res = await makeRequest('POST', '/appt-1/deny', {
            user: { sub: 'patient-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Cancel appointment
    await test('POST /:id/cancel - patient cancels', async () => {
        mockDb.query = async function(sql) {
            const sqlLower = sql.toLowerCase();
            if (sqlLower.includes('update')) {
                return {
                    rows: [{ id: 'appt-1', status: 'cancelled' }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 0 };
        };

        const res = await makeRequest('POST', '/appt-1/cancel', {
            user: { sub: 'patient-1', role: 'patient' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, 'cancelled');
    });

    await test('POST /:id/cancel - doctor cancels', async () => {
        mockDb.query = async function(sql) {
            const sqlLower = sql.toLowerCase();
            if (sqlLower.includes('update')) {
                return {
                    rows: [{ id: 'appt-1', status: 'cancelled' }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 0 };
        };

        const res = await makeRequest('POST', '/appt-1/cancel', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('POST /:id/cancel - 404 for unauthorized', async () => {
        mockDb.query = async function() {
            return { rows: [], rowCount: 0 };
        };

        const res = await makeRequest('POST', '/appt-1/cancel', {
            user: { sub: 'other-user', role: 'patient' }
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