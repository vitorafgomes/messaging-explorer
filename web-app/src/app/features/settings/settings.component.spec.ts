import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { SettingsComponent } from './settings.component';
import { AppUpdateService, RELEASES_URL } from './app-update.service';
import { ClearAllDataDialogComponent } from './clear-all-data-dialog.component';
import { BugReportDialogComponent } from '../../shared/bug-report-dialog.component';
import { BugReportService } from '../../shared/bug-report.service';
import { ConnectionService, DevSettingsService } from '../../core/services';

/** The text of an element as a reader hears it: every text node, separated by one space. */
function words(node: Element | null | undefined): string {
  if (!node) return '';
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const SECRET = 'sentinel-api-secret-7f3a9c';
const PORT = 59173;

function fakeShell(overrides: Record<string, unknown> = {}) {
  let listener: (data: unknown) => void = () => {};
  const shell: any = {
    platform: 'linux',
    getApiPort: async () => PORT,
    getApiSecret: async () => SECRET,
    getAppVersion: vi.fn(async () => '2.4.2'),
    getUpdateChannel: vi.fn(async () => 'latest'),
    getSelfUpdateBlocker: vi.fn(async () => null),
    onUpdateStatus: (callback: (data: unknown) => void) => { listener = callback; },
    checkForUpdates: vi.fn(async () => ({ status: 'dev-mode' })),
    downloadUpdate: vi.fn(async () => ({ status: 'ok' })),
    installUpdate: vi.fn(),
    setUpdateChannel: vi.fn(async (channel: string) => ({ status: 'ok', channel })),
    ...overrides,
  };
  return { shell, push: (data: unknown) => listener(data) };
}

describe('SettingsComponent', () => {
  const dialog = { open: vi.fn((..._args: unknown[]) => ({ afterClosed: () => of(undefined as unknown) })) };
  const connectionService = { refreshStatus: vi.fn() };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MatDialog, useValue: dialog },
        { provide: ConnectionService, useValue: connectionService },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronAPI;
    localStorage.removeItem('dev-mode');
  });

  async function render(overrides: Record<string, unknown> = {}, withShell = true) {
    const fake = fakeShell(overrides);
    if (withShell) (window as any).electronAPI = fake.shell;
    await TestBed.inject(AppUpdateService).initialize();
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const refresh = async () => { await fixture.whenStable(); fixture.detectChanges(); };
    return {
      fixture, el, shell: fake.shell, refresh,
      push: async (data: unknown) => { fake.push(data); await refresh(); },
      state: () => words(el.querySelector('[data-testid="update-state"]')),
      button: (label: string) => Array.from(el.querySelectorAll('button, a'))
        .find(b => words(b) === label) as HTMLElement | undefined,
    };
  }

  it('About shows the app version and the API only as local, never its port or secret', async () => {
    const { el } = await render();
    const about = words(el.querySelector('[data-testid="about"]'));

    expect(el.querySelector('[data-testid="current-version"]')!.textContent).toBe('2.4.2');
    expect(about).toContain('Version 2.4.2, Stable channel');
    expect(about).toContain('API Local, on this computer');
    expect(el.textContent).not.toContain(SECRET);
    expect(el.textContent).not.toContain(String(PORT));
  });

  it('choosing Beta sets the update channel through the shell and About names it', async () => {
    const { el, shell, refresh } = await render();
    const beta = Array.from(el.querySelectorAll('mat-button-toggle button')).find(b => b.textContent?.trim() === 'Beta') as HTMLElement;

    beta.click();
    await refresh();

    expect(shell.setUpdateChannel).toHaveBeenCalledWith('beta');
    expect(el.querySelector('[data-testid="about"]')!.textContent).toContain('Beta channel');
  });

  it('not checked yet and checking are their own states', async () => {
    const { state, push } = await render();
    expect(state()).toContain('Not checked yet in this session');

    await push({ status: 'checking' });
    expect(state()).toContain('Checking for updates');
  });

  it('up to date: says the version is the newest on the channel', async () => {
    const { state, push } = await render();
    await push({ status: 'up-to-date' });
    expect(state()).toBe('check_circle You are up to date 2.4.2 is the newest version on the Stable channel.');
  });

  it('available: names the version, says it is downloading in the background, and Download joins the download through the shell', async () => {
    const { state, push, button, shell } = await render();
    await push({ status: 'available', version: '2.5.0' });

    expect(state()).toContain('Version 2.5.0 is available');
    expect(state()).toContain('It is downloading in the background and installs the next time you quit the app.');
    button('download Download')!.click();
    expect(shell.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('downloading: shows the percent and that the app does not restart on its own', async () => {
    const { state, push } = await render();
    await push({ status: 'downloading', version: '2.5.0', percent: 42 });
    expect(state()).toContain('Downloading version 2.5.0');
    expect(state()).toContain('42%');
    expect(state()).toContain('The app does not restart on its own.');
  });

  it('ready: Restart to Update installs through the shell', async () => {
    const { state, push, button, shell } = await render();
    await push({ status: 'downloaded', version: '2.5.0' });

    expect(state()).toContain('Version 2.5.0 is ready to install');
    button('restart_alt Restart to Update')!.click();
    expect(shell.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('a failed download says why, that nothing was installed, retries the download and links the release', async () => {
    const { state, push, button, shell, el } = await render();
    await push({ status: 'available', version: '2.5.0' });
    button('download Download')!.click();
    await push({ status: 'error', message: 'The connection was reset.' });

    expect(state()).toContain('The update to 2.5.0 was not downloaded');
    expect(state()).toContain('The connection was reset. You are still on 2.4.2 and nothing was installed.');
    const link = Array.from(el.querySelectorAll('[data-testid="update-state"] a')).map(a => a.getAttribute('href'));
    expect(link).toEqual([`${RELEASES_URL}/tag/v2.5.0`]);

    button('refresh Retry')!.click();
    expect(shell.downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it('a failed check says the check failed and Retry checks again', async () => {
    const { state, push, button, shell } = await render();
    await push({ status: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });

    expect(state()).toContain('Could not check for updates');
    expect(state()).toContain('net::ERR_INTERNET_DISCONNECTED');
    button('refresh Retry')!.click();
    expect(shell.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('a package that cannot update itself links the release of the new version, never Download or Restart', async () => {
    const { state, push, el } = await render({ getSelfUpdateBlocker: async () => 'macos-unsigned' });
    await push({ status: 'available', version: '2.5.0' });

    expect(state()).toContain('Version 2.5.0 is available, and this package cannot update itself');
    expect(state()).toContain('macOS: the build is not signed, and macOS installs an update only into a signed app.');
    const actions = Array.from(el.querySelectorAll('[data-testid="update-state"] a, [data-testid="update-state"] button'));
    expect(actions.map(a => words(a))).toEqual(['Open the download page open_in_new']);
    expect(actions[0].getAttribute('href')).toBe(`${RELEASES_URL}/tag/v2.5.0`);
    expect(actions[0].getAttribute('target')).toBe('_blank');

    await push({ status: 'downloaded', version: '2.5.0' });
    expect(state()).not.toContain('Restart to Update');
  });

  it('the portable Windows build says it has no installed copy to replace', async () => {
    const { state, push } = await render({ getSelfUpdateBlocker: async () => 'windows-portable' });
    await push({ status: 'available', version: '2.5.0' });
    expect(state()).toContain('Windows, portable build: there is no installed copy to replace; the file you run is the app.');
  });

  it('outside the desktop app the screen says updates are handled by it and offers no channel', async () => {
    const { el } = await render({}, false);
    expect(el.textContent).toContain('Updates are handled by the desktop app');
    expect(el.querySelector('mat-button-toggle-group')).toBeNull();
  });

  it('Report a bug opens the bug report with the version, the platform and the errors caught in this session', async () => {
    TestBed.inject(BugReportService).startCapture();
    window.dispatchEvent(new ErrorEvent('error', { message: 'Sample failure', filename: 'main.js', lineno: 7 }));
    const { button } = await render();

    button('bug_report Report a bug')!.click();

    const [component, config] = dialog.open.mock.calls[0] as unknown as [unknown, { data: any }];
    expect(component).toBe(BugReportDialogComponent);
    expect(config.data.type).toBe('bug');
    expect(config.data.version).toBe('2.4.2');
    expect(config.data.platform).toBe('linux');
    expect(config.data.errors).toHaveLength(1);
    expect(config.data.errors[0]).toContain('Sample failure (main.js:7)');
  });

  it('the developer mode switch turns developer mode on and off', async () => {
    const { el, refresh } = await render();
    const devSettings = TestBed.inject(DevSettingsService);
    const toggle = el.querySelector('mat-slide-toggle button') as HTMLElement;
    expect(el.querySelector('mat-slide-toggle')!.textContent).toContain('Show the Debug button on the Connections screen');

    toggle.click();
    await refresh();
    expect(devSettings.devMode()).toBe(true);
    expect(localStorage.getItem('dev-mode')).toBe('true');

    toggle.click();
    await refresh();
    expect(devSettings.devMode()).toBe(false);
  });

  it('Clear all data in the danger zone opens the typed confirmation; after a clear the connection status is read again', async () => {
    const result = { message: 'Cleared 3 connections and 2 groups', connectionsDeleted: 3, groupsDeleted: 2 };
    dialog.open.mockReturnValueOnce({ afterClosed: () => of(result) });
    const { el } = await render();
    const zone = el.querySelector('.danger-zone') as HTMLElement;
    expect(words(zone)).toContain('No broker is touched. It cannot be undone.');

    (zone.querySelector('button') as HTMLElement).click();

    expect(dialog.open.mock.calls[0][0]).toBe(ClearAllDataDialogComponent);
    expect(connectionService.refreshStatus).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('Cleared 3 connections and 2 groups');
  });

  it('a Clear all data dialog closed without clearing changes nothing', async () => {
    const { el } = await render();
    ((el.querySelector('.danger-zone') as HTMLElement).querySelector('button') as HTMLElement).click();
    expect(connectionService.refreshStatus).not.toHaveBeenCalled();
  });

  it('the screen meets the ui.md criteria: no Bootstrap or Font Awesome class, and every button has a name, in any state', async () => {
    const { el, push } = await render();
    const check = () => {
      const classes = Array.from(el.querySelectorAll('*')).flatMap(n => Array.from(n.classList));
      expect(classes.filter(c => /^(btn|btn-.*|fa|fas|fa-.*|form-control|card|badge|alert|row|col-.*|nav-tabs|progress)$/.test(c))).toEqual([]);
      const unnamed = Array.from(el.querySelectorAll('button, a'))
        .filter(b => !(words(b) || b.getAttribute('aria-label') || b.getAttribute('aria-labelledby')));
      expect(unnamed).toEqual([]);
    };
    check();
    for (const status of [{ status: 'available', version: '2.5.0' }, { status: 'downloading', percent: 5 }, { status: 'downloaded' }, { status: 'error', message: 'x' }]) {
      await push(status);
      check();
    }
  });
});
