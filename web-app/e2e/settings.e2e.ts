import { expect, open, setDark, shoot, test } from './fixtures';

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
    await expect(page.getByTestId('about')).not.toContainText('API');
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

test.describe('The toolbar', () => {
  /** The contrast ratio of the link's text on the toolbar, as the browser paints the two colours. */
  const contrast = (page: import('@playwright/test').Page, name: string) => page.evaluate((label) => {
    const link = [...document.querySelectorAll('mat-toolbar a.nav-link')].find(a => a.textContent?.trim() === label) as HTMLElement;
    const text = link.querySelector('.mdc-button__label') as HTMLElement ?? link;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const painted = (...colours: string[]) => {
      context.clearRect(0, 0, 1, 1);
      for (const colour of colours) { context.fillStyle = colour; context.fillRect(0, 0, 1, 1); }
      const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data].map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const bar = getComputedStyle(document.querySelector('mat-toolbar')!).backgroundColor;
    const [back, front] = [painted(bar), painted(bar, getComputedStyle(text).color)];
    return { disabled: link.getAttribute('aria-disabled') === 'true' || link.hasAttribute('disabled'), ratio: (Math.max(back, front) + 0.05) / (Math.min(back, front) + 0.05) };
  }, name);

  test('a link that needs a connection can still be read while there is none, in the light and in the dark theme', async ({ page }) => {
    await open(page, 'connections');
    for (const theme of ['light', 'dark'] as const) {
      await setDark(page, theme === 'dark');
      for (const name of ['Entities', 'Monitoring']) {
        const link = await contrast(page, name);
        expect(link.disabled, `${name} is disabled while no broker is connected`).toBe(true);
        expect(link.ratio, `${name}, disabled, on the toolbar of the ${theme} theme: a contrast of at least 3 to 1 so the word can be read`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
