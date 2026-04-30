import { Component, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QueueService, TopicService, ThemeService, MessageImportService } from '../../core/services';
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
    MatDialogModule,
    MatSnackBarModule
  ],
  host: {
    '[class.dark-mode-dialog]': 'themeService.isDark()'
  },
  template: `
    <div class="modal-header" [class.bg-dark]="themeService.isDark()" [class.text-light]="themeService.isDark()">
      <h5 class="modal-title d-flex align-items-center gap-2" [class.text-light]="themeService.isDark()">
        <i class="fa fa-upload text-primary"></i>
        Import Messages to {{ data.entityType === 'queue' ? 'Queue' : 'Topic' }}: {{ data.entityName }}
      </h5>
    </div>

    <div class="modal-body" [class.bg-dark]="themeService.isDark()" [class.text-light]="themeService.isDark()">
      <!-- File Picker -->
      <div class="file-picker-area mb-3">
        <label class="form-label d-flex align-items-center gap-2">
          <i class="fa fa-file text-muted"></i>
          Select File
        </label>
        <div class="input-group">
          <input
            type="file"
            class="form-control"
            accept=".json,.csv"
            (change)="onFileSelected($event)"
            #fileInput>
        </div>
        <small class="form-text text-muted">Supported formats: JSON, CSV (exported from this application)</small>
      </div>

      <!-- File Info -->
      @if (fileName()) {
        <div class="file-info mb-3">
          <div class="d-flex align-items-center gap-2 text-muted">
            <i class="fa fa-file-text"></i>
            <span>{{ fileName() }}</span>
            <span class="badge bg-secondary">{{ formatFileSize(fileSize()) }}</span>
          </div>
        </div>
      }

      <!-- Parse Error -->
      @if (parseError()) {
        <div class="alert alert-danger d-flex align-items-center gap-2 mb-3" role="alert">
          <i class="fa fa-exclamation-triangle"></i>
          <div>{{ parseError() }}</div>
        </div>
      }

      <!-- Parsed Messages Preview -->
      @if (parsedMessages().length > 0) {
        <div class="parse-summary mb-3">
          <div class="alert alert-success d-flex align-items-center gap-2" role="alert">
            <i class="fa fa-check-circle"></i>
            <div>Parsed <strong>{{ parsedMessages().length }}</strong> message{{ parsedMessages().length > 1 ? 's' : '' }} from file</div>
          </div>
        </div>

        <!-- Preview Table -->
        <div class="preview-section mb-3">
          <label class="form-label d-flex align-items-center gap-2">
            <i class="fa fa-table text-muted"></i>
            Preview (first {{ previewMessages().length }} of {{ parsedMessages().length }})
          </label>
          <div class="table-responsive">
            <table class="table table-sm table-bordered preview-table" [class.table-dark]="themeService.isDark()">
              <thead>
                <tr>
                  <th style="width: 40px">#</th>
                  <th style="width: 180px">Message ID</th>
                  <th style="width: 140px">Subject</th>
                  <th style="width: 120px">Content Type</th>
                  <th>Body</th>
                </tr>
              </thead>
              <tbody>
                @for (msg of previewMessages(); track $index) {
                  <tr>
                    <td class="text-muted">{{ $index + 1 }}</td>
                    <td class="text-truncate" style="max-width: 180px" [title]="msg.messageId || ''">
                      {{ msg.messageId || '(auto)' }}
                    </td>
                    <td class="text-truncate" style="max-width: 140px" [title]="msg.subject || ''">
                      {{ msg.subject || '-' }}
                    </td>
                    <td>{{ msg.contentType || '-' }}</td>
                    <td class="text-truncate font-monospace" style="max-width: 300px" [title]="msg.body">
                      {{ msg.body | slice:0:80 }}{{ msg.body.length > 80 ? '...' : '' }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (parsedMessages().length > 5) {
            <small class="text-muted">... and {{ parsedMessages().length - 5 }} more messages</small>
          }
        </div>

        <!-- Import Options -->
        <div class="import-options mb-3">
          <label class="form-label d-flex align-items-center gap-2">
            <i class="fa fa-cog text-muted"></i>
            Import Options
          </label>
          <div class="d-flex flex-column gap-2">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="generateNewIds" [(ngModel)]="generateNewIds">
              <label class="form-check-label" for="generateNewIds">
                Generate new Message IDs
                <small class="d-block text-muted">Replace existing message IDs with new UUIDs</small>
              </label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="skipEmpty" [(ngModel)]="skipEmpty">
              <label class="form-check-label" for="skipEmpty">
                Skip messages with empty body
                <small class="d-block text-muted">Exclude messages that have no body content</small>
              </label>
            </div>
          </div>
        </div>
      }

      <!-- Import Progress -->
      @if (importing()) {
        <div class="import-progress mb-3">
          <div class="d-flex align-items-center gap-2 mb-2">
            <span class="spinner-border spinner-border-sm text-primary"></span>
            <span>Sending messages...</span>
          </div>
          <div class="progress" style="height: 6px;">
            <div class="progress-bar progress-bar-striped progress-bar-animated"
              [style.width.%]="importProgress()">
            </div>
          </div>
          <small class="text-muted">{{ importedCount() }} of {{ getImportCount() }} sent</small>
        </div>
      }

      <!-- Import Result -->
      @if (importResult()) {
        <div class="alert" [class.alert-success]="importResult()!.failures === 0" [class.alert-warning]="importResult()!.failures > 0" role="alert">
          <div class="d-flex align-items-center gap-2">
            <i class="fa" [class.fa-check-circle]="importResult()!.failures === 0" [class.fa-exclamation-triangle]="importResult()!.failures > 0"></i>
            <div>
              <strong>Import complete:</strong>
              {{ importResult()!.successes }} sent successfully
              @if (importResult()!.failures > 0) {
                , {{ importResult()!.failures }} failed
              }
            </div>
          </div>
        </div>
      }
    </div>

    <div class="modal-footer" [class.bg-dark]="themeService.isDark()">
      <button class="btn btn-secondary" mat-dialog-close>
        {{ importResult() ? 'Close' : 'Cancel' }}
      </button>
      <button class="btn btn-primary" (click)="importMessages()"
        [disabled]="parsedMessages().length === 0 || importing() || getImportCount() === 0 || !!importResult()">
        @if (importing()) {
          <span class="spinner-border spinner-border-sm me-2"></span>
        } @else {
          <i class="fa fa-upload me-2"></i>
        }
        Import {{ getImportCount() }} message{{ getImportCount() !== 1 ? 's' : '' }}
      </button>
    </div>
  `,
  styles: [`
    .modal-header {
      border-bottom: 1px solid var(--bs-border-color);
      padding: 16px 24px;
    }

    .modal-title {
      margin: 0;
      font-size: 18px;
      font-weight: 500;
      color: var(--bs-body-color);

      i {
        font-size: 20px;
      }
    }

    .modal-body {
      padding: 24px;
      min-width: 600px;
      max-height: 70vh;
      overflow-y: auto;
    }

    .modal-footer {
      border-top: 1px solid var(--bs-border-color);
      padding: 16px 24px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .preview-table {
      font-size: 13px;
      margin-bottom: 4px;

      th {
        font-weight: 600;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--bs-secondary-color);
      }

      td {
        vertical-align: middle;
      }

      .font-monospace {
        font-size: 12px;
      }
    }

    .file-info {
      padding: 8px 12px;
      border-radius: 6px;
      background-color: var(--bs-tertiary-bg);
    }

    .import-options {
      padding: 12px;
      border-radius: 6px;
      background-color: var(--bs-tertiary-bg);
    }

    .import-progress {
      padding: 12px;
      border-radius: 6px;
      background-color: var(--bs-tertiary-bg);
    }
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
  protected themeService = inject(ThemeService);

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
