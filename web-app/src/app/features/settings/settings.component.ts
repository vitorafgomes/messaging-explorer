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
import { ConnectionService, DevSettingsService, ThemeService } from '../../core/services';
import { BugReportService } from '../../shared/bug-report.service';
import { AppUpdateService, RELEASES_URL, REPOSITORY_URL, UpdateChannel } from './app-update.service';
import { ClearAllDataDialogComponent, ClearAllDataResult } from './clear-all-data-dialog.component';

const BLOCKER_REASONS = {
  'macos-unsigned': { platform: 'macOS', reason: 'the build is not signed, and macOS installs an update only into a signed app.' },
  'windows-portable': { platform: 'Windows, portable build', reason: 'there is no installed copy to replace; the file you run is the app.' },
  'linux-package': { platform: 'Linux, installed package', reason: 'only the AppImage replaces itself; a package such as the .deb is updated by installing the new one.' },
} as const;

/** The settings of the app: appearance, updates, data, developer mode and tools, and About. */
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
  readonly blockerReason = computed(() => {
    const blocker = this.updates.blocker();
    return blocker ? BLOCKER_REASONS[blocker] : null;
  });
  readonly releaseOfVersion = computed(() => {
    const version = this.updates.availableVersion();
    return version ? `${RELEASES_URL}/tag/v${version}` : RELEASES_URL;
  });

  constructor() {
    void Promise.resolve(this.shell?.getDataFile?.()).then(file => this.dataFile.set(typeof file === 'string' ? file : ''), () => {});
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
    if (this.updates.failedDuring() === 'download') {
      void this.updates.download();
    } else {
      void this.updates.check();
    }
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
