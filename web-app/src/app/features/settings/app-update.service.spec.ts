import { TestBed } from '@angular/core/testing';
import { AppUpdateService, releaseNoteLines } from './app-update.service';

function fakeShell(overrides: Record<string, unknown> = {}) {
  let listener: (data: unknown) => void = () => {};
  const shell: any = {
    platform: 'linux',
    getAppVersion: vi.fn(async () => '2.4.2'),
    getUpdateChannel: vi.fn(async () => 'latest'),
    getSelfUpdateBlocker: vi.fn(async () => null),
    onUpdateStatus: (callback: (data: unknown) => void) => { listener = callback; },
    checkForUpdates: vi.fn(async () => ({ status: 'ok' })),
    downloadUpdate: vi.fn(async () => ({ status: 'ok' })),
    installUpdate: vi.fn(),
    setUpdateChannel: vi.fn(async (channel: string) => ({ status: 'ok', channel })),
    ...overrides,
  };
  return { shell, push: (data: unknown) => listener(data) };
}

describe('AppUpdateService', () => {
  afterEach(() => delete (window as any).electronAPI);

  async function start(overrides: Record<string, unknown> = {}) {
    const fake = fakeShell(overrides);
    (window as any).electronAPI = fake.shell;
    const updates = TestBed.inject(AppUpdateService);
    await updates.initialize();
    return { updates, ...fake };
  }

  it('reads the version, the channel and why the package cannot update itself from the shell', async () => {
    const { updates } = await start({
      getUpdateChannel: async () => 'beta',
      getSelfUpdateBlocker: async () => 'macos-unsigned',
    });
    expect(updates.version()).toBe('2.4.2');
    expect(updates.channel()).toBe('beta');
    expect(updates.blocker()).toBe('macos-unsigned');
    expect(updates.status()).toBe('idle');
  });

  it('a value the shell sends that is not a known reason does not block updates', async () => {
    const { updates } = await start({ getSelfUpdateBlocker: async () => 'something-else' });
    expect(updates.blocker()).toBeNull();
  });

  it('reads the kind of package from the shell as deb or appimage, and anything else as unknown', async () => {
    for (const [answer, expected] of [['deb', 'deb'], ['appimage', 'appimage'], ['rpm', null], [null, null], [{ kind: 'deb' }, null]] as const) {
      TestBed.resetTestingModule();
      const { updates } = await start({ getPackageType: async () => answer });
      expect(updates.packageType(), `the shell answered ${JSON.stringify(answer)}`).toBe(expected);
    }
  });

  it('a check that finds a newer version is available with that version', async () => {
    const fake = fakeShell();
    fake.shell.checkForUpdates = vi.fn(async () => {
      fake.push({ status: 'checking' });
      fake.push({ status: 'available', version: '2.5.0' });
      return { status: 'ok', version: '2.5.0' };
    });
    (window as any).electronAPI = fake.shell;
    const updates = TestBed.inject(AppUpdateService);
    await updates.initialize();

    await updates.check();

    expect(updates.status()).toBe('available');
    expect(updates.availableVersion()).toBe('2.5.0');
  });

  it('a development build says so instead of checking forever', async () => {
    const { updates } = await start({ checkForUpdates: async () => ({ status: 'dev-mode' }) });
    await updates.check();
    expect(updates.status()).toBe('dev-mode');
  });

  it('a check the updater leaves unanswered ends as a failed check, not a spinner', async () => {
    const { updates } = await start();
    await updates.check();
    expect(updates.status()).toBe('error');
    expect(updates.failedDuring()).toBe('check');
    expect(updates.error()).toBe('The updater gave no answer.');
  });

  it('a failed download is reported as a download with the reason the updater gave', async () => {
    const { updates, push } = await start();
    push({ status: 'available', version: '2.5.0' });
    await updates.download('2.5.0');
    push({ status: 'downloading', percent: 42 });
    push({ status: 'error', message: 'net::ERR_CONNECTION_RESET' });

    expect(updates.status()).toBe('error');
    expect(updates.failedDuring()).toBe('download');
    expect(updates.error()).toBe('net::ERR_CONNECTION_RESET');
    expect(updates.percent()).toBe(42);
  });

  it('a download the shell started on its own that fails is reported as a download, not as a check', async () => {
    const { updates, push } = await start();
    push({ status: 'available', version: '2.5.0' });
    push({ status: 'downloading', percent: 10 });
    push({ status: 'error', message: 'net::ERR_CONNECTION_RESET' });

    expect(updates.status()).toBe('error');
    expect(updates.failedDuring()).toBe('download');
    expect(updates.error()).toBe('net::ERR_CONNECTION_RESET');
  });

  it('a later scheduled check that fails after a finished download is reported as a check', async () => {
    const { updates, push } = await start();
    push({ status: 'available', version: '2.5.0' });
    push({ status: 'downloading', percent: 50 });
    push({ status: 'downloaded', version: '2.5.0' });
    push({ status: 'checking' });
    push({ status: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });

    expect(updates.failedDuring()).toBe('check');
  });

  it('the channel changes only when the shell accepts it', async () => {
    const { updates, shell } = await start({
      setUpdateChannel: vi.fn(async () => ({ status: 'error', message: 'Unknown update channel' })),
    });
    await updates.setChannel('beta');
    expect(shell.setUpdateChannel).toHaveBeenCalledWith('beta');
    expect(updates.channel()).toBe('latest');
    expect(updates.channelError()).toBe('Unknown update channel');
  });

  it('an accepted channel is kept and checked again', async () => {
    const { updates, shell } = await start({ checkForUpdates: vi.fn(async () => ({ status: 'dev-mode' })) });
    await updates.setChannel('beta');
    expect(updates.channel()).toBe('beta');
    expect(shell.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('setChannel answers once the shell accepted the channel, without waiting for the check and the versions', async () => {
    const { updates } = await start({
      checkForUpdates: vi.fn(() => new Promise(() => undefined)),
      listUpdateVersions: vi.fn(() => new Promise(() => undefined)),
    });
    const answered = await Promise.race([
      updates.setChannel('beta').then(() => 'answered'),
      new Promise(resolve => setTimeout(() => resolve('still waiting'), 200)),
    ]);
    expect(answered, 'a slow check must not hold whoever asked for the channel').toBe('answered');
    expect(updates.channel()).toBe('beta');
  });

  it('a package that cannot update itself never downloads or installs', async () => {
    const { updates, shell, push } = await start({ getSelfUpdateBlocker: async () => 'windows-portable' });
    push({ status: 'available', version: '2.5.0' });

    await updates.download('2.5.0');
    updates.install();

    expect(shell.downloadUpdate).not.toHaveBeenCalled();
    expect(shell.installUpdate).not.toHaveBeenCalled();
  });

  it('without the shell, updates are unavailable', async () => {
    const updates = TestBed.inject(AppUpdateService);
    await updates.initialize();
    expect(updates.status()).toBe('unavailable');
  });
});

describe('releaseNoteLines', () => {
  it('one note per version gives the lines of every note, and an entry without a note adds none', () => {
    expect(releaseNoteLines([
      { version: '2.5.0', note: '<p>Rules tab</p>' },
      { version: '2.4.9' },
      { version: '2.4.8', note: '<p>Faster tree</p>' },
    ])).toEqual(['Rules tab', 'Faster tree']);
  });

  it('notes without a list give their lines of text, blank lines dropped', () => {
    expect(releaseNoteLines('<p>First line</p>\n\n<p>Second   line</p>')).toEqual(['First line', 'Second line']);
  });

  it('no notes, or notes of another type, give no lines', () => {
    expect(releaseNoteLines(null)).toEqual([]);
    expect(releaseNoteLines('   ')).toEqual([]);
    expect(releaseNoteLines(42)).toEqual([]);
  });
});
