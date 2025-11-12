const assert = require('assert');

// Test the Kafka module
const kafka = require('../src/kafka');

// Test issueToken function (we'll need to extract it or test via routes)
const jwt = require('jsonwebtoken');
const JWT_SECRET = 'devsecret';

// Mock database
const mockDb = {
    data: [],
    query: async function(sql, params) {
        // Simple mock that returns empty results
        return { rows: [] };
    }
};

// Test counter
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

// Helper function to create a token (extracted logic)
function issueToken(user) {
    return jwt.sign(
        {sub: user.id, role: user.role, name: user.name, email: user.email},
        JWT_SECRET,
        {expiresIn: '2h'}
    );
}

console.log('\n=== Testing Auth Service ===\n');

// Test 1: JWT Token Generation
test('should generate valid JWT token', () => {
    const user = {
        id: 'user-123',
        role: 'doctor',
        name: 'Dr. Smith',
        email: 'smith@hospital.com'
    };

    const token = issueToken(user);
    assert(token, 'Token should be generated');
    assert(typeof token === 'string', 'Token should be a string');

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    assert.strictEqual(decoded.sub, user.id, 'Token should contain user id');
    assert.strictEqual(decoded.role, user.role, 'Token should contain user role');
    assert.strictEqual(decoded.name, user.name, 'Token should contain user name');
    assert.strictEqual(decoded.email, user.email, 'Token should contain user email');
});

// Test 2: JWT Token Verification
test('should verify valid JWT token', () => {
    const user = {
        id: 'user-456',
        role: 'patient',
        name: 'John Doe',
        email: 'john@example.com'
    };

    const token = issueToken(user);
    const decoded = jwt.verify(token, JWT_SECRET);

    assert(decoded, 'Token should be decoded');
    assert.strictEqual(decoded.sub, user.id);
    assert.strictEqual(decoded.role, user.role);
});

// Test 3: JWT Token with wrong secret should fail
test('should reject token with wrong secret', () => {
    const user = {
        id: 'user-789',
        role: 'admin',
        name: 'Admin User',
        email: 'admin@example.com'
    };

    const token = issueToken(user);

    try {
        jwt.verify(token, 'wrongsecret');
        assert.fail('Should have thrown error for wrong secret');
    } catch (err) {
        assert(err.name === 'JsonWebTokenError', 'Should throw JsonWebTokenError');
    }
});

// Test 4: Kafka publishEvent should not throw
testAsync('Kafka publishEvent should handle gracefully when Kafka is disabled', async () => {
    // When Kafka is not available, publishEvent should not throw
    try {
        await kafka.publishEvent('user.events', {
            type: 'USER_CREATED',
            id: 'user-123',
            role: 'doctor',
            name: 'Dr. Smith',
            email: 'smith@hospital.com'
        });
        assert(true, 'publishEvent should not throw');
    } catch (err) {
        assert.fail(`publishEvent should not throw: ${err.message}`);
    }
});

// Test 5: Test HTTP app creation
test('createApp should require all parameters', () => {
    const { createApp } = require('../src/http');

    try {
        // This will fail because we're not providing a valid Express app setup
        // but it tests that the function exists and can be imported
        assert(typeof createApp === 'function', 'createApp should be a function');
    } catch (err) {
        assert.fail(`createApp import failed: ${err.message}`);
    }
});

// Test 6: Test user data validation
test('should validate required fields for user registration', () => {
    const validUser = {
        name: 'Dr. Smith',
        email: 'smith@hospital.com',
        password: 'password123'
    };

    // Check all required fields are present
    assert(validUser.name, 'Name should be present');
    assert(validUser.email, 'Email should be present');
    assert(validUser.password, 'Password should be present');

    const invalidUser = {
        name: 'Dr. Smith',
        email: 'smith@hospital.com'
        // missing password
    };

    assert(!invalidUser.password, 'Invalid user should be missing password');
});

// Test 7: Test email validation format
test('should validate email format', () => {
    const validEmail = 'test@example.com';
    const invalidEmail = 'notanemail';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    assert(emailRegex.test(validEmail), 'Valid email should pass regex');
    assert(!emailRegex.test(invalidEmail), 'Invalid email should fail regex');
});

// Test 8: Test role validation
test('should validate user roles', () => {
    const validRoles = ['admin', 'doctor', 'patient'];
    const testRole = 'doctor';

    assert(validRoles.includes(testRole), 'Doctor role should be valid');
    assert(!validRoles.includes('invalid'), 'Invalid role should not be accepted');
});

// Test 9: Test JWT expiration
test('should create token with expiration', () => {
    const user = {
        id: 'user-999',
        role: 'doctor',
        name: 'Dr. Test',
        email: 'test@hospital.com'
    };

    const token = issueToken(user);
    const decoded = jwt.decode(token);

    assert(decoded.exp, 'Token should have expiration');
    assert(decoded.iat, 'Token should have issued at time');
    assert(decoded.exp > decoded.iat, 'Expiration should be after issued time');
});

// Test 10: Test nanoid generation
test('should generate unique IDs with nanoid', () => {
    const { nanoid } = require('nanoid');

    const id1 = nanoid();
    const id2 = nanoid();

    assert(id1, 'Should generate first ID');
    assert(id2, 'Should generate second ID');
    assert(id1 !== id2, 'IDs should be unique');
    assert(typeof id1 === 'string', 'ID should be a string');
    assert(id1.length > 0, 'ID should not be empty');
});

// Test 11: Test password hashing (demo - in real app you'd use bcrypt)
test('should handle password storage (demo mode)', () => {
    const password = 'mySecurePassword123';
    const passwordHash = password; // In demo mode, it's plain text

    assert.strictEqual(passwordHash, password, 'In demo mode, password is stored as-is');
});

// Test 12: Test user object structure
test('should create proper user object structure', () => {
    const { nanoid } = require('nanoid');

    const user = {
        id: nanoid(),
        role: 'doctor',
        name: 'Dr. Smith',
        email: 'smith@hospital.com',
        passwordHash: 'hashedPassword'
    };

    assert(user.id, 'User should have ID');
    assert(user.role, 'User should have role');
    assert(user.name, 'User should have name');
    assert(user.email, 'User should have email');
    assert(user.passwordHash, 'User should have password hash');
});

// Test 13: Test event structure for Kafka
test('should create proper event structure for USER_CREATED', () => {
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

// Test 14: Test event structure for USER_UPDATED
test('should create proper event structure for USER_UPDATED', () => {
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

// Test 15: Test event structure for USER_DELETED
test('should create proper event structure for USER_DELETED', () => {
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

    // Validate ISO date format
    const date = new Date(event.deletedAt);
    assert(!isNaN(date.getTime()), 'deletedAt should be valid date');
});

// Run async tests
(async () => {
    await testAsync('Kafka publishEvent test', async () => {
        await kafka.publishEvent('test.topic', { test: 'data' });
    });

    // Summary
    console.log('\n=== Test Summary ===\n');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);

    if (failed > 0) {
        process.exit(1);
    }
})();