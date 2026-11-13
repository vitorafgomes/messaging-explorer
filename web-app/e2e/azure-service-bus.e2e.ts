import { SEED } from './seed';
import { Page } from '@playwright/test';
import { expect, messageBodies, messagesDialog, open, shoot, test, treeNode } from './fixtures';

/**
 * The entities tree lists the subscriptions of a topic only when the topic reports a subscription
 * count, and the emulator reports every runtime count as zero; the Topics screen loads them on open.
 */
async function openTopicOnTopicsScreen(page: Page): Promise<void> {
  await open(page, 'topics');
  await page.locator('.card-header', { hasText: SEED.topic }).click();
}

const subscriptionRow = (page: Page) => page.locator('.subscription-card', { hasText: SEED.subscription });

test.describe.configure({ mode: 'serial' });

test.describe('Azure Service Bus emulator', () => {
  test('adds a connection and connects to it', async ({ page }) => {
    await open(page, 'connections');
    await expect(page.getByText('No connections configured')).toBeVisible();
    await shoot(page, 'connections-empty');

    await page.getByRole('button', { name: 'Add Connection' }).click();
    await page.getByLabel('Connection Name').fill('orders-servicebus');
    await page.getByLabel('Authentication').click();
    await page.getByRole('option', { name: 'Connection string' }).click();
    await page.getByLabel('Connection String').fill(process.env['E2E_AZURE_CONNECTION_STRING'] ?? '');
    await shoot(page, 'connection-dialog-servicebus');
    await page.getByRole('button', { name: 'Save' }).click();

    const card = page.locator('.connection-card', { hasText: 'orders-servicebus' });
    await expect(card.getByRole('heading', { name: 'orders-servicebus' })).toBeVisible();
    await card.getByRole('button', { name: 'Connect' }).click();
    await expect(page).toHaveURL(/#\/entities$/);
    await expect(page.locator('.connection-badge.connected')).toBeVisible();
    await expect(treeNode(page, SEED.queue)).toBeVisible();
    await expect(treeNode(page, SEED.topic)).toBeVisible();
    await shoot(page, 'entities-servicebus');
  });

  test('opens a queue and a subscription', async ({ page }) => {
    await open(page, 'entities');
    await treeNode(page, SEED.queue).click();
    await expect(page.locator('.entity-title h2')).toHaveText(SEED.queue);
    await expect(page.locator('.entity-title')).toContainText('Queue');
    await shoot(page, 'queue-servicebus');

    await openTopicOnTopicsScreen(page);
    await expect(subscriptionRow(page)).toBeVisible();
    await shoot(page, 'topics-servicebus');
  });

  test('peeks the messages of a queue, its dead-letter queue and a subscription', async ({ page }) => {
    await open(page, 'entities');
    await treeNode(page, SEED.queue).click();
    await page.getByRole('button', { name: 'View Messages' }).click();
    await expect(messagesDialog(page)).toContainText(`Messages: ${SEED.queue}`);
    await expect(messageBodies(page)).toHaveText(SEED.activeBodies);
    await shoot(page, 'messages-active-servicebus');

    await messagesDialog(page).getByRole('button', { name: /Dead Letter/ }).click();
    await expect(messageBodies(page)).toHaveText(SEED.deadLetterBodies);
    await shoot(page, 'messages-deadletter-servicebus');
    await page.keyboard.press('Escape');
    await expect(messagesDialog(page)).toBeHidden();

    await openTopicOnTopicsScreen(page);
    await subscriptionRow(page).getByTitle('View Messages').click();
    await expect(messagesDialog(page)).toContainText(`Messages: ${SEED.subscription}`);
    await expect(messageBodies(page)).toHaveText([SEED.subscriptionBody]);
    await shoot(page, 'messages-subscription-servicebus');
  });

  test('sends a message to a queue and sees it in the queue', async ({ page }) => {
    const body = '{"orderId":"order-3001"}';
    await open(page, 'entities');
    await treeNode(page, SEED.queue).click();
    await page.getByRole('button', { name: 'Send Message' }).click();
    await page.getByPlaceholder('{"key": "value"}').fill(body);
    await shoot(page, 'send-message-dialog-servicebus');
    await page.locator('mat-dialog-container').getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Message sent successfully!')).toBeVisible();

    await page.getByRole('button', { name: 'View Messages' }).click();
    await expect(messageBodies(page)).toHaveText([...SEED.activeBodies, body]);
    await messageBodies(page).last().scrollIntoViewIfNeeded();
    await shoot(page, 'messages-after-send-servicebus');
  });
});
