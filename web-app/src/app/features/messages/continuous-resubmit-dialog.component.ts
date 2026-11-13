import { Component, computed, inject, signal, OnDestroy } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioModule } from '@angular/material/radio';
import { MatTableModule } from '@angular/material/table';
import { firstValueFrom } from 'rxjs';
import {
  MessageExportService,
  QueueService,
  ResubmitRun,
  ResubmitRunService,
  ResubmitRunTarget,
  TopicService,
  isPossibleDuplicate
} from '../../core/services';
import { ProviderService } from '../../core/services/provider.service';
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

/** The sentence every state of the dialog shows. */
export const AT_LEAST_ONCE = 'This operation is at-least-once: a message sent but not removed from the dead-letter queue may be delivered twice.';

const SHOWN_LEFT_BEHIND = 100;

/** "2 h 40 min", "3 min 5 s" or "12 s". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} h ${min} min`;
  if (min > 0) return `${min} min ${s} s`;
  return `${s} s`;
}

/**
 * Auto resubmit of a dead-letter queue. Where the API reads the dead-letter queue from a position,
 * the dialog configures, shows and reports a run kept by ResubmitRunService, which goes on when the
 * dialog closes; otherwise it runs the head-of-queue loop that stops on the first failure.
 */
@Component({
  selector: 'app-continuous-resubmit-dialog',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatProgressBarModule, MatRadioModule, MatTableModule
  ],
  template: `
    <h2 mat-dialog-title>Auto resubmit dead-letter</h2>

    <mat-dialog-content class="content">
      <p class="target">
        <strong>{{ data.entityName }}</strong>
        @if (data.topicName) { <span>, subscription of {{ data.topicName }}</span> }
      </p>
      <p class="note" role="note">
        <mat-icon aria-hidden="true">info</mat-icon>
        <span>{{ atLeastOnce }}</span>
      </p>

      @if (run(); as run) {
        @let p = run.progress();
        <p class="hint">Run on {{ run.connection ?? 'an unnamed connection' }}, started {{ run.startedAt | date: 'medium' }}.</p>
        @if (!run.isActive() && p.failed > 0 && !canRetry(run)) {
          <p class="hint">The connection changed since this run, so its failed messages cannot be retried from here.</p>
        }
        <div class="stats">
          <div class="stat"><span class="label">Read</span><span class="value">{{ p.read | number }} of {{ p.total | number }}</span></div>
          <div class="stat"><span class="label">Matched so far</span><span class="value">{{ p.matched | number }}</span></div>
          <div class="stat"><span class="label">Resubmitted</span><span class="value">{{ p.resubmitted | number }}</span></div>
          <div class="stat"><span class="label">Failed</span><span class="value" [class.error]="p.failed > 0">{{ p.failed | number }}</span></div>
          <div class="stat"><span class="label">Possible duplicates</span><span class="value" [class.error]="p.possibleDuplicates > 0">{{ p.possibleDuplicates | number }}</span></div>
        </div>
        <mat-progress-bar
          [mode]="p.total > 0 ? 'determinate' : 'indeterminate'"
          [value]="p.total > 0 ? (p.read * 100) / p.total : 0"
          [attr.aria-label]="'Read ' + p.read + ' of ' + p.total" />
        <p class="timing">
          <span>Elapsed <strong>{{ duration(p.elapsedMs) }}</strong></span>
          @if (p.ratePerSecond !== null) {
            <span>Rate <strong>{{ p.ratePerSecond | number: '1.0-1' }} messages per second</strong>, last minute</span>
          }
          @if (p.remainingMs !== null) {
            <span>About <strong>{{ duration(p.remainingMs) }}</strong> left</span>
          }
        </p>
        <p class="status" aria-live="polite">
          <mat-icon aria-hidden="true" [class.error]="p.status === 'failed'">{{ statusIcon[p.status] }}</mat-icon>
          <span>{{ statusLabel[p.status] }}. {{ p.message }}</span>
        </p>
        @if (run.isActive()) {
          <p class="hint">Pause starts nothing new once the request in flight has answered. Stop cancels the request in flight; its messages are then reported as possible duplicates.</p>
        } @else if (byReason().length > 0) {
          <table mat-table [dataSource]="byReason()" class="table">
            <caption>By dead-letter reason</caption>
            <ng-container matColumnDef="reason">
              <th mat-header-cell *matHeaderCellDef>Reason</th>
              <td mat-cell *matCellDef="let row">{{ row.reason }}</td>
            </ng-container>
            <ng-container matColumnDef="read">
              <th mat-header-cell *matHeaderCellDef>Read</th>
              <td mat-cell *matCellDef="let row">{{ row.read | number }}</td>
            </ng-container>
            <ng-container matColumnDef="resubmitted">
              <th mat-header-cell *matHeaderCellDef>Resubmitted</th>
              <td mat-cell *matCellDef="let row">{{ row.resubmitted | number }}</td>
            </ng-container>
            <ng-container matColumnDef="failed">
              <th mat-header-cell *matHeaderCellDef>Failed</th>
              <td mat-cell *matCellDef="let row">{{ row.failed | number }}</td>
            </ng-container>
            <ng-container matColumnDef="possibleDuplicates">
              <th mat-header-cell *matHeaderCellDef>Possible duplicate</th>
              <td mat-cell *matCellDef="let row">{{ row.possibleDuplicates | number }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="reasonColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: reasonColumns"></tr>
          </table>
        }
        @if (leftBehind().length > 0) {
          <table mat-table [dataSource]="leftBehind()" [trackBy]="trackLeftBehind" class="table">
            <caption>
              Left in the dead-letter queue: {{ p.failed + p.possibleDuplicates | number }}, by sequence number.
              {{ leftBehind().length }} shown, all of them in the saved report.
            </caption>
            <ng-container matColumnDef="sequenceNumber">
              <th mat-header-cell *matHeaderCellDef>Sequence Number</th>
              <td mat-cell *matCellDef="let row" class="mono">{{ row.sequenceNumber }}</td>
            </ng-container>
            <ng-container matColumnDef="reason">
              <th mat-header-cell *matHeaderCellDef>Reason</th>
              <td mat-cell *matCellDef="let row">{{ row.deadLetterReason }}</td>
            </ng-container>
            <ng-container matColumnDef="result">
              <th mat-header-cell *matHeaderCellDef>Result</th>
              <td mat-cell *matCellDef="let row"><strong [class.error]="row.duplicate">{{ row.duplicate ? 'Possible duplicate, do not retry.' : 'Failed, not sent.' }}</strong> {{ row.error }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="leftColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: leftColumns"></tr>
          </table>
        }
      } @else if (state() === 'config') {
        @if (startRefused()) {
          <p class="note warn" role="alert">
            <mat-icon aria-hidden="true">error</mat-icon>
            <span>The connection is changing, so no run was started. Start it again once the connection shows its new state.</span>
          </p>
        }
        @if (data.entityType === 'subscription') {
          <p class="note warn" role="note">
            <mat-icon aria-hidden="true">warning</mat-icon>
            <span>Messages will be sent to the topic and will pass through all subscription filters. If this subscription has filters configured, messages may not return to it.</span>
          </p>
        }
        @if (data.deadLetterMessageCount != null && data.deadLetterMessageCount > 0) {
          <p>
            About <strong>{{ data.deadLetterMessageCount | number }}</strong> dead-letter messages.
            @if (positional) { The run reads the count again when it starts and never reads more messages than that. }
          </p>
        }
        @if (positional) {
          <fieldset class="group">
            <legend>Which messages</legend>
            <mat-form-field appearance="outline">
              <mat-label>Dead-letter reason equals</mat-label>
              <input matInput name="reason" [(ngModel)]="reasonFilter" autocomplete="off">
              <mat-hint>Empty: any reason</mat-hint>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Text in the subject or body</mat-label>
              <input matInput name="text" [(ngModel)]="textFilter" autocomplete="off">
              <mat-hint>Applied to each batch as it is read; the run counts what matched so far</mat-hint>
            </mat-form-field>
            @if (reasonFilter.trim() || textFilter.trim()) {
              <p class="note warn" role="note">
                <mat-icon aria-hidden="true">warning</mat-icon>
                <span>A filter leaves the messages it skips at the head of the queue; the server can reach only a few hundred messages past them, so a filtered run may stop early.</span>
              </p>
            }
          </fieldset>
          <fieldset class="group">
            <legend>When a message fails</legend>
            <mat-radio-group aria-label="When a message fails" name="failureMode" [(ngModel)]="stopAtFirstFailure" class="radios">
              <mat-radio-button [value]="false">Skip it, continue, and report it at the end</mat-radio-button>
              <mat-radio-button [value]="true">Stop at the first failure</mat-radio-button>
            </mat-radio-group>
            <p class="hint">Continuing applies to a message the broker refused and to a possible duplicate. A message the server cannot find is tried again once its lock is released, and then stops the run.</p>
          </fieldset>
        }
        <mat-form-field appearance="outline" class="batch">
          <mat-label>Batch size</mat-label>
          <input matInput type="number" name="batchSize" [(ngModel)]="batchSize" min="1" max="500">
          <mat-hint>1 to 500 messages per cycle.@if (positional) { The server reads 250 per scan. A smaller batch costs the broker more scans.}</mat-hint>
        </mat-form-field>
      } @else {
        <div class="stats">
          <div class="stat"><span class="label">Batch</span><span class="value">{{ currentBatch() }}</span></div>
          <div class="stat"><span class="label">Processed</span><span class="value">{{ totalProcessed() }}</span></div>
          <div class="stat"><span class="label">Success</span><span class="value">{{ totalSuccess() }}</span></div>
          <div class="stat"><span class="label">Failed</span><span class="value" [class.error]="totalFailure() > 0">{{ totalFailure() }}</span></div>
        </div>
        @if (data.deadLetterMessageCount != null && data.deadLetterMessageCount > 0) {
          <mat-progress-bar mode="determinate" [value]="getOverallPercentage()" [attr.aria-label]="'Overall progress ' + getOverallPercentage() + '%'" />
        }
        <p class="status" aria-live="polite">
          @if (state() === 'running') {
            <mat-icon aria-hidden="true">sync</mat-icon><span>{{ statusMessage() }}</span>
          } @else if (stoppedByUser()) {
            <mat-icon aria-hidden="true">stop_circle</mat-icon><span>Stopped by user</span>
          } @else if (stoppedByError()) {
            <mat-icon aria-hidden="true" class="error">error</mat-icon><span class="error">{{ statusMessage() }}</span>
          } @else {
            <mat-icon aria-hidden="true">check_circle</mat-icon><span>Completed - Dead letter queue is empty</span>
          }
        </p>
        @if (batchLog().length > 0) {
          <ul class="log" aria-label="Batch log">
            @for (entry of batchLog(); track entry.batch) {
              <li [class.error]="entry.successCount === 0 && entry.failureCount > 0">
                #{{ entry.batch }}: {{ entry.peeked }} peeked, {{ entry.successCount }} ok@if (entry.failureCount > 0) {, {{ entry.failureCount }} failed}
              </li>
            }
          </ul>
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (run(); as run) {
        @if (run.isActive()) {
          <button mat-button (click)="close()">Close, keep running</button>
          @if (run.progress().status === 'paused') {
            <button mat-stroked-button (click)="run.resume()"><mat-icon aria-hidden="true">play_arrow</mat-icon>Resume</button>
          } @else {
            <button mat-stroked-button (click)="run.pause()"><mat-icon aria-hidden="true">pause</mat-icon>Pause</button>
          }
          <button mat-flat-button (click)="run.stop()"><mat-icon aria-hidden="true">stop</mat-icon>Stop</button>
        } @else {
          <button mat-stroked-button (click)="saveReport(run)"><mat-icon aria-hidden="true">download</mat-icon>Save report, JSON</button>
          @if (canRetry(run)) {
            <button mat-stroked-button (click)="retryFailed(run)"><mat-icon aria-hidden="true">replay</mat-icon>Retry the {{ run.progress().failed }} failed</button>
          }
          <button mat-button (click)="newRun()">New run</button>
          <button mat-flat-button (click)="close()">Close</button>
        }
      } @else if (state() === 'config') {
        <button mat-button mat-dialog-close>Cancel</button>
        <button mat-flat-button (click)="start()" [disabled]="!batchSizeValid()"><mat-icon aria-hidden="true">play_arrow</mat-icon>Start</button>
      } @else if (state() === 'running') {
        <button mat-flat-button (click)="stop()"><mat-icon aria-hidden="true">stop</mat-icon>Stop</button>
      } @else {
        <button mat-flat-button (click)="close()">Close</button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .content { display: flex; flex-direction: column; gap: 12px; min-width: min(640px, 80vw); }
    p { margin: 0; }
    .target { overflow-wrap: anywhere; }
    .note { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: 8px; background: var(--mat-sys-surface-container); color: var(--mat-sys-on-surface-variant); }
    .note.warn { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
    .stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 8px 12px; border-radius: 8px; background: var(--mat-sys-surface-container); }
    .label { font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    .value { font: var(--mat-sys-title-medium); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .error { color: var(--mat-sys-error); }
    .timing { display: flex; flex-wrap: wrap; gap: 16px; font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); font-variant-numeric: tabular-nums; }
    .status { display: flex; align-items: flex-start; gap: 8px; }
    .hint { font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }
    .group { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; border: 0; min-width: 0; }
    legend { padding: 0 0 4px; font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    .radios { display: flex; flex-direction: column; }
    .batch { max-width: 240px; }
    .table { width: 100%; }
    caption { text-align: start; padding: 0 0 4px; font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    .mono { font-family: ui-monospace, monospace; }
    .log { max-height: 200px; overflow-y: auto; margin: 0; padding: 8px 12px; list-style: none; border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; font: var(--mat-sys-body-small); }
  `]
})
export class ContinuousResubmitDialogComponent implements OnDestroy {
  data = inject<ContinuousResubmitDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<ContinuousResubmitDialogComponent>);
  private queueService = inject(QueueService);
  private topicService = inject(TopicService);
  private runs = inject(ResubmitRunService);
  private exporter = inject(MessageExportService);

  /** The API's own answer says the dead-letter queue can be read from a sequence number. */
  readonly positional = inject(ProviderService).capabilities()?.supportsPeekFromSequenceNumber === true;
  readonly target: ResubmitRunTarget = {
    entityType: this.data.entityType,
    entityName: this.data.entityName,
    topicName: this.data.topicName,
    subQueue: 'deadletter'
  };
  readonly run = signal<ResubmitRun | undefined>(this.runs.find(this.target));
  readonly atLeastOnce = AT_LEAST_ONCE;
  readonly duration = formatDuration;
  readonly reasonColumns = ['reason', 'read', 'resubmitted', 'failed', 'possibleDuplicates'];
  readonly leftColumns = ['sequenceNumber', 'reason', 'result'];
  readonly trackLeftBehind = (_: number, row: { sequenceNumber: number; duplicate: boolean }) => `${row.duplicate}:${row.sequenceNumber}`;
  readonly statusLabel = { running: 'Running', paused: 'Paused', completed: 'Finished', stopped: 'Stopped', failed: 'Ended on a failure' } as const;
  readonly statusIcon = { running: 'sync', paused: 'pause_circle', completed: 'check_circle', stopped: 'stop_circle', failed: 'error' } as const;

  readonly byReason = computed(() => {
    const run = this.run();
    run?.progress();
    return run ? run.byReason() : [];
  });

  /** The first left-behind messages, failed then possible duplicates; the saved report holds all of them. */
  readonly leftBehind = computed(() => {
    const run = this.run();
    run?.progress();
    if (!run) return [];
    return [
      ...run.failed.slice(0, SHOWN_LEFT_BEHIND).map(entry => ({ ...entry, duplicate: false })),
      ...run.possibleDuplicates.slice(0, SHOWN_LEFT_BEHIND).map(entry => ({ ...entry, duplicate: true }))
    ].slice(0, SHOWN_LEFT_BEHIND);
  });

  /** The server receives 250 messages per scan, so a run asks for as many; the head-of-queue loop keeps 10. */
  batchSize = this.positional ? 250 : 10;
  stopAtFirstFailure = false;
  reasonFilter = '';
  textFilter = '';

  state = signal<DialogState>('config');
  /** The run was not started because the connection is changing. */
  startRefused = signal(false);
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

  batchSizeValid(): boolean {
    return Number.isInteger(this.batchSize) && this.batchSize >= 1 && this.batchSize <= 500;
  }

  getOverallPercentage(): number {
    const total = this.data.deadLetterMessageCount;
    if (!total || total === 0) return 0;
    return Math.min(100, Math.round((this.totalSuccess() / total) * 100));
  }

  async start(): Promise<void> {
    if (this.positional) {
      const run = this.runs.start(this.target, {
        batchSize: this.batchSize,
        stopAtFirstFailure: this.stopAtFirstFailure,
        reason: this.reasonFilter.trim() || undefined,
        text: this.textFilter.trim() || undefined
      });
      this.run.set(run);
      this.startRefused.set(!run);
      return;
    }

    this.state.set('running');
    this.dialogRef.disableClose = true;
    this.shouldStop = false;

    try {
      await this.runLoop();
    } catch (err) {
      console.error('Continuous resubmit error:', err);
      this.statusMessage.set('Unexpected error occurred');
      this.stoppedByError.set(true);
    }

    this.state.set('finished');
    this.dialogRef.disableClose = false;
  }

  stop(): void {
    this.shouldStop = true;
    this.stoppedByUser.set(true);
    this.statusMessage.set('Stopping...');
  }

  canRetry(run: ResubmitRun): boolean {
    return this.runs.canRetry(run);
  }

  retryFailed(run: ResubmitRun): void {
    this.run.set(this.runs.retry(run));
  }

  newRun(): void {
    this.runs.clear(this.target);
    this.run.set(undefined);
  }

  saveReport(run: ResubmitRun): void {
    const report = run.report();
    const name = [this.data.topicName, this.data.entityName].filter(Boolean).join('-').replace(/[^A-Za-z0-9._-]+/g, '_');
    const stamp = report.startedAt.replace(/[:.]/g, '-');
    this.exporter.downloadFile(JSON.stringify(report, null, 2), `resubmit-report-${name}-${stamp}.json`, 'application/json');
  }

  close(): void {
    const run = this.run();
    if (run) {
      const p = run.progress();
      this.dialogRef.close(run.isActive() ? undefined : {
        totalProcessed: p.read,
        totalSuccess: p.resubmitted,
        totalFailure: p.failed + p.possibleDuplicates,
        stopped: p.status === 'stopped',
        completed: p.status === 'completed'
      } satisfies ContinuousResubmitResult);
      return;
    }
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

      // 5. Stop on the first failure or possible duplicate
      if (result.failureCount > 0) {
        this.statusMessage.set(this.stopReason(batchNum, result));
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

  private stopReason(batchNum: number, result: BatchOperationResult): string {
    const duplicates = result.failures.filter(f => isPossibleDuplicate(f)).map(f => f.sequenceNumber);
    const failed = result.failures.filter(f => !isPossibleDuplicate(f)).map(f => f.sequenceNumber);
    const named = [
      failed.length > 0 ? `failed: ${failed.join(', ')}` : '',
      duplicates.length > 0 ? `possible duplicate - do not retry: ${duplicates.join(', ')}` : ''
    ].filter(part => part !== '').join('; ');
    return `Stopped: batch #${batchNum} reported ${result.failureCount} failure(s); they are not resubmitted again`
      + (named ? ` (${named})` : '');
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
