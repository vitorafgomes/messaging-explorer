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

/**
 * Switches the theme the way ThemeService applies and stores it, without a reload, so an open
 * dialog stays open for the screenshot.
 */
export async function setDark(page: Page, dark: boolean): Promise<void> {
  await page.evaluate((d) => {
    document.documentElement.classList.toggle('dark-theme', d);
    localStorage.setItem('app-theme', d ? 'dark' : 'light');
  }, dark);
  await page.waitForFunction((d) => document.documentElement.classList.contains('dark-theme') === d, dark);
}

/** Saves the screen as it is now, in the light and in the dark theme. */
export async function shoot(page: Page, name: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setDark(page, theme === 'dark');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}-${theme}.png`, animations: 'disabled' });
  }
  await setDark(page, false);
}

/** A queue or topic row of the entities tree, by its exact name; a subscription row under a topic is not one. */
export const treeNode = (page: Page, name: string) =>
  page.locator('xpath=//*[contains(@class, "tree-node")][not(ancestor::*[contains(@class, "tree-children")])]',
    { has: page.locator('.node-name', { hasText: new RegExp(`^${name.replace(/\./g, '\\.')}$`) }) });

/** Selects a subscription of a topic in the entities tree, opening the topic first when it is closed. */
export async function openSubscription(page: Page, topic: string, subscription: string): Promise<void> {
  if ((await treeNode(page, topic).getAttribute('aria-expanded')) !== 'true') {
    await treeNode(page, topic).click();
  }
  await treeNode(page, topic).locator('xpath=ancestor::div[contains(@class, "tree-row")][1]/following-sibling::div[contains(@class, "tree-children")][1]')
    .locator('.tree-node', { has: page.locator('.node-name', { hasText: new RegExp(`^${subscription.replace(/\./g, '\\.')}$`) }) })
    .click();
}

/** The open dialog of the messages of an entity; its rows are the messages it peeked. */
export const messagesDialog = (page: Page) => page.locator('mat-dialog-container', { hasText: 'Messages:' });
export const messageBodies = (page: Page) => messagesDialog(page).locator('.message-card .message-preview');
