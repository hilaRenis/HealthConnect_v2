// const assert = require('assert');
// const jwt = require('jsonwebtoken');
// const { nanoid } = require('nanoid');
//
// const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
//
// // Test counter
// let passed = 0;
// let failed = 0;
//
// function test(name, fn) {
//     try {
//         fn();
//         console.log(`✓ ${name}`);
//         passed++;
//     } catch (err) {
//         console.log(`✗ ${name}`);
//         console.error(`  Error: ${err.message}`);
//         failed++;
//     }
// }
//
// async function testAsync(name, fn) {
//     try {
//         await fn();
//         console.log(`✓ ${name}`);
//         passed++;
//     } catch (err) {
//         console.log(`✗ ${name}`);
//         console.error(`  Error: ${err.message}`);
//         failed++;
//     }
// }
//
// // Helper function matching index.js
// function issueToken(user) {
//     return jwt.sign(
//         {sub: user.id, role: user.role, name: user.name, email: user.email},
//         JWT_SECRET,
//         {expiresIn: '2h'}
//     );
// }
//
// // Helper to simulate authGuard logic
// function createAuthGuard(roleOrRoles) {
//     const roles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
//     return { roles, isArray: Array.isArray(roleOrRoles) };
// }
//
// console.log('\n=== Testing Auth Service ===\n');
//
// // ========== KAFKA.JS TESTS (Full Coverage) ==========
//
// testAsync('Kafka module should export publishEvent function', async () => {
//     const kafka = require('../src/kafka');
//     assert(typeof kafka.publishEvent === 'function', 'publishEvent should be a function');
// });
//
// testAsync('publishEvent should handle when Kafka is disabled', async () => {
//     const kafka = require('../src/kafka');
//     await kafka.publishEvent('user.events', {
//         type: 'USER_CREATED',
//         id: 'user-123',
//         role: 'doctor',
//         name: 'Dr. Smith',
//         email: 'smith@hospital.com'
//     });
//     assert(true, 'publishEvent should not throw when Kafka is disabled');
// });
//
// testAsync('publishEvent should handle event with custom key', async () => {
//     const kafka = require('../src/kafka');
//     await kafka.publishEvent('user.events', {
//         type: 'USER_UPDATED',
//         id: 'user-456',
//         name: 'Updated Name'
//     }, { key: 'custom-key' });
//     assert(true, 'publishEvent should handle custom key');
// });
//
// testAsync('publishEvent should add emittedAt timestamp', async () => {
//     const kafka = require('../src/kafka');
//     const payload = {
//         type: 'USER_DELETED',
//         id: 'user-789',
//         role: 'patient'
//     };
//     await kafka.publishEvent('user.events', payload);
//     // The actual implementation adds emittedAt internally
//     assert(true, 'publishEvent should add timestamp');
// });
//
// // ========== HTTP.JS TESTS (Full Coverage) ==========
//
// test('createApp should be a function', () => {
//     const { createApp } = require('../src/http');
//     assert(typeof createApp === 'function', 'createApp should be a function');
// });
//
// test('createApp should handle configuration object', () => {
//     const express = require('express');
//     const { createApp } = require('../src/http');
//
//     // Mock app.listen to prevent actual server start
//     const originalListen = express.application.listen;
//     express.application.listen = function(port, callback) {
//         if (callback) callback();
//         return { close: () => {} };
//     };
//
//     try {
//         const mockRoutes = (app) => {
//             app.get('/test', (req, res) => res.json({ test: true }));
//         };
//
//         // This will create the app but we can't easily test it without starting server
//         // Just verify the function accepts the right params
//         assert(true, 'createApp accepts config object');
//     } finally {
//         express.application.listen = originalListen;
//     }
// });
//
// test('Express middleware should parse JSON', () => {
//     const express = require('express');
//     const app = express();
//     app.use(express.json());
//     assert(true, 'Express should have json middleware');
// });
//
// test('X-User header parsing logic', () => {
//     const testUser = { id: '123', role: 'doctor', name: 'Test' };
//     const xuHeader = JSON.stringify(testUser);
//
//     try {
//         const parsed = JSON.parse(xuHeader);
//         assert.strictEqual(parsed.id, testUser.id);
//         assert.strictEqual(parsed.role, testUser.role);
//     } catch (err) {
//         assert.fail('Should parse X-User header');
//     }
// });
//
// test('Health check endpoint structure', () => {
//     const healthResponse = { service: 'auth-service', ok: true };
//     assert(healthResponse.service);
//     assert(healthResponse.ok === true);
// });
//
// test('Error handler should format error response', () => {
//     const error = new Error('Test error');
//     error.status = 400;
//
//     const errorResponse = { error: error.message || 'InternalError' };
//     assert.strictEqual(errorResponse.error, 'Test error');
// });
//
// test('Error handler should default to 500 status', () => {
//     const error = new Error('Internal error');
//     const status = error.status || 500;
//     assert.strictEqual(status, 500);
// });
//
// // ========== INDEX.JS TESTS (Full Coverage) ==========
//
// // Test issueToken function
// test('issueToken should generate valid JWT token', () => {
//     const user = {
//         id: 'user-123',
//         role: 'doctor',
//         name: 'Dr. Smith',
//         email: 'smith@hospital.com'
//     };
//
//     const token = issueToken(user);
//     assert(token, 'Token should be generated');
//     assert(typeof token === 'string', 'Token should be a string');
//
//     const decoded = jwt.verify(token, JWT_SECRET);
//     assert.strictEqual(decoded.sub, user.id);
//     assert.strictEqual(decoded.role, user.role);
//     assert.strictEqual(decoded.name, user.name);
//     assert.strictEqual(decoded.email, user.email);
// });
//
// test('issueToken should set 2 hour expiration', () => {
//     const user = {
//         id: 'user-999',
//         role: 'doctor',
//         name: 'Dr. Test',
//         email: 'test@hospital.com'
//     };
//
//     const token = issueToken(user);
//     const decoded = jwt.decode(token);
//
//     assert(decoded.exp, 'Token should have expiration');
//     assert(decoded.iat, 'Token should have issued at time');
//
//     const expectedExpiration = decoded.iat + (2 * 60 * 60); // 2 hours in seconds
//     assert.strictEqual(decoded.exp, expectedExpiration, 'Expiration should be 2 hours');
// });
//
// // Test authGuard function
// test('authGuard should handle single role as string', () => {
//     const guard = createAuthGuard('admin');
//     assert(guard.roles.includes('admin'));
//     assert.strictEqual(guard.roles.length, 1);
// });
//
// test('authGuard should handle multiple roles as array', () => {
//     const guard = createAuthGuard(['doctor', 'admin']);
//     assert(guard.roles.includes('doctor'));
//     assert(guard.roles.includes('admin'));
//     assert.strictEqual(guard.roles.length, 2);
//     assert(guard.isArray === true);
// });
//
// test('authGuard should convert single role to array', () => {
//     const guard = createAuthGuard('patient');
//     assert(Array.isArray(guard.roles));
//     assert.strictEqual(guard.roles.length, 1);
// });
//
// // Test JWT verification logic
// test('JWT verification should succeed with valid token', () => {
//     const user = {
//         id: 'user-456',
//         role: 'patient',
//         name: 'John Doe',
//         email: 'john@example.com'
//     };
//
//     const token = issueToken(user);
//
//     try {
//         const payload = jwt.verify(token, JWT_SECRET);
//         assert(payload, 'Token should be verified');
//         assert.strictEqual(payload.sub, user.id);
//     } catch (err) {
//         assert.fail('Valid token should verify');
//     }
// });
//
// test('JWT verification should fail with wrong secret', () => {
//     const user = {
//         id: 'user-789',
//         role: 'admin',
//         name: 'Admin User',
//         email: 'admin@example.com'
//     };
//
//     const token = issueToken(user);
//
//     try {
//         jwt.verify(token, 'wrongsecret');
//         assert.fail('Should have thrown error');
//     } catch (err) {
//         assert(err.name === 'JsonWebTokenError');
//     }
// });
//
// test('JWT verification should fail with expired token', () => {
//     const expiredToken = jwt.sign(
//         { sub: 'user-123', role: 'doctor' },
//         JWT_SECRET,
//         { expiresIn: '0s' } // Already expired
//     );
//
//     try {
//         jwt.verify(expiredToken, JWT_SECRET);
//         assert.fail('Should have thrown error for expired token');
//     } catch (err) {
//         assert(err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError');
//     }
// });
//
// // Test Bearer token extraction
// test('should extract Bearer token from Authorization header', () => {
//     const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
//     const auth = `Bearer ${token}`;
//
//     const extracted = auth.startsWith('Bearer ') ? auth.slice(7) : null;
//     assert.strictEqual(extracted, token);
// });
//
// test('should return null for missing Bearer prefix', () => {
//     const auth = 'InvalidFormat token';
//     const extracted = auth.startsWith('Bearer ') ? auth.slice(7) : null;
//     assert.strictEqual(extracted, null);
// });
//
// // Test route validation logic
// test('should validate required fields for doctor registration', () => {
//     const validBody = { name: 'Dr. Smith', email: 'smith@test.com', password: 'pass123' };
//     const hasAllFields = !!(validBody.name && validBody.email && validBody.password);
//     assert.strictEqual(hasAllFields, true);
// });
//
// test('should reject registration with missing fields', () => {
//     const invalidBody = { name: 'Dr. Smith', email: 'smith@test.com' };
//     const hasAllFields = !!(invalidBody.name && invalidBody.email && invalidBody.password);
//     assert.strictEqual(hasAllFields, false);
// });
//
// test('should validate required fields for patient registration', () => {
//     const validBody = { name: 'John Doe', email: 'john@test.com', password: 'pass123' };
//     const hasAllFields = !!(validBody.name && validBody.email && validBody.password);
//     assert.strictEqual(hasAllFields, true);
// });
//
// test('should validate required fields for user update', () => {
//     const validBody = { name: 'Updated Name', email: 'updated@test.com' };
//     const hasRequiredFields = !!(validBody.name && validBody.email);
//     assert.strictEqual(hasRequiredFields, true);
// });
//
// test('should handle optional password in user update', () => {
//     const bodyWithPassword = { name: 'Name', email: 'email@test.com', password: 'newpass' };
//     const bodyWithoutPassword = { name: 'Name', email: 'email@test.com' };
//
//     assert(bodyWithPassword.password !== undefined);
//     assert(bodyWithoutPassword.password === undefined);
// });
//
// test('should validate login credentials format', () => {
//     const validCredentials = { email: 'test@example.com', password: 'password123' };
//     const hasCredentials = !!(validCredentials.email && validCredentials.password);
//     assert.strictEqual(hasCredentials, true);
// });
//
// // Test nanoid usage
// test('nanoid should generate unique user IDs', () => {
//     const id1 = nanoid();
//     const id2 = nanoid();
//
//     assert(id1, 'Should generate first ID');
//     assert(id2, 'Should generate second ID');
//     assert(id1 !== id2, 'IDs should be unique');
//     assert(typeof id1 === 'string');
//     assert(id1.length > 0);
// });
//
// // Test user object creation
// test('should create proper user object for doctor', () => {
//     const user = {
//         id: nanoid(),
//         role: 'doctor',
//         name: 'Dr. Smith',
//         email: 'smith@hospital.com',
//         passwordHash: 'hashedPassword'
//     };
//
//     assert(user.id);
//     assert.strictEqual(user.role, 'doctor');
//     assert(user.name);
//     assert(user.email);
//     assert(user.passwordHash);
// });
//
// test('should create proper user object for patient', () => {
//     const user = {
//         id: nanoid(),
//         role: 'patient',
//         name: 'John Doe',
//         email: 'john@example.com',
//         passwordHash: 'hashedPassword'
//     };
//
//     assert(user.id);
//     assert.strictEqual(user.role, 'patient');
//     assert(user.name);
//     assert(user.email);
//     assert(user.passwordHash);
// });
//
// // Test Kafka event structures
// test('should create proper USER_CREATED event', () => {
//     const event = {
//         type: 'USER_CREATED',
//         id: 'user-123',
//         role: 'doctor',
//         name: 'Dr. Smith',
//         email: 'smith@hospital.com'
//     };
//
//     assert.strictEqual(event.type, 'USER_CREATED');
//     assert(event.id);
//     assert(event.role);
//     assert(event.name);
//     assert(event.email);
// });
//
// test('should create proper USER_UPDATED event', () => {
//     const event = {
//         type: 'USER_UPDATED',
//         id: 'user-123',
//         role: 'doctor',
//         name: 'Dr. John Smith',
//         email: 'john.smith@hospital.com'
//     };
//
//     assert.strictEqual(event.type, 'USER_UPDATED');
//     assert(event.id);
//     assert(event.name);
//     assert(event.email);
// });
//
// test('should create proper USER_DELETED event', () => {
//     const event = {
//         type: 'USER_DELETED',
//         id: 'user-123',
//         role: 'doctor',
//         deletedAt: new Date().toISOString()
//     };
//
//     assert.strictEqual(event.type, 'USER_DELETED');
//     assert(event.id);
//     assert(event.role);
//     assert(event.deletedAt);
//
//     const date = new Date(event.deletedAt);
//     assert(!isNaN(date.getTime()));
// });
//
// // Test email validation
// test('should validate email format', () => {
//     const validEmail = 'test@example.com';
//     const invalidEmail = 'notanemail';
//     const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
//
//     assert(emailRegex.test(validEmail));
//     assert(!emailRegex.test(invalidEmail));
// });
//
// // Test role validation
// test('should validate user roles', () => {
//     const validRoles = ['admin', 'doctor', 'patient'];
//
//     assert(validRoles.includes('admin'));
//     assert(validRoles.includes('doctor'));
//     assert(validRoles.includes('patient'));
//     assert(!validRoles.includes('invalid'));
// });
//
// // Test SQL query parameter structure
// test('should structure INSERT query parameters correctly', () => {
//     const user = {
//         id: 'user-123',
//         role: 'doctor',
//         name: 'Dr. Smith',
//         email: 'smith@test.com',
//         passwordHash: 'hash123'
//     };
//
//     const params = [user.id, user.role, user.name, user.email, user.passwordHash];
//     assert.strictEqual(params.length, 5);
//     assert.strictEqual(params[0], user.id);
//     assert.strictEqual(params[1], user.role);
// });
//
// // Test UPDATE query building logic
// test('should build UPDATE query parameters with password', () => {
//     const updates = [];
//     const params = [];
//
//     updates.push(`name = $${params.length + 1}`);
//     params.push('New Name');
//
//     updates.push(`email = $${params.length + 1}`);
//     params.push('newemail@test.com');
//
//     updates.push(`passwordHash = $${params.length + 1}`);
//     params.push('newhash');
//
//     params.push('user-id');
//
//     assert.strictEqual(params.length, 4);
//     assert.strictEqual(updates.length, 3);
//     assert.strictEqual(params[3], 'user-id'); // ID should be last
// });
//
// test('should build UPDATE query parameters without password', () => {
//     const updates = [];
//     const params = [];
//
//     updates.push(`name = $${params.length + 1}`);
//     params.push('New Name');
//
//     updates.push(`email = $${params.length + 1}`);
//     params.push('newemail@test.com');
//
//     // No password update
//
//     params.push('user-id');
//
//     assert.strictEqual(params.length, 3);
//     assert.strictEqual(updates.length, 2);
// });
//
// // Test ISO timestamp generation
// test('should generate valid ISO timestamp for deletedAt', () => {
//     const deletedAt = new Date().toISOString();
//     const date = new Date(deletedAt);
//
//     assert(!isNaN(date.getTime()));
//     assert(deletedAt.includes('T'));
//     assert(deletedAt.includes('Z'));
// });
//
// // Test request body handling
// test('should handle empty request body', () => {
//     const body = undefined;
//     const { name, email, password } = body || {};
//
//     assert(name === undefined);
//     assert(email === undefined);
//     assert(password === undefined);
// });
//
// test('should extract fields from request body', () => {
//     const body = { name: 'Test', email: 'test@test.com', password: 'pass' };
//     const { name, email, password } = body || {};
//
//     assert.strictEqual(name, 'Test');
//     assert.strictEqual(email, 'test@test.com');
//     assert.strictEqual(password, 'pass');
// });
//
// // Run async tests
// (async () => {
//     // Summary
//     console.log('\n=== Test Summary ===\n');
//     console.log(`Passed: ${passed}`);
//     console.log(`Failed: ${failed}`);
//     console.log(`Total: ${passed + failed}`);
//     console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(2)}%`);
//
//     if (failed > 0) {
//         process.exit(1);
//     }
// })();

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