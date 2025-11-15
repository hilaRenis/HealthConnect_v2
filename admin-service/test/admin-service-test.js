const assert = require('assert');
const http = require('http');

let passed = 0;
let failed = 0;

// Mock database
const mockDb = {
    queries: [],
    mockResults: {},
    query: async function(sql, params) {
        this.queries.push({ sql, params });
        const sqlLower = sql.toLowerCase();

        if (sqlLower.includes('insert')) {
            return this.mockResults['INSERT'] || { rows: [], rowCount: 1 };
        }
        if (sqlLower.includes('update')) {
            return this.mockResults['UPDATE'] || { rows: [], rowCount: 1 };
        }
        if (sqlLower.includes('select')) {
            return this.mockResults['SELECT'] || { rows: [] };
        }

        return { rows: [], rowCount: 0 };
    },
    reset() {
        this.queries = [];
        this.mockResults = {};
    }
};

// Mock axios
const mockAxios = {
    post: async () => ({ data: { id: 'mock-id', success: true } }),
    put: async () => ({ data: { id: 'mock-id', success: true } }),
    get: async () => ({ data: { id: 'mock-id' } }),
    delete: async () => ({ data: {} })
};

// Mock Kafka
const mockKafka = {
    publishedEvents: [],
    publishEvent: async function(topic, payload, options) {
        this.publishedEvents.push({ topic, payload, options });
    },
    startConsumer: async function() {
        return {};
    },
    reset() {
        this.publishedEvents = [];
    }
};

// Setup mocks
require.cache[require.resolve('../admin-service/src/db')] = { exports: mockDb };
require.cache[require.resolve('../admin-service/src/axiosInstance')] = { exports: mockAxios };
require.cache[require.resolve('../admin-service/src/kafka')] = { exports: mockKafka };

// Set environment
process.env.PORT = '3006';
process.env.KAFKA_BROKERS = 'none';

// Load the service
delete require.cache[require.resolve('../admin-service/src/index')];
require('../admin-service/src/index');

