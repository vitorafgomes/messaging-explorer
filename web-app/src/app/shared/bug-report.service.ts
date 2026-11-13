import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { BugReportDialogComponent } from './bug-report-dialog.component';
import { AppUpdateService } from '../features/settings/app-update.service';

/** Keeps the last five errors of the window and opens the bug report with them. */
@Injectable({ providedIn: 'root' })
export class BugReportService {
  private readonly dialog = inject(MatDialog);
  private readonly updates = inject(AppUpdateService);
  private readonly lastErrors: string[] = [];
  private capturing = false;

  startCapture(): void {
    if (this.capturing) return;
    this.capturing = true;
    window.addEventListener('error', (event) => {
      const message = event.message?.includes('[object') ? this.formatError(event.error) : event.message;
      this.remember(`${new Date().toISOString()} - ${message} (${event.filename}:${event.lineno})`);
    });
    window.addEventListener('unhandledrejection', (event) => {
      this.remember(`${new Date().toISOString()} - Unhandled: ${this.formatError(event.reason)}`);
    });
  }

  open(type: 'bug' | 'feature'): void {
    const shell = (window as any).electronAPI;
    this.dialog.open(BugReportDialogComponent, {
      width: '520px',
      data: {
        type,
        version: this.updates.version() || 'unknown',
        platform: shell ? (shell.platform || 'unknown') : 'browser',
        errors: [...this.lastErrors],
      },
    });
  }

  private remember(entry: string): void {
    this.lastErrors.push(entry);
    if (this.lastErrors.length > 5) this.lastErrors.shift();
  }

  private formatError(reason: unknown): string {
    if (reason instanceof Error) {
      return `${reason.name}: ${reason.message}`;
    }
    if (typeof reason === 'object' && reason !== null) {
      const r = reason as any;
      if (r.status !== undefined && r.url) {
        return `HTTP ${r.status} ${r.statusText || ''} - ${r.url}`;
      }
      if (r.message) {
        return String(r.message);
      }
      try { return JSON.stringify(reason).substring(0, 300); } catch { /* fall through */ }
    }
    return String(reason);
  }
}
