import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { SettingsComponent } from './settings.component';
import { McpSettingsService, McpState } from './mcp-settings.service';
import { AppUpdateService, RELEASES_URL, REPOSITORY_URL } from './app-update.service';
import { ClearAllDataDialogComponent } from './clear-all-data-dialog.component';
import { BugReportDialogComponent } from '../../shared/bug-report-dialog.component';
import { BugReportService } from '../../shared/bug-report.service';
import { ConnectionGroupService, ConnectionService, DevSettingsService, ThemeService } from '../../core/services';

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
  const connectionService = { refreshStatus: vi.fn(), getConnections: () => of([]) };
  /** An API without the MCP server unless a spec says otherwise, so no spec here reaches the network. */
  const mcpState = signal<McpState | null>(null);
  const mcp = { state: mcpState, absent: signal(true), load: () => of(mcpState()), activity: () => of([]) };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MatDialog, useValue: dialog },
        { provide: ConnectionService, useValue: connectionService },
        { provide: ConnectionGroupService, useValue: { getGroups: () => of([]) } },
        { provide: McpSettingsService, useValue: mcp },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.clearAllMocks();
    mcpState.set(null);
    mcp.absent.set(true);
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

  describe('the versions of the channel', () => {
    const versions = [
      { version: '2.4.4', date: '2026-11-14T10:00:00Z', notes: '- a fix\n<script>alert(1)</script>', installed: false },
      { version: '2.4.2', date: '2026-11-01T10:00:00Z', notes: '', installed: true },
    ];
    const shown = (el: HTMLElement) => words(el.querySelector('[data-testid="version-list"] .mat-mdc-select-value'));
    const openList = async (el: HTMLElement, refresh: () => Promise<void>) => {
      (el.querySelector('[data-testid="version-list"]') as HTMLElement).click();
      await refresh();
      return Array.from(document.querySelectorAll<HTMLElement>('mat-option'));
    };

    it('lists the versions the shell read for the channel, marks the installed one, and shows the notes of the one picked as text', async () => {
      const listUpdateVersions = vi.fn(async () => ({ status: 'ok', channel: 'latest', versions }));
      const { el, refresh } = await render({ listUpdateVersions });
      await refresh();
      await refresh();

      expect(listUpdateVersions, 'the shell is asked with no argument').toHaveBeenCalledWith();
      const list = el.querySelector('[data-testid="version-list"]') as HTMLElement;
      expect(list.tagName, 'the versions are a dropdown').toBe('MAT-SELECT');
      expect(list.getAttribute('aria-labelledby')).toContain('version-label');
      expect(shown(el), 'the newest is picked first').toBe('2.4.4 · Nov 14, 2026');
      const options = await openList(el, refresh);
      expect(options.map(words)).toStrictEqual(['2.4.4 · Nov 14, 2026', '2.4.2 · Nov 1, 2026 · Installed']);
      const notes = el.querySelector('[data-testid="version-notes"]') as HTMLElement;
      expect(words(notes.querySelector('h3'))).toBe('What version 2.4.4 has');
      expect(notes.querySelector('pre')?.textContent, 'the notes as the text the release holds').toBe('- a fix\n<script>alert(1)</script>');
      expect(notes.querySelector('script'), 'the notes are never markup').toBeNull();

      options[1].click();
      await refresh();
      expect(shown(el)).toBe('2.4.2 · Nov 1, 2026 · Installed');
      const picked = el.querySelector('[data-testid="version-notes"]') as HTMLElement;
      expect(words(picked.querySelector('h3'))).toBe('What version 2.4.2 has');
      expect(words(picked)).toContain('No notes were written for this version.');
      expect(words(picked)).toContain('This is the version you have.');
      expect(Array.from(el.querySelectorAll('[data-testid="version-notes"] button')).length, 'picking a version offers no install').toBe(0);
    });

    it('a list the shell could not read is an error with its reason and Retry, never an empty list', async () => {
      const listUpdateVersions = vi.fn()
        .mockResolvedValueOnce({ status: 'error', message: 'The release list could not be reached. Check the connection to the internet.' })
        .mockResolvedValueOnce({ status: 'ok', channel: 'latest', versions });
      const { el, refresh } = await render({ listUpdateVersions });
      await refresh();

      const error = el.querySelector('[data-testid="versions-error"]') as HTMLElement;
      expect(error.getAttribute('role')).toBe('alert');
      expect(words(error)).toContain('The versions could not be read: The release list could not be reached. Check the connection to the internet.');
      expect(el.querySelector('[data-testid="version-list"]')).toBeNull();

      (Array.from(error.querySelectorAll('button')).find(b => words(b).endsWith('Retry')) as HTMLElement).click();
      await refresh();
      expect(shown(el)).toBe('2.4.4 · Nov 14, 2026');
      expect(el.querySelector('[data-testid="versions-error"]')).toBeNull();
    });

    it('a channel with no release says so, and an answer that is not a list is an error', async () => {
      const none = await render({ listUpdateVersions: vi.fn(async () => ({ status: 'ok', channel: 'latest', versions: [] })) });
      await none.refresh();
      expect(words(none.el.querySelector('[data-testid="versions-empty"]'))).toBe('No version was released on the Stable channel yet.');
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [SettingsComponent],
        providers: [provideNoopAnimations(), provideRouter([]), { provide: MatDialog, useValue: dialog }, { provide: ConnectionService, useValue: connectionService }],
      }).compileComponents();

      const odd = await render({ listUpdateVersions: vi.fn(async () => ({ status: 'ok', versions: 'not a list' })) });
      await odd.refresh();
      expect(words(odd.el.querySelector('[data-testid="versions-error"]'))).toContain('The versions could not be read: The desktop app gave no list.');
    });

    it('changing the channel reads the versions of the new channel', async () => {
      const listUpdateVersions = vi.fn(async () => ({ status: 'ok', channel: 'latest', versions }));
      const { el, refresh } = await render({ listUpdateVersions });
      await refresh();

      (Array.from(el.querySelectorAll('mat-button-toggle button')).find(b => b.textContent?.trim() === 'Beta') as HTMLElement).click();
      await new Promise(resolve => setTimeout(resolve));
      await refresh();

      expect(listUpdateVersions).toHaveBeenCalledTimes(2);
    });

    it('an answer for the channel left behind never replaces the list of the channel shown, and the old list is not shown under the new channel', async () => {
      const beta = [{ version: '2.4.5-beta.7', date: '2026-11-15T10:00:00Z', notes: 'beta notes', installed: false }];
      let answerStable: (value: unknown) => void = () => {};
      const listUpdateVersions = vi.fn()
        .mockImplementationOnce(() => new Promise(resolve => { answerStable = resolve; }))
        .mockResolvedValueOnce({ status: 'ok', channel: 'beta', versions: beta });
      const { el, refresh } = await render({ listUpdateVersions });

      (Array.from(el.querySelectorAll('mat-button-toggle button')).find(b => b.textContent?.trim() === 'Beta') as HTMLElement).click();
      await new Promise(resolve => setTimeout(resolve));
      await refresh();
      expect(shown(el), 'the list of Beta').toBe('2.4.5-beta.7 · Nov 15, 2026');

      answerStable({ status: 'ok', channel: 'latest', versions });
      await new Promise(resolve => setTimeout(resolve));
      await refresh();
      expect(shown(el), 'the late answer for Stable is dropped').toBe('2.4.5-beta.7 · Nov 15, 2026');
    });

    describe('the notes expand and hide', () => {
      const long = { version: '2.4.4', date: '2026-11-14T10:00:00Z', notes: ['- one', '- two', '- three', '- four', '- five', '- six'].join('\n'), installed: false, older: false, installable: true };
      const open = async () => {
        const rendered = await render({ listUpdateVersions: vi.fn(async () => ({ status: 'ok', channel: 'latest', versions: [long] })) });
        await rendered.refresh();
        await rendered.refresh();
        const notes = () => rendered.el.querySelector('[data-testid="version-notes"]') as HTMLElement;
        const toggle = () => notes().querySelector('button.notes-toggle') as HTMLButtonElement;
        const button = (label: string) => Array.from(notes().querySelectorAll('button')).find(b => words(b) === label) as HTMLButtonElement | undefined;
        return { ...rendered, notes, toggle, button };
      };

      it('the notes open with the version, name how many lines they hold, show the first four of a long text and the rest on "Show all 6 lines"', async () => {
        const { notes, toggle, button, refresh } = await open();

        expect(words(toggle())).toContain('Release notes of 2.4.4');
        expect(words(toggle())).toContain('6 lines');
        expect(toggle().getAttribute('aria-expanded')).toBe('true');
        expect(notes().querySelector('pre')?.textContent, 'the first four lines').toBe('- one\n- two\n- three\n- four');

        button('Show all 6 lines')!.click();
        await refresh();
        expect(notes().querySelector('pre')?.textContent).toBe(long.notes);
        expect(button('Show fewer'), 'the way back').toBeDefined();
      });

      it('hidden notes leave their header and say they are hidden, and the agreement and Install stay as they were, as Settings.dc.html draws', async () => {
        const { el, notes, toggle, refresh } = await open();
        const agreement = () => el.querySelector('[data-testid="version-install"] mat-checkbox input') as HTMLInputElement;
        const install = () => Array.from(el.querySelectorAll<HTMLButtonElement>('[data-testid="version-install"] button')).find(b => words(b).includes('Install '))!;

        toggle().click();
        await refresh();

        expect(toggle().getAttribute('aria-expanded')).toBe('false');
        expect(notes().querySelector('pre'), 'no notes on screen').toBeNull();
        expect(words(notes())).toContain('Hidden. Open them to read what this version has.');
        expect(agreement().disabled, 'the agreement can be given with the notes hidden').toBe(false);

        agreement().click();
        await refresh();
        expect(install().disabled).toBe(false);
      });
    });

    describe('installing the version picked', () => {
      const picks = [
        { version: '2.4.4', date: '2026-11-14T10:00:00Z', notes: '- a fix', installed: false, older: false, installable: true },
        { version: '2.4.2', date: '2026-11-01T10:00:00Z', notes: '', installed: true, older: false, installable: true },
        { version: '2.4.1', date: '2026-10-20T10:00:00Z', notes: '- older', installed: false, older: true, installable: true },
        { version: '2.4.0', date: '2026-10-01T10:00:00Z', notes: '', installed: false, older: true, installable: false },
      ];
      const block = (el: HTMLElement) => el.querySelector('[data-testid="version-install"]') as HTMLElement | null;
      const installButton = (el: HTMLElement) => Array.from(block(el)?.querySelectorAll('button') ?? []).find(b => words(b).includes('Install ')) as HTMLButtonElement | undefined;
      const agree = (el: HTMLElement) => (block(el)!.querySelector('mat-checkbox input') as HTMLInputElement).click();
      const pick = async (el: HTMLElement, refresh: () => Promise<void>, index: number) => {
        (await openList(el, refresh))[index].click();
        await refresh();
      };
      const open = async (overrides: Record<string, unknown> = {}) => {
        const installUpdateVersion = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ status: 'ok', version: '2.4.4' }));
        const rendered = await render({ listUpdateVersions: vi.fn(async () => ({ status: 'ok', channel: 'latest', versions: picks })), installUpdateVersion, ...overrides });
        await rendered.refresh();
        await rendered.refresh();
        return { ...rendered, installUpdateVersion };
      };

      it('a version other than the installed one can be installed only after the user agrees, and the shell is given the version and the agreement alone', async () => {
        const { el, refresh, installUpdateVersion } = await open();

        expect(words(block(el)!.querySelector('p')), 'the newest, not installed, is picked first').toBe('Install 2.4.4. You have 2.4.2.');
        expect(block(el)!.querySelector('[data-testid="downgrade-note"]'), 'a newer version is no downgrade').toBeNull();
        expect(installButton(el)!.disabled, 'Install waits for the agreement').toBe(true);
        installButton(el)!.click();
        expect(installUpdateVersion).not.toHaveBeenCalled();

        agree(el);
        await refresh();
        expect(installButton(el)!.disabled).toBe(false);
        installButton(el)!.click();
        await refresh();

        expect(installUpdateVersion.mock.calls).toStrictEqual([['2.4.4', true]]);
      });

      it('on a deb, under the agreement, the version panel says installing asks for the administrator password', async () => {
        const deb = await open({ getPackageType: vi.fn(async () => 'deb') });
        const debNote = block(deb.el)!.querySelector('[data-testid="password-note"]');
        expect(words(debNote), 'a deb installs through dpkg, which asks for the password').toBe('Installing asks for the administrator password of this computer.');
        expect(block(deb.el)!.querySelector('mat-checkbox')!.compareDocumentPosition(debNote!) & Node.DOCUMENT_POSITION_FOLLOWING, 'the sentence sits under the agreement').toBeTruthy();
        expect(installButton(deb.el), 'a deb offers Install').toBeDefined();
      });

      it('on an AppImage the version panel says nothing of a password', async () => {
        const appImage = await open({ getPackageType: vi.fn(async () => 'appimage') });
        expect(installButton(appImage.el), 'the AppImage offers Install').toBeDefined();
        expect(block(appImage.el)!.querySelector('[data-testid="password-note"]'), 'the AppImage replaces itself without a password').toBeNull();
        expect(words(appImage.el)).not.toContain('administrator password');
      });

      it('under the heading, the picked version is placed against the installed one, in the words of the artboard', async () => {
        const { el, refresh } = await open();
        const relation = () => el.querySelector('[data-testid="version-relation"]') as HTMLElement | null;

        expect(words(relation()), 'a newer version').toBe('Newer than 2.4.2, the version you have.');
        expect(relation()!.previousElementSibling?.tagName, 'the line comes right after the heading, as drawn').toBe('H3');
        await pick(el, refresh, 1);
        expect(words(relation()), 'the installed version').toBe('The version installed on this computer.');
        await pick(el, refresh, 2);
        expect(words(relation()), 'an older version').toBe('Older than 2.4.2, the version you have.');
      });

      it('beside Install, Open the release page opens the page of the picked version through the same safe link as the blocked branches', async () => {
        const { el } = await open();
        const actions = block(el)!.querySelector('.install-actions') as HTMLElement;
        const page = Array.from(actions.querySelectorAll('a')).find(a => words(a) === 'Open the release page');

        expect(page, 'Open the release page sits beside Install').toBeDefined();
        expect(page!.previousElementSibling, 'after the Install button, as drawn').toBe(installButton(el));
        expect(page!.getAttribute('href'), 'the release page of the version picked').toBe('https://github.com/vitorafgomes/messaging-explorer/releases/tag/v2.4.4');
        expect(page!.getAttribute('target'), 'opened by the shell, outside the app').toBe('_blank');
        expect(page!.getAttribute('rel')).toBe('noopener noreferrer');
      });

      it('under the agreement, the app says nothing downloads before Install, and stops saying it while a version downloads', async () => {
        const { el, refresh } = await open({ installUpdateVersion: vi.fn(() => new Promise(() => {})) });
        const hint = () => Array.from(block(el)!.querySelectorAll('p, span')).find(e => words(e) === 'Nothing downloads until you tick the box and press Install. The app restarts to finish.');

        expect(hint(), 'shown while nothing downloads').toBeDefined();
        agree(el);
        await refresh();
        installButton(el)!.click();
        await refresh();
        expect(hint(), 'not shown while the version downloads').toBeUndefined();
      });

      it('the installed version shows its notes and nothing to install, and picking another version withdraws the agreement', async () => {
        const { el, refresh } = await open();
        agree(el);
        await refresh();

        await pick(el, refresh, 1);
        expect(block(el), 'the installed version offers no install').toBeNull();
        expect(words(el.querySelector('[data-testid="version-notes"]'))).toContain('This is the version you have.');

        await pick(el, refresh, 2);
        expect(installButton(el)!.disabled, 'the agreement given for 2.4.4 does not carry to 2.4.1').toBe(true);
        expect(words(block(el)!.querySelector('[data-testid="downgrade-note"]'))).toContain('This goes back to an older version.');
      });

      it('the agreement is for the version it was given for: when the list is read again and shows another version, Install waits for a new agreement', async () => {
        const beta = [{ version: '2.4.5-beta.7', date: '2026-11-15T10:00:00Z', notes: 'beta notes', installed: false, older: false, installable: true }];
        const listUpdateVersions = vi.fn()
          .mockResolvedValueOnce({ status: 'ok', channel: 'latest', versions: picks })
          .mockResolvedValueOnce({ status: 'ok', channel: 'beta', versions: beta });
        const { el, refresh, installUpdateVersion } = await open({ listUpdateVersions });
        agree(el);
        await refresh();
        expect(installButton(el)!.disabled).toBe(false);

        (Array.from(el.querySelectorAll('mat-button-toggle button')).find(b => b.textContent?.trim() === 'Beta') as HTMLElement).click();
        await new Promise(resolve => setTimeout(resolve));
        await refresh();
        await refresh();

        expect(words(block(el)!.querySelector('p'))).toBe('Install 2.4.5-beta.7. You have 2.4.2.');
        expect(installButton(el)!.disabled, 'the agreement given for 2.4.4 is not one for 2.4.5-beta.7').toBe(true);
        expect((block(el)!.querySelector('mat-checkbox input') as HTMLInputElement).checked).toBe(false);
        installButton(el)!.click();
        expect(installUpdateVersion).not.toHaveBeenCalled();
      });

      it('an install the shell refuses or cannot finish says why, as an error', async () => {
        const { el, refresh } = await open({ installUpdateVersion: vi.fn(async () => ({ status: 'error', message: 'Version 2.4.4 was not installed: disk full' })) });
        agree(el);
        await refresh();
        installButton(el)!.click();
        await refresh();
        await refresh();

        const error = el.querySelector('[data-testid="install-error"]') as HTMLElement;
        expect(error.getAttribute('role')).toBe('alert');
        expect(words(error)).toBe('Version 2.4.4 was not installed: disk full');
      });

      it('a release with no package for this system, and a package that cannot replace itself, show the page of the version and no Install', async () => {
        const noPackage = await open();
        await pick(noPackage.el, noPackage.refresh, 3);
        expect(installButton(noPackage.el), 'no Install without a package').toBeUndefined();
        expect(block(noPackage.el)!.querySelector('mat-checkbox')).toBeNull();
        expect(block(noPackage.el)!.querySelector('a')!.getAttribute('href')).toBe('https://github.com/vitorafgomes/messaging-explorer/releases/tag/v2.4.0');

        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
          imports: [SettingsComponent],
          providers: [provideNoopAnimations(), provideRouter([]), { provide: MatDialog, useValue: dialog }, { provide: ConnectionService, useValue: connectionService }],
        }).compileComponents();
        const blocked = await open({ getSelfUpdateBlocker: vi.fn(async () => 'linux-package') });
        expect(installButton(blocked.el), 'no Install on a package that cannot replace itself').toBeUndefined();
        expect(block(blocked.el)!.querySelector('a')!.getAttribute('href')).toBe('https://github.com/vitorafgomes/messaging-explorer/releases/tag/v2.4.4');
        expect(blocked.installUpdateVersion).not.toHaveBeenCalled();
      });
    });

    it('a desktop app that cannot list versions shows no version list at all', async () => {
      const { el, refresh } = await render();
      await refresh();

      expect(el.querySelector('[data-testid="version-list"], [data-testid="versions-error"], [data-testid="versions-empty"]')).toBeNull();
    });
  });

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

  it('available: names the version, downloads nothing by itself, and Download waits for the agreement to that version', async () => {
    const { state, push, button, shell, el, fixture } = await render();
    await push({ status: 'available', version: '2.5.0' });
    const agreement = () => el.querySelector('[data-testid="update-agreement"] input') as HTMLInputElement;

    expect(state()).toContain('Version 2.5.0 is available');
    expect(state()).toContain('You have 2.4.2. Nothing downloads or installs until you agree.');
    expect(words(el.querySelector('[data-testid="update-agreement"]'))).toBe('I have read what this version has and want to install it');
    expect((button('download Download') as HTMLButtonElement).disabled).toBe(true);
    fixture.componentInstance.downloadUpdate();
    expect(shell.downloadUpdate, 'no agreement, no download').not.toHaveBeenCalled();

    agreement().click();
    await push({ status: 'available', version: '2.5.1' });
    expect(agreement().checked, 'an agreement to 2.5.0 is not one to 2.5.1').toBe(false);
    expect((button('download Download') as HTMLButtonElement).disabled).toBe(true);

    agreement().click();
    await push({ status: 'available', version: '2.5.1' });
    button('download Download')!.click();
    expect(shell.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(shell.downloadUpdate).toHaveBeenCalledWith(true, '2.5.1');
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

  it('on a deb, Download and Restart to Update say installing asks for the administrator password, and the ready state does not say it installs on quit', async () => {
    const { state, push, button, el, shell } = await render({ getPackageType: vi.fn(async () => 'deb') });
    const note = () => el.querySelector('[data-testid="update-state"] [data-testid="password-note"]');

    await push({ status: 'available', version: '2.5.0' });
    expect(button('download Download'), 'a deb offers Download').toBeDefined();
    expect(words(note()), 'beside Download').toBe('Installing asks for the administrator password of this computer.');
    expect(el.querySelector('[data-testid="update-agreement"]')!.compareDocumentPosition(note()!) & Node.DOCUMENT_POSITION_FOLLOWING, 'the sentence sits under the agreement').toBeTruthy();

    await push({ status: 'downloaded', version: '2.5.0' });
    expect(state()).toContain('Version 2.5.0 is ready to install');
    expect(words(note()), 'beside Restart to Update').toBe('Installing asks for the administrator password of this computer.');
    expect(state(), 'a deb never installs on quit').not.toContain('it installs the next time you quit the app');
    expect(state()).toContain('It installs only when you press Restart to Update.');
    button('restart_alt Restart to Update')!.click();
    expect(shell.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('on an AppImage, Download and Restart to Update say nothing of a password, and the ready state still installs on quit', async () => {
    const { state, push, el } = await render({ getPackageType: vi.fn(async () => 'appimage') });
    await push({ status: 'available', version: '2.5.0' });
    expect(el.querySelector('[data-testid="password-note"]')).toBeNull();
    await push({ status: 'downloaded', version: '2.5.0' });
    expect(el.querySelector('[data-testid="password-note"]')).toBeNull();
    expect(state()).toContain('Restart now, or keep working: it installs the next time you quit the app.');
  });

  it('an install that fails after the download says it was not installed, never that it was not downloaded or that nothing changed, and Retry installs again', async () => {
    const { state, push, button, shell } = await render({ getPackageType: vi.fn(async () => 'deb'), installUpdate: vi.fn() });
    await push({ status: 'downloading', version: '2.5.0', percent: 100 });
    await push({ status: 'downloaded', version: '2.5.0' });
    await push({ status: 'error', message: 'Command pkexec exited with code 126' });

    expect(state(), 'the heading names the install').toContain('The update to 2.5.0 was not installed');
    expect(state(), 'the reason the updater gave').toContain('Command pkexec exited with code 126');
    expect(state(), 'a download that succeeded is not called a failed download').not.toContain('was not downloaded');
    expect(state(), 'a failed install of a package may have changed it, so the page does not say nothing was installed').not.toContain('nothing was installed');
    button('refresh Retry')!.click();
    expect(shell.installUpdate, 'Retry installs the update that is already downloaded').toHaveBeenCalledTimes(1);
    expect(shell.checkForUpdates, 'and does not check again').not.toHaveBeenCalled();
  });

  it('on a deb the note under the channel does not say a beta installs on the next quit', async () => {
    const deb = await render({ getPackageType: vi.fn(async () => 'deb') });
    expect(deb.el.textContent, 'a deb never installs on quit').not.toContain('installs on the next quit');
    expect(deb.el.textContent).toContain('a beta already downloaded still installs when you press Restart to Update');
  });

  it('on an AppImage the note under the channel says a beta already downloaded installs on the next quit', async () => {
    const { el } = await render({ getPackageType: vi.fn(async () => 'appimage') });
    expect(el.textContent).toContain('a beta already downloaded still installs on the next quit');
  });

  it('a failed download says why, that nothing was installed, retries the download and links the release', async () => {
    const { state, push, button, shell, el } = await render();
    await push({ status: 'available', version: '2.5.0' });
    (el.querySelector('[data-testid="update-agreement"] input') as HTMLInputElement).click();
    await push({ status: 'available', version: '2.5.0' });
    button('download Download')!.click();
    await push({ status: 'error', message: 'The connection was reset.' });

    expect(state()).toContain('The update to 2.5.0 was not downloaded');
    expect(state()).toContain('The connection was reset. You are still on 2.4.2 and nothing was installed.');
    const link = Array.from(el.querySelectorAll('[data-testid="update-state"] a')).map(a => a.getAttribute('href'));
    expect(link).toEqual([`${RELEASES_URL}/tag/v2.5.0`]);
    expect(words(el.querySelector('[data-testid="update-state"] a'))).toBe('Open the release page of 2.5.0 open_in_new');

    const checks = shell.checkForUpdates.mock.calls.length;
    button('refresh Retry')!.click();
    expect(shell.checkForUpdates.mock.calls.length, 'Retry checks again: after a failed download the shell holds no version an agreement can be given for').toBe(checks + 1);
    expect(shell.downloadUpdate, 'Retry starts no download by itself').toHaveBeenCalledTimes(1);
  });

  it('Retry after a failed download that has no agreement checks again, so the agreement can be given, and downloads nothing', async () => {
    const { push, button, shell } = await render();
    await push({ status: 'available', version: '2.5.0' });
    await push({ status: 'downloading', version: '2.5.0', percent: 10 });
    await push({ status: 'error', message: 'The connection was reset.' });
    const checks = shell.checkForUpdates.mock.calls.length;

    button('refresh Retry')!.click();

    expect(shell.downloadUpdate).not.toHaveBeenCalled();
    expect(shell.checkForUpdates.mock.calls.length).toBe(checks + 1);
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
    expect(el.querySelector('mat-checkbox')!.textContent).toContain('Show the Logs screen in the toolbar and the Debug button on the Connections screen');

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

  it('the MCP server group sits between Data and Developer, as Settings.dc.html draws it, and is absent against an API without it', async () => {
    const headings = (el: HTMLElement) => Array.from(el.querySelectorAll('main > section h2, main > app-settings-mcp section h2')).map(h => words(h));
    const without = await render();
    expect(headings(without.el), 'an API without the MCP server: no group').toStrictEqual(['Appearance', 'Updates', 'Data', 'Developer', 'About']);

    mcpState.set({ enabled: false, url: 'http://localhost:5917/mcp', hasToken: false, tokenCreatedAt: null, levels: ['read'],
      supports: { logs: false, appSettings: false, confirmation: false }, logsAllowed: false, connections: [] });
    mcp.absent.set(false);
    const withIt = await render();
    expect(headings(withIt.el), 'the group between Data and Developer').toStrictEqual(['Appearance', 'Updates', 'Data', 'MCP server', 'Developer', 'About']);
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
