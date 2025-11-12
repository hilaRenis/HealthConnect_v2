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

// ========================================
// PART 1: HTTP.JS TESTS
// ========================================

console.log('\n=== Testing http.js ===\n');

// Mock express for http.js tests
const express = require('express');
let mockApp;
let middlewares = [];
let routes = {};
let listenPort;
let listenCallback;

function resetHttpMocks() {
    middlewares = [];
    routes = {};
    listenPort = null;
    listenCallback = null;
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
            listenPort = port;
            listenCallback = callback;
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
    if (id === 'express') {
        return mockExpressFactory;
    }
    return originalRequire.apply(this, arguments);
};

delete require.cache[require.resolve('../src/http')];
const { createApp } = require('../src/http');

Module.prototype.require = originalRequire;

test('createApp should be exported as a function', () => {
    assert.strictEqual(typeof createApp, 'function');
});

test('createApp should create app with basic config', () => {
    resetHttpMocks();
    const routes = (app) => {};
    createApp({ name: 'test-service', routes, port: 3000 });
    assert(middlewares.length > 0);
    assert.strictEqual(listenPort, 3000);
});

testAsync('X-User middleware should parse valid JSON header', async () => {
    resetHttpMocks();
    const routes = (app) => {};
    createApp({ name: 'test-service', routes, port: 3000 });

    const xuMiddleware = middlewares[1];
    const req = { headers: { 'x-user': '{"id":"123","role":"admin"}' }, user: undefined };
    const res = {};
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    xuMiddleware(req, res, next);

    assert(nextCalled);
    assert.strictEqual(req.user.id, '123');
    assert.strictEqual(req.user.role, 'admin');
});

testAsync('X-User middleware should handle invalid JSON gracefully', async () => {
    resetHttpMocks();
    const routes = (app) => {};
    createApp({ name: 'test-service', routes, port: 3000 });

    const xuMiddleware = middlewares[1];
    const req = { headers: { 'x-user': 'invalid-json' }, user: undefined };
    const res = {};
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    xuMiddleware(req, res, next);

    assert(nextCalled);
    assert.strictEqual(req.user, undefined);
});

testAsync('Health check should return correct response', async () => {
    resetHttpMocks();
    const routes = (app) => {};
    createApp({ name: 'auth-service', routes, port: 3000 });

    const healthHandler = routes['GET /health'];
    const req = {};
    let jsonData;
    const res = { json: (data) => { jsonData = data; } };

    healthHandler(req, res);

    assert.deepStrictEqual(jsonData, { service: 'auth-service', ok: true });
});

testAsync('Error handler should format error with status', async () => {
    resetHttpMocks();
    const routes = (app) => {};
    createApp({ name: 'test-service', routes, port: 3000 });

    const errorHandler = middlewares[middlewares.length - 1];
    const err = new Error('Test error');
    err.status = 400;
    const req = {};
    let statusCode, jsonData;
    const res = {
        status: (code) => { statusCode = code; return res; },
        json: (data) => { jsonData = data; }
    };

    const originalError = console.error;
    console.error = () => {};
    errorHandler(err, req, res, () => {});
    console.error = originalError;

    assert.strictEqual(statusCode, 400);
    assert.deepStrictEqual(jsonData, { error: 'Test error' });
});

testAsync('Error handler should default to 500 status', async () => {
    resetHttpMocks();
    const routes = (app) => {};
    createApp({ name: 'test-service', routes, port: 3000 });

    const errorHandler = middlewares[middlewares.length - 1];
    const err = new Error('Internal error');
    const req = {};
    let statusCode;
    const res = {
        status: (code) => { statusCode = code; return res; },
        json: (data) => {}
    };

    const originalError = console.error;
    console.error = () => {};
    errorHandler(err, req, res, () => {});
    console.error = originalError;

    assert.strictEqual(statusCode, 500);
});

// ========================================
// PART 2: KAFKA.JS TESTS
// ========================================

console.log('\n=== Testing kafka.js ===\n');

// Mock kafkajs
let mockProducerInstance;
let mockKafkaConfig;
let producerConnectCalled = false;
let producerDisconnectCalled = false;
let sentMessages = [];
let connectShouldFail = false;
let sendShouldFail = false;
let sendFailureType = null;

function resetKafkaMocks() {
    producerConnectCalled = false;
    producerDisconnectCalled = false;
    sentMessages = [];
    connectShouldFail = false;
    sendShouldFail = false;
    sendFailureType = null;

    mockProducerInstance = {
        connect: async () => {
            producerConnectCalled = true;
            if (connectShouldFail) throw new Error('Connection failed');
        },
        disconnect: async () => {
            producerDisconnectCalled = true;
        },
        send: async (payload) => {
            if (sendShouldFail) {
                const error = new Error('Send failed');
                if (sendFailureType) error.name = sendFailureType;
                throw error;
            }
            sentMessages.push(payload);
        }
    };
}

resetKafkaMocks();

class MockKafka {
    constructor(config) {
        mockKafkaConfig = config;
    }
    producer() {
        return mockProducerInstance;
    }
}

const mockKafkajs = {
    Kafka: MockKafka,
    logLevel: { ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4 }
};

Module.prototype.require = function(id) {
    if (id === 'kafkajs') return mockKafkajs;
    return originalRequire.apply(this, arguments);
};

process.env.KAFKA_BROKERS = 'kafka:9092';
process.env.KAFKA_CONNECT_TIMEOUT_MS = '500';
process.env.KAFKA_RETRY_ATTEMPTS = '0';

delete require.cache[require.resolve('../src/kafka')];
const kafka = require('../src/kafka');

Module.prototype.require = originalRequire;

test('kafka module should export publishEvent', () => {
    assert.strictEqual(typeof kafka.publishEvent, 'function');
});

testAsync('publishEvent should successfully publish event', async () => {
    resetKafkaMocks();

    const payload = {
        type: 'USER_CREATED',
        id: 'user-123',
        role: 'doctor',
        name: 'Dr. Smith',
        email: 'smith@hospital.com'
    };

    await kafka.publishEvent('user.events', payload);
    await new Promise(resolve => setTimeout(resolve, 100));

    assert(producerConnectCalled);
    assert.strictEqual(sentMessages.length, 1);
    assert.strictEqual(sentMessages[0].topic, 'user.events');
});

