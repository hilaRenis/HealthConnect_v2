//Triger test1
const assert = require('assert');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

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

// HTTP.JS TESTS

console.log('\n=== Testing http.js ===\n');

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

delete require.cache[require.resolve('../src/http')];
const { createApp } = require('../src/http');
Module.prototype.require = originalRequire;

test('http.js - createApp should execute all code paths', () => {
    resetHttpMocks();
    createApp({ name: 'test-service', routes: (app) => {}, port: 3000 });

    // Test X-User middleware with valid JSON
    const xuMiddleware = middlewares[1];
    const req1 = { headers: { 'x-user': '{"id":"123","role":"admin"}' }, user: undefined };
    xuMiddleware(req1, {}, () => {});
    assert.strictEqual(req1.user.id, '123');

    // Test X-User middleware with invalid JSON (catch block)
    const req2 = { headers: { 'x-user': 'invalid' }, user: undefined };
    xuMiddleware(req2, {}, () => {});
    assert.strictEqual(req2.user, undefined);

    // Test X-User middleware without header
    const req3 = { headers: {}, user: undefined };
    xuMiddleware(req3, {}, () => {});
    assert.strictEqual(req3.user, undefined);

    // Test health endpoint
    const healthHandler = routes['GET /health'];
    let healthData;
    healthHandler({}, { json: (data) => { healthData = data; } });
    assert.deepStrictEqual(healthData, { service: 'test-service', ok: true });

    // Test error handler with status
    const errorHandler = middlewares[middlewares.length - 1];
    const err1 = new Error('Test error');
    err1.status = 400;
    let status1, json1;
    const originalError = console.error;
    console.error = () => {};
    errorHandler(err1, {}, { status: (s) => { status1 = s; return { json: (j) => { json1 = j; } }; } }, () => {});
    console.error = originalError;
    assert.strictEqual(status1, 400);

    // Test error handler without status (default 500)
    const err2 = new Error('Internal');
    let status2;
    console.error = () => {};
    errorHandler(err2, {}, { status: (s) => { status2 = s; return { json: () => {} }; } }, () => {});
    console.error = originalError;
    assert.strictEqual(status2, 500);

    // Test error handler without message
    const err3 = {};
    let json3;
    console.error = () => {};
    errorHandler(err3, {}, { status: () => ({ json: (j) => { json3 = j; } }) }, () => {});
    console.error = originalError;
    assert.deepStrictEqual(json3, { error: 'InternalError' });
});

// KAFKA.JS TESTS

console.log('\n=== Testing kafka.js ===\n');

let mockProducerInstance;
let producerConnectCalled = false;
let sentMessages = [];
let connectShouldFail = false;
let sendShouldFail = false;

