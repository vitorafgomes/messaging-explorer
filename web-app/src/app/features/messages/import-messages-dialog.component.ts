import { Component, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QueueService, TopicService, MessageImportService } from '../../core/services';
import { SendMessageRequest } from '../../core/models';

export interface ImportMessagesDialogData {
  entityType: 'queue' | 'topic';
  entityName: string;
}

@Component({
  selector: 'app-import-messages-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon fontIcon="upload" aria-hidden="true"></mat-icon>
      <span>Import Messages to {{ data.entityType === 'queue' ? 'Queue' : 'Topic' }}: {{ data.entityName }}</span>
    </h2>

    <mat-dialog-content class="content">
      <div class="file-picker">
        <label for="import-file" class="field-label">Select File</label>
        <input
          id="import-file"
          type="file"
          class="file-input"
          accept=".json,.csv"
          aria-describedby="import-file-hint"
          (change)="onFileSelected($event)">
        <span id="import-file-hint" class="hint">Supported formats: JSON, CSV (exported from this application)</span>
      </div>

      @if (fileName()) {
        <p class="file-info">
          <mat-icon fontIcon="description" aria-hidden="true"></mat-icon>
          <span class="file-name">{{ fileName() }}</span>
          <span class="size">{{ formatFileSize(fileSize()) }}</span>
        </p>
      }

      @if (parseError()) {
        <p class="note error" role="alert">
          <mat-icon fontIcon="error" aria-hidden="true"></mat-icon>
          <span>{{ parseError() }}</span>
        </p>
      }

      @if (parsedMessages().length > 0) {
        <p class="note" role="status">
          <mat-icon fontIcon="check_circle" aria-hidden="true"></mat-icon>
          <span>Parsed <strong>{{ parsedMessages().length }}</strong> message{{ parsedMessages().length > 1 ? 's' : '' }} from file</span>
        </p>

        <div class="preview">
          <table class="preview-table">
            <caption>Preview (first {{ previewMessages().length }} of {{ parsedMessages().length }})</caption>
            <thead>
              <tr>
                <th scope="col" class="num">#</th>
                <th scope="col">Message ID</th>
                <th scope="col">Subject</th>
                <th scope="col">Content Type</th>
                <th scope="col">Body</th>
              </tr>
            </thead>
            <tbody>
              @for (msg of previewMessages(); track $index) {
                <tr>
                  <td class="num">{{ $index + 1 }}</td>
                  <td class="truncate mono" [title]="msg.messageId || ''">{{ msg.messageId || '(auto)' }}</td>
                  <td class="truncate" [title]="msg.subject || ''">{{ msg.subject || '-' }}</td>
                  <td>{{ msg.contentType || '-' }}</td>
                  <td class="truncate mono body" [title]="msg.body">{{ msg.body | slice:0:80 }}{{ msg.body.length > 80 ? '...' : '' }}</td>
                </tr>
              }
            </tbody>
          </table>
          @if (parsedMessages().length > 5) {
            <span class="hint">... and {{ parsedMessages().length - 5 }} more messages</span>
          }
        </div>

        <fieldset class="group">
          <legend>Import Options</legend>
          <mat-checkbox name="generateNewIds" [(ngModel)]="generateNewIds">
            Generate new Message IDs
            <span class="hint block">Replace existing message IDs with new UUIDs</span>
          </mat-checkbox>
          <mat-checkbox name="skipEmpty" [(ngModel)]="skipEmpty">
            Skip messages with empty body
            <span class="hint block">Exclude messages that have no body content</span>
          </mat-checkbox>
        </fieldset>
      }

      @if (importing()) {
        <div class="send-progress" role="status">
          <span>Sending messages...</span>
          <mat-progress-bar mode="determinate" [value]="importProgress()" aria-label="Messages sent"></mat-progress-bar>
          <span class="hint">{{ importedCount() }} of {{ getImportCount() }} sent</span>
        </div>
      }

      @if (importResult()) {
        <p class="note" [class.error]="importResult()!.failures > 0" role="status">
          <mat-icon [fontIcon]="importResult()!.failures === 0 ? 'check_circle' : 'warning'" aria-hidden="true"></mat-icon>
          <span>
            <strong>Import complete:</strong>
            {{ importResult()!.successes }} sent successfully
            @if (importResult()!.failures > 0) {
              , {{ importResult()!.failures }} failed
            }
          </span>
        </p>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>
        {{ importResult() ? 'Close' : 'Cancel' }}
      </button>
      <button mat-flat-button type="button" (click)="importMessages()"
        [disabled]="parsedMessages().length === 0 || importing() || getImportCount() === 0 || !!importResult()">
        @if (importing()) {
          <mat-progress-spinner mode="indeterminate" diameter="18" aria-hidden="true"></mat-progress-spinner>
        } @else {
          <mat-icon fontIcon="upload" aria-hidden="true"></mat-icon>
        }
        Import {{ getImportCount() }} message{{ getImportCount() !== 1 ? 's' : '' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .title { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
    .title mat-icon { flex: none; color: var(--mat-sys-primary); }
    .content { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    p { margin: 0; }
    .file-picker { display: flex; flex-direction: column; gap: 4px; }
    .field-label { font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    .file-input { box-sizing: border-box; max-width: 100%; padding: 8px 12px; border: 1px solid var(--mat-sys-outline); border-radius: 8px; background: var(--mat-sys-surface); color: var(--mat-sys-on-surface); font: var(--mat-sys-body-medium); }
    .hint { font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }
    .block { display: block; }
    .file-info { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--mat-sys-on-surface-variant); }
    .file-name { min-width: 0; overflow-wrap: anywhere; }
    .size { flex: none; padding: 0 8px; border-radius: 999px; background: var(--mat-sys-surface-container-highest); font: var(--mat-sys-label-medium); font-variant-numeric: tabular-nums; }
    .note { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: 8px; background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .note mat-icon { flex: none; }
    .note.error { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .preview { display: flex; flex-direction: column; gap: 4px; min-width: 0; overflow-x: auto; }
    .preview-table { width: 100%; table-layout: fixed; border-collapse: collapse; font: var(--mat-sys-body-small); font-variant-numeric: tabular-nums; }
    caption { padding: 0 0 4px; text-align: start; font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    th { padding: 8px; border-bottom: 1px solid var(--mat-sys-outline); text-align: start; font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    td { padding: 8px; border-bottom: 1px solid var(--mat-sys-outline-variant); vertical-align: top; }
    .num { width: 32px; text-align: end; color: var(--mat-sys-on-surface-variant); }
    .body { width: 40%; }
    .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mono { font-family: ui-monospace, monospace; }
    .group { display: flex; flex-direction: column; gap: 4px; min-width: 0; margin: 0; padding: 0; border: 0; }
    legend { padding: 0 0 4px; font: var(--mat-sys-title-small); }
    .send-progress { display: flex; flex-direction: column; gap: 8px; }
  `]
})
export class ImportMessagesDialogComponent {
  data = inject<ImportMessagesDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<ImportMessagesDialogComponent>);
  private queueService = inject(QueueService);
  private topicService = inject(TopicService);
  private importService = inject(MessageImportService);
  private snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  // State signals
  parsedMessages = signal<SendMessageRequest[]>([]);
  fileName = signal('');
  fileSize = signal(0);
  parseError = signal('');
  importing = signal(false);
  importedCount = signal(0);
  importProgress = signal(0);
  importResult = signal<{ successes: number; failures: number } | null>(null);

  // Options
  generateNewIds = false;
  skipEmpty = false;

  /**
   * Returns the first 5 messages for the preview table.
   */
  previewMessages(): SendMessageRequest[] {
    return this.parsedMessages().slice(0, 5);
  }

  /**
   * Returns the number of messages that will actually be imported
   * (accounting for the skip-empty option).
   */
  getImportCount(): number {
    const messages = this.parsedMessages();
    if (!this.skipEmpty) {
      return messages.length;
    }
    return messages.filter(m => m.body && m.body.trim() !== '').length;
  }

  /**
   * Handles file selection from the file input.
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Reset state
    this.parsedMessages.set([]);
    this.parseError.set('');
    this.importResult.set(null);
    this.importedCount.set(0);
    this.importProgress.set(0);
    this.fileName.set(file.name);
    this.fileSize.set(file.size);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const content = reader.result as string;
        const messages = this.importService.parseFile(content, file.name);
        if (messages.length === 0) {
          this.parseError.set('No messages found in file');
        } else {
          this.parsedMessages.set(messages);
        }
      } catch (e) {
        this.parseError.set(e instanceof Error ? e.message : 'Failed to parse file');
      }
    };
    reader.onerror = () => {
      this.parseError.set('Failed to read file');
    };
    reader.readAsText(file);
  }

  /**
   * Imports parsed messages by sending them to the backend in a batch.
   */
  importMessages(): void {
    let messages = [...this.parsedMessages()];

    if (this.skipEmpty) {
      messages = messages.filter(m => m.body && m.body.trim() !== '');
    }

    if (this.generateNewIds) {
      messages = messages.map(m => ({
        ...m,
        messageId: crypto.randomUUID()
      }));
    }

    if (messages.length === 0) {
      this.snackBar.open('No messages to import', 'Close', { duration: 3000 });
      return;
    }

    this.importing.set(true);
    this.importedCount.set(0);
    this.importProgress.set(0);

    // Use batch send for efficiency
    const sendObservable = this.data.entityType === 'queue'
      ? this.queueService.sendMessages(this.data.entityName, messages)
      : this.topicService.sendMessages(this.data.entityName, messages);

    sendObservable.pipe(
      finalize(() => this.importing.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        this.importedCount.set(result.count ?? messages.length);
        this.importProgress.set(100);
        this.importResult.set({
          successes: result.count ?? messages.length,
          failures: 0
        });
        this.snackBar.open(
          `Successfully imported ${result.count ?? messages.length} messages`,
          'Close',
          { duration: 5000 }
        );
      },
      error: (err) => {
        this.importResult.set({
          successes: 0,
          failures: messages.length
        });
        const errorMsg = err?.error?.message || err?.message || 'Unknown error';
        this.snackBar.open(`Import failed: ${errorMsg}`, 'Close', { duration: 5000 });
      }
    });
  }

  /**
   * Formats a file size in bytes to a human-readable string.
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const exp = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, exp);
    return `${size.toFixed(exp > 0 ? 1 : 0)} ${units[exp]}`;
  }
}
