import { Component, computed, effect, inject, OnInit, NgZone, HostListener, signal, DestroyRef, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, exhaustMap, filter, map, merge, of, switchMap, take, takeUntil, timer } from 'rxjs';
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
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ConnectionService, ConnectionGroupService, ThemeService, EntitySelectionService, DevSettingsService, ResubmitRunService } from './core/services';
import { AppLogService } from './core/services/app-log.service';
import { DeadLetterNotificationService, DeadLetterAlert } from './core/services/dead-letter-notification.service';
import { BugReportService } from './shared/bug-report.service';
import { AppUpdateService } from './features/settings/app-update.service';
import { McpRequest, McpSettingsService } from './features/settings/mcp-settings.service';
import { McpRequestDialogComponent, McpRequestOutcome } from './features/settings/mcp-request-dialog.component';
import { McpAppSettingsService } from './features/settings/mcp-app-settings.service';
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
  /** How many resubmits run; the desktop shell is told each change, so quitting asks first while one runs. */
  private readonly activeRunCount = computed(() => this.runs.activeRuns().length);

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
  /** The MCP server: its mark is on the toolbar only while it is enabled; a failed read leaves the mark off, and Settings says why. */
  readonly mcp = inject(McpSettingsService);
  private readonly bugReport = inject(BugReportService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  /** Whether the API answered 404 to GET mcp/requests: it cannot ask the user, so nothing is polled again. */
  private readonly requestsAbsent = signal(false);
  /** The app asks the user while the server is enabled and the API can wait for an answer. */
  private readonly asking = computed(() => {
    const state = this.mcp.state();
    return !!state?.enabled && !!state.supports?.confirmation && !this.requestsAbsent();
  });
  private readonly appSettings = inject(McpAppSettingsService);
  /** Whether the API answered 404 to GET mcp/app-requests: it cannot change settings of this app, so nothing is polled again. */
  private readonly appRequestsAbsent = signal(false);
  /** The app applies what an assistant asked of its settings while the server is enabled and the user allowed it. */
  private readonly applying = computed(() => {
    const state = this.mcp.state();
    return !!state?.enabled && !!state.supports?.appSettings && !!state.appSettingsAllowed && !this.appRequestsAbsent();
  });
  /** The request whose dialog is open; one at a time. */
  private openRequest: { id: string; ref: MatDialogRef<McpRequestDialogComponent, McpRequestOutcome> } | null = null;
  /** The requests already shown and still listed by the API, which a later poll never opens again. */
  private readonly shown = new Set<string>();

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

  /**
   * Polls the waiting requests every 2 seconds while asking, one GET in flight at a time; a failed poll waits for the
   * next tick and shows nothing. Polling stops when the server is turned off and when the app is destroyed.
   * The changes of a setting of this app are polled on their own 2 second tick while applying, and each tick waits
   * until the list it read is applied.
   */
  constructor() {
    effect(() => {
      const count = this.activeRunCount();
      untracked(() => (window as any).electronAPI?.setActiveRuns?.(count));
    });
    this.destroyRef.onDestroy(() => this.openRequest?.ref.close());
    toObservable(this.asking).pipe(
      switchMap(on => {
        if (!on) { this.openRequest?.ref.close('gone'); return EMPTY; }
        return timer(0, 2000).pipe(exhaustMap(() => this.mcp.requests().pipe(catchError((error: { status?: number }) => {
          if (error?.status === 404) this.requestsAbsent.set(true);
          return EMPTY;
        }))));
      }),
      takeUntilDestroyed(),
    ).subscribe(list => this.showRequest(list));
    toObservable(this.applying).pipe(
      switchMap(on => on ? timer(0, 2000) : EMPTY),
      exhaustMap(() => this.mcp.appRequests().pipe(
        switchMap(list => this.appSettings.apply(list)),
        catchError((error: { status?: number }) => {
          if (error?.status === 404) this.appRequestsAbsent.set(true);
          return EMPTY;
        }))),
      takeUntilDestroyed(),
    ).subscribe();
  }

  ngOnInit() {
    this.themeService.initialize();
    this.devSettingsService.initialize();
    this.bugReport.startCapture();
    this.mcp.load().subscribe({ error: () => {} });

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

  /** Closes the open dialog when its request left the list; otherwise opens the oldest request not shown yet. */
  private showRequest(list: McpRequest[]): void {
    for (const id of this.shown) if (!list.some(r => r.id === id)) this.shown.delete(id);
    const open = this.openRequest;
    if (open) {
      if (!list.some(r => r.id === open.id)) open.ref.close('gone');
      return;
    }
    const next = list.filter(r => !this.shown.has(r.id)).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))[0];
    if (!next) return;
    this.shown.add(next.id);
    const ref = this.dialog.open<McpRequestDialogComponent, McpRequest, McpRequestOutcome>(McpRequestDialogComponent, { ...McpRequestDialogComponent.config, data: next });
    this.openRequest = { id: next.id, ref };
    const before = this.connectionService.currentConnectionId;
    ref.beforeClosed().subscribe(outcome => {
      if (this.openRequest?.ref === ref) this.openRequest = null;
      if (outcome === 'gone') this.snackBar.open('The request is no longer waiting.', 'Close', { duration: 5000 });
      if (outcome === 'allowed' && next.kind === 'connect') this.followConnect(before);
    });
  }

  /**
   * After the user allowed an assistant to connect, reads the connection status once a second, without publishing it,
   * until it names another connection than <code>before</code> or 15 seconds pass; the changed status is then published
   * once, so every screen follows the switch without a reload and none reloads while nothing changed.
   */
  private followConnect(before: string | null): void {
    timer(0, 1000).pipe(
      exhaustMap(() => this.connectionService.peekStatus().pipe(catchError(() => EMPTY))),
      filter(status => (status.connected ? status.connectionId ?? null : null) !== before),
      take(1),
      takeUntil(timer(15_000)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.connectionService.refreshStatus());
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
