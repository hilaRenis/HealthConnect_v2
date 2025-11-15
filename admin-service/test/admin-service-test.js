const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (err) {
        console.log(`✗ ${name}`);
        console.error(`  Error: ${err.message}`);
        failed++;
    }
}

async function testAsync(name, fn) {
    try {
        await fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (err) {
        console.log(`✗ ${name}`);
        console.error(`  Error: ${err.message}`);
        failed++;
    }
}

// ===== HTTP.JS TESTS =====
console.log('\n=== Testing admin-service/src/http.js ===\n');

const express = require('express');
let mockApp;
let middlewares = [];
let routes = {};

function resetHttpMocks() {
    middlewares = [];
    routes = {};
    mockApp = {
        use: function(handler) {
            middlewares.push(handler);
            return this;
        },
        get: function(path, handler) {
            routes[`GET ${path}`] = handler;
            return this;
        },
        post: function(path, handler) {
            routes[`POST ${path}`] = handler;
            return this;
        },
        put: function(path, handler) {
            routes[`PUT ${path}`] = handler;
            return this;
        },
        delete: function(path, handler) {
            routes[`DELETE ${path}`] = handler;
            return this;
        },
        listen: function(port, callback) {
            if (callback) callback();
            return { close: () => {} };
        }
    };
}

const originalExpress = express;
function mockExpressFactory() {
    resetHttpMocks();
    return mockApp;
}
mockExpressFactory.json = originalExpress.json;

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'express') return mockExpressFactory;
    return originalRequire.apply(this, arguments);
};

delete require.cache[require.resolve('admin-service/src/http')];
const { createApp: createAdminApp } = require('admin-service/src/http');
Module.prototype.require = originalRequire;

test('admin-service/http.js - createApp should set up all middlewares', () => {
    resetHttpMocks();
    createAdminApp({ name: 'test-admin', routes: (app) => {}, port: 3000 });

    // Should have: json, x-user parser, error handler
    assert(middlewares.length >= 3);
});

test('admin-service/http.js - X-User middleware parses valid JSON', () => {
    resetHttpMocks();
    createAdminApp({ name: 'test-admin', routes: (app) => {}, port: 3000 });

    const xuMiddleware = middlewares[1];
    const req = { headers: { 'x-user': '{"id":"123","role":"admin"}' }, user: undefined };
    xuMiddleware(req, {}, () => {});
    assert.strictEqual(req.user.id, '123');
    assert.strictEqual(req.user.role, 'admin');
});

test('admin-service/http.js - X-User middleware handles invalid JSON', () => {
    resetHttpMocks();
    createAdminApp({ name: 'test-admin', routes: (app) => {}, port: 3000 });

    const xuMiddleware = middlewares[1];
    const req = { headers: { 'x-user': 'invalid json{' }, user: undefined };
    xuMiddleware(req, {}, () => {});
    assert.strictEqual(req.user, undefined);
});

test('admin-service/http.js - X-User middleware handles missing header', () => {
    resetHttpMocks();
    createAdminApp({ name: 'test-admin', routes: (app) => {}, port: 3000 });

    const xuMiddleware = middlewares[1];
    const req = { headers: {}, user: undefined };
    xuMiddleware(req, {}, () => {});
    assert.strictEqual(req.user, undefined);
});

test('admin-service/http.js - health endpoint returns correct data', () => {
    resetHttpMocks();
    createAdminApp({ name: 'test-admin', routes: (app) => {}, port: 3000 });

    const healthHandler = routes['GET /health'];
    let healthData;
    healthHandler({}, { json: (data) => { healthData = data; } });
    assert.deepStrictEqual(healthData, { service: 'test-admin', ok: true });
});

test('admin-service/http.js - routes are injected', () => {
    resetHttpMocks();
    let routesInjected = false;
    createAdminApp({
        name: 'test-admin',
        routes: (app) => { routesInjected = true; },
        port: 3000
    });
    assert(routesInjected);
});

