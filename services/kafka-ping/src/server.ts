import Fastify from 'fastify';
import { Kafka, logLevel } from 'kafkajs';

const TOPIC = process.env.KAFKA_SMOKE_TOPIC ?? 'oat.domain.smoke';
const GROUP = process.env.KAFKA_SMOKE_GROUP ?? 'oat-kafka-ping';
const BROKERS = (process.env.KAFKA_BROKERS ?? '127.0.0.1:19092')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const kafka = new Kafka({
  clientId: 'oat-kafka-ping',
  brokers: BROKERS,
  logLevel: logLevel.NOTHING,
});

let lastPayload: { topic: string; at: string; note?: string } | null = null;
let runLoopError: string | null = null;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureTopic() {
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({
      topics: [{ topic: TOPIC, numPartitions: 1, replicationFactor: 1 }],
    });
  } catch {
    // topic may already exist
  } finally {
    await admin.disconnect();
  }
}

async function runAsyncLoop() {
  try {
    await ensureTopic();
    const consumer = kafka.consumer({ groupId: `${GROUP}-${process.pid}` });
    await consumer.connect();
    await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
    void consumer.run({
      eachMessage: async ({ topic, message }) => {
        lastPayload = {
          topic,
          at: new Date().toISOString(),
          note: message.value?.toString(),
        };
      },
    });
    await sleep(1500);
    const producer = kafka.producer();
    await producer.connect();
    await producer.send({
      topic: TOPIC,
      messages: [
        { value: `ping-${Date.now()}`, key: 'kafka-ping' },
      ],
    });
    await sleep(2000);
    await producer.disconnect();
    // Leave consumer running for continued smoke; process stays up for HTTP /ready
  } catch (e) {
    runLoopError = e instanceof Error ? e.message : String(e);
  }
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

app.get('/health', async () => ({ status: 'ok', _service: 'kafka-ping' }));

app.get('/ready', async () => {
  if (runLoopError) {
    return { ready: false, error: runLoopError, brokers: BROKERS };
  }
  if (lastPayload) {
    return { ready: true, last: lastPayload, brokers: BROKERS, topic: TOPIC };
  }
  return { ready: true, note: 'no message yet; async loop still starting', brokers: BROKERS };
});

async function main() {
  const port = Number(process.env.KAFKA_PING_PORT ?? 3040);
  void runAsyncLoop();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info({ port, brokers: BROKERS, topic: TOPIC }, 'kafka-ping up');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