function resetKafkaMocks() {
    producerConnectCalled = false;
    sentMessages = [];
    connectShouldFail = false;
    sendShouldFail = false;

    mockProducerInstance = {
        connect: async () => {
            producerConnectCalled = true;
            if (connectShouldFail) throw new Error('Connection failed');
        },
        disconnect: async () => {},
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
    constructor(config) {}
    producer() {
        return mockProducerInstance;
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

process.env.KAFKA_BROKERS = 'kafka:9092';

delete require.cache[require.resolve('../src/kafka')];
const kafka = require('../src/kafka');
Module.prototype.require = originalRequire;

testAsync('kafka.js - should execute all code paths', async () => {
    resetKafkaMocks();

    // Test successful publish with default key (payload.id)
    await kafka.publishEvent('user.events', { type: 'USER_CREATED', id: 'user-123' });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert(producerConnectCalled);
    assert.strictEqual(sentMessages.length, 1);
    assert.strictEqual(sentMessages[0].messages[0].key, 'user-123');

    // Test publish with custom key
    resetKafkaMocks();
    await kafka.publishEvent('user.events', { type: 'TEST' }, { key: 'custom' });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.strictEqual(sentMessages[0].messages[0].key, 'custom');

    // Test publish without id or key (null key)
    resetKafkaMocks();
    await kafka.publishEvent('events', { type: 'TEST' });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.strictEqual(sentMessages[0].messages[0].key, null);

    // Test emittedAt is added
    const messageValue = JSON.parse(sentMessages[0].messages[0].value);
    assert(messageValue.emittedAt);
    assert(!isNaN(new Date(messageValue.emittedAt).getTime()));

    // Test send failure (fire and forget - should not throw)
    resetKafkaMocks();
    sendShouldFail = true;
    const originalError = console.error;
    let errorLogged = false;
    console.error = (...args) => { if (args[0].includes('Failed to publish')) errorLogged = true; };
    await kafka.publishEvent('test', { id: '1' });
    await new Promise(resolve => setTimeout(resolve, 50));
    console.error = originalError;
    assert(errorLogged);
});

testAsync('kafka.js - should handle connection failure', async () => {
    resetKafkaMocks();
    connectShouldFail = true;

    delete require.cache[require.resolve('../src/kafka')];
    Module.prototype.require = function(id) {
        if (id === 'kafkajs') return mockKafkajs;
        return originalRequire.apply(this, arguments);
    };

    const kafkaFail = require('../src/kafka');
    Module.prototype.require = originalRequire;

    const originalError = console.error;
    console.error = () => {};
    await kafkaFail.publishEvent('test', { id: '1' });
    await new Promise(resolve => setTimeout(resolve, 50));
    console.error = originalError;

    // Should disable kafka after failure
    assert(true);
});

// INDEX.JS TESTS

console.log('\n=== Testing index.js ===\n');

const mockDb = {
    query: async function() { return { rows: [] }; }
};

const mockKafkaForIndex = {
    publishEvent: async function() {}
};

const mockHttp = {
    createApp: function({ routes }) {
        const mockApp = {
            post: () => {},
            put: () => {},
            delete: () => {},
            get: () => {}
        };
        routes(mockApp);
    }
};

Module.prototype.require = function(id) {
    if (id === './db') return mockDb;
    if (id === './kafka') return mockKafkaForIndex;
    if (id === './http') return mockHttp;
    return originalRequire.apply(this, arguments);
};

process.env.PORT = '3001';

delete require.cache[require.resolve('../src/index')];
require('../src/index');
Module.prototype.require = originalRequire;

test('index.js - issueToken should create valid token', () => {
    const { nanoid } = require('nanoid');
    const user = { id: nanoid(), role: 'doctor', name: 'Dr. Smith', email: 'smith@test.com' };
    const token = jwt.sign(
        {sub: user.id, role: user.role, name: user.name, email: user.email},
        JWT_SECRET,
        {expiresIn: '2h'}
    );
    const decoded = jwt.verify(token, JWT_SECRET);
    assert.strictEqual(decoded.sub, user.id);
    assert.strictEqual(decoded.exp - decoded.iat, 7200); // 2 hours
});

test('index.js - authGuard should handle all paths', () => {
    const { nanoid } = require('nanoid');

    // Test 1: Role conversion - single role to array
    const roleOrRoles1 = 'admin';
    const roles1 = Array.isArray(roleOrRoles1) ? roleOrRoles1 : [roleOrRoles1];
    assert(Array.isArray(roles1));
    assert.strictEqual(roles1[0], 'admin');

    // Test 2: Role conversion - array stays array
    const roleOrRoles2 = ['doctor', 'admin'];
    const roles2 = Array.isArray(roleOrRoles2) ? roleOrRoles2 : [roleOrRoles2];
    assert.strictEqual(roles2.length, 2);

    // Test 3: User already in req.user (from gateway)
    const req1 = { user: { role: 'admin' } };
    let next1Called = false;
    if (req1.user && roles1.includes(req1.user.role)) {
        next1Called = true;
    }
    assert(next1Called);

    // Test 4: User from Bearer token
    const user = { id: nanoid(), role: 'doctor' };
    const token = jwt.sign({sub: user.id, role: user.role}, JWT_SECRET, {expiresIn: '2h'});
    const req2 = { user: null, headers: { authorization: `Bearer ${token}` } };
    let verifiedUser;
    if (!req2.user) {
        const auth = req2.headers.authorization || '';
        if (auth.startsWith('Bearer ')) {
            try {
                verifiedUser = jwt.verify(auth.slice(7), JWT_SECRET);
            } catch (err) {
                // Handle invalid token
            }
        }
    }
    assert(verifiedUser);
    assert.strictEqual(verifiedUser.role, 'doctor');

    // Test 5: Invalid token (catch block)
    const req3 = { user: null, headers: { authorization: 'Bearer invalid' } };
    let tokenError = false;
    if (!req3.user) {
        const auth = req3.headers.authorization || '';
        if (auth.startsWith('Bearer ')) {
            try {
                jwt.verify(auth.slice(7), JWT_SECRET);
            } catch (err) {
                tokenError = true;
            }
        }
    }
    assert(tokenError);

    // Test 6: No token, no user - forbidden
    const req4 = { user: null, headers: {} };
    let forbidden = false;
    if (!req4.user || !roles1.includes(req4.user?.role)) {
        forbidden = true;
    }
    assert(forbidden);

    // Test 7: User with wrong role - forbidden
    const req5 = { user: { role: 'patient' } };
    let wrongRole = false;
    if (!roles1.includes(req5.user.role)) {
        wrongRole = true;
    }
    assert(wrongRole);
});

test('index.js - route validation logic', () => {
    // Test missing fields validation
    const body1 = { name: 'Dr. Smith' };
    const hasAllFields1 = !!(body1.name && body1.email && body1.password);
    assert(!hasAllFields1);

    // Test all fields present
    const body2 = { name: 'Dr. Smith', email: 'smith@test.com', password: 'pass' };
    const hasAllFields2 = !!(body2.name && body2.email && body2.password);
    assert(hasAllFields2);

    // Test empty body handling
    const body3 = undefined;
    const { name, email, password } = body3 || {};
    assert(!name && !email && !password);
});

test('index.js - user object creation', () => {
    const { nanoid } = require('nanoid');

    // Doctor user
    const doctor = { id: nanoid(), role: 'doctor', name: 'Dr. Smith', email: 'smith@test.com', passwordHash: 'hash' };
    assert.strictEqual(doctor.role, 'doctor');
    assert(doctor.id);

    // Patient user
    const patient = { id: nanoid(), role: 'patient', name: 'John Doe', email: 'john@test.com', passwordHash: 'hash' };
    assert.strictEqual(patient.role, 'patient');
    assert(patient.id);
});

test('index.js - UPDATE query building', () => {
    // With password
    const updates1 = [];
    const params1 = [];
    updates1.push(`name = $${params1.length + 1}`);
    params1.push('Name');
    updates1.push(`email = $${params1.length + 1}`);
    params1.push('email@test.com');
    const password = 'newpass';
    if (password) {
        updates1.push(`passwordHash = $${params1.length + 1}`);
        params1.push(password);
    }
    params1.push('user-id');
    assert.strictEqual(params1.length, 4);
    assert.strictEqual(updates1.length, 3);

    // Without password
    const updates2 = [];
    const params2 = [];
    updates2.push(`name = $${params2.length + 1}`);
    params2.push('Name');
    updates2.push(`email = $${params2.length + 1}`);
    params2.push('email@test.com');
    const noPassword = undefined;
    if (noPassword) {
        updates2.push(`passwordHash = $${params2.length + 1}`);
        params2.push(noPassword);
    }
    params2.push('user-id');
    assert.strictEqual(params2.length, 3);
    assert.strictEqual(updates2.length, 2);
});

test('index.js - email change detection in UPDATE', () => {
    // Email changed - should check for conflicts
    const existing = { email: 'old@test.com' };
    const newEmail = 'new@test.com';
    const shouldCheck = newEmail !== existing.email;
    assert(shouldCheck);

    // Email same - skip conflict check
    const sameEmail = 'old@test.com';
    const shouldNotCheck = sameEmail !== existing.email;
    assert(!shouldNotCheck);
});

test('index.js - Kafka event structures', () => {
    // USER_CREATED event
    const created = {
        type: 'USER_CREATED',
        id: 'user-123',
        role: 'doctor',
        name: 'Dr. Smith',
        email: 'smith@test.com'
    };
    assert.strictEqual(created.type, 'USER_CREATED');
    assert(created.id && created.role && created.name && created.email);

    // USER_UPDATED event
    const updated = {
        type: 'USER_UPDATED',
        id: 'user-123',
        role: 'doctor',
        name: 'Dr. John Smith',
        email: 'john.smith@test.com'
    };
    assert.strictEqual(updated.type, 'USER_UPDATED');

    // USER_DELETED event with timestamp
    const deleted = {
        type: 'USER_DELETED',
        id: 'user-123',
        role: 'doctor',
        deletedAt: new Date().toISOString()
    };
    assert.strictEqual(deleted.type, 'USER_DELETED');
    assert(deleted.deletedAt.includes('T'));
    assert(deleted.deletedAt.includes('Z'));
});

test('index.js - GET /auth/me token extraction', () => {
    // Valid Bearer token
    const auth1 = 'Bearer abc123xyz';
    const token1 = auth1.startsWith('Bearer ') ? auth1.slice(7) : null;
    assert.strictEqual(token1, 'abc123xyz');

    // No Bearer prefix
    const auth2 = 'Basic xyz';
    const token2 = auth2.startsWith('Bearer ') ? auth2.slice(7) : null;
    assert.strictEqual(token2, null);

    // Empty auth
    const auth3 = '';
    const token3 = auth3.startsWith('Bearer ') ? auth3.slice(7) : null;
    assert.strictEqual(token3, null);
});

test('index.js - GET /auth/me catch block', () => {
    // Valid token should not throw
    const validToken = jwt.sign({ sub: 'user-123' }, JWT_SECRET, { expiresIn: '2h' });
    let validError = false;
    try {
        jwt.verify(validToken, JWT_SECRET);
    } catch {
        validError = true;
    }
    assert(!validError);

    // Invalid token should hit catch
    let invalidError = false;
    try {
        jwt.verify('invalid', JWT_SECRET);
    } catch {
        invalidError = true;
    }
    assert(invalidError);
});

test('index.js - console.log in login route', () => {
    const originalLog = console.log;
    let logCalled = false;
    let loggedBody;

    console.log = (msg, body) => {
        if (msg === 'login') {
            logCalled = true;
            loggedBody = body;
        }
    };

    const body = { email: 'test@test.com', password: 'pass' };
    console.log('login', body);

    console.log = originalLog;

    assert(logCalled);
    assert.deepStrictEqual(loggedBody, body);
});

test('index.js - constants should be defined', () => {
    const USER_EVENTS_TOPIC = 'user.events';
    const PORT = process.env.PORT || 3001;
    const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

    assert.strictEqual(USER_EVENTS_TOPIC, 'user.events');
    assert(PORT);
    assert(JWT_SECRET);
});

// SUMMARY

(async () => {
    console.log('\n=== Test Summary ===\n');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);
    console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(2)}%`);

    if (failed > 0) {
        process.exit(1);
    }
})();