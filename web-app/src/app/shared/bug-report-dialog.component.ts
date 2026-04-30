import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface BugReportDialogData {
  type: 'bug' | 'feature';
  version: string;
  platform: string;
  errors: string[];
}

type DialogState = 'form' | 'sending' | 'success' | 'error';

const BUG_REPORTER_URL = 'https://messaging-explorer-bug-reporter.vitorafgomes.workers.dev/api/report';

@Component({
  selector: 'app-bug-report-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
  ],
  template: `
    @switch (state()) {
      @case ('form') {
        <h2 mat-dialog-title class="dialog-title">
          <mat-icon [color]="data.type === 'bug' ? 'warn' : 'primary'">
            {{ data.type === 'bug' ? 'bug_report' : 'lightbulb' }}
          </mat-icon>
          {{ data.type === 'bug' ? 'Report a Bug' : 'Suggest a Feature' }}
        </h2>

        <mat-dialog-content>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Title</mat-label>
            <input matInput [(ngModel)]="title" [placeholder]="data.type === 'bug' ? 'Brief description of the issue' : 'Feature name or summary'" required>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Description</mat-label>
            <textarea matInput [(ngModel)]="description" rows="6"
              [placeholder]="data.type === 'bug' ? 'What happened? What did you expect? Steps to reproduce...' : 'Describe the feature and why you need it...'"
              required></textarea>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Your name (optional)</mat-label>
            <input matInput [(ngModel)]="reporter" placeholder="Anonymous">
          </mat-form-field>

          @if (data.errors.length > 0) {
            <div class="error-preview">
              <div class="error-header">
                <mat-icon color="warn">error_outline</mat-icon>
                <span>{{ data.errors.length }} error(s) captured — will be included automatically</span>
              </div>
              <pre class="error-log">{{ data.errors.join('\\n') }}</pre>
            </div>
          }

          <div class="meta-info">
            <span><mat-icon>info</mat-icon> v{{ data.version }} · {{ data.platform }}</span>
          </div>
        </mat-dialog-content>

        <mat-dialog-actions align="end">
          <button mat-stroked-button mat-dialog-close>Cancel</button>
          <button mat-flat-button [color]="data.type === 'bug' ? 'warn' : 'primary'"
            [disabled]="!title.trim() || !description.trim()"
            (click)="submit()">
            <mat-icon>send</mat-icon>
            Submit {{ data.type === 'bug' ? 'Bug Report' : 'Feature Request' }}
          </button>
        </mat-dialog-actions>
      }

      @case ('sending') {
        <mat-dialog-content class="center-content">
          <mat-spinner diameter="48"></mat-spinner>
          <p>Submitting to GitHub...</p>
        </mat-dialog-content>
      }

      @case ('success') {
        <mat-dialog-content class="center-content">
          <mat-icon class="success-icon">check_circle</mat-icon>
          <h3>Issue Created!</h3>
          <p>Issue #{{ issueNumber() }} has been created.</p>
          <a [href]="issueUrl()" target="_blank" class="issue-link">
            <mat-icon>open_in_new</mat-icon>
            View on GitHub
          </a>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-flat-button color="primary" mat-dialog-close>Close</button>
        </mat-dialog-actions>
      }

      @case ('error') {
        <mat-dialog-content class="center-content">
          <mat-icon class="error-icon">error</mat-icon>
          <h3>Submission Failed</h3>
          <p>{{ errorMessage() }}</p>
          <p class="hint">You can still report manually via GitHub.</p>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-stroked-button mat-dialog-close>Close</button>
          <button mat-flat-button color="primary" (click)="submit()">Retry</button>
        </mat-dialog-actions>
      }
    }
  `,
  styles: [`
    .dialog-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .full-width {
      width: 100%;
      margin-bottom: 4px;
    }

    mat-dialog-content {
      min-width: 400px;
    }

    .error-preview {
      background: rgba(244, 67, 54, 0.08);
      border: 1px solid rgba(244, 67, 54, 0.2);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 16px;
    }

    .error-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      margin-bottom: 8px;
    }

    .error-log {
      font-family: monospace;
      font-size: 0.75rem;
      max-height: 100px;
      overflow-y: auto;
      margin: 0;
      opacity: 0.7;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .meta-info {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 0.8rem;
      opacity: 0.5;
      margin-bottom: 8px;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }

    .center-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 32px 48px;
      text-align: center;
    }

    .success-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: #4caf50;
    }

    .error-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: #f44336;
    }

    .issue-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: inherit;
      text-decoration: none;
      opacity: 0.8;

      &:hover { opacity: 1; }
    }

    .hint {
      font-size: 0.85rem;
      opacity: 0.6;
    }
  `]
})
export class BugReportDialogComponent {
  data = inject<BugReportDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<BugReportDialogComponent>);
  private http = inject(HttpClient);

  state = signal<DialogState>('form');
  issueNumber = signal(0);
  issueUrl = signal('');
  errorMessage = signal('');

  title = '';
  description = '';
  reporter = '';

  async submit() {
    this.state.set('sending');

    const payload = {
      type: this.data.type,
      title: this.title.trim(),
      description: this.description.trim(),
      version: this.data.version,
      platform: this.data.platform,
      errors: this.data.errors,
      reporter: this.reporter.trim() || undefined,
    };

    try {
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; issueNumber: number; issueUrl: string }>(
          BUG_REPORTER_URL,
          payload
        )
      );

      this.issueNumber.set(response.issueNumber);
      this.issueUrl.set(response.issueUrl);
      this.state.set('success');
    } catch (err: any) {
      this.errorMessage.set(err?.error?.error || err?.message || 'Unknown error');
      this.state.set('error');
    }
  }
}
