import { Injectable, NgZone, inject, signal } from '@angular/core';

export type UpdateStatus =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'dev-mode';

export type UpdateChannel = 'latest' | 'beta';
export type SelfUpdateBlocker = 'macos-unsigned' | 'windows-portable' | 'linux-package';

const BLOCKERS: SelfUpdateBlocker[] = ['macos-unsigned', 'windows-portable', 'linux-package'];
const SHELL_STATUSES: UpdateStatus[] = ['checking', 'up-to-date', 'available', 'downloading', 'downloaded', 'error'];

export const RELEASES_URL = 'https://github.com/vitorafgomes/messaging-explorer/releases';

/** The version of the app and the state of its updates, as the Electron shell reports them. */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly ngZone = inject(NgZone);
  private initialized = false;
  private downloadRequested = false;

  readonly version = signal('');
  readonly channel = signal<UpdateChannel>('latest');
  readonly channelError = signal('');
  readonly status = signal<UpdateStatus>('unavailable');
  readonly availableVersion = signal('');
  readonly percent = signal(0);
  readonly error = signal('');
  readonly failedDuring = signal<'check' | 'download'>('check');
  readonly blocker = signal<SelfUpdateBlocker | null>(null);

  private get shell(): any {
    return typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
  }

  async initialize(): Promise<void> {
    const shell = this.shell;
    if (this.initialized || !shell) return;
    this.initialized = true;

    if (shell.onUpdateStatus) {
      this.status.set('idle');
      shell.onUpdateStatus((data: any) => this.ngZone.run(() => this.onShellStatus(data)));
    }
    const [version, channel, blocker] = await Promise.all([
      shell.getAppVersion?.(),
      shell.getUpdateChannel?.(),
      shell.getSelfUpdateBlocker?.(),
    ]);
    this.version.set(typeof version === 'string' ? version : '');
    this.channel.set(channel === 'beta' ? 'beta' : 'latest');
    this.blocker.set(BLOCKERS.includes(blocker) ? blocker : null);
  }

  async check(): Promise<void> {
    const shell = this.shell;
    if (!shell?.checkForUpdates) return;
    this.downloadRequested = false;
    this.error.set('');
    this.status.set('checking');
    const result = await shell.checkForUpdates();
    if (result?.status === 'dev-mode') {
      this.status.set('dev-mode');
    } else if (result?.status === 'error') {
      this.fail('check', result.message);
    } else if (this.status() === 'checking') {
      this.fail('check', 'The updater gave no answer.');
    }
  }

  async download(): Promise<void> {
    const shell = this.shell;
    if (this.blocker() || !shell?.downloadUpdate) return;
    this.downloadRequested = true;
    this.error.set('');
    const result = await shell.downloadUpdate();
    if (result?.status === 'error') this.fail('download', result.message);
  }

  install(): void {
    if (this.blocker()) return;
    this.shell?.installUpdate?.();
  }

  async setChannel(channel: UpdateChannel): Promise<void> {
    const shell = this.shell;
    if (!shell?.setUpdateChannel || channel === this.channel()) return;
    this.channelError.set('');
    const result = await shell.setUpdateChannel(channel);
    if (result?.status !== 'ok') {
      this.channelError.set(result?.message || 'The update channel was not changed.');
      return;
    }
    this.channel.set(channel);
    await this.check();
  }

  private onShellStatus(data: any): void {
    if (!SHELL_STATUSES.includes(data?.status)) return;
    if (data.version) this.availableVersion.set(data.version);
    if (typeof data.percent === 'number') this.percent.set(data.percent);
    if (data.status === 'error') {
      this.fail(this.downloadRequested ? 'download' : 'check', data.message);
      return;
    }
    this.status.set(data.status);
  }

  private fail(during: 'check' | 'download', message: unknown): void {
    this.failedDuring.set(during);
    this.error.set(typeof message === 'string' && message ? message : 'The updater did not say why.');
    this.status.set('error');
  }
}
