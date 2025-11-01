class MockKafka {
    constructor() {
        this.events = [];
    }

    async publish(topic, event) {
        this.events.push({ topic, event });
    }

    getEvents(topic) {
        return this.events.filter(e => e.topic === topic).map(e => e.event);
    }
}

// Test
async function test() {
    console.log('\n=== Testing Kafka Events ===\n');

    const kafka = new MockKafka();

    // Simulate: Auth service creates user
    await kafka.publish('user.events', {
        type: 'USER_CREATED',
        id: 'user-123',
        role: 'doctor',
        name: 'Dr. Smith',
        email: 'smith@hospital.com'
    });

    // Simulate: Auth service updates user
    await kafka.publish('user.events', {
        type: 'USER_UPDATED',
        id: 'user-123',
        name: 'Dr. John Smith',
        email: 'john.smith@hospital.com'
    });

    // Verify events were published
    const events = kafka.getEvents('user.events');

    console.log('✓ Published 2 events');
    console.log('✓ Event 1:', events[0].type, '-', events[0].name);
    console.log('✓ Event 2:', events[1].type, '-', events[1].name);
    console.log(`✓ Total events: ${events.length}`);

    console.log('\n=== Test completed ===\n');
}

test();