import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

export interface BugReportDialogData {
  type: 'bug' | 'feature';
  version: string;
  platform: string;
  errors: string[];
}

type DialogState = 'form' | 'success' | 'error';

const GITHUB_ISSUES_NEW_URL = 'https://github.com/vitorafgomes/messaging-explorer/issues/new';

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
          <p class="intro">Nothing is sent from the app. Submit opens a new GitHub issue in your browser with the text below filled in; you read it, change it and submit it there.</p>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Title</mat-label>
            <input matInput [(ngModel)]="title" [placeholder]="data.type === 'bug' ? 'Brief description of the issue' : 'Feature name or summary'" required>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Description</mat-label>
            <textarea matInput [(ngModel)]="description" rows="4"
              [placeholder]="data.type === 'bug' ? 'What happened? What did you expect? Steps to reproduce...' : 'Describe the feature and why you need it...'"
              required></textarea>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Your name (optional)</mat-label>
            <input matInput [(ngModel)]="reporter" placeholder="Anonymous">
            <mat-hint>Published with the issue. Leave it empty to add no name.</mat-hint>
          </mat-form-field>

          <div class="included" data-testid="included">
            <h3>What is included, besides what you type</h3>
            <pre class="preview">{{ issueBody() }}</pre>
            <span class="caption">The version, the platform and the errors the app caught in this session ({{ data.errors.length }}). No connection, no namespace, no message body.</span>
          </div>

          <p class="public" role="note">
            <mat-icon aria-hidden="true">warning</mat-icon>
            <span><strong>The issue is public.</strong> Do not paste a connection string, a password or a message body into it.</span>
          </p>
        </mat-dialog-content>

        <mat-dialog-actions align="end">
          <button mat-button mat-dialog-close>Cancel</button>
          <button mat-flat-button
            [disabled]="!title.trim() || !description.trim()"
            (click)="submit()">
            Submit {{ data.type === 'bug' ? 'Bug Report' : 'Feature Request' }}
            <mat-icon iconPositionEnd aria-hidden="true">open_in_new</mat-icon>
          </button>
        </mat-dialog-actions>
      }

      @case ('success') {
        <mat-dialog-content class="center-content">
          <mat-icon class="success-icon">check_circle</mat-icon>
          <h3>Opening GitHub</h3>
          <p>A GitHub Issues page has been opened with your details pre-filled. Review and submit it there.</p>
          <a [href]="issueUrl()" target="_blank" class="issue-link">
            <mat-icon>open_in_new</mat-icon>
            Open on GitHub
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

    .intro {
      margin: 0 0 16px;
      color: var(--mat-sys-on-surface-variant);
    }

    .included {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 8px 0 16px;

      h3 {
        margin: 0;
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .preview {
      margin: 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-small);
      font-family: ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace;
      max-height: 160px;
      overflow-y: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .caption {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .public {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 0;
      padding: 10px 14px;
      border-radius: 8px;
      background: var(--app-warning-container);
      color: var(--app-on-warning-container);
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
      color: var(--app-success);
    }

    .error-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: var(--mat-sys-error);
    }

    .issue-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--mat-sys-primary);
      text-decoration: none;
    }

    .hint {
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface-variant);
    }
  `]
})
export class BugReportDialogComponent {
  data = inject<BugReportDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<BugReportDialogComponent>);
  state = signal<DialogState>('form');
  issueUrl = signal('');
  errorMessage = signal('');

  title = '';
  description = '';
  reporter = '';

  /** The body of the issue exactly as it is posted: the description, then what the app adds. */
  issueBody(): string {
    const bodyParts = [
      this.description.trim(),
      '',
      '---',
      `**Version:** ${this.data.version}`,
      `**Platform:** ${this.data.platform}`,
    ];

    if (this.reporter.trim()) {
      bodyParts.push(`**Reporter:** ${this.reporter.trim()}`);
    }

    if (this.data.errors?.length) {
      bodyParts.push('', '**Errors:**', '```', ...this.data.errors, '```');
    }

    return bodyParts.join('\n');
  }

  async submit() {
    const labels = this.data.type === 'bug' ? 'bug' : 'enhancement';

    const params = new URLSearchParams({
      title: this.title.trim(),
      body: this.issueBody(),
      labels,
    });

    const url = `${GITHUB_ISSUES_NEW_URL}?${params.toString()}`;

    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      this.issueUrl.set(url);
      this.state.set('success');
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to open GitHub Issues');
      this.state.set('error');
    }
  }
}
