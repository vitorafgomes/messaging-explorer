import { Component, computed, inject, OnInit, NgZone, HostListener } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, merge, of, switchMap } from 'rxjs';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AsyncPipe } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ConnectionService, ConnectionGroupService, ThemeService, EntitySelectionService, DevSettingsService, ResubmitRunService } from './core/services';
import { AppLogService } from './core/services/app-log.service';
import { DeadLetterNotificationService, DeadLetterAlert } from './core/services/dead-letter-notification.service';
import { BugReportService } from './shared/bug-report.service';
import { AppUpdateService } from './features/settings/app-update.service';
import { ResubmitRunIndicatorComponent, runPercent, runSummary } from './features/messages/resubmit-run-indicator.component';
import { EnvironmentChipComponent } from './shared/environment-chip.component';
import { readConnectionContext } from './features/entities/connection-context';

interface NavItem {
  label: string;
  route: string;
  /** The screen shows a broker, so it opens only while a connection is active. */
  needsConnection?: boolean;
}

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    AsyncPipe,
    MatToolbarModule,
    MatSidenavModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatBadgeModule,
    MatTooltipModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatDialogModule,
    MatSnackBarModule,
    ResubmitRunIndicatorComponent,
    EnvironmentChipComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private connectionService = inject(ConnectionService);
  private groupService = inject(ConnectionGroupService);
  private router = inject(Router);
  private selectionService = inject(EntitySelectionService);
  private ngZone = inject(NgZone);

  readonly themeService = inject(ThemeService);
  readonly devSettingsService = inject(DevSettingsService);
  private snackBar = inject(MatSnackBar);
  readonly dlqService = inject(DeadLetterNotificationService);
  readonly runs = inject(ResubmitRunService);
  readonly runPercent = runPercent;

  connectionStatus$ = this.connectionService.connectionStatus$;
  /** Whether a connection is active, for the links that need one. */
  readonly connected = toSignal(this.connectionStatus$.pipe(map(status => status.connected)), { initialValue: false });

  /**
   * The active connection's environment for the toolbar chip, read again on every connect and
   * disconnect and after a connection or a group is saved; null while disconnected.
   */
  readonly environment = toSignal(merge(this.connectionStatus$, this.groupService.changed$, this.connectionService.saved$).pipe(
    switchMap(() => this.connectionService.isConnected ? readConnectionContext(this.connectionService, this.groupService) : of(null))));

  isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

  readonly updates = inject(AppUpdateService);
  private readonly bugReport = inject(BugReportService);

  /** The Logs screen and its item on the toolbar exist only while Developer mode is on. */
  readonly devMode = this.devSettingsService.devMode;
  readonly logs = inject(AppLogService);

  navItems: NavItem[] = [
    { label: 'Connections', route: '/connections' },
    { label: 'Entities', route: '/entities', needsConnection: true },
    { label: 'Monitoring', route: '/monitoring', needsConnection: true },
  ];

  /** The name of the Notifications button: the resubmit run while one is active, else how many subscriptions hold dead-letter messages. */
  readonly notificationsLabel = computed(() => {
    const active = this.runs.activeRuns();
    if (active.length === 1) return `Notifications: ${runSummary(active[0])}`;
    if (active.length > 1) return `Notifications: ${active.length} resubmit runs`;
    const count = this.dlqService.alertCount();
    if (count === 0) return 'Notifications';
    return `Notifications: ${count} subscription${count === 1 ? '' : 's'} with dead-letter messages`;
  });

  ngOnInit() {
    this.themeService.initialize();
    this.devSettingsService.initialize();
    this.bugReport.startCapture();

    if (this.isElectron) {
      this.setupElectronListeners();
      void this.updates.initialize();
    }
  }

  /** Ctrl+Shift+D, or Cmd+Shift+D on a Mac, toggles developer mode. */
  @HostListener('window:keydown', ['$event'])
  onDevModeShortcut(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.devSettingsService.toggle();
      const state = this.devSettingsService.devMode() ? 'enabled' : 'disabled';
      this.snackBar.open(`Developer mode ${state}`, 'Close', { duration: 2000 });
    }
  }

  onNotificationClick(alert: DeadLetterAlert) {
    this.router.navigate(['/entities']).then(() => {
      setTimeout(() => {
        this.selectionService.navigateToSubscription(alert.topicName, alert.subscriptionName);
      }, 100);
    });
  }

  openBugReport(type: 'bug' | 'feature') {
    this.bugReport.open(type);
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
  }
}
