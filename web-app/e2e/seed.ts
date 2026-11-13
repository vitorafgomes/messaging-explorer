export const RABBIT_USER = 'e2e-admin';

/** The entities and messages every flow starts from, the same names on both brokers. */
export const SEED = {
  queue: 'orders',
  topic: 'order-events',
  subscription: 'warehouse',
  activeBodies: ['{"orderId":"order-1001"}', '{"orderId":"order-1002"}', '{"orderId":"order-1003"}'],
  deadLetterBodies: ['{"orderId":"order-0901","reason":"expired"}', '{"orderId":"order-0902","reason":"expired"}'],
  subscriptionBody: '{"event":"order-shipped","orderId":"order-1001"}',
};

export interface SeedApi {
  url: string;
  secret: string;
}

async function call<T = unknown>(api: SeedApi, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${api.url}/${path}`, {
    method,
    headers: { 'X-Api-Key': api.secret, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Seeding failed: ${method} ${path} answered ${response.status}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function withConnection(api: SeedApi, connection: object, seed: () => Promise<void>): Promise<void> {
  const saved = await call<{ id: string }>(api, 'POST', 'connections', connection);
  await call(api, 'POST', `connections/${saved.id}/connect`);
  await seed();
  await call(api, 'POST', 'connections/disconnect');
  await call(api, 'DELETE', `connections/${saved.id}`);
}

const send = (api: SeedApi, path: string, body: string, extra: object = {}) =>
  call(api, 'POST', path, { body, contentType: 'application/json', ...extra });

async function createTopicWithSubscription(api: SeedApi): Promise<void> {
  await call(api, 'POST', 'topics', { name: SEED.topic });
  await call(api, 'POST', `topics/${SEED.topic}/subscriptions`, { name: SEED.subscription });
}

/** RabbitMQ: dead letters live in the queue named after the source with a .dlq suffix. */
export async function seedRabbit(api: SeedApi, connection: object): Promise<void> {
  await withConnection(api, connection, async () => {
    await call(api, 'POST', 'queues', { name: SEED.queue });
    await call(api, 'POST', 'queues', { name: `${SEED.queue}.dlq` });
    await createTopicWithSubscription(api);
    for (const body of SEED.activeBodies) await send(api, `queues/${SEED.queue}/messages`, body);
    for (const body of SEED.deadLetterBodies) await send(api, `queues/${SEED.queue}.dlq/messages`, body);
    await send(api, `topics/${SEED.topic}/messages`, SEED.subscriptionBody);
  });
}

/**
 * Azure Service Bus emulator: the dead-letter queue is filled by expiry. The messages are sent with a
 * one-second time to live to a queue that dead-letters on expiry, and a receive after they expire
 * makes the broker move them.
 */
export async function seedAzure(api: SeedApi, connectionString: string): Promise<void> {
  const connection = { name: 'orders-servicebus', providerType: 'AzureServiceBus', authType: 'ConnectionString', connectionString };
  await withConnection(api, connection, async () => {
    await call(api, 'POST', 'queues', { name: SEED.queue, options: { deadLetteringOnMessageExpiration: true } });
    await createTopicWithSubscription(api);
    for (const body of SEED.deadLetterBodies) {
      await send(api, `queues/${SEED.queue}/messages`, body, { timeToLive: '00:00:01' });
    }
    await new Promise((r) => setTimeout(r, 3000));
    await call(api, 'POST', `queues/${SEED.queue}/messages/receive?count=1`);
    for (const body of SEED.activeBodies) await send(api, `queues/${SEED.queue}/messages`, body);
    await send(api, `topics/${SEED.topic}/messages`, SEED.subscriptionBody);
  });
}