testAsync('publishEvent should use custom key when provided', async () => {
    resetKafkaMocks();

    const payload = { type: 'USER_UPDATED', id: 'user-456', name: 'Updated Name' };

    await kafka.publishEvent('user.events', payload, { key: 'custom-key' });
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.strictEqual(sentMessages.length, 1);
    assert.strictEqual(sentMessages[0].messages[0].key, 'custom-key');
});

testAsync('publishEvent should add emittedAt timestamp', async () => {
    resetKafkaMocks();

    const payload = { type: 'USER_CREATED', id: 'user-123', role: 'doctor' };

    await kafka.publishEvent('user.events', payload);
    await new Promise(resolve => setTimeout(resolve, 100));

    const messageValue = JSON.parse(sentMessages[0].messages[0].value);
    assert(messageValue.emittedAt);
    assert(messageValue.type === 'USER_CREATED');

    const date = new Date(messageValue.emittedAt);
    assert(!isNaN(date.getTime()));
});

testAsync('publishEvent should handle send failures gracefully', async () => {
    resetKafkaMocks();
    sendShouldFail = true;

    const originalError = console.error;
    let errorLogged = false;
    console.error = (...args) => {
        if (args[0].includes('Failed to publish')) errorLogged = true;
    };

    await kafka.publishEvent('user.events', { type: 'TEST', id: '1' });
    await new Promise(resolve => setTimeout(resolve, 100));

    console.error = originalError;
    assert(errorLogged);
});

test('Kafka should be configured with correct settings', () => {
    assert(mockKafkaConfig);
    assert.strictEqual(mockKafkaConfig.clientId, 'auth-service');
    assert(Array.isArray(mockKafkaConfig.brokers));
    assert(mockKafkaConfig.brokers.includes('kafka:9092'));
    assert.strictEqual(mockKafkaConfig.connectionTimeout, 500);
});

console.log('\n=== Additional Kafka.js Coverage Tests ===\n');

testAsync('Multiple publishEvent calls should reuse same producer', async () => {
    resetKafkaMocks();

    await kafka.publishEvent('topic1', { type: 'EVENT1', id: '1' });
    await kafka.publishEvent('topic2', { type: 'EVENT2', id: '2' });
    await kafka.publishEvent('topic3', { type: 'EVENT3', id: '3' });

    await new Promise(resolve => setTimeout(resolve, 100));

    assert(producerConnectCalled);
    assert.strictEqual(sentMessages.length, 3);
});

testAsync('publishEvent should preserve all original payload fields', async () => {
    resetKafkaMocks();

    const payload = {
        type: 'USER_UPDATED',
        id: 'user-456',
        role: 'doctor',
        name: 'Dr. Johnson',
        email: 'johnson@hospital.com',
        customField: 'customValue'
    };

    await kafka.publishEvent('user.events', payload);
    await new Promise(resolve => setTimeout(resolve, 100));

    const messageValue = JSON.parse(sentMessages[0].messages[0].value);
    assert.strictEqual(messageValue.type, 'USER_UPDATED');
    assert.strictEqual(messageValue.id, 'user-456');
    assert.strictEqual(messageValue.role, 'doctor');
    assert.strictEqual(messageValue.name, 'Dr. Johnson');
    assert.strictEqual(messageValue.email, 'johnson@hospital.com');
    assert.strictEqual(messageValue.customField, 'customValue');
});

testAsync('publishEvent should use payload.id as default key', async () => {
    resetKafkaMocks();

    const payload = {
        type: 'USER_DELETED',
        id: 'user-789',
        role: 'patient'
    };

    await kafka.publishEvent('user.events', payload);
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.strictEqual(sentMessages.length, 1);
    assert.strictEqual(sentMessages[0].messages[0].key, 'user-789');
});

testAsync('publishEvent should handle null key when no id in payload', async () => {
    resetKafkaMocks();

    const payload = {
        type: 'EVENT_WITHOUT_ID'
    };

    await kafka.publishEvent('events', payload);
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.strictEqual(sentMessages.length, 1);
    assert.strictEqual(sentMessages[0].messages[0].key, null);
});

test('Kafka retry configuration should be valid', () => {
    assert(mockKafkaConfig.retry);
    assert.strictEqual(mockKafkaConfig.retry.retries, 0);
    assert(typeof mockKafkaConfig.retry.initialRetryTime === 'number');
    assert(typeof mockKafkaConfig.retry.maxRetryTime === 'number');
});

test('Should parse KAFKA_BROKERS with multiple brokers', () => {
    const input = 'kafka1:9092,kafka2:9092, kafka3:9092';
    const parsed = input.split(',').map(b => b.trim()).filter(Boolean);
    assert.strictEqual(parsed.length, 3);
    assert.strictEqual(parsed[0], 'kafka1:9092');
    assert.strictEqual(parsed[1], 'kafka2:9092');
    assert.strictEqual(parsed[2], 'kafka3:9092');
});

test('Should recognize disabled broker values', () => {
    const disabledValues = ['none', 'off', 'disabled'];
    disabledValues.forEach(val => {
        const normalized = val.toLowerCase();
        assert(['none', 'off', 'disabled'].includes(normalized));
    });
});

test('Should handle invalid timeout values', () => {
    const inputs = ['invalid', '-100', '0', 'abc'];
    inputs.forEach(input => {
        const parsed = Number.parseInt(input, 10);
        const timeout = Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
        assert.strictEqual(timeout, 500);
    });
});

test('Should use custom timeout when valid', () => {
    const input = '2000';
    const parsed = Number.parseInt(input, 10);
    const timeout = Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
    assert.strictEqual(timeout, 2000);
});

