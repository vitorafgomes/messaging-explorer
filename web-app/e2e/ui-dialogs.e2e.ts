import { expect, open, shoot, test } from './fixtures';

/**
 * Screenshots of the Connections dialogs in every state Connections.dc.html draws, to compare them with
 * the artboard. It runs after the broker suites, on the connections they saved, and adds a client with two
 * environments, which no later suite reads.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Connections dialogs as Connections.dc.html draws them', () => {
  test('Add Connection: Azure with each authentication, then RabbitMQ', async ({ page }) => {
    await open(page, 'connections');
    await page.getByRole('button', { name: 'Add Connection' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toContainText('Add Connection');
    await shoot(page, 'dlg-add-azure-signin');

    for (const [auth, name] of [['Connection string', 'connstring'], ['Service Principal', 'principal'], ['Azure CLI session', 'cli']] as const) {
      await dialog.getByRole('radio', { name: auth }).check();
      await shoot(page, `dlg-add-azure-${name}`);
    }

    await dialog.getByLabel('Provider Type').click();
    await page.getByRole('option', { name: 'RabbitMQ' }).click();
    await shoot(page, 'dlg-add-rabbitmq');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Edit of a saved connection', async ({ page }) => {
    await open(page, 'connections');
    await page.getByRole('button', { name: 'Edit orders-servicebus' }).click();
    await expect(page.locator('mat-dialog-container')).toContainText('Edit Connection');
    await shoot(page, 'dlg-edit-servicebus');
    await page.locator('mat-dialog-container').getByRole('button', { name: 'Replace' }).click();
    await expect(page.locator('mat-dialog-container')).toContainText('New Connection String');
    await shoot(page, 'dlg-edit-servicebus-replace');
    await page.locator('mat-dialog-container').getByRole('button', { name: 'Cancel' }).click();
  });

  test('Manage Groups: Clients, then Environments of a client', async ({ page }) => {
    await open(page, 'connections');
    await page.getByRole('button', { name: 'Manage Groups' }).click();
    const dialog = page.locator('mat-dialog-container');
    await shoot(page, 'dlg-groups-clients-empty');

    await dialog.getByLabel('Client Name').fill('Contoso');
    await dialog.getByRole('button', { name: 'Add Client' }).click();
    await expect(dialog).toContainText('Contoso');
    await shoot(page, 'dlg-groups-clients');

    await dialog.getByRole('tab', { name: 'Environments' }).click();
    await dialog.getByLabel('Select Client').click();
    await page.getByRole('option', { name: 'Contoso' }).click();
    for (const env of ['Production', 'Development']) {
      await dialog.getByLabel('Environment Name').fill(env);
      await dialog.getByRole('button', { name: 'Add Environment' }).click();
      await expect(dialog).toContainText(env);
    }
    await shoot(page, 'dlg-groups-environments');
    await dialog.getByRole('button', { name: 'Close' }).click();
  });

  test('Export, with and without the secrets', async ({ page }) => {
    await open(page, 'connections');
    await page.getByRole('button', { name: 'Export' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toContainText('Export connections');
    await shoot(page, 'dlg-export');
    await dialog.getByRole('checkbox', { name: 'Include plaintext secrets in export' }).check();
    await shoot(page, 'dlg-export-secrets');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });
});
