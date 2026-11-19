import { SEED } from './seed';
import { Page } from '@playwright/test';
import { expect, messageBodies, messagesDialog, open, shoot, test, treeNode } from './fixtures';

/**
 * The entities tree lists the subscriptions of a topic only when the topic reports a subscription
 * count, and the emulator reports every runtime count as zero; the Topics screen loads them on open.
 */
async function openTopicOnTopicsScreen(page: Page): Promise<void> {
  await open(page, 'topics');
  await page.locator('.topic-toggle', { hasText: SEED.topic }).click();
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
    await page.getByRole('radio', { name: 'Connection string' }).check();
    await page.getByLabel('Connection String', { exact: true }).fill(process.env['E2E_AZURE_CONNECTION_STRING'] ?? '');
    await shoot(page, 'connection-dialog-servicebus');
    await page.getByRole('button', { name: 'Save' }).click();

    const card = page.locator('.connection-card', { hasText: 'orders-servicebus' });
    await expect(card.getByRole('heading', { name: 'orders-servicebus' })).toBeVisible();
    await card.getByRole('button', { name: 'Connect' }).click();
    await expect(page).toHaveURL(/#\/entities$/);
    await expect(page.locator('mat-toolbar .broker', { hasText: 'Connected to' })).toBeVisible();
    await expect(treeNode(page, SEED.queue)).toBeVisible();
    await expect(treeNode(page, SEED.topic)).toBeVisible();
    await shoot(page, 'entities-servicebus');
  });

  test('opens a queue and a subscription', async ({ page }) => {
    await open(page, 'entities');
    await treeNode(page, SEED.queue).click();
    await expect(page.locator('.entity-title h2')).toHaveText(SEED.queue);
    await expect(page.locator('.entity-title')).toContainText('Queue');
    await expect(page.getByTestId('no-counts-note'), 'the emulator reports no message counts, and the panel says so').toBeVisible();
    await expect(page.locator('.entity-stats .stat-value').first(), 'no number where the broker gives none').toHaveText('—');
    await expect(page.locator('.entity-stats .stat-label').filter({ hasText: 'Transfer dead-letter' })).toHaveCount(0);
    await expect(page.locator('.entity-tree .count-chip'), 'no count beside a row of the tree').toHaveCount(0);
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
    await expect(messagesDialog(page).getByRole('button', { name: /Active Messages/ }), 'the tab counts what it loaded').toContainText(String(SEED.activeBodies.length));
    await expect(messagesDialog(page).getByRole('button', { name: /Transfer dead-letter/ }), 'the emulator has no transfer dead-letter queue to open').toHaveCount(0);
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
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByPlaceholder('{"key": "value"}').fill(body);
    await shoot(page, 'send-message-dialog-servicebus');
    await page.locator('mat-dialog-container').getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Message sent successfully!')).toBeVisible();

    await page.getByRole('button', { name: 'View Messages' }).click();
    await expect(messageBodies(page)).toHaveText([...SEED.activeBodies, body]);
    await messageBodies(page).last().scrollIntoViewIfNeeded();
    await shoot(page, 'messages-after-send-servicebus');
  });

  test('resubmits one message of the dead-letter queue to the queue, and the results name it', async ({ page }) => {
    await open(page, 'entities');
    await treeNode(page, SEED.queue).click();
    await page.getByRole('button', { name: 'View messages' }).click();
    await messagesDialog(page).getByRole('button', { name: /Dead Letter/ }).click();
    await expect(messageBodies(page)).toHaveText(SEED.deadLetterBodies);

    await messagesDialog(page).locator('.message-card input[type="checkbox"]').first().check();
    await messagesDialog(page).locator('app-bulk-actions-toolbar').getByRole('button', { name: 'Resubmit' }).click();
    const results = page.locator('mat-dialog-container', { hasText: 'Successful' });
    await expect(results).toBeVisible();
    await expect(results.locator('.stat-card.success .stat-value')).toHaveText('1');
    await shoot(page, 'resubmit-results-servicebus');
    await results.getByRole('button', { name: 'Close' }).click();

    await expect(messageBodies(page)).toHaveText([SEED.deadLetterBodies[1]]);
    await messagesDialog(page).getByRole('button', { name: /Active Messages/ }).click();
    await messagesDialog(page).locator('button.refresh').first().click();
    await expect(messageBodies(page).filter({ hasText: 'order-0901' })).toHaveCount(1);
  });

  test('deletes a selection of active messages after its confirmation, and only those', async ({ page }) => {
    await open(page, 'entities');
    await treeNode(page, SEED.queue).click();
    await page.getByRole('button', { name: 'View messages' }).click();
    const [deleted, ...kept] = SEED.activeBodies;
    await expect(messageBodies(page).filter({ hasText: 'order-1001' })).toHaveCount(1);

    await messagesDialog(page).locator('.message-card', { hasText: 'order-1001' }).locator('input[type="checkbox"]').check();
    await messagesDialog(page).locator('app-bulk-actions-toolbar').getByRole('button', { name: 'Delete 1' }).click();
    const confirm = page.locator('mat-dialog-container', { hasText: 'Delete Messages' });
    await expect(confirm).toBeVisible();
    await shoot(page, 'delete-confirm-servicebus');
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    const results = page.locator('mat-dialog-container', { hasText: 'Successful' });
    await expect(results.locator('.stat-card.success .stat-value')).toHaveText('1');
    await results.getByRole('button', { name: 'Close' }).click();

    for (const body of kept) {
      await expect(messageBodies(page).filter({ hasText: JSON.parse(body).orderId }), `${body} is kept, read again after the delete`).toHaveCount(1);
    }
    await expect(messageBodies(page).filter({ hasText: 'order-1001' }), `${deleted} is gone from the list read again`).toHaveCount(0);
  });
});
