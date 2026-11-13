import { RABBIT_USER, SEED } from './seed';
import { expect, messageBodies, messagesDialog, open, openSubscription, shoot, test, treeNode } from './fixtures';

test.describe.configure({ mode: 'serial' });

const env = (name: string) => process.env[name] ?? '';
const seededCount = String(SEED.activeBodies.length);
const countAfterSend = String(SEED.activeBodies.length + 1);

test.describe('RabbitMQ', () => {
  test('adds a connection and connects to it', async ({ page }) => {
    await open(page, 'connections');
    await page.getByRole('button', { name: 'Add Connection' }).click();
    await page.getByLabel('Connection Name').fill('orders-rabbitmq');
    await page.getByLabel('Provider Type').click();
    await page.getByRole('option', { name: 'RabbitMQ' }).click();
    await page.getByLabel('Host Name').fill('localhost');
    await page.getByLabel('Port', { exact: true }).fill(env('E2E_RABBIT_AMQP_PORT'));
    await page.getByLabel('Username').fill(RABBIT_USER);
    await page.getByLabel('Password').fill(env('E2E_RABBIT_PASSWORD'));
    await page.getByLabel('Management Port').fill(env('E2E_RABBIT_MANAGEMENT_PORT'));
    await shoot(page, 'connection-dialog-rabbitmq');
    await page.getByRole('button', { name: 'Save' }).click();

    const card = page.locator('.connection-card', { hasText: 'orders-rabbitmq' });
    await expect(card.getByRole('heading', { name: 'orders-rabbitmq' })).toBeVisible();
    await shoot(page, 'connections-saved');

    await card.getByRole('button', { name: 'Connect' }).click();
    await expect(page).toHaveURL(/#\/entities$/);
    await expect(page.locator('.connection-badge.connected')).toContainText(`localhost:${env('E2E_RABBIT_AMQP_PORT')}`);
    for (const name of [SEED.queue, `${SEED.queue}.dlq`, SEED.subscription, SEED.topic]) {
      await expect(treeNode(page, name)).toBeVisible();
    }
    await shoot(page, 'entities-rabbitmq');
  });

  test('the connection card names the provider and the broker it points at', async ({ page }) => {
    test.fail(true, 'The provider type enum of the app is numeric and the API sends a name, so the card says Unknown Provider');
    await open(page, 'connections');
    const card = page.locator('.connection-card', { hasText: 'orders-rabbitmq' });
    await expect(card).toContainText('RabbitMQ', { timeout: 5000 });
    await expect(card).toContainText(`localhost:${env('E2E_RABBIT_AMQP_PORT')}`, { timeout: 5000 });
  });

  test('opens a queue and shows its message count', async ({ page }) => {
    await open(page, 'entities');
    await treeNode(page, SEED.queue).click();
    await expect(page.locator('.entity-title h2')).toHaveText(SEED.queue);
    await expect(page.locator('.stat-card', { hasText: 'Active Messages' }).locator('.stat-value')).toHaveText(seededCount);
    await shoot(page, 'queue-rabbitmq');
  });

  test('opens a subscription of a topic', async ({ page }) => {
    await open(page, 'entities');
    await openSubscription(page, SEED.topic, SEED.subscription);
    await expect(page.locator('.entity-title h2')).toHaveText(SEED.subscription);
    await expect(page.locator('.entity-title')).toContainText('Subscription');
    await shoot(page, 'subscription-rabbitmq');
  });

  test('peeks the messages of a queue and its dead-letter queue', async ({ page }) => {
    await open(page, 'entities');
    await treeNode(page, SEED.queue).click();
    await page.getByRole('button', { name: 'View Messages' }).click();

    const dialog = messagesDialog(page);
    await expect(dialog).toContainText(`Messages: ${SEED.queue}`);
    await expect(dialog.getByRole('button', { name: /Active Messages/ })).toContainText(seededCount);
    await expect(messageBodies(page).first()).toHaveText(SEED.activeBodies[0]);
    await shoot(page, 'messages-active-rabbitmq');

    await dialog.getByRole('button', { name: /Dead Letter/ }).click();
    await expect(messageBodies(page).first()).toHaveText(SEED.deadLetterBodies[0]);
    await shoot(page, 'messages-deadletter-rabbitmq');
  });

  test('peek lists each message of the queue once', async ({ page }) => {
    test.fail(true, 'RabbitMQ peek requeues each message to the head, so it returns the first message again and again');
    await open(page, 'entities');
    await treeNode(page, SEED.queue).click();
    await page.getByRole('button', { name: 'View Messages' }).click();
    await expect(messageBodies(page).first()).toBeVisible();
    await expect(messageBodies(page)).toHaveText(SEED.activeBodies, { timeout: 5000 });
  });

  test('sends a message to a queue and sees the queue count grow', async ({ page }) => {
    await open(page, 'entities');
    await treeNode(page, SEED.queue).click();
    const active = page.locator('.stat-card', { hasText: 'Active Messages' }).locator('.stat-value');
    await expect(active).toHaveText(seededCount);

    await page.getByRole('button', { name: 'Send Message' }).click();
    await page.getByPlaceholder('{"key": "value"}').fill('{"orderId":"order-2001"}');
    await shoot(page, 'send-message-dialog-rabbitmq');
    await page.locator('mat-dialog-container').getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Message sent successfully!')).toBeVisible();

    await expect(async () => {
      await treeNode(page, SEED.queue).click();
      await expect(active).toHaveText(countAfterSend, { timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await shoot(page, 'queue-after-send-rabbitmq');
  });

  test('the Connections screen lists the connection while the toolbar shows it connected', async ({ page }) => {
    await open(page, 'entities');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Connections' }).click();
    await expect(page.getByRole('heading', { name: 'Connections', level: 2 })).toBeVisible();
    const card = page.locator('.connection-card', { hasText: 'orders-rabbitmq' });
    await expect(card.getByRole('heading', { name: 'orders-rabbitmq' })).toBeVisible();
    await expect(page.locator('.connection-badge.connected')).toContainText(`localhost:${env('E2E_RABBIT_AMQP_PORT')}`);
    await shoot(page, 'connections-connected');
  });

  test('the Connections screen marks the active connection after navigating back to it', async ({ page }) => {
    test.fail(true, 'Connect never stores IsConnected, so the mark set at connect is lost when the screen loads the list again');
    await open(page, 'connections');
    const card = page.locator('.connection-card', { hasText: 'orders-rabbitmq' });
    await expect(card.locator('.badge', { hasText: 'Connected' })).toBeVisible({ timeout: 5000 });
  });

  test('the Queues and Topics screens list the seeded entities', async ({ page }) => {
    await open(page, 'queues');
    await expect(page.getByText(SEED.queue, { exact: true })).toBeVisible();
    await shoot(page, 'queues-rabbitmq');
    await open(page, 'topics');
    await expect(page.getByText(SEED.topic, { exact: true })).toBeVisible();
    await shoot(page, 'topics-rabbitmq');
  });

  test('the Monitoring screen shows the queues and subscriptions with their counts', async ({ page }) => {
    await open(page, 'monitoring');
    await expect(page.getByRole('heading', { name: 'Monitoring', exact: true })).toBeVisible();
    const ordersRow = page.locator('tr', { has: page.getByText(SEED.queue, { exact: true }) });
    await expect(ordersRow).toBeVisible();
    await expect(async () => {
      await page.getByRole('button', { name: 'Refresh' }).click();
      await expect(ordersRow.locator('td').nth(1)).toHaveText(countAfterSend, { timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    await expect(page.getByText('Subscriptions (1)')).toBeVisible();
    await shoot(page, 'monitoring-rabbitmq');
  });
});
