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

/** A release of the chosen channel, as the desktop app read it from the release page. Its notes are text from outside the app. */
export interface UpdateVersion {
  version: string;
  date: string;
  notes: string;
  installed: boolean;
  /** Whether it comes before the installed version, so installing it goes back. */
  older: boolean;
  /** Whether its release holds the package the desktop app can install on this system. */
  installable: boolean;
}

export const REPOSITORY_URL = 'https://github.com/vitorafgomes/messaging-explorer';
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;

/**
 * The release notes the updater reports (HTML, or one note per version) as plain lines of text:
 * the items of its lists, else its lines. The HTML is parsed inert and never rendered as markup.
 */
export function releaseNoteLines(notes: unknown): string[] {
  const html = Array.isArray(notes)
    ? notes.map(n => (typeof n?.note === 'string' ? n.note : '')).join('\n')
    : typeof notes === 'string' ? notes : '';
  if (!html.trim()) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items = Array.from(doc.querySelectorAll('li')).map(li => li.textContent ?? '');
  const lines = items.length ? items : (doc.body.textContent ?? '').split('\n');
  return lines.map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** The version of the app and the state of its updates, as the Electron shell reports them. */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly ngZone = inject(NgZone);
  private initialized = false;
  private downloadRequested = false;
  private versionsRead = 0;

  readonly version = signal('');
  readonly channel = signal<UpdateChannel>('latest');
  readonly channelError = signal('');
  readonly status = signal<UpdateStatus>('unavailable');
  readonly availableVersion = signal('');
  readonly percent = signal(0);
  readonly error = signal('');
  readonly failedDuring = signal<'check' | 'download'>('check');
  readonly blocker = signal<SelfUpdateBlocker | null>(null);
  readonly releaseNotes = signal<string[]>([]);
  readonly lastChecked = signal<Date | null>(null);
  /** The versions of the chosen channel; null until they were read, or where the desktop app cannot list them. */
  readonly versions = signal<UpdateVersion[] | null>(null);
  readonly versionsLoading = signal(false);
  readonly versionsError = signal('');
  /** The version being downloaded at the user's word, or '' when none is. */
  readonly installingVersion = signal('');
  readonly installError = signal('');
  /** Whether the version found downloads by itself; false while the app keeps a version the user picked. */
  readonly downloadsByItself = signal(true);

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
      this.lastChecked.set(new Date());
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
    this.versions.set(null);
    await Promise.all([this.check(), this.loadVersions()]);
  }

  /**
   * Reads the versions of the chosen channel through the desktop app; a list that could not be read is an error,
   * never an empty list. Only the answer of the latest read is kept, so one that arrives late for a channel left
   * behind changes nothing.
   */
  async loadVersions(): Promise<void> {
    const shell = this.shell;
    if (!shell?.listUpdateVersions) return;
    const read = ++this.versionsRead;
    this.versionsLoading.set(true);
    this.versionsError.set('');
    const result = await Promise.resolve(shell.listUpdateVersions()).catch(() => null);
    if (read !== this.versionsRead) return;
    this.versionsLoading.set(false);
    if (result?.status === 'ok' && Array.isArray(result.versions)) {
      this.versions.set(result.versions
        .filter((v: any) => typeof v?.version === 'string' && v.version)
        .map((v: any) => ({
          version: v.version,
          date: typeof v.date === 'string' ? v.date : '',
          notes: typeof v.notes === 'string' ? v.notes : '',
          installed: v.installed === true,
          older: v.older === true,
          installable: v.installable === true,
        })));
      return;
    }
    this.versions.set(null);
    this.versionsError.set(typeof result?.message === 'string' && result.message ? result.message : 'The desktop app gave no list.');
  }

  /**
   * Downloads a version the user picked and agreed to; the desktop app installs it on restart. The desktop app
   * decides whether it may be installed, from a version alone, and says why when it refuses.
   */
  async installVersion(version: string): Promise<void> {
    const shell = this.shell;
    if (this.blocker() || !shell?.installUpdateVersion || this.installingVersion()) return;
    this.installError.set('');
    this.installingVersion.set(version);
    this.downloadRequested = true;
    const result = await Promise.resolve(shell.installUpdateVersion(version, true)).catch(() => null);
    this.installingVersion.set('');
    if (result?.status !== 'ok') {
      this.installError.set(typeof result?.message === 'string' && result.message ? result.message : `Version ${version} was not installed: the desktop app gave no answer.`);
    }
  }

  private onShellStatus(data: any): void {
    if (!SHELL_STATUSES.includes(data?.status)) return;
    if (data.version) this.availableVersion.set(data.version);
    if (typeof data.percent === 'number') this.percent.set(data.percent);
    if (data.status === 'available') {
      this.releaseNotes.set(releaseNoteLines(data.releaseNotes));
      this.downloadsByItself.set(data.downloads !== false);
    }
    if (data.status === 'up-to-date' || data.status === 'available') this.lastChecked.set(new Date());
    if (data.status === 'checking') this.downloadRequested = false;
    if (data.status === 'downloading' || (data.status === 'available' && !this.blocker() && data.downloads !== false)) this.downloadRequested = true;
    if (data.status === 'error') {
      this.fail(this.downloadRequested ? 'download' : 'check', data.message);
      return;
    }
    this.status.set(data.status);
  }

  private fail(during: 'check' | 'download', message: unknown): void {
    if (during === 'check') this.lastChecked.set(new Date());
    this.failedDuring.set(during);
    this.error.set(typeof message === 'string' && message ? message : 'The updater did not say why.');
    this.status.set('error');
  }
}
