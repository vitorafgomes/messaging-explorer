import { TestBed } from '@angular/core/testing';
import { AppUpdateService } from './app-update.service';

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
    await updates.download();
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

  it('an automatic download that fails before any progress is reported as a download', async () => {
    const { updates, push } = await start();
    push({ status: 'available', version: '2.5.0' });
    push({ status: 'error', message: 'net::ERR_CONNECTION_RESET' });

    expect(updates.failedDuring()).toBe('download');
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

  it('a package that cannot update itself never downloads or installs', async () => {
    const { updates, shell, push } = await start({ getSelfUpdateBlocker: async () => 'windows-portable' });
    push({ status: 'available', version: '2.5.0' });

    await updates.download();
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
