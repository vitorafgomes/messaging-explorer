import { Component, inject, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { QueueService, TopicService } from '../../core/services';
import { BatchOperationResult } from '../../core/models';

export interface ContinuousResubmitDialogData {
  entityType: 'queue' | 'subscription';
  entityName: string;
  topicName?: string;
  deadLetterMessageCount?: number;
}

export interface ContinuousResubmitResult {
  totalProcessed: number;
  totalSuccess: number;
  totalFailure: number;
  stopped: boolean;
  completed: boolean;
}

type DialogState = 'config' | 'running' | 'finished';

@Component({
  selector: 'app-continuous-resubmit-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule],
  host: {
    '[class.dark-mode-dialog]': 'isDarkMode()'
  },
  template: `
    <div class="modal-header" [class.bg-dark]="isDarkMode()" [class.text-light]="isDarkMode()">
      <h5 class="modal-title d-flex align-items-center gap-2" [class.text-light]="isDarkMode()">
        <i class="fa fa-repeat text-success"></i>
        Auto Resubmit Dead Letters
      </h5>
    </div>

    <div class="modal-body" [class.bg-dark]="isDarkMode()" [class.text-light]="isDarkMode()">
      <!-- CONFIG STATE -->
      @if (state() === 'config') {
        <div class="config-section">
          <p class="mb-3" [class.text-light]="isDarkMode()">
            This will continuously resubmit dead letter messages in batches until the queue is empty or you stop the process.
          </p>

          @if (data.entityType === 'subscription') {
            <div class="alert alert-warning mb-3">
              <i class="fa fa-info-circle me-2"></i>
              Messages will be sent to the topic and will pass through all subscription filters.
              If this subscription has filters configured, messages may not return to it.
            </div>
          }

          <div class="mb-3">
            <label class="form-label fw-medium">Batch Size</label>
            <input
              type="number"
              class="form-control"
              [(ngModel)]="batchSize"
              min="1"
              max="500"
              style="max-width: 200px;">
            <div class="form-text">
              Number of messages to process per cycle (1-500).
            </div>
          </div>

          @if (data.deadLetterMessageCount != null && data.deadLetterMessageCount > 0) {
            <div class="alert alert-info mb-0">
              <i class="fa fa-info-circle me-2"></i>
              Approximately <strong>{{ data.deadLetterMessageCount }}</strong> dead letter messages in queue.
            </div>
          }
        </div>
      }

      <!-- RUNNING STATE -->
      @if (state() === 'running' || state() === 'finished') {
        <div class="progress-section">
          <!-- Stats -->
          <div class="stats-grid mb-3">
            <div class="stat-card">
              <div class="stat-value">{{ currentBatch() }}</div>
              <div class="stat-label">Batch</div>
            </div>
            <div class="stat-card">
              <div class="stat-value text-primary">{{ totalProcessed() }}</div>
              <div class="stat-label">Processed</div>
            </div>
            <div class="stat-card">
              <div class="stat-value text-success">{{ totalSuccess() }}</div>
              <div class="stat-label">Success</div>
            </div>
            <div class="stat-card">
              <div class="stat-value text-danger">{{ totalFailure() }}</div>
              <div class="stat-label">Failed</div>
            </div>
          </div>

          <!-- Progress Bar -->
          @if (data.deadLetterMessageCount != null && data.deadLetterMessageCount > 0) {
            <div class="mb-3">
              <div class="d-flex justify-content-between mb-1">
                <small>Overall Progress</small>
                <small>{{ getOverallPercentage() }}%</small>
              </div>
              <div class="progress" style="height: 20px;">
                <div
                  class="progress-bar progress-bar-striped"
                  [class.progress-bar-animated]="state() === 'running'"
                  [class.bg-success]="state() === 'finished' && totalFailure() === 0"
                  [class.bg-warning]="state() === 'finished' && totalFailure() > 0"
                  role="progressbar"
                  [style.width.%]="getOverallPercentage()">
                </div>
              </div>
            </div>
          }

          <!-- Current Status -->
          <div class="status-bar" [class.text-light]="isDarkMode()">
            @if (state() === 'running') {
              <i class="fa fa-spinner fa-spin me-2"></i>
              <span>{{ statusMessage() }}</span>
            } @else if (stoppedByUser()) {
              <i class="fa fa-stop-circle text-warning me-2"></i>
              <span class="text-warning">Stopped by user</span>
            } @else if (stoppedByError()) {
              <i class="fa fa-exclamation-circle text-danger me-2"></i>
              <span class="text-danger">Stopped: entire batch failed</span>
            } @else {
              <i class="fa fa-check-circle text-success me-2"></i>
              <span class="text-success">Completed - Dead letter queue is empty</span>
            }
          </div>

          <!-- Batch Log -->
          @if (batchLog().length > 0) {
            <div class="batch-log mt-3">
              <label class="form-label fw-medium mb-2">Batch Log</label>
              <div class="log-container">
                @for (entry of batchLog(); track entry.batch) {
                  <div class="log-entry" [class.log-error]="entry.successCount === 0 && entry.failureCount > 0">
                    <span class="log-batch">#{{ entry.batch }}</span>
                    <span class="log-detail">
                      {{ entry.peeked }} peeked,
                      <span class="text-success">{{ entry.successCount }} ok</span>
                      @if (entry.failureCount > 0) {
                        , <span class="text-danger">{{ entry.failureCount }} failed</span>
                      }
                    </span>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>

    <div class="modal-footer" [class.bg-dark]="isDarkMode()">
      @if (state() === 'config') {
        <button class="btn btn-secondary" mat-dialog-close>Cancel</button>
        <button class="btn btn-success" (click)="start()" [disabled]="batchSize < 1 || batchSize > 500">
          <i class="fa fa-play me-2"></i>
          Start
        </button>
      } @else if (state() === 'running') {
        <button class="btn btn-warning" (click)="stop()">
          <i class="fa fa-stop me-2"></i>
          Stop
        </button>
      } @else {
        <button class="btn btn-primary" (click)="close()">
          <i class="fa fa-check me-2"></i>
          Close
        </button>
      }
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

      i { font-size: 20px; }
    }

    .modal-body {
      padding: 24px;
      min-width: 520px;

      p { color: var(--bs-secondary-color); }
    }

    .modal-footer {
      border-top: 1px solid var(--bs-border-color);
      padding: 16px 24px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }

    .stat-card {
      text-align: center;
      padding: 12px 8px;
      border-radius: 8px;
      border: 1px solid var(--bs-border-color);
      background: var(--bs-light, #f8f9fa);
    }

    .stat-value {
      font-size: 24px;
      font-weight: 700;
      line-height: 1.2;
    }

    .stat-label {
      font-size: 12px;
      text-transform: uppercase;
      color: var(--bs-secondary-color);
      font-weight: 500;
      margin-top: 4px;
    }

    .status-bar {
      text-align: center;
      padding: 12px;
      background: var(--bs-light, #f8f9fa);
      border-radius: 6px;
      font-size: 0.95rem;
    }

    .batch-log {
      .log-container {
        max-height: 200px;
        overflow-y: auto;
        border: 1px solid var(--bs-border-color);
        border-radius: 6px;
        padding: 8px;
        font-size: 0.85rem;
        font-family: monospace;
      }

      .log-entry {
        padding: 4px 8px;
        border-radius: 4px;

        &:nth-child(odd) {
          background: var(--bs-light, rgba(0,0,0,0.02));
        }

        &.log-error {
          background: rgba(220, 53, 69, 0.1);
        }
      }

      .log-batch {
        font-weight: 600;
        margin-right: 8px;
        min-width: 30px;
        display: inline-block;
      }
    }

    .progress {
      border-radius: 6px;
      background-color: var(--bs-secondary-bg);
    }

    :host.dark-mode-dialog {
      .stat-card, .status-bar {
        background-color: var(--bs-dark);
      }
    }
  `]
})
export class ContinuousResubmitDialogComponent implements OnDestroy {
  data = inject<ContinuousResubmitDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<ContinuousResubmitDialogComponent>);
  private queueService = inject(QueueService);
  private topicService = inject(TopicService);

  batchSize = 10;

  state = signal<DialogState>('config');
  currentBatch = signal(0);
  totalProcessed = signal(0);
  totalSuccess = signal(0);
  totalFailure = signal(0);
  statusMessage = signal('Starting...');
  stoppedByUser = signal(false);
  stoppedByError = signal(false);

  batchLog = signal<Array<{
    batch: number;
    peeked: number;
    successCount: number;
    failureCount: number;
  }>>([]);

  private shouldStop = false;

  ngOnDestroy(): void {
    this.shouldStop = true;
  }

  isDarkMode(): boolean {
    if (typeof document === 'undefined') return false;
    const bsTheme = document.documentElement.getAttribute('data-bs-theme');
    const hasThemeDark = document.body.classList.contains('theme-dark');
    return bsTheme === 'dark' || hasThemeDark;
  }

  getOverallPercentage(): number {
    const total = this.data.deadLetterMessageCount;
    if (!total || total === 0) return 0;
    return Math.min(100, Math.round((this.totalSuccess() / total) * 100));
  }

  async start(): Promise<void> {
    this.state.set('running');
    this.dialogRef.disableClose = true;
    this.shouldStop = false;

    try {
      await this.runLoop();
    } catch (err) {
      console.error('Continuous resubmit error:', err);
      this.statusMessage.set('Unexpected error occurred');
    }

    this.state.set('finished');
    this.dialogRef.disableClose = false;
  }

  stop(): void {
    this.shouldStop = true;
    this.stoppedByUser.set(true);
    this.statusMessage.set('Stopping...');
  }

  close(): void {
    const result: ContinuousResubmitResult = {
      totalProcessed: this.totalProcessed(),
      totalSuccess: this.totalSuccess(),
      totalFailure: this.totalFailure(),
      stopped: this.stoppedByUser(),
      completed: !this.stoppedByUser() && !this.stoppedByError()
    };
    this.dialogRef.close(result);
  }

  private async runLoop(): Promise<void> {
    let batchNum = 0;

    while (!this.shouldStop) {
      batchNum++;
      this.currentBatch.set(batchNum);
      this.statusMessage.set(`Batch #${batchNum}: Peeking messages...`);

      // 1. Peek dead letter messages
      let messages;
      try {
        messages = await this.peekDeadLetterMessages(this.batchSize);
      } catch (err) {
        console.error('Failed to peek dead letter messages:', err);
        this.statusMessage.set('Failed to peek messages');
        this.stoppedByError.set(true);
        break;
      }

      if (messages.length === 0) {
        this.statusMessage.set('Dead letter queue is empty');
        break;
      }

      if (this.shouldStop) break;

      // 2. Resubmit batch
      this.statusMessage.set(`Batch #${batchNum}: Resubmitting ${messages.length} messages...`);
      const sequenceNumbers = messages.map(m => m.sequenceNumber);

      let result: BatchOperationResult;
      try {
        result = await this.resubmitBatch(sequenceNumbers);
      } catch (err) {
        console.error('Failed to resubmit batch:', err);
        this.statusMessage.set('Failed to resubmit batch');
        this.stoppedByError.set(true);
        break;
      }

      // 3. Update counters
      this.totalProcessed.update(v => v + messages.length);
      this.totalSuccess.update(v => v + result.successCount);
      this.totalFailure.update(v => v + result.failureCount);

      // 4. Log batch
      this.batchLog.update(log => [...log, {
        batch: batchNum,
        peeked: messages.length,
        successCount: result.successCount,
        failureCount: result.failureCount
      }]);

      // 5. If entire batch failed, stop to avoid infinite loop
      if (result.successCount === 0) {
        this.statusMessage.set('Stopped: entire batch failed');
        this.stoppedByError.set(true);
        break;
      }

      // 6. If we got fewer messages than batch size, queue might be empty
      if (messages.length < this.batchSize) {
        this.statusMessage.set('Dead letter queue is empty');
        break;
      }
    }
  }

  private peekDeadLetterMessages(count: number): Promise<any[]> {
    const obs = this.data.entityType === 'queue'
      ? this.queueService.peekDeadLetterMessages(this.data.entityName, count)
      : this.topicService.peekDeadLetterMessages(this.data.topicName!, this.data.entityName, count);
    return firstValueFrom(obs);
  }

  private resubmitBatch(sequenceNumbers: number[]): Promise<BatchOperationResult> {
    const obs = this.data.entityType === 'queue'
      ? this.queueService.resubmitDeadLetterMessages(this.data.entityName, sequenceNumbers)
      : this.topicService.resubmitDeadLetterMessages(this.data.topicName!, this.data.entityName, sequenceNumbers);
    return firstValueFrom(obs);
  }
}
