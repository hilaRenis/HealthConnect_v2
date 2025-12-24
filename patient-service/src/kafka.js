const { Kafka, logLevel } = require('kafkajs');

process.env.KAFKAJS_NO_PARTITIONER_WARNING = process.env.KAFKAJS_NO_PARTITIONER_WARNING || '1';

const rawBrokers = process.env.KAFKA_BROKERS || 'kafka:9092';
const normalizedBrokers = rawBrokers
  .split(',')
  .map((b) => b.trim())
  .filter(Boolean);
const brokers = normalizedBrokers.some((b) => ['none', 'off', 'disabled'].includes(b.toLowerCase())) ? [] : normalizedBrokers;

const connectTimeoutInput = Number.parseInt(process.env.KAFKA_CONNECT_TIMEOUT_MS || '500', 10);
const CONNECT_TIMEOUT_MS = Number.isFinite(connectTimeoutInput) && connectTimeoutInput > 0 ? connectTimeoutInput : 500;
const retryInput = Number.parseInt(process.env.KAFKA_RETRY_ATTEMPTS || '0', 10);
const RETRY_ATTEMPTS = Number.isFinite(retryInput) && retryInput >= 0 ? retryInput : 0;

// Check if we need SASL authentication (for Confluent Cloud)
const kafkaUsername = process.env.KAFKA_USERNAME;
const kafkaPassword = process.env.KAFKA_PASSWORD;
const useSsl = process.env.KAFKA_USE_SSL === 'true';

const kafkaConfig = {
  clientId: 'patient-service',
  brokers,
  connectionTimeout: CONNECT_TIMEOUT_MS,
  retry: {
    retries: RETRY_ATTEMPTS,
    initialRetryTime: Math.min(100, CONNECT_TIMEOUT_MS),
    maxRetryTime: CONNECT_TIMEOUT_MS,
  },
  logLevel: logLevel.ERROR,
};

// Add SASL/SSL if credentials provided (Confluent Cloud)
if (kafkaUsername && kafkaPassword) {
  kafkaConfig.sasl = {
    mechanism: 'plain',
    username: kafkaUsername,
    password: kafkaPassword,
  };
  kafkaConfig.ssl = useSsl;
}

const kafka = brokers.length > 0 ? new Kafka(kafkaConfig) : null;

let producer = null;
let kafkaDisabled = false;

async function connectWithTimeout(connectPromise) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Kafka connect timeout')), CONNECT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([connectPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function getProducer() {
  if (!kafka || kafkaDisabled) return null;
  if (producer) return producer;
  producer = kafka.producer();
  try {
    await connectWithTimeout(producer.connect());
    return producer;
  } catch (error) {
    console.error('[patient-service] Failed to establish Kafka connection, disabling publisher', error);
    kafkaDisabled = true;
    try {
      await producer.disconnect();
    } catch (disconnectErr) {
      console.error('[patient-service] Failed to disconnect Kafka producer cleanly', disconnectErr);
    }
    producer = null;
    return null;
  }
}

function sendAsync(producerInstance, payload) {
  producerInstance.send(payload).catch((error) => {
    console.error('[patient-service] Failed to publish Kafka event', payload.topic, error);
    if (error?.name === 'KafkaJSNumberOfRetriesExceeded') {
      kafkaDisabled = true;
    }
  });
}

async function publishEvent(topic, payload, { key } = {}) {
  const activeProducer = await getProducer();
  if (!activeProducer) {
    return;
  }

  sendAsync(activeProducer, {
    topic,
    messages: [
      {
        key: key || payload.id || null,
        value: JSON.stringify({ ...payload, emittedAt: new Date().toISOString() }),
      },
    ],
  });
}

async function startConsumer({ groupId, topics, handleMessage }) {
  if (!kafka || kafkaDisabled) {
    console.warn('[patient-service] Kafka disabled, consumer not started');
    return null;
  }

  const consumer = kafka.consumer({ groupId });
  try {
    await connectWithTimeout(consumer.connect());
  } catch (error) {
    console.error('[patient-service] Failed to connect Kafka consumer, disabling consumer', error);
    kafkaDisabled = true;
    return null;
  }
  for (const topic of topics) {
    await consumer.subscribe({ topic, fromBeginning: true });
  }

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message?.value) return;
      const json = message.value.toString();
      try {
        const payload = JSON.parse(json);
        await handleMessage(topic, payload);
      } catch (err) {
        console.error('[patient-service] Failed to handle Kafka message', topic, err);
      }
    },
  });

  return consumer;
}

module.exports = {
  publishEvent,
  startConsumer,
};
