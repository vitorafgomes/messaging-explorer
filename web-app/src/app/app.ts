import { Component, inject, OnInit, signal, NgZone, ErrorHandler } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AsyncPipe } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ConnectionService, ThemeService, EntitySelectionService, DevSettingsService } from './core/services';
import { DeadLetterNotificationService, DeadLetterAlert } from './core/services/dead-letter-notification.service';
import { BugReportDialogComponent } from './shared/bug-report-dialog.component';

interface NavItem {
  label: string;
  icon: string;
  route: string;
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error' | 'dev-mode';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    AsyncPipe,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatBadgeModule,
    MatTooltipModule,
    MatProgressBarModule,
    MatDividerModule,
    MatDialogModule,
    MatSnackBarModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private connectionService = inject(ConnectionService);
  private router = inject(Router);
  private selectionService = inject(EntitySelectionService);
  private ngZone = inject(NgZone);
  private dialog = inject(MatDialog);

  readonly themeService = inject(ThemeService);
  readonly devSettingsService = inject(DevSettingsService);
  private snackBar = inject(MatSnackBar);
  readonly dlqService = inject(DeadLetterNotificationService);

  connectionStatus$ = this.connectionService.connectionStatus$;
  sidebarOpen = signal(true);

  isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

  // Error capture for bug reports
  private lastErrors: string[] = [];

  // Version & Update
  appVersion = signal('');
  updateStatus = signal<UpdateStatus>('idle');
  updateVersion = signal('');
  downloadPercent = signal(0);
  updateError = signal('');
  updateChannel = signal<'latest' | 'beta'>('latest');

  navItems: NavItem[] = [
    { label: 'Connections', icon: 'link', route: '/connections' },
    { label: 'Entities', icon: 'account_tree', route: '/entities' },
    { label: 'Queues', icon: 'list', route: '/queues' },
    { label: 'Topics', icon: 'forum', route: '/topics' },
    { label: 'Monitoring', icon: 'monitoring', route: '/monitoring' },
  ];

  ngOnInit() {
    this.themeService.initialize();
    this.devSettingsService.initialize();
    this.setupErrorCapture();
    this.setupDevModeShortcut();

    if (this.isElectron) {
      this.setupElectronListeners();
      this.loadVersion();
      this.loadUpdateChannel();
      this.setupUpdateListener();
    }
  }

  private setupDevModeShortcut(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        this.devSettingsService.toggle();
        const state = this.devSettingsService.devMode() ? 'enabled' : 'disabled';
        this.snackBar.open(`Developer mode ${state}`, 'Close', { duration: 2000 });
      }
    });
  }

  private setupErrorCapture() {
    window.addEventListener('error', (event) => {
      const message = event.message?.includes('[object') ? this.formatError(event.error) : event.message;
      this.lastErrors.push(`${new Date().toISOString()} — ${message} (${event.filename}:${event.lineno})`);
      if (this.lastErrors.length > 5) this.lastErrors.shift();
    });
    window.addEventListener('unhandledrejection', (event) => {
      this.lastErrors.push(`${new Date().toISOString()} — Unhandled: ${this.formatError(event.reason)}`);
      if (this.lastErrors.length > 5) this.lastErrors.shift();
    });
  }

  private formatError(reason: unknown): string {
    if (reason instanceof Error) {
      return `${reason.name}: ${reason.message}`;
    }
    if (typeof reason === 'object' && reason !== null) {
      const r = reason as any;
      // HttpErrorResponse
      if (r.status !== undefined && r.url) {
        return `HTTP ${r.status} ${r.statusText || ''} — ${r.url}`;
      }
      // Generic object with message
      if (r.message) {
        return String(r.message);
      }
      try { return JSON.stringify(reason).substring(0, 300); } catch { /* fallthrough */ }
    }
    return String(reason);
  }

  toggleSidebar() {
    this.sidebarOpen.update(v => !v);
  }

  onNotificationClick(alert: DeadLetterAlert) {
    this.router.navigate(['/entities']).then(() => {
      setTimeout(() => {
        this.selectionService.navigateToSubscription(alert.topicName, alert.subscriptionName);
      }, 100);
    });
  }

  openBugReport(type: 'bug' | 'feature') {
    const version = this.appVersion() || 'unknown';
    const platform = this.isElectron ? ((window as any).electronAPI?.platform || 'unknown') : 'browser';

    this.dialog.open(BugReportDialogComponent, {
      width: '520px',
      data: {
        type,
        version,
        platform,
        errors: [...this.lastErrors],
      },
    });
  }

  checkForUpdates() {
    if (!this.isElectron) return;
    const api = (window as any).electronAPI;
    api.checkForUpdates();
  }

  downloadUpdate() {
    if (!this.isElectron) return;
    const api = (window as any).electronAPI;
    api.downloadUpdate();
  }

  installUpdate() {
    if (!this.isElectron) return;
    const api = (window as any).electronAPI;
    api.installUpdate();
  }

  private async loadVersion() {
    const api = (window as any).electronAPI;
    if (api.getAppVersion) {
      const version = await api.getAppVersion();
      this.appVersion.set(version);
    }
  }

  private async loadUpdateChannel() {
    const api = (window as any).electronAPI;
    if (api.getUpdateChannel) {
      const channel = await api.getUpdateChannel();
      this.updateChannel.set(channel === 'beta' ? 'beta' : 'latest');
    }
  }

  async switchChannel(channel: 'latest' | 'beta') {
    if (!this.isElectron) return;
    const api = (window as any).electronAPI;
    if (api.setUpdateChannel) {
      await api.setUpdateChannel(channel);
      this.updateChannel.set(channel);
      this.snackBar.open(`Update channel set to ${channel === 'beta' ? 'Beta' : 'Stable'}`, 'Close', { duration: 3000 });
      // Re-check for updates on the new channel
      this.checkForUpdates();
    }
  }

  private setupUpdateListener() {
    const api = (window as any).electronAPI;
    if (api.onUpdateStatus) {
      api.onUpdateStatus((data: any) => {
        this.ngZone.run(() => {
          this.updateStatus.set(data.status);
          if (data.version) this.updateVersion.set(data.version);
          if (data.percent) this.downloadPercent.set(data.percent);
          if (data.message) this.updateError.set(data.message);
        });
      });
    }
  }

  private setupElectronListeners() {
    const electronAPI = (window as any).electronAPI;

    if (electronAPI.onNavigate) {
      electronAPI.onNavigate((route: string) => {
        this.ngZone.run(() => this.router.navigate([route]));
      });
    }

    if (electronAPI.onChangeConnection) {
      electronAPI.onChangeConnection((connectionId: string) => {
        this.ngZone.run(() => this.connectionService.connect(connectionId).subscribe());
      });
    }

    if (electronAPI.onToggleDevMode) {
      electronAPI.onToggleDevMode(() => {
        this.ngZone.run(() => {
          this.devSettingsService.toggle();
          const state = this.devSettingsService.devMode() ? 'enabled' : 'disabled';
          this.snackBar.open(`Developer mode ${state}`, 'Close', { duration: 2000 });
        });
      });
    }
  }
}