function makeRequest(method, path, options = {}) {
    return new Promise((resolve, reject) => {
        const { body, headers = {}, user } = options;

        if (user) {
            headers['x-user'] = JSON.stringify(user);
        }

        const req = http.request({
            hostname: 'localhost',
            port: 3006,
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
    console.log('\n=== Admin Service Tests ===\n');

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 200));

    // Health check
    await test('GET /health', async () => {
        const res = await makeRequest('GET', '/health');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.service, 'admin-service');
        assert.strictEqual(res.body.ok, true);
    });

    // Users endpoint
    await test('GET /users/:id - admin gets user', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{ id: 'user-1', role: 'doctor', name: 'Dr. Smith', email: 'smith@test.com' }]
        };

        const res = await makeRequest('GET', '/users/user-1', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.id, 'user-1');
    });

    await test('GET /users/:id - 404 when not found', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('GET', '/users/user-999', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 404);
    });

    await test('GET /users/:id - forbidden for non-admin', async () => {
        const res = await makeRequest('GET', '/users/user-1', {
            user: { sub: 'doctor-1', role: 'doctor' }
        });

        assert.strictEqual(res.status, 403);
    });

    // Doctors endpoints
    await test('POST /doctors - admin creates doctor', async () => {
        const res = await makeRequest('POST', '/doctors', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'Dr. Smith', email: 'smith@test.com', password: 'pass123' }
        });

        assert.strictEqual(res.status, 201);
    });

    await test('POST /doctors - fails without required fields', async () => {
        const res = await makeRequest('POST', '/doctors', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'Dr. Smith' }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('PUT /doctors/:id - admin updates doctor', async () => {
        const res = await makeRequest('PUT', '/doctors/doc-1', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'Dr. John Smith', email: 'john@test.com' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('PUT /doctors/:id - fails without required fields', async () => {
        const res = await makeRequest('PUT', '/doctors/doc-1', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'Dr. Smith' }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('PUT /doctors/:id - updates with password', async () => {
        const res = await makeRequest('PUT', '/doctors/doc-1', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'Dr. Smith', email: 'smith@test.com', password: 'newpass' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('DELETE /doctors/:id - admin deletes doctor', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{ id: 'doc-1' }]
        };

        const res = await makeRequest('DELETE', '/doctors/doc-1', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 204);
    });

    await test('DELETE /doctors/:id - 404 when not found', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('DELETE', '/doctors/doc-999', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 404);
    });

    // Stats endpoint
    await test('GET /stats - admin gets stats', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            return { rows: [{ count: callCount === 1 ? '10' : '5' }] };
        };

        const res = await makeRequest('GET', '/stats', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.patients, 10);
        assert.strictEqual(res.body.doctors, 5);
    });

    // Doctors list
    await test('GET /doctors - admin lists doctors', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            if (callCount === 1) {
                return { rows: [{ id: 'doc-1', name: 'Dr. Smith', email: 'smith@test.com' }] };
            }
            return { rows: [{ count: '1' }] };
        };

        const res = await makeRequest('GET', '/doctors', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 200);
        assert(Array.isArray(res.body.data));
        assert.strictEqual(res.body.total, 1);
    });

    await test('GET /doctors - supports pagination and sorting', async () => {
        let callCount = 0;
        mockDb.query = async function() {
            callCount++;
            return callCount === 1 ? { rows: [] } : { rows: [{ count: '0' }] };
        };

        const res = await makeRequest('GET', '/doctors?page=2&limit=5&sortBy=email&order=desc&search=smith', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 200);
    });

    // Patients list
    await test('GET /patients - admin lists patients', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            if (callCount === 1) {
                return {
                    rows: [{
                        id: 'pat-1',
                        userid: 'user-1',
                        name: 'John Doe',
                        dob: '1990-01-01',
                        conditions: [],
                        email: 'john@test.com',
                        user_name: 'John Doe',
                        user_role: 'patient',
                        doctor_id: 'doc-1',
                        doctor_name: 'Dr. Smith',
                        doctor_email: 'smith@test.com'
                    }]
                };
            }
            return { rows: [{ count: '1' }] };
        };

        const res = await makeRequest('GET', '/patients', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 200);
        assert(Array.isArray(res.body.data));
    });

    await test('GET /patients - supports all sort options', async () => {
        let callCount = 0;
        mockDb.query = async function() {
            callCount++;
            return callCount === 1 ? { rows: [] } : { rows: [{ count: '0' }] };
        };

        const res = await makeRequest('GET', '/patients?sortBy=dob&order=desc', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('GET /patients/:id - admin gets patient', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{
                id: 'pat-1',
                userid: 'user-1',
                name: 'John Doe',
                dob: '1990-01-01',
                conditions: [],
                email: 'john@test.com',
                user_name: 'John',
                user_role: 'patient',
                doctor_id: 'doc-1',
                doctor_name: 'Dr. Smith',
                doctor_email: 'smith@test.com'
            }]
        };

        const res = await makeRequest('GET', '/patients/pat-1', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.id, 'pat-1');
        assert(res.body.doctor);
    });

    await test('GET /patients/:id - 404 when not found', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('GET', '/patients/pat-999', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 404);
    });

    await test('DELETE /patients/:id - admin deletes patient', async () => {
        mockDb.mockResults.SELECT = {
            rows: [{
                id: 'pat-1',
                userid: 'user-1',
                name: 'John'
            }]
        };

        const res = await makeRequest('DELETE', '/patients/pat-1', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 204);
    });

    await test('DELETE /patients/:id - 404 when not found', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('DELETE', '/patients/pat-999', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 404);
    });

    // Assign doctor
    await test('POST /patients/:id/assign-doctor - assigns doctor', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            if (callCount === 1) {
                return { rows: [{ id: 'pat-1', userid: 'user-1' }] };
            }
            if (callCount === 2) {
                return { rows: [] };
            }
            if (callCount === 3) {
                return { rows: [{ id: 'doc-1' }] };
            }
            return { rows: [{ id: 'pat-1', userid: 'user-1', doctor_id: 'doc-1', doctor_name: 'Dr. Smith', doctor_email: 'smith@test.com' }] };
        };

        const res = await makeRequest('POST', '/patients/pat-1/assign-doctor', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { doctorId: 'doc-1' }
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.ok, true);
    });

    await test('POST /patients/:id/assign-doctor - unassigns doctor', async () => {
        let callCount = 0;
        mockDb.query = async function(sql) {
            callCount++;
            if (callCount === 1) {
                return { rows: [{ id: 'pat-1', userid: 'user-1' }] };
            }
            if (callCount === 2) {
                return { rows: [{ doctorid: 'doc-old' }] };
            }
            return { rows: [{ id: 'pat-1', userid: 'user-1' }] };
        };

        const res = await makeRequest('POST', '/patients/pat-1/assign-doctor', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { doctorId: '' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('POST /patients/:id/assign-doctor - 404 for missing patient', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('POST', '/patients/pat-999/assign-doctor', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { doctorId: 'doc-1' }
        });

        assert.strictEqual(res.status, 404);
    });

    await test('POST /patients/:id/assign-doctor - 404 for missing doctor', async () => {
        let callCount = 0;
        mockDb.query = async function() {
            callCount++;
            if (callCount === 1) return { rows: [{ id: 'pat-1' }] };
            if (callCount === 2) return { rows: [] };
            return { rows: [] };
        };

        const res = await makeRequest('POST', '/patients/pat-1/assign-doctor', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { doctorId: 'doc-999' }
        });

        assert.strictEqual(res.status, 404);
    });

    // Appointments
    await test('POST /appointments - admin creates appointment', async () => {
        let callCount = 0;
        mockDb.query = async function() {
            callCount++;
            if (callCount === 1) return { rows: [{ userid: 'user-1' }] };
            return { rows: [{ id: 'doc-1' }] };
        };

        const res = await makeRequest('POST', '/appointments', {
            user: { sub: 'admin-1', role: 'admin' },
            body: {
                patientId: 'pat-1',
                doctorId: 'doc-1',
                startTime: '2025-12-01T10:00:00Z',
                endTime: '2025-12-01T11:00:00Z'
            }
        });

        assert.strictEqual(res.status, 201);
    });

    await test('POST /appointments - doctor creates for assigned patient', async () => {
        let callCount = 0;
        mockDb.query = async function() {
            callCount++;
            if (callCount === 1) return { rows: [{ userid: 'user-1' }] };
            if (callCount === 2) return { rows: [{ id: '1' }] };
            return { rows: [{ id: 'doc-1' }] };
        };

        const res = await makeRequest('POST', '/appointments', {
            user: { sub: 'doc-1', role: 'doctor' },
            body: {
                patientId: 'pat-1',
                startTime: '2025-12-01T10:00:00Z',
                endTime: '2025-12-01T11:00:00Z'
            }
        });

        assert.strictEqual(res.status, 201);
    });

    await test('POST /appointments - 403 doctor not assigned to patient', async () => {
        let callCount = 0;
        mockDb.query = async function() {
            callCount++;
            if (callCount === 1) return { rows: [{ userid: 'user-1' }] };
            return { rows: [] };
        };

        const res = await makeRequest('POST', '/appointments', {
            user: { sub: 'doc-1', role: 'doctor' },
            body: {
                patientId: 'pat-1',
                startTime: '2025-12-01T10:00:00Z',
                endTime: '2025-12-01T11:00:00Z'
            }
        });

        assert.strictEqual(res.status, 403);
    });

    await test('POST /appointments - fails without required fields', async () => {
        const res = await makeRequest('POST', '/appointments', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { patientId: 'pat-1' }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('POST /appointments - 404 patient not found', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('POST', '/appointments', {
            user: { sub: 'admin-1', role: 'admin' },
            body: {
                patientId: 'pat-999',
                doctorId: 'doc-1',
                startTime: '2025-12-01T10:00:00Z',
                endTime: '2025-12-01T11:00:00Z'
            }
        });

        assert.strictEqual(res.status, 404);
    });

    await test('POST /appointments - 400 invalid times', async () => {
        mockDb.mockResults.SELECT = { rows: [{ userid: 'user-1' }] };

        const res = await makeRequest('POST', '/appointments', {
            user: { sub: 'admin-1', role: 'admin' },
            body: {
                patientId: 'pat-1',
                doctorId: 'doc-1',
                startTime: 'invalid',
                endTime: '2025-12-01T11:00:00Z'
            }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('GET /appointments/:id - admin gets appointment', async () => {
        const res = await makeRequest('GET', '/appointments/appt-1', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('PUT /appointments/:id - admin updates appointment', async () => {
        mockDb.mockResults.SELECT = { rows: [{ userid: 'user-1' }] };

        const res = await makeRequest('PUT', '/appointments/appt-1', {
            user: { sub: 'admin-1', role: 'admin' },
            body: {
                patientId: 'pat-1',
                doctorId: 'doc-1',
                startTime: '2025-12-01T10:00:00Z',
                endTime: '2025-12-01T11:00:00Z',
                status: 'confirmed'
            }
        });

        assert.strictEqual(res.status, 200);
    });

    await test('PUT /appointments/:id - fails without fields', async () => {
        const res = await makeRequest('PUT', '/appointments/appt-1', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { patientId: 'pat-1' }
        });

        assert.strictEqual(res.status, 400);
    });

    await test('DELETE /appointments/:id - admin deletes', async () => {
        const res = await makeRequest('DELETE', '/appointments/appt-1', {
            user: { sub: 'admin-1', role: 'admin' }
        });

        assert.strictEqual(res.status, 204);
    });

    // Create patient
    await test('POST /patients - admin creates patient', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('POST', '/patients', {
            user: { sub: 'admin-1', role: 'admin' },
            body: {
                name: 'John Doe',
                email: 'john@test.com',
                password: 'pass123',
                dob: '1990-01-01'
            }
        });

        assert.strictEqual(res.status, 201);
    });

    await test('POST /patients - creates with doctor assignment', async () => {
        mockDb.mockResults.SELECT = { rows: [] };

        const res = await makeRequest('POST', '/patients', {
            user: { sub: 'admin-1', role: 'admin' },
            body: {
                name: 'John Doe',
                email: 'john@test.com',
                password: 'pass123',
                dob: '1990-01-01',
                doctorId: 'doc-1'
            }
        });

        assert.strictEqual(res.status, 201);
    });

    await test('POST /patients - fails without required fields', async () => {
        const res = await makeRequest('POST', '/patients', {
            user: { sub: 'admin-1', role: 'admin' },
            body: { name: 'John Doe' }
        });

        assert.strictEqual(res.status, 400);
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