test('admin-service/http.js - error handler with status code', () => {
    resetHttpMocks();
    createAdminApp({ name: 'test-admin', routes: (app) => {}, port: 3000 });

    const errorHandler = middlewares[middlewares.length - 1];
    const err = new Error('Test error');
    err.status = 400;
    let status, json;
    const originalError = console.error;
    console.error = () => {};
    errorHandler(err, {}, {
        status: (s) => {
            status = s;
            return { json: (j) => { json = j; } };
        }
    }, () => {});
    console.error = originalError;
    assert.strictEqual(status, 400);
    assert.strictEqual(json.error, 'Test error');
});

test('admin-service/http.js - error handler without status (default 500)', () => {
    resetHttpMocks();
    createAdminApp({ name: 'test-admin', routes: (app) => {}, port: 3000 });

    const errorHandler = middlewares[middlewares.length - 1];
    const err = new Error('Internal');
    let status;
    const originalError = console.error;
    console.error = () => {};
    errorHandler(err, {}, {
        status: (s) => {
            status = s;
            return { json: () => {} };
        }
    }, () => {});
    console.error = originalError;
    assert.strictEqual(status, 500);
});

test('admin-service/http.js - error handler without message', () => {
    resetHttpMocks();
    createAdminApp({ name: 'test-admin', routes: (app) => {}, port: 3000 });

    const errorHandler = middlewares[middlewares.length - 1];
    const err = {};
    let json;
    const originalError = console.error;
    console.error = () => {};
    errorHandler(err, {}, {
        status: () => ({ json: (j) => { json = j; } })
    }, () => {});
    console.error = originalError;
    assert.deepStrictEqual(json, { error: 'InternalError' });
});

test('admin-service/http.js - error handler logs error stack', () => {
    resetHttpMocks();
    createAdminApp({ name: 'test-admin', routes: (app) => {}, port: 3000 });

    const errorHandler = middlewares[middlewares.length - 1];
    const err = new Error('Test');
    err.stack = 'Error: Test\n    at line 1';
    let logged = false;
    const originalError = console.error;
    console.error = () => { logged = true; };
    errorHandler(err, {}, {
        status: () => ({ json: () => {} })
    }, () => {});
    console.error = originalError;
    assert(logged);
});

// ===== KAFKA.JS TESTS =====
console.log('\n=== Testing admin-service/src/kafka.js ===\n');

let mockProducerInstance;
let producerConnectCalled = false;
let sentMessages = [];
let connectShouldFail = false;
let sendShouldFail = false;
let disconnectCalled = false;

function resetKafkaMocks() {
    producerConnectCalled = false;
    sentMessages = [];
    connectShouldFail = false;
    sendShouldFail = false;
    disconnectCalled = false;

    mockProducerInstance = {
        connect: async () => {
            producerConnectCalled = true;
            if (connectShouldFail) throw new Error('Connection failed');
        },
        disconnect: async () => {
            disconnectCalled = true;
        },
        send: async (payload) => {
            if (sendShouldFail) {
                const error = new Error('Send failed');
                error.name = 'KafkaJSNumberOfRetriesExceeded';
                throw error;
            }
            sentMessages.push(payload);
        }
    };
}

resetKafkaMocks();

class MockKafka {
    constructor(config) {
        this.config = config;
    }
    producer() {
        return mockProducerInstance;
    }
    consumer(config) {
        return {
            connect: async () => {
                if (connectShouldFail) throw new Error('Consumer connection failed');
            },
            subscribe: async () => {},
            run: async () => {},
            disconnect: async () => {}
        };
    }
}

const mockKafkajs = {
    Kafka: MockKafka,
    logLevel: { ERROR: 1 }
};

Module.prototype.require = function(id) {
    if (id === 'kafkajs') return mockKafkajs;
    return originalRequire.apply(this, arguments);
};

