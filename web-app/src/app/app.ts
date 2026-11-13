import { Component, inject, OnInit, NgZone, HostListener } from '@angular/core';
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
import { MatDividerModule } from '@angular/material/divider';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ConnectionService, ThemeService, EntitySelectionService, DevSettingsService } from './core/services';
import { DeadLetterNotificationService, DeadLetterAlert } from './core/services/dead-letter-notification.service';
import { BugReportService } from './shared/bug-report.service';
import { AppUpdateService } from './features/settings/app-update.service';
import { ResubmitRunIndicatorComponent } from './features/messages/resubmit-run-indicator.component';

interface NavItem {
  label: string;
  route: string;
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
    MatDividerModule,
    MatDialogModule,
    MatSnackBarModule,
    ResubmitRunIndicatorComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private connectionService = inject(ConnectionService);
  private router = inject(Router);
  private selectionService = inject(EntitySelectionService);
  private ngZone = inject(NgZone);

  readonly themeService = inject(ThemeService);
  readonly devSettingsService = inject(DevSettingsService);
  private snackBar = inject(MatSnackBar);
  readonly dlqService = inject(DeadLetterNotificationService);

  connectionStatus$ = this.connectionService.connectionStatus$;

  isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

  readonly updates = inject(AppUpdateService);
  private readonly bugReport = inject(BugReportService);

  navItems: NavItem[] = [
    { label: 'Connections', route: '/connections' },
    { label: 'Entities', route: '/entities' },
    { label: 'Queues', route: '/queues' },
    { label: 'Topics', route: '/topics' },
    { label: 'Monitoring', route: '/monitoring' },
  ];

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
