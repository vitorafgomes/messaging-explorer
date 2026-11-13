import { expect, open, shoot, test } from './fixtures';

const SAMPLE_VERSION = '2.4.2';

/**
 * Adds the update members of the Electron preload to the page, with sample answers, beside the two
 * the fixture gives. The shell's update-status events are sent with window.pushUpdateStatus.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript((version) => {
    const shell = (window as any).electronAPI;
    let listener: (data: unknown) => void = () => {};
    (window as any).pushUpdateStatus = (data: unknown) => listener(data);
    Object.assign(shell, {
      platform: 'linux',
      getAppVersion: async () => version,
      getUpdateChannel: async () => 'latest',
      getSelfUpdateBlocker: async () => null,
      onUpdateStatus: (callback: (data: unknown) => void) => { listener = callback; },
      checkForUpdates: async () => {
        listener({ status: 'checking' });
        listener({ status: 'up-to-date' });
        return { status: 'ok' };
      },
      setUpdateChannel: async (channel: string) => ({ status: 'ok', channel }),
    });
  }, SAMPLE_VERSION);
});

test.describe('Settings', () => {
  test('opens from the toolbar and shows the version and the state of the updates', async ({ page }) => {
    await open(page, 'connections');
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/#\/settings$/);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

    await expect(page.getByTestId('current-version')).toHaveText(SAMPLE_VERSION);
    await expect(page.getByTestId('about')).toContainText(`${SAMPLE_VERSION}, Stable channel`);
    await expect(page.getByTestId('about')).toContainText('Local, on this computer');
    await expect(page.getByTestId('update-state')).toContainText('Not checked yet in this session');
    await shoot(page, 'settings-not-checked');

    await page.getByRole('button', { name: 'Check now' }).click();
    await expect(page.getByTestId('update-state')).toContainText('You are up to date');
    await expect(page.getByTestId('update-state')).toContainText(`${SAMPLE_VERSION} is the newest version on the Stable channel.`);
    await shoot(page, 'settings-up-to-date');

    await page.evaluate(() => (window as any).pushUpdateStatus({ status: 'available', version: '2.5.0' }));
    await expect(page.getByTestId('update-state')).toContainText('Version 2.5.0 is available');
    await expect(page.getByRole('link', { name: 'Version 2.5.0 is available: open Settings' })).toBeVisible();
    await shoot(page, 'settings-update-available');

    await page.getByRole('button', { name: 'Clear all data' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('No broker is touched.');
    await expect(dialog.getByRole('button', { name: 'Clear all data' })).toBeDisabled();
    await shoot(page, 'settings-clear-all-data');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});