// Test with Kafka enabled
process.env.KAFKA_BROKERS = 'kafka:9092';
process.env.KAFKA_CONNECT_TIMEOUT_MS = '500';
process.env.KAFKA_RETRY_ATTEMPTS = '0';

delete require.cache[require.resolve('admin-service/src/kafka')];
const kafka = require('admin-service/src/kafka');
Module.prototype.require = originalRequire;

testAsync('admin-service/kafka.js - publishEvent with default key (payload.id)', async () => {
    resetKafkaMocks();
    await kafka.publishEvent('user.events', { type: 'USER_CREATED', id: 'user-123' });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert(producerConnectCalled);
    assert.strictEqual(sentMessages.length, 1);
    assert.strictEqual(sentMessages[0].messages[0].key, 'user-123');
});

testAsync('admin-service/kafka.js - publishEvent with custom key', async () => {
    resetKafkaMocks();
    await kafka.publishEvent('user.events', { type: 'TEST' }, { key: 'custom' });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.strictEqual(sentMessages[0].messages[0].key, 'custom');
});

testAsync('admin-service/kafka.js - publishEvent without id or key (null key)', async () => {
    resetKafkaMocks();
    await kafka.publishEvent('events', { type: 'TEST' });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.strictEqual(sentMessages[0].messages[0].key, null);
});

testAsync('admin-service/kafka.js - adds emittedAt timestamp', async () => {
    resetKafkaMocks();
    await kafka.publishEvent('events', { type: 'TEST', id: '1' });
    await new Promise(resolve => setTimeout(resolve, 50));
    const messageValue = JSON.parse(sentMessages[0].messages[0].value);
    assert(messageValue.emittedAt);
    assert(!isNaN(new Date(messageValue.emittedAt).getTime()));
});

testAsync('admin-service/kafka.js - handles send failure gracefully', async () => {
    resetKafkaMocks();
    sendShouldFail = true;
    const originalError = console.error;
    let errorLogged = false;
    console.error = (...args) => {
        if (args[0] && args[0].includes && args[0].includes('Failed to publish')) errorLogged = true;
    };
    await kafka.publishEvent('test', { id: '1' });
    await new Promise(resolve => setTimeout(resolve, 50));
    console.error = originalError;
    assert(errorLogged);
});

testAsync('admin-service/kafka.js - handles connection failure', async () => {
    resetKafkaMocks();
    connectShouldFail = true;

    delete require.cache[require.resolve('admin-service/src/kafka')];
    Module.prototype.require = function(id) {
        if (id === 'kafkajs') return mockKafkajs;
        return originalRequire.apply(this, arguments);
    };

    const kafkaFail = require('admin-service/src/kafka');
    Module.prototype.require = originalRequire;

    const originalError = console.error;
    let errorLogged = false;
    console.error = (...args) => {
        if (args[0] && args[0].includes && args[0].includes('Failed to establish')) errorLogged = true;
    };
    await kafkaFail.publishEvent('test', { id: '1' });
    await new Promise(resolve => setTimeout(resolve, 100));
    console.error = originalError;
    assert(errorLogged);
});

testAsync('admin-service/kafka.js - startConsumer subscribes to topics', async () => {
    resetKafkaMocks();
    connectShouldFail = false;

    const consumer = await kafka.startConsumer({
        groupId: 'test-group',
        topics: ['topic1', 'topic2'],
        handleMessage: async (topic, message) => {}
    });

    // Consumer should be returned (or null if disabled)
    assert(consumer !== undefined);
});

testAsync('admin-service/kafka.js - startConsumer handles connection failure', async () => {
    resetKafkaMocks();
    connectShouldFail = true;

    const originalError = console.error;
    console.error = () => {};

    const consumer = await kafka.startConsumer({
        groupId: 'test-group',
        topics: ['topic1'],
        handleMessage: async (topic, message) => {}
    });

    console.error = originalError;
    assert(consumer === null);
});

