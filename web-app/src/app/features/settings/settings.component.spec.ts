import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { SettingsComponent } from './settings.component';
import { AppUpdateService, RELEASES_URL, REPOSITORY_URL } from './app-update.service';
import { ClearAllDataDialogComponent } from './clear-all-data-dialog.component';
import { BugReportDialogComponent } from '../../shared/bug-report-dialog.component';
import { BugReportService } from '../../shared/bug-report.service';
import { ConnectionService, DevSettingsService, ThemeService } from '../../core/services';

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
        provideRouter([]),
        { provide: MatDialog, useValue: dialog },
        { provide: ConnectionService, useValue: connectionService },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronAPI;
    localStorage.removeItem('dev-mode');
    localStorage.removeItem('app-theme');
    document.documentElement.classList.remove('dark-theme');
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

  it('About lists the version, the licence and what it is built with, as drawn, and never the API port or secret', async () => {
    const { el } = await render();
    const about = words(el.querySelector('[data-testid="about"]'));

    expect(el.querySelector('[data-testid="current-version"]')!.textContent).toBe('2.4.2');
    expect(Array.from(el.querySelectorAll('[data-testid="about"] dt')).map(d => words(d))).toEqual(['Version', 'Licence', 'Built with']);
    expect(about).toContain('Version 2.4.2, Stable channel');
    expect(about).not.toContain('API');
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
    expect(words(el.querySelector('[data-testid="update-state"] a'))).toBe('Open the release page of 2.5.0 open_in_new');

    button('refresh Retry')!.click();
    expect(shell.downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it('a failed check says the check failed and Retry checks again', async () => {
    const { state, push, button, shell, el } = await render();
    await push({ status: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });

    expect(state()).toContain('Could not check for updates');
    expect(state()).toContain('net::ERR_INTERNET_DISCONNECTED');
    button('refresh Retry')!.click();
    expect(shell.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(words(el.querySelector('[data-testid="last-check"]'))).not.toBe('Not in this session');
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
    expect(el.querySelector('[aria-labelledby="channel-label"]')).toBeNull();
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

  it('the developer mode checkbox turns developer mode on and off', async () => {
    const { el, refresh } = await render();
    const devSettings = TestBed.inject(DevSettingsService);
    const toggle = el.querySelector('mat-checkbox input[type="checkbox"]') as HTMLElement;
    expect(el.querySelector('mat-checkbox')!.textContent).toContain('Show the Debug button on the Connections screen');

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

  it('Appearance offers System, Light and Dark; System is the default and Dark turns the dark theme on and is remembered', async () => {
    const { el, refresh } = await render();
    const group = el.querySelector('[data-testid="theme"]') as HTMLElement;
    const choices = Array.from(group.querySelectorAll('button'));
    expect(choices.map(b => words(b))).toEqual(['System', 'Light', 'Dark']);
    expect(choices.map(b => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(words(el.querySelector('[aria-labelledby="appearance-heading"]'))).toContain('System follows the light or dark setting of this computer and changes with it.');

    choices[2].click();
    await refresh();
    expect(TestBed.inject(ThemeService).mode()).toBe('dark');
    expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
    expect(localStorage.getItem('app-theme')).toBe('dark');
  });

  it('the intro says what the screen gathers, as the artboard words it', async () => {
    const { el } = await render();
    expect(words(el.querySelector('.page-head'))).toContain('What the theme button, the version label and the File, View and Help menus held. The window has no menu bar, so it all lives here.');
  });

  it('Last check says no check yet, then the time a check answered', async () => {
    const { el, push } = await render();
    const lastCheck = () => words(el.querySelector('[data-testid="last-check"]'));
    expect(words(el.querySelector('[data-testid="last-check"]')!.parentElement)).toContain('Last check');
    expect(lastCheck()).toBe('Not in this session');

    await push({ status: 'up-to-date' });
    expect(lastCheck()).not.toBe('Not in this session');
    expect(lastCheck()).toContain(String(new Date().getFullYear()));
  });

  it('an available version lists its release notes as text, never as markup', async () => {
    const { el, push } = await render();
    await push({
      status: 'available', version: '2.5.0',
      releaseNotes: '<ul><li>Rules tab for subscriptions</li><li><img src="x" onerror="alert(1)">The entity tree stays fast</li></ul>',
    });
    const notes = el.querySelector('[data-testid="release-notes"]') as HTMLElement;
    expect(words(notes.querySelector('.notes-title'))).toBe('Release notes of 2.5.0');
    expect(Array.from(notes.querySelectorAll('li')).map(li => words(li))).toEqual(['Rules tab for subscriptions', 'The entity tree stays fast']);
    expect(notes.querySelector('img')).toBeNull();
  });

  it('an available version without release notes shows no notes', async () => {
    const { el, push } = await render();
    await push({ status: 'available', version: '2.5.0' });
    expect(el.querySelector('[data-testid="release-notes"]')).toBeNull();
  });

  it('Data shows the real path of the file and Show in folder shows it in the file manager', async () => {
    const showDataFile = vi.fn(async () => ({ status: 'ok' }));
    const { el, refresh, button } = await render({ getDataFile: async () => '/home/u/.config/Messaging Explorer/data/workspace.json', showDataFile });
    await refresh();
    expect(words(el.querySelector('[data-testid="data-file"] .mono'))).toBe('/home/u/.config/Messaging Explorer/data/workspace.json');
    button('folder Show in folder')!.click();
    await refresh();
    expect(showDataFile).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="data-file"] [role="alert"]')).toBeNull();
  });

  it('Show in folder says why when the shell cannot show the file', async () => {
    const { el, refresh, button } = await render({ getDataFile: async () => '/d/workspace.json', showDataFile: async () => ({ status: 'error', message: 'Nothing is saved yet, so there is no file to show.' }) });
    await refresh();
    button('folder Show in folder')!.click();
    await refresh();
    await refresh();
    expect(words(el.querySelector('[data-testid="data-file"] [role="alert"]'))).toBe('Nothing is saved yet, so there is no file to show.');
  });

  it('Developer tools: Open developer tools opens them through the shell, with the warning that they show the API key', async () => {
    const openDevTools = vi.fn(async () => undefined);
    const { el, refresh, button } = await render({ openDevTools });
    const developer = el.querySelector('section[aria-labelledby="developer-heading"]');
    const row = developer?.querySelector('[data-testid="developer-tools"]');
    expect(words(row?.querySelector('.row-label')), 'the Developer section has a row labelled Developer tools').toBe('Developer tools');
    expect(words(row?.querySelector('button')), 'the desktop app offers Open developer tools in that row').toBe('Open developer tools');
    expect(words(developer?.querySelector('[data-testid="developer-tools-note"]')), 'the drawn warning is shown word for word in the Developer section')
      .toBe('The developer tools show every request the page makes to the local API, with its key. Close them before you share your screen.');
    button('Open developer tools')!.click();
    await refresh();
    expect(openDevTools, 'Open developer tools asks the shell once, with no argument').toHaveBeenCalledTimes(1);
    expect(openDevTools, 'Open developer tools sends no argument to the shell').toHaveBeenCalledWith();
  });

  it('outside the desktop app there is no Open developer tools and no developer tools row', async () => {
    const { el, button } = await render({}, false);
    expect(button('Open developer tools'), 'the browser build offers no Open developer tools').toBeUndefined();
    expect(el.querySelector('[data-testid="developer-tools"]'), 'the browser build has no developer tools row').toBeNull();
    expect(el.querySelector('[data-testid="developer-tools-note"]'), 'the browser build has no developer tools note').toBeNull();
  });

  it('outside the desktop app there is no Show in folder and no path', async () => {
    const { el, button } = await render({}, false);
    expect(button('folder Show in folder')).toBeUndefined();
    expect(el.querySelector('[data-testid="data-file"] .mono')).toBeNull();
  });

  it('Data says the file is plain text and links Export and Import to the Connections screen', async () => {
    const { el } = await render();
    expect(words(el.querySelector('[aria-labelledby="data-heading"]'))).toContain('Plain text, secrets included. Connection strings, passwords and client secrets in it are not encrypted. Protect it like a password file.');
    const move = el.querySelector('[data-testid="move-connections"]') as HTMLElement;
    expect(words(move)).toContain('An export masks the secrets unless you ask for them.');
    expect(Array.from(move.querySelectorAll('a')).map(a => [words(a), a.getAttribute('href')])).toEqual([['download Export', '/connections'], ['upload Import', '/connections']]);
    expect(Array.from(move.querySelectorAll('a mat-icon')).map(i => i.textContent?.trim()), 'Export carries the download icon and Import the upload icon, as Settings.dc.html draws them').toEqual(['download', 'upload']);
  });

  it('About links the repository, the changelog and the private security report, each in the browser', async () => {
    const { el, button } = await render();
    const links = (id: string) => Array.from(el.querySelectorAll(`[data-testid="${id}"] a`))
      .map(a => [words(a), a.getAttribute('href'), a.getAttribute('target')]);
    expect(links('project')).toEqual([
      ['Repository open_in_new', REPOSITORY_URL, '_blank'],
      ['Changelog open_in_new', `${REPOSITORY_URL}/blob/main/CHANGELOG.md`, '_blank'],
    ]);
    expect(links('security')).toEqual([['Report a security problem privately open_in_new', `${REPOSITORY_URL}/security/advisories/new`, '_blank']]);
    const trailing = Array.from(el.querySelectorAll('[data-testid="project"] a, [data-testid="security"] a'))
      .map(a => a.querySelector('mat-icon[iconpositionend]')?.textContent?.trim() ?? null);
    expect(trailing, 'Repository, Changelog and the security report end with the external-link icon, as Settings.dc.html draws them').toEqual(['open_in_new', 'open_in_new', 'open_in_new']);
    expect(words(el.querySelector('[data-testid="security"]'))).toContain('A private report to the maintainers, never a public issue.');
    expect(button('Suggest a feature')).toBeDefined();
  });
});
