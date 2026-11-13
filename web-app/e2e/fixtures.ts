import { Page, test as base } from '@playwright/test';
import { resolve } from 'node:path';

export { expect } from '@playwright/test';

export const SCREENSHOT_DIR = resolve(__dirname, '../dist/e2e/screenshots');

/**
 * A page whose window carries the two members of the Electron preload contract that the app reads
 * for the API: its port and the per-run key. ApiService then attaches the key itself, as in the
 * desktop app.
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const browserLog: string[] = [];
    page.on('pageerror', (error) => browserLog.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') browserLog.push(`console: ${message.text()}`);
    });
    page.on('requestfailed', (request) => browserLog.push(`request failed: ${request.url()} ${request.failure()?.errorText}`));
    await page.addInitScript(
      ({ port, secret }) => {
        Object.defineProperty(window, 'electronAPI', {
          value: { getApiPort: async () => port, getApiSecret: async () => secret },
        });
      },
      { port: Number(process.env['E2E_API_PORT']), secret: process.env['E2E_API_SECRET'] ?? '' },
    );
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('browser-log', { body: browserLog.join('\n') || 'empty', contentType: 'text/plain' });
    }
  },
});

/** Opens a route of the app; the Electron renderer path routes by hash. */
export async function open(page: Page, route: string): Promise<void> {
  await page.goto(`${process.env['E2E_BASE_URL']}/#/${route}`);
}

const themeToggle = (page: Page) =>
  page.locator('mat-toolbar button', { has: page.locator('mat-icon', { hasText: /^(light|dark)_mode$/ }) });

async function setDark(page: Page, dark: boolean): Promise<void> {
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark-theme'));
  if (isDark !== dark) await themeToggle(page).dispatchEvent('click');
  await page.waitForFunction((d) => document.documentElement.classList.contains('dark-theme') === d, dark);
}

/** Saves the screen as it is now, in the light and in the dark theme, through the toolbar's theme toggle. */
export async function shoot(page: Page, name: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setDark(page, theme === 'dark');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}-${theme}.png`, animations: 'disabled' });
  }
  await setDark(page, false);
}

/** A queue or topic row of the entities tree, by its exact name. */
export const treeNode = (page: Page, name: string) =>
  page.locator('.tree-node', { has: page.locator('.node-name', { hasText: new RegExp(`^${name.replace(/\./g, '\\.')}$`) }) });

/** Expands a topic in the entities tree and selects one of its subscriptions. */
export async function openSubscription(page: Page, topic: string, subscription: string): Promise<void> {
  await treeNode(page, topic).locator('.node-icon-expandable').click();
  await page.locator('.node-subscription', { hasText: subscription }).click();
}

/** The open dialog of the messages of an entity; its rows are the messages it peeked. */
export const messagesDialog = (page: Page) => page.locator('mat-dialog-container', { hasText: 'Messages:' });
export const messageBodies = (page: Page) => messagesDialog(page).locator('.message-card .message-preview');