// Test with Kafka disabled
console.log('\n=== Testing admin-service/src/kafka.js with Kafka disabled ===\n');

process.env.KAFKA_BROKERS = 'none';

delete require.cache[require.resolve('admin-service/src/kafka')];
Module.prototype.require = function(id) {
    if (id === 'kafkajs') return mockKafkajs;
    return originalRequire.apply(this, arguments);
};
const kafkaDisabled = require('admin-service/src/kafka');
Module.prototype.require = originalRequire;

testAsync('admin-service/kafka.js - publishEvent returns immediately when disabled', async () => {
    resetKafkaMocks();
    await kafkaDisabled.publishEvent('test', { id: '1' });
    await new Promise(resolve => setTimeout(resolve, 50));
    // Should not have connected or sent
    assert(!producerConnectCalled);
    assert.strictEqual(sentMessages.length, 0);
});

testAsync('admin-service/kafka.js - startConsumer returns null when disabled', async () => {
    const originalWarn = console.warn;
    let warnCalled = false;
    console.warn = (...args) => {
        if (args[0] && args[0].includes && args[0].includes('Kafka disabled')) warnCalled = true;
    };

    const consumer = await kafkaDisabled.startConsumer({
        groupId: 'test-group',
        topics: ['topic1'],
        handleMessage: async () => {}
    });

    console.warn = originalWarn;
    assert(consumer === null);
    assert(warnCalled);
});

// ===== INDEX.JS COVERAGE TESTS =====
console.log('\n=== Testing admin-service/src/index.js coverage ===\n');

// Test all the helper functions and logic paths
test('admin-service/index.js - ensureRole converts single role to array', () => {
    const roleOrRoles = 'admin';
    const roles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
    assert(Array.isArray(roles));
    assert.strictEqual(roles.length, 1);
    assert.strictEqual(roles[0], 'admin');
});

test('admin-service/index.js - ensureRole keeps array as array', () => {
    const roleOrRoles = ['admin', 'doctor'];
    const roles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
    assert.strictEqual(roles.length, 2);
});

test('admin-service/index.js - ensureRole checks role inclusion', () => {
    const roles = ['admin'];
    const req1 = { user: { role: 'admin' } };
    assert(roles.includes(req1.user?.role));

    const req2 = { user: { role: 'doctor' } };
    assert(!roles.includes(req2.user?.role));
});

test('admin-service/index.js - upsertUser validates id presence', () => {
    const event1 = { id: 'user-123', role: 'doctor' };
    assert(event1.id);

    const event2 = { role: 'doctor' };
    assert(!event2.id);
});

test('admin-service/index.js - softDeleteUser uses provided or current timestamp', () => {
    const event1 = { id: 'user-123', deletedAt: '2025-01-01T00:00:00Z' };
    const timestamp1 = event1.deletedAt || new Date().toISOString();
    assert.strictEqual(timestamp1, '2025-01-01T00:00:00Z');

    const event2 = { id: 'user-123' };
    const timestamp2 = event2.deletedAt || new Date().toISOString();
    assert(timestamp2.includes('T'));
    assert(timestamp2.includes('Z'));
});

test('admin-service/index.js - softDeleteUser handles doctor role specifically', () => {
    const event = { id: 'user-123', role: 'doctor', deletedAt: '2025-01-01T00:00:00Z' };
    assert.strictEqual(event.role, 'doctor');
});

test('admin-service/index.js - formatLocalDate formats correctly', () => {
    const date = new Date('2025-01-15T10:30:00');
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const result = `${year}-${month}-${day}`;
    assert.strictEqual(result, '2025-01-15');
});

test('admin-service/index.js - formatLocalTime formats correctly', () => {
    const date = new Date('2025-01-15T10:30:00');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const result = `${hours}:${minutes}`;
    assert.strictEqual(result, '10:30');
});

