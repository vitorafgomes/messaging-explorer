import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ConnectionService, DevSettingsService, ThemeService } from '../../core/services';
import { BugReportService } from '../../shared/bug-report.service';
import { AppUpdateService, RELEASES_URL, REPOSITORY_URL, UpdateChannel, UpdateVersion } from './app-update.service';
import { ClearAllDataDialogComponent, ClearAllDataResult } from './clear-all-data-dialog.component';
import { SettingsMcpComponent } from './settings-mcp.component';

const BLOCKER_REASONS = {
  'macos-unsigned': { platform: 'macOS', reason: 'the build is not signed, and macOS installs an update only into a signed app.' },
  'windows-portable': { platform: 'Windows, portable build', reason: 'there is no installed copy to replace; the file you run is the app.' },
  'linux-package': { platform: 'Linux, installed package', reason: 'only the AppImage and the .deb replace themselves; another package, such as an .rpm, is updated by installing the new one.' },
} as const;

/** The settings of the app: appearance, updates, data, the MCP server, developer mode and tools, and About. */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatSelectModule,
    SettingsMcpComponent,
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  readonly updates = inject(AppUpdateService);
  readonly devSettings = inject(DevSettingsService);
  readonly theme = inject(ThemeService);
  private readonly bugReport = inject(BugReportService);
  private readonly connectionService = inject(ConnectionService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  private readonly shell = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
  /** Whether the desktop app can show the data file in the file manager. */
  readonly canShowFile = typeof this.shell?.showDataFile === 'function';
  /** Whether the desktop app can open its developer tools. */
  readonly canOpenDevTools = typeof this.shell?.openDevTools === 'function';
  readonly dataFile = signal('');
  readonly showFileError = signal('');

  readonly releasesUrl = RELEASES_URL;
  readonly repositoryUrl = REPOSITORY_URL;
  readonly changelogUrl = `${REPOSITORY_URL}/blob/main/CHANGELOG.md`;
  readonly securityReportUrl = `${REPOSITORY_URL}/security/advisories/new`;
  readonly channelName = computed(() => this.updates.channel() === 'beta' ? 'Beta' : 'Stable');
  /** A deb installs through the package manager, which asks for the administrator password, and never on quit. */
  readonly isDeb = computed(() => this.updates.packageType() === 'deb');
  readonly blockerReason = computed(() => {
    const blocker = this.updates.blocker();
    return blocker ? BLOCKER_REASONS[blocker] : null;
  });
  readonly releaseOfVersion = computed(() => {
    const version = this.updates.availableVersion();
    return version ? `${RELEASES_URL}/tag/v${version}` : RELEASES_URL;
  });

  /** The version whose notes are shown: the one the user picked while it is still listed, else the newest. */
  private readonly pickedVersionName = signal<string | null>(null);
  readonly pickedVersion = computed<UpdateVersion | null>(() => {
    const versions = this.updates.versions() ?? [];
    return versions.find(v => v.version === this.pickedVersionName()) ?? versions[0] ?? null;
  });

  constructor() {
    void Promise.resolve(this.shell?.getDataFile?.()).then(file => this.dataFile.set(typeof file === 'string' ? file : ''), () => {});
    void this.updates.loadVersions();
  }

  /** How many lines of long notes are shown before "Show all". */
  readonly notesShort = 4;
  readonly notesOpen = signal(true);
  readonly notesAll = signal(false);
  readonly noteLines = computed(() => (this.pickedVersion()?.notes ?? '').trim().split('\n'));
  readonly notesShown = computed(() => (this.notesAll() ? this.noteLines() : this.noteLines().slice(0, this.notesShort)).join('\n'));

  pickVersion(version: string): void {
    this.notesOpen.set(true);
    this.notesAll.set(false);
    this.pickedVersionName.set(version);
    this.agreedVersion.set(null);
    this.updates.installError.set('');
  }

  /** The version the user agreed to install; the agreement holds only while that version is the one shown. */
  private readonly agreedVersion = signal<string | null>(null);
  readonly agreedToInstall = computed(() => this.agreedVersion() !== null && this.agreedVersion() === this.pickedVersion()?.version);

  agree(version: string, agreed: boolean): void {
    this.agreedVersion.set(agreed ? version : null);
  }

  /** The version found by the check that the user agreed to download and install; it holds only for that version. */
  private readonly agreedUpdate = signal<string | null>(null);
  readonly agreedToUpdate = computed(() => this.agreedUpdate() !== null && this.agreedUpdate() === this.updates.availableVersion());

  agreeToUpdate(agreed: boolean): void {
    this.agreedUpdate.set(agreed ? this.updates.availableVersion() : null);
  }

  downloadUpdate(): void {
    void this.updates.download(this.agreedUpdate());
  }

  releaseOf(version: string): string {
    return `${RELEASES_URL}/tag/v${version}`;
  }

  installPicked(version: string): void {
    if (!this.agreedToInstall()) return;
    void this.updates.installVersion(version);
  }

  async showDataFile(): Promise<void> {
    this.showFileError.set('');
    const result = await Promise.resolve(this.shell?.showDataFile?.()).catch(() => null);
    if (result?.status !== 'ok') {
      this.showFileError.set(result?.message || 'The file could not be shown.');
    }
  }

  openDevTools(): void {
    void Promise.resolve(this.shell?.openDevTools?.()).catch(() => {});
  }

  setChannel(channel: UpdateChannel): void {
    void this.updates.setChannel(channel);
  }

  retry(): void {
    if (this.updates.failedDuring() === 'install') this.updates.install();
    else void this.updates.check();
  }

  openBugReport(type: 'bug' | 'feature'): void {
    this.bugReport.open(type);
  }

  openClearAllData(): void {
    this.dialog.open<ClearAllDataDialogComponent, void, ClearAllDataResult>(ClearAllDataDialogComponent, { width: '560px' })
      .afterClosed()
      .subscribe(result => {
        if (!result) return;
        this.connectionService.refreshStatus();
        this.snackBar.open(result.message, 'Close', { duration: 5000 });
      });
  }
}