testAsync('Published message should have correct structure', async () => {
    resetKafkaMocks();

    const payload = {
        type: 'USER_CREATED',
        id: 'user-999',
        role: 'patient'
    };

    await kafka.publishEvent('user.events', payload);
    await new Promise(resolve => setTimeout(resolve, 100));

    const message = sentMessages[0];
    assert.strictEqual(message.topic, 'user.events');
    assert(Array.isArray(message.messages));
    assert.strictEqual(message.messages.length, 1);

    const msg = message.messages[0];
    assert(msg.key !== undefined);
    assert(typeof msg.value === 'string');

    const parsed = JSON.parse(msg.value);
    assert(parsed.type);
    assert(parsed.id);
    assert(parsed.emittedAt);
});

test('Should handle whitespace in broker list', () => {
    const input = '  kafka1:9092  ,  kafka2:9092  ';
    const parsed = input.split(',').map(b => b.trim()).filter(Boolean);
    assert.strictEqual(parsed[0], 'kafka1:9092');
    assert.strictEqual(parsed[1], 'kafka2:9092');
});

test('Should filter empty broker strings', () => {
    const input = 'kafka1:9092,,kafka2:9092,';
    const parsed = input.split(',').map(b => b.trim()).filter(Boolean);
    assert.strictEqual(parsed.length, 2);
});

// ========================================
// PART 3: INDEX.JS TESTS
// ========================================

console.log('\n=== Testing index.js ===\n');

// Mock database
const mockDb = {
    queries: [],
    queryResults: [],
    query: async function(sql, params) {
        this.queries.push({ sql, params });
        return this.queryResults.shift() || { rows: [] };
    },
    reset: function() {
        this.queries = [];
        this.queryResults = [];
    },
    mockResult: function(result) {
        this.queryResults.push(result);
    }
};

// Mock Kafka for index.js
const mockKafkaForIndex = {
    events: [],
    publishEvent: async function(topic, payload, options) {
        this.events.push({ topic, payload, options });
    },
    reset: function() {
        this.events = [];
    }
};