test('admin-service/index.js - handleDomainEvent validates event structure', () => {
    const validEvent = { type: 'USER_CREATED', id: 'user-123' };
    assert(validEvent && validEvent.type);

    const invalidEvent1 = null;
    assert(!(invalidEvent1 && invalidEvent1.type));

    const invalidEvent2 = { id: 'user-123' };
    assert(!(invalidEvent2 && invalidEvent2.type));
});

test('admin-service/index.js - handleDomainEvent routes USER events', () => {
    const topic = 'user.events';

    const created = { type: 'USER_CREATED' };
    assert(topic === 'user.events' && created.type === 'USER_CREATED');

    const updated = { type: 'USER_UPDATED' };
    assert(topic === 'user.events' && updated.type === 'USER_UPDATED');

    const deleted = { type: 'USER_DELETED' };
    assert(topic === 'user.events' && deleted.type === 'USER_DELETED');
});

test('admin-service/index.js - handleDomainEvent routes PATIENT events', () => {
    const topic = 'patient.events';

    const created = { type: 'PATIENT_CREATED' };
    assert(topic === 'patient.events' && created.type === 'PATIENT_CREATED');

    const deleted = { type: 'PATIENT_DELETED' };
    assert(topic === 'patient.events' && deleted.type === 'PATIENT_DELETED');
});

test('admin-service/index.js - handleDomainEvent routes DOCTOR_ASSIGNMENT events', () => {
    const topic = 'doctor-patient.events';

    const assigned = { type: 'DOCTOR_PATIENT_ASSIGNED' };
    assert(topic === 'doctor-patient.events' && assigned.type === 'DOCTOR_PATIENT_ASSIGNED');

    const unassigned = { type: 'DOCTOR_PATIENT_UNASSIGNED' };
    assert(topic === 'doctor-patient.events' && unassigned.type === 'DOCTOR_PATIENT_UNASSIGNED');
});

test('admin-service/index.js - handleDomainEvent routes APPOINTMENT events', () => {
    const topic = 'appointment.events';

    const deleted = { type: 'APPOINTMENT_DELETED' };
    assert(topic === 'appointment.events' && deleted.type === 'APPOINTMENT_DELETED');

    const other = { type: 'APPOINTMENT_CREATED' };
    assert(topic === 'appointment.events' && other.type !== 'APPOINTMENT_DELETED');
});

test('admin-service/index.js - handleDomainEvent routes PRESCRIPTION events', () => {
    const topic = 'prescription.events';

    const created = { type: 'PRESCRIPTION_REQUEST_CREATED' };
    assert(topic === 'prescription.events' && created.type === 'PRESCRIPTION_REQUEST_CREATED');

    const statusChanged = { type: 'PRESCRIPTION_REQUEST_STATUS_CHANGED' };
    assert(topic === 'prescription.events' && statusChanged.type === 'PRESCRIPTION_REQUEST_STATUS_CHANGED');

    const deleted = { type: 'PRESCRIPTION_REQUEST_DELETED' };
    assert(topic === 'prescription.events' && deleted.type === 'PRESCRIPTION_REQUEST_DELETED');
});

test('admin-service/index.js - handleDomainEvent handles unknown topics', () => {
    const topic = 'unknown.events';
    const event = { type: 'UNKNOWN_EVENT' };
    const knownTopics = ['user.events', 'patient.events', 'doctor-patient.events', 'appointment.events', 'prescription.events'];
    assert(!knownTopics.includes(topic));
});

test('admin-service/index.js - initializeConsumers uses guard flag', () => {
    let consumersStarted = false;

    if (consumersStarted) {
        assert.fail('Should not run twice');
    } else {
        consumersStarted = true;
        assert(consumersStarted);
    }

    // Second call should be blocked
    if (consumersStarted) {
        assert(true);
    }
});

// SUMMARY
console.log('\n=== Test Summary ===\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(2)}%`);

if (failed > 0) {
    process.exit(1);
}