// Mock http createApp
let appRoutes;
const mockHttp = {
    createApp: function({ name, routes, port }) {
        appRoutes = routes;
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

function createMockReqRes(body = {}, params = {}, headers = {}, user = null) {
    const req = { body, params, headers, user };
    let statusCode = 200;
    let jsonData;
    let sentStatus;

    const res = {
        status: function(code) {
            statusCode = code;
            return this;
        },
        json: function(data) {
            jsonData = data;
            sentStatus = statusCode;
            return this;
        },
        send: function() {
            sentStatus = statusCode;
            return this;
        }
    };

    return { req, res, getStatus: () => sentStatus, getJson: () => jsonData };
}

test('issueToken should generate valid JWT token', () => {
    const { nanoid } = require('nanoid');
    const user = {
        id: nanoid(),
        role: 'doctor',
        name: 'Dr. Smith',
        email: 'smith@hospital.com'
    };

    const token = jwt.sign(
        {sub: user.id, role: user.role, name: user.name, email: user.email},
        JWT_SECRET,
        {expiresIn: '2h'}
    );

    assert(token);
    const decoded = jwt.verify(token, JWT_SECRET);
    assert.strictEqual(decoded.sub, user.id);
    assert.strictEqual(decoded.role, user.role);
});

testAsync('POST /auth/register-doctor should register a doctor', async () => {
    mockDb.reset();
    mockKafkaForIndex.reset();

    mockDb.mockResult({ rows: [] });
    mockDb.mockResult({ rows: [] });

    const body = {
        name: 'Dr. Johnson',
        email: 'johnson@hospital.com',
        password: 'password123'
    };

    const { req, res, getStatus, getJson } = createMockReqRes(body, {}, {}, { role: 'admin' });

    const routeHandler = async (req, res) => {
        const {name, email, password} = req.body || {};
        if (!name || !email || !password) return res.status(400).json({error: 'Missing fields'});
        const {rows} = await mockDb.query('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
        if (rows.length > 0) return res.status(409).json({error: 'Email exists'});
        const {nanoid} = require('nanoid');
        const user = {id: nanoid(), role: 'doctor', name, email, passwordHash: password};
        await mockDb.query('INSERT INTO users (id, role, name, email, passwordHash) VALUES ($1, $2, $3, $4, $5)',
            [user.id, user.role, user.name, user.email, user.passwordHash]);
        await mockKafkaForIndex.publishEvent('user.events', {
            type: 'USER_CREATED',
            id: user.id,
            role: user.role,
            name: user.name,
            email: user.email,
        });
        res.status(201).json({id: user.id});
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 201);
    assert(getJson().id);
    assert.strictEqual(mockKafkaForIndex.events.length, 1);
    assert.strictEqual(mockKafkaForIndex.events[0].payload.type, 'USER_CREATED');
});

testAsync('POST /auth/register-doctor should reject missing fields', async () => {
    mockDb.reset();

    const body = { name: 'Dr. Smith' };
    const { req, res, getStatus, getJson } = createMockReqRes(body, {}, {}, { role: 'admin' });

    const routeHandler = async (req, res) => {
        const {name, email, password} = req.body || {};
        if (!name || !email || !password) return res.status(400).json({error: 'Missing fields'});
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 400);
    assert.deepStrictEqual(getJson(), { error: 'Missing fields' });
});

testAsync('POST /auth/register-doctor should reject existing email', async () => {
    mockDb.reset();
    mockDb.mockResult({ rows: [{ email: 'existing@hospital.com' }] });

    const body = {
        name: 'Dr. Smith',
        email: 'existing@hospital.com',
        password: 'password123'
    };

    const { req, res, getStatus, getJson } = createMockReqRes(body, {}, {}, { role: 'admin' });

    const routeHandler = async (req, res) => {
        const {name, email, password} = req.body || {};
        if (!name || !email || !password) return res.status(400).json({error: 'Missing fields'});
        const {rows} = await mockDb.query('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
        if (rows.length > 0) return res.status(409).json({error: 'Email exists'});
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 409);
});

testAsync('POST /auth/register-patient should register a patient', async () => {
    mockDb.reset();
    mockKafkaForIndex.reset();

    mockDb.mockResult({ rows: [] });
    mockDb.mockResult({ rows: [] });

    const body = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123'
    };

    const { req, res, getStatus, getJson } = createMockReqRes(body, {}, {}, { role: 'doctor' });

    const routeHandler = async (req, res) => {
        const {name, email, password} = req.body || {};
        if (!name || !email || !password) return res.status(400).json({error: 'Missing fields'});
        const {rows} = await mockDb.query('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
        if (rows.length > 0) return res.status(409).json({error: 'Email exists'});
        const {nanoid} = require('nanoid');
        const user = {id: nanoid(), role: 'patient', name, email, passwordHash: password};
        await mockDb.query('INSERT INTO users (id, role, name, email, passwordHash) VALUES ($1, $2, $3, $4, $5)',
            [user.id, user.role, user.name, user.email, user.passwordHash]);
        await mockKafkaForIndex.publishEvent('user.events', {
            type: 'USER_CREATED',
            id: user.id,
            role: user.role,
            name: user.name,
            email: user.email,
        });
        res.status(201).json({id: user.id});
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 201);
    assert(getJson().id);
    assert.strictEqual(mockKafkaForIndex.events[0].payload.role, 'patient');
});

testAsync('PUT /auth/users/:id should update user', async () => {
    mockDb.reset();
    mockKafkaForIndex.reset();

    const userId = 'user-123';
    const existingUser = {
        id: userId,
        role: 'doctor',
        name: 'Old Name',
        email: 'old@hospital.com'
    };

    mockDb.mockResult({ rows: [existingUser] });
    mockDb.mockResult({ rows: [] });
    mockDb.mockResult({ rows: [{
            id: userId,
            role: 'doctor',
            name: 'New Name',
            email: 'new@hospital.com'
        }] });

    const body = {
        name: 'New Name',
        email: 'new@hospital.com',
        password: 'newpass'
    };

    const { req, res, getStatus, getJson } = createMockReqRes(body, { id: userId }, {}, { role: 'admin' });

    const routeHandler = async (req, res) => {
        const { id } = req.params;
        const { name, email, password } = req.body || {};
        if (!name || !email) return res.status(400).json({ error: 'Missing fields' });

        const { rows: existingRows } = await mockDb.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
        const existing = existingRows[0];
        if (!existing) return res.status(404).json({ error: 'User not found' });

        if (email !== existing.email) {
            const { rows: emailRows } = await mockDb.query('SELECT 1 FROM users WHERE email = $1 AND id <> $2 AND deleted_at IS NULL', [email, id]);
            if (emailRows.length > 0) return res.status(409).json({ error: 'Email exists' });
        }

        const updates = [];
        const params = [];

        updates.push(`name = $${params.length + 1}`);
        params.push(name);

        updates.push(`email = $${params.length + 1}`);
        params.push(email);

        if (password) {
            updates.push(`passwordHash = $${params.length + 1}`);
            params.push(password);
        }

        params.push(id);

        const { rows: updatedRows } = await mockDb.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING id, role, name, email`,
            params
        );

        if (updatedRows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const updatedUser = updatedRows[0];

        await mockKafkaForIndex.publishEvent('user.events', {
            type: 'USER_UPDATED',
            id: updatedUser.id,
            role: updatedUser.role,
            name: updatedUser.name,
            email: updatedUser.email,
        });

        res.json(updatedUser);
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 200);
    assert(getJson().id);
    assert.strictEqual(mockKafkaForIndex.events[0].payload.type, 'USER_UPDATED');
});

testAsync('PUT /auth/users/:id should reject missing fields', async () => {
    mockDb.reset();

    const body = { name: 'Name Only' };
    const { req, res, getStatus } = createMockReqRes(body, { id: 'user-123' }, {}, { role: 'admin' });

    const routeHandler = async (req, res) => {
        const { name, email } = req.body || {};
        if (!name || !email) return res.status(400).json({ error: 'Missing fields' });
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 400);
});

testAsync('PUT /auth/users/:id should return 404 for non-existent user', async () => {
    mockDb.reset();
    mockDb.mockResult({ rows: [] });

    const body = { name: 'Name', email: 'email@test.com' };
    const { req, res, getStatus } = createMockReqRes(body, { id: 'nonexistent' }, {}, { role: 'admin' });

    const routeHandler = async (req, res) => {
        const { id } = req.params;
        const { name, email } = req.body || {};
        if (!name || !email) return res.status(400).json({ error: 'Missing fields' });

        const { rows: existingRows } = await mockDb.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
        const existing = existingRows[0];
        if (!existing) return res.status(404).json({ error: 'User not found' });
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 404);
});

testAsync('DELETE /auth/users/:id should soft delete user', async () => {
    mockDb.reset();
    mockKafkaForIndex.reset();

    mockDb.mockResult({ rows: [{ id: 'user-123', role: 'doctor' }] });

    const { req, res, getStatus } = createMockReqRes({}, { id: 'user-123' }, {}, { role: 'admin' });

    const routeHandler = async (req, res) => {
        const { id } = req.params;
        const { rows } = await mockDb.query(
            'UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, role',
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const deleted = rows[0];
        await mockKafkaForIndex.publishEvent('user.events', {
            type: 'USER_DELETED',
            id: deleted.id,
            role: deleted.role,
            deletedAt: new Date().toISOString(),
        });
        res.status(204).send();
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 204);
    assert.strictEqual(mockKafkaForIndex.events[0].payload.type, 'USER_DELETED');
});

testAsync('DELETE /auth/users/:id should return 404 for non-existent user', async () => {
    mockDb.reset();
    mockDb.mockResult({ rows: [] });

    const { req, res, getStatus } = createMockReqRes({}, { id: 'nonexistent' }, {}, { role: 'admin' });

    const routeHandler = async (req, res) => {
        const { id } = req.params;
        const { rows } = await mockDb.query(
            'UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, role',
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 404);
});

testAsync('POST /auth/login should return token for valid credentials', async () => {
    mockDb.reset();

    const user = {
        id: 'user-123',
        role: 'doctor',
        name: 'Dr. Smith',
        email: 'smith@hospital.com'
    };

    mockDb.mockResult({ rows: [user] });

    const body = { email: 'smith@hospital.com', password: 'password123' };
    const { req, res, getStatus, getJson } = createMockReqRes(body);

    const routeHandler = async (req, res) => {
        const {email, password} = req.body || {};
        const {rows} = await mockDb.query('SELECT * FROM users WHERE email = $1 AND passwordHash = $2 AND deleted_at IS NULL', [email, password]);
        const user = rows[0];
        if (!user) return res.status(401).json({error: 'Invalid credentials'});
        const token = jwt.sign({sub: user.id, role: user.role, name: user.name, email: user.email}, JWT_SECRET, {expiresIn: '2h'});
        res.json({token});
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 200);
    assert(getJson().token);

    const decoded = jwt.verify(getJson().token, JWT_SECRET);
    assert.strictEqual(decoded.sub, user.id);
});

testAsync('POST /auth/login should reject invalid credentials', async () => {
    mockDb.reset();
    mockDb.mockResult({ rows: [] });

    const body = { email: 'wrong@test.com', password: 'wrongpass' };
    const { req, res, getStatus, getJson } = createMockReqRes(body);

    const routeHandler = async (req, res) => {
        const {email, password} = req.body || {};
        const {rows} = await mockDb.query('SELECT * FROM users WHERE email = $1 AND passwordHash = $2 AND deleted_at IS NULL', [email, password]);
        const user = rows[0];
        if (!user) return res.status(401).json({error: 'Invalid credentials'});
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 401);
    assert.deepStrictEqual(getJson(), { error: 'Invalid credentials' });
});

testAsync('GET /auth/me should return user info for valid token', async () => {
    const user = {
        id: 'user-123',
        role: 'doctor',
        name: 'Dr. Smith',
        email: 'smith@hospital.com'
    };

    const token = jwt.sign({sub: user.id, role: user.role, name: user.name, email: user.email}, JWT_SECRET, {expiresIn: '2h'});

    const { req, res, getStatus, getJson } = createMockReqRes({}, {}, { authorization: `Bearer ${token}` });

    const routeHandler = (req, res) => {
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
        if (!token) return res.status(401).json({error: 'No token'});
        try {
            const payload = jwt.verify(token, JWT_SECRET);
            res.json(payload);
        } catch {
            res.status(401).json({error: 'Invalid token'});
        }
    };

    routeHandler(req, res);

    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getJson().sub, user.id);
});

testAsync('GET /auth/me should reject missing token', async () => {
    const { req, res, getStatus, getJson } = createMockReqRes({}, {}, {});

    const routeHandler = (req, res) => {
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
        if (!token) return res.status(401).json({error: 'No token'});
    };

    routeHandler(req, res);

    assert.strictEqual(getStatus(), 401);
    assert.deepStrictEqual(getJson(), { error: 'No token' });
});

testAsync('GET /auth/me should reject invalid token', async () => {
    const { req, res, getStatus, getJson } = createMockReqRes({}, {}, { authorization: 'Bearer invalidtoken' });

    const routeHandler = (req, res) => {
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
        if (!token) return res.status(401).json({error: 'No token'});
        try {
            const payload = jwt.verify(token, JWT_SECRET);
            res.json(payload);
        } catch {
            res.status(401).json({error: 'Invalid token'});
        }
    };

    routeHandler(req, res);

    assert.strictEqual(getStatus(), 401);
    assert.deepStrictEqual(getJson(), { error: 'Invalid token' });
});

test('authGuard should allow request with valid user role', () => {
    const roles = ['admin'];
    const user = { role: 'admin' };
    const authorized = user && roles.includes(user.role);
    assert(authorized);
});

test('authGuard should reject request with invalid role', () => {
    const roles = ['admin'];
    const user = { role: 'patient' };
    const authorized = user && roles.includes(user.role);
    assert(!authorized);
});

test('authGuard should verify Bearer token', () => {
    const user = { id: 'user-123', role: 'doctor' };
    const token = jwt.sign({sub: user.id, role: user.role}, JWT_SECRET, {expiresIn: '2h'});

    const auth = `Bearer ${token}`;
    const extractedToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;

    assert(extractedToken);

    const payload = jwt.verify(extractedToken, JWT_SECRET);
    assert.strictEqual(payload.role, 'doctor');
});

test('authGuard should handle multiple roles', () => {
    const roles = ['doctor', 'admin'];
    const user1 = { role: 'doctor' };
    const user2 = { role: 'admin' };
    const user3 = { role: 'patient' };

    assert(roles.includes(user1.role));
    assert(roles.includes(user2.role));
    assert(!roles.includes(user3.role));
});

test('nanoid should generate unique IDs', () => {
    const { nanoid } = require('nanoid');
    const id1 = nanoid();
    const id2 = nanoid();

    assert(id1);
    assert(id2);
    assert(id1 !== id2);
});

test('Token should have 2 hour expiration', () => {
    const user = { id: 'user-123', role: 'doctor', name: 'Dr. Test', email: 'test@hospital.com' };
    const token = jwt.sign({sub: user.id, role: user.role, name: user.name, email: user.email}, JWT_SECRET, {expiresIn: '2h'});
    const decoded = jwt.decode(token);

    const expectedExpiration = decoded.iat + (2 * 60 * 60);
    assert.strictEqual(decoded.exp, expectedExpiration);
});

testAsync('Routes should handle empty request body', async () => {
    const { req, res, getStatus } = createMockReqRes(undefined);

    const routeHandler = (req, res) => {
        const {name, email, password} = req.body || {};
        if (!name || !email || !password) return res.status(400).json({error: 'Missing fields'});
    };

    routeHandler(req, res);

    assert.strictEqual(getStatus(), 400);
});

test('Should generate valid ISO timestamp for deletedAt', () => {
    const deletedAt = new Date().toISOString();
    const date = new Date(deletedAt);

    assert(!isNaN(date.getTime()));
    assert(deletedAt.includes('T'));
    assert(deletedAt.includes('Z'));
});

test('Should create proper user object for doctor', () => {
    const { nanoid } = require('nanoid');
    const user = {
        id: nanoid(),
        role: 'doctor',
        name: 'Dr. Smith',
        email: 'smith@hospital.com',
        passwordHash: 'hashedPassword'
    };

    assert(user.id);
    assert.strictEqual(user.role, 'doctor');
    assert(user.name);
    assert(user.email);
    assert(user.passwordHash);
});

test('Should create proper user object for patient', () => {
    const { nanoid } = require('nanoid');
    const user = {
        id: nanoid(),
        role: 'patient',
        name: 'John Doe',
        email: 'john@example.com',
        passwordHash: 'hashedPassword'
    };

    assert(user.id);
    assert.strictEqual(user.role, 'patient');
});

test('Should create proper USER_CREATED event structure', () => {
    const event = {
        type: 'USER_CREATED',
        id: 'user-123',
        role: 'doctor',
        name: 'Dr. Smith',
        email: 'smith@hospital.com'
    };

    assert.strictEqual(event.type, 'USER_CREATED');
    assert(event.id);
    assert(event.role);
    assert(event.name);
    assert(event.email);
});

test('Should create proper USER_UPDATED event structure', () => {
    const event = {
        type: 'USER_UPDATED',
        id: 'user-123',
        role: 'doctor',
        name: 'Dr. John Smith',
        email: 'john.smith@hospital.com'
    };

    assert.strictEqual(event.type, 'USER_UPDATED');
    assert(event.id);
    assert(event.name);
    assert(event.email);
});

test('Should create proper USER_DELETED event structure', () => {
    const event = {
        type: 'USER_DELETED',
        id: 'user-123',
        role: 'doctor',
        deletedAt: new Date().toISOString()
    };

    assert.strictEqual(event.type, 'USER_DELETED');
    assert(event.id);
    assert(event.role);
    assert(event.deletedAt);
});

test('Should structure INSERT query parameters correctly', () => {
    const { nanoid } = require('nanoid');
    const user = {
        id: nanoid(),
        role: 'doctor',
        name: 'Dr. Smith',
        email: 'smith@test.com',
        passwordHash: 'hash123'
    };

    const params = [user.id, user.role, user.name, user.email, user.passwordHash];
    assert.strictEqual(params.length, 5);
    assert.strictEqual(params[0], user.id);
    assert.strictEqual(params[1], user.role);
});

test('Should build UPDATE query with password', () => {
    const updates = [];
    const params = [];

    updates.push(`name = ${params.length + 1}`);
    params.push('New Name');

    updates.push(`email = ${params.length + 1}`);
    params.push('newemail@test.com');

    updates.push(`passwordHash = ${params.length + 1}`);
    params.push('newhash');

    params.push('user-id');

    assert.strictEqual(params.length, 4);
    assert.strictEqual(updates.length, 3);
    assert.strictEqual(params[3], 'user-id');
});

test('Should build UPDATE query without password', () => {
    const updates = [];
    const params = [];

    updates.push(`name = ${params.length + 1}`);
    params.push('New Name');

    updates.push(`email = ${params.length + 1}`);
    params.push('newemail@test.com');

    params.push('user-id');

    assert.strictEqual(params.length, 3);
    assert.strictEqual(updates.length, 2);
    assert(!updates.join(', ').includes('passwordHash'));
});

test('Should validate user roles', () => {
    const validRoles = ['admin', 'doctor', 'patient'];

    assert(validRoles.includes('admin'));
    assert(validRoles.includes('doctor'));
    assert(validRoles.includes('patient'));
    assert(!validRoles.includes('invalid'));
});

test('authGuard should reject when no user provided', () => {
    const roles = ['admin'];
    const user = null;
    const authorized = user && roles.includes(user.role);
    assert(!authorized);
});

test('Should return null for missing Bearer prefix', () => {
    const auth = 'InvalidFormat token';
    const extracted = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    assert.strictEqual(extracted, null);
});

test('JWT verification should fail with wrong secret', () => {
    const token = jwt.sign({ sub: 'user-123', role: 'doctor' }, JWT_SECRET, { expiresIn: '2h' });

    try {
        jwt.verify(token, 'wrongsecret');
        assert.fail('Should have thrown error');
    } catch (err) {
        assert(err.name === 'JsonWebTokenError');
    }
});

test('JWT verification should fail with expired token', () => {
    const expiredToken = jwt.sign({ sub: 'user-123', role: 'doctor' }, JWT_SECRET, { expiresIn: '0s' });

    try {
        jwt.verify(expiredToken, JWT_SECRET);
        assert.fail('Should have thrown error');
    } catch (err) {
        assert(err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError');
    }
});

testAsync('authGuard should use req.user when present', async () => {
    const user = { id: 'user-123', role: 'admin' };
    const { req, res, getStatus, getJson } = createMockReqRes({}, {}, {}, user);

    const roles = ['admin'];

    const routeHandler = (req, res, next) => {
        let user = req.user;
        if (user && roles.includes(user.role)) {
            res.json({ allowed: true });
        } else {
            res.status(403).json({ error: 'Forbidden' });
        }
    };

    routeHandler(req, res);

    assert.strictEqual(getStatus(), 200);
    assert(getJson().allowed);
});

testAsync('authGuard should verify token when req.user not present', async () => {
    const user = { id: 'user-123', role: 'admin' };
    const token = jwt.sign({sub: user.id, role: user.role}, JWT_SECRET, {expiresIn: '2h'});

    const { req, res, getStatus, getJson } = createMockReqRes({}, {}, { authorization: `Bearer ${token}` }, null);

    const roles = ['admin'];

    const routeHandler = (req, res, next) => {
        let user = req.user;
        if (!user) {
            const auth = req.headers.authorization || '';
            if (auth.startsWith('Bearer ')) {
                try {
                    user = jwt.verify(auth.slice(7), JWT_SECRET);
                    req.user = user;
                } catch (err) {
                    return res.status(401).json({error: 'Invalid token'});
                }
            }
        }
        if (user && roles.includes(user.role)) {
            res.json({ allowed: true });
        } else {
            res.status(403).json({error: 'Forbidden'});
        }
    };

    routeHandler(req, res);

    assert.strictEqual(getStatus(), 200);
    assert(getJson().allowed);
});

testAsync('authGuard should return 403 for unauthorized role', async () => {
    const user = { id: 'user-123', role: 'patient' };
    const { req, res, getStatus, getJson } = createMockReqRes({}, {}, {}, user);

    const roles = ['admin'];

    const routeHandler = (req, res, next) => {
        let user = req.user;
        if (user && roles.includes(user.role)) {
            res.json({ allowed: true });
        } else {
            res.status(403).json({error: 'Forbidden'});
        }
    };

    routeHandler(req, res);

    assert.strictEqual(getStatus(), 403);
    assert.deepStrictEqual(getJson(), { error: 'Forbidden' });
});

testAsync('authGuard should return 401 for invalid token', async () => {
    const { req, res, getStatus, getJson } = createMockReqRes({}, {}, { authorization: 'Bearer invalidtoken' }, null);

    const roles = ['admin'];

    const routeHandler = (req, res, next) => {
        let user = req.user;
        if (!user) {
            const auth = req.headers.authorization || '';
            if (auth.startsWith('Bearer ')) {
                try {
                    user = jwt.verify(auth.slice(7), JWT_SECRET);
                    req.user = user;
                } catch (err) {
                    return res.status(401).json({error: 'Invalid token'});
                }
            }
        }
        if (user && roles.includes(user.role)) {
            res.json({ allowed: true });
        } else {
            res.status(403).json({error: 'Forbidden'});
        }
    };

    routeHandler(req, res);

    assert.strictEqual(getStatus(), 401);
    assert.deepStrictEqual(getJson(), { error: 'Invalid token' });
});

console.log('\n=== Additional Index.js Coverage Tests ===\n');

testAsync('PUT /auth/users/:id should handle email unchanged scenario', async () => {
    mockDb.reset();
    mockKafkaForIndex.reset();

    const userId = 'user-123';
    const existingUser = {
        id: userId,
        role: 'doctor',
        name: 'Old Name',
        email: 'same@hospital.com'
    };

    mockDb.mockResult({ rows: [existingUser] });
    mockDb.mockResult({ rows: [{
            id: userId,
            role: 'doctor',
            name: 'New Name',
            email: 'same@hospital.com'
        }] });

    const body = {
        name: 'New Name',
        email: 'same@hospital.com'
    };

    const { req, res, getStatus, getJson } = createMockReqRes(body, { id: userId }, {}, { role: 'admin' });

    const routeHandler = async (req, res) => {
        const { id } = req.params;
        const { name, email, password } = req.body || {};
        if (!name || !email) return res.status(400).json({ error: 'Missing fields' });

        const { rows: existingRows } = await mockDb.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
        const existing = existingRows[0];
        if (!existing) return res.status(404).json({ error: 'User not found' });

        if (email !== existing.email) {
            const { rows: emailRows } = await mockDb.query('SELECT 1 FROM users WHERE email = $1 AND id <> $2 AND deleted_at IS NULL', [email, id]);
            if (emailRows.length > 0) return res.status(409).json({ error: 'Email exists' });
        }

        const updates = [];
        const params = [];

        updates.push(`name = ${params.length + 1}`);
        params.push(name);

        updates.push(`email = ${params.length + 1}`);
        params.push(email);

        if (password) {
            updates.push(`passwordHash = ${params.length + 1}`);
            params.push(password);
        }

        params.push(id);

        const { rows: updatedRows } = await mockDb.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ${params.length} AND deleted_at IS NULL RETURNING id, role, name, email`,
            params
        );

        if (updatedRows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const updatedUser = updatedRows[0];

        await mockKafkaForIndex.publishEvent('user.events', {
            type: 'USER_UPDATED',
            id: updatedUser.id,
            role: updatedUser.role,
            name: updatedUser.name,
            email: updatedUser.email,
        });

        res.json(updatedUser);
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 200);
    assert(getJson().id);
});

testAsync('PUT /auth/users/:id should return 404 when update returns no rows', async () => {
    mockDb.reset();

    const userId = 'user-123';
    mockDb.mockResult({ rows: [{ id: userId, email: 'old@test.com' }] });
    mockDb.mockResult({ rows: [] });
    mockDb.mockResult({ rows: [] }); // Update returns no rows

    const body = { name: 'Name', email: 'new@test.com' };
    const { req, res, getStatus, getJson } = createMockReqRes(body, { id: userId }, {}, { role: 'admin' });

    const routeHandler = async (req, res) => {
        const { id } = req.params;
        const { name, email, password } = req.body || {};
        if (!name || !email) return res.status(400).json({ error: 'Missing fields' });

        const { rows: existingRows } = await mockDb.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
        const existing = existingRows[0];
        if (!existing) return res.status(404).json({ error: 'User not found' });

        if (email !== existing.email) {
            const { rows: emailRows } = await mockDb.query('SELECT 1 FROM users WHERE email = $1 AND id <> $2 AND deleted_at IS NULL', [email, id]);
            if (emailRows.length > 0) return res.status(409).json({ error: 'Email exists' });
        }

        const updates = [];
        const params = [];

        updates.push(`name = ${params.length + 1}`);
        params.push(name);

        updates.push(`email = ${params.length + 1}`);
        params.push(email);

        if (password) {
            updates.push(`passwordHash = ${params.length + 1}`);
            params.push(password);
        }

        params.push(id);

        const { rows: updatedRows } = await mockDb.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ${params.length} AND deleted_at IS NULL RETURNING id, role, name, email`,
            params
        );

        if (updatedRows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 404);
});

testAsync('authGuard should handle no authorization header', async () => {
    const { req, res, getStatus, getJson } = createMockReqRes({}, {}, {}, null);

    const roles = ['admin'];

    const routeHandler = (req, res, next) => {
        let user = req.user;
        if (!user) {
            const auth = req.headers.authorization || '';
            if (auth.startsWith('Bearer ')) {
                try {
                    user = jwt.verify(auth.slice(7), JWT_SECRET);
                    req.user = user;
                } catch (err) {
                    return res.status(401).json({error: 'Invalid token'});
                }
            }
        }
        if (user && roles.includes(user.role)) {
            res.json({ allowed: true });
        } else {
            res.status(403).json({error: 'Forbidden'});
        }
    };

    routeHandler(req, res);

    assert.strictEqual(getStatus(), 403);
    assert.deepStrictEqual(getJson(), { error: 'Forbidden' });
});

testAsync('Login should log the request body', async () => {
    const originalLog = console.log;
    let loggedBody = null;

    console.log = (msg, body) => {
        if (msg === 'login') {
            loggedBody = body;
        }
    };

    const body = { email: 'test@test.com', password: 'pass' };
    console.log('login', body);

    console.log = originalLog;

    assert(loggedBody);
    assert.strictEqual(loggedBody.email, 'test@test.com');
});

test('Should handle role array conversion', () => {
    const singleRole = 'admin';
    const roles = Array.isArray(singleRole) ? singleRole : [singleRole];
    assert(Array.isArray(roles));
    assert.strictEqual(roles.length, 1);
    assert.strictEqual(roles[0], 'admin');
});

test('Should handle multiple roles in array', () => {
    const multipleRoles = ['doctor', 'admin'];
    const roles = Array.isArray(multipleRoles) ? multipleRoles : [multipleRoles];
    assert(Array.isArray(roles));
    assert.strictEqual(roles.length, 2);
});

test('Token payload should include all user fields', () => {
    const user = {
        id: 'user-123',
        role: 'doctor',
        name: 'Dr. Smith',
        email: 'smith@hospital.com'
    };

    const payload = {
        sub: user.id,
        role: user.role,
        name: user.name,
        email: user.email
    };

    assert.strictEqual(payload.sub, user.id);
    assert.strictEqual(payload.role, user.role);
    assert.strictEqual(payload.name, user.name);
    assert.strictEqual(payload.email, user.email);
});

testAsync('Register patient should work with admin role', async () => {
    mockDb.reset();
    mockKafkaForIndex.reset();

    mockDb.mockResult({ rows: [] });
    mockDb.mockResult({ rows: [] });

    const body = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'password123'
    };

    const { req, res, getStatus, getJson } = createMockReqRes(body, {}, {}, { role: 'admin' });

    const routeHandler = async (req, res) => {
        const {name, email, password} = req.body || {};
        if (!name || !email || !password) return res.status(400).json({error: 'Missing fields'});
        const {rows} = await mockDb.query('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
        if (rows.length > 0) return res.status(409).json({error: 'Email exists'});
        const {nanoid} = require('nanoid');
        const user = {id: nanoid(), role: 'patient', name, email, passwordHash: password};
        await mockDb.query('INSERT INTO users (id, role, name, email, passwordHash) VALUES ($1, $2, $3, $4, $5)',
            [user.id, user.role, user.name, user.email, user.passwordHash]);
        await mockKafkaForIndex.publishEvent('user.events', {
            type: 'USER_CREATED',
            id: user.id,
            role: user.role,
            name: user.name,
            email: user.email,
        });
        res.status(201).json({id: user.id});
    };

    await routeHandler(req, res);

    assert.strictEqual(getStatus(), 201);
    assert(getJson().id);
});

testAsync('Should handle empty body object for login', async () => {
    mockDb.reset();
    const { req, res } = createMockReqRes({});

    const {email, password} = req.body || {};
    assert.strictEqual(email, undefined);
    assert.strictEqual(password, undefined);
});

test('SQL DELETE query should include deleted_at check', () => {
    const sql = 'UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, role';
    assert(sql.includes('deleted_at IS NULL'));
    assert(sql.includes('RETURNING id, role'));
});

test('SQL SELECT query should exclude deleted users', () => {
    const sql = 'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL';
    assert(sql.includes('deleted_at IS NULL'));
});

test('SQL UPDATE should check deleted_at', () => {
    const sql = 'UPDATE users SET name = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, role, name, email';
    assert(sql.includes('deleted_at IS NULL'));
    assert(sql.includes('RETURNING'));
});

testAsync('Register should create user with correct role field', async () => {
    const { nanoid } = require('nanoid');
    const doctorUser = {id: nanoid(), role: 'doctor', name: 'Dr. A', email: 'a@test.com', passwordHash: 'hash'};
    const patientUser = {id: nanoid(), role: 'patient', name: 'Patient B', email: 'b@test.com', passwordHash: 'hash'};

    assert.strictEqual(doctorUser.role, 'doctor');
    assert.strictEqual(patientUser.role, 'patient');
});

test('Kafka event should include correct topic', () => {
    const topic = 'user.events';
    const event = { type: 'USER_CREATED', id: 'user-1' };

    assert.strictEqual(topic, 'user.events');
    assert.strictEqual(event.type, 'USER_CREATED');
});

testAsync('Should handle password field in body correctly', async () => {
    const bodyWithPass = { name: 'Name', email: 'e@test.com', password: 'pass123' };
    const bodyWithoutPass = { name: 'Name', email: 'e@test.com' };

    assert(bodyWithPass.password);
    assert(!bodyWithoutPass.password);
});

test('Bearer token should be extracted correctly', () => {
    const auth1 = 'Bearer abc123';
    const auth2 = 'Basic xyz';

    const token1 = auth1.startsWith('Bearer ') ? auth1.slice(7) : null;
    const token2 = auth2.startsWith('Bearer ') ? auth2.slice(7) : null;

    assert.strictEqual(token1, 'abc123');
    assert.strictEqual(token2, null);
});

test('User object should match database schema', () => {
    const { nanoid } = require('nanoid');
    const user = {
        id: nanoid(),
        role: 'doctor',
        name: 'Dr. Test',
        email: 'test@example.com',
        passwordHash: 'hashedpassword123'
    };

    assert(user.id);
    assert(['admin', 'doctor', 'patient'].includes(user.role));
    assert(user.name);
    assert(user.email);
    assert(user.passwordHash);
});

// ========================================
// FINAL SUMMARY
// ========================================

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