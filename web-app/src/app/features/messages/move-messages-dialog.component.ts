import { Component, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { Subscription, finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QueueService } from '../../core/services';
import { NEW_MESSAGE_ID_OPTION } from '../../core/services/bulk-operations.service';
import { QueueInfo } from '../../core/models';
import { connectionContext } from '../entities/connection-context';
import { EnvironmentLineComponent } from '../../shared/environment-line.component';

export interface MoveMessagesDialogData {
  currentQueueName: string;
  messageCount: number;
  isDeadLetter: boolean;
}

/** What the dialog closes with when the user chose a target. */
export interface MoveMessagesDialogResult {
  targetQueueName: string;
  /** Send each copy with a new message id; offered only when the chosen target detects duplicates. */
  newMessageIdOnDuplicateDetection: boolean;
}

@Component({
  selector: 'app-move-messages-dialog',
  standalone: true,
  imports: [EnvironmentLineComponent, 
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatCheckboxModule
  ],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon fontIcon="swap_horiz" aria-hidden="true"></mat-icon>
      <span>Move {{ data.messageCount }} {{ data.messageCount === 1 ? 'Message' : 'Messages' }}</span>
    </h2>

    <mat-dialog-content class="content">
      <app-environment-line [mark]="context().mark"><b>{{ data.currentQueueName }}</b> on {{ context().where }}</app-environment-line>
      @if (loading()) {
        <p class="state" role="status">
          <mat-progress-spinner mode="indeterminate" diameter="24" aria-hidden="true"></mat-progress-spinner>
          <span>Loading available queues...</span>
        </p>
      } @else if (error()) {
        <p class="note error" role="alert">
          <mat-icon fontIcon="error" aria-hidden="true"></mat-icon>
          <span>{{ error() }}</span>
        </p>
      } @else {
        <p>
          Select the target queue to move
          <strong>{{ data.messageCount }}</strong>
          {{ data.messageCount === 1 ? 'message' : 'messages' }}
          from
          <strong>{{ data.currentQueueName }}</strong>{{ data.isDeadLetter ? ' (Dead Letter)' : '' }}.
        </p>

        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Target Queue</mat-label>
          <select
            matNativeControl
            [(ngModel)]="selectedTargetQueue"
            (ngModelChange)="readTarget($event)"
            [disabled]="availableQueues().length === 0"
            required>
            <option [ngValue]="null">-- Select a queue --</option>
            @for (queue of availableQueues(); track queue.name) {
              <option [value]="queue.name">{{ queue.name }}</option>
            }
          </select>
          @if (availableQueues().length === 0) {
            <mat-hint class="warn">No other queues available</mat-hint>
          } @else {
            <mat-hint>Select the destination queue for the selected messages</mat-hint>
          }
        </mat-form-field>

        @if (selectedTargetQueue) {
          <p class="note" role="note">
            <mat-icon fontIcon="info" aria-hidden="true"></mat-icon>
            <span>
              <strong>Note:</strong> Messages will be moved from
              <strong>{{ data.currentQueueName }}</strong> to
              <strong>{{ selectedTargetQueue }}</strong>.
              The original messages will be removed from the source queue.
            </span>
          </p>
          @if (targetDetectsDuplicates()) {
            <mat-checkbox class="new-message-id" [checked]="newMessageId()" (change)="newMessageId.set($event.checked)">{{ option.label }}</mat-checkbox>
            <p class="note" role="note"><mat-icon fontIcon="info" aria-hidden="true"></mat-icon><span>{{ option.hint }}</span></p>
          }
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close [disabled]="loading()">
        Cancel
      </button>
      <button
        mat-flat-button
        type="button"
        (click)="dialogRef.close(choice())"
        [disabled]="!selectedTargetQueue || loading() || error()">
        <mat-icon fontIcon="swap_horiz" aria-hidden="true"></mat-icon>
        Move Messages
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .title { display: flex; align-items: center; gap: 8px; }
    .title mat-icon { flex: none; color: var(--mat-sys-primary); }
    .content { display: flex; flex-direction: column; gap: 16px; min-width: 0; overflow-wrap: anywhere; }
    p { margin: 0; }
    .state { display: flex; align-items: center; gap: 12px; color: var(--mat-sys-on-surface-variant); }
    .note { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: 8px; background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .note mat-icon { flex: none; }
    .note.error { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .warn { color: var(--mat-sys-error); }
  `]
})
export class MoveMessagesDialogComponent implements OnInit {
  /** The active connection and its environment, for the line under the title. */
  readonly context = connectionContext();
  data = inject<MoveMessagesDialogData>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<MoveMessagesDialogComponent, MoveMessagesDialogResult>);
  private queueService = inject(QueueService);
  private snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  loading = signal(false);
  error = signal<string | null>(null);
  allQueues = signal<QueueInfo[]>([]);
  availableQueues = signal<QueueInfo[]>([]);
  selectedTargetQueue: string | null = null;
  readonly option = NEW_MESSAGE_ID_OPTION;
  /** Whether the chosen target detects duplicates, as its settings say; false while unknown, when a refusal offers the option on retry. */
  readonly targetDetectsDuplicates = signal(false);
  /** Whether the move sends each copy with a new message id; off until the user ticks it. */
  readonly newMessageId = signal(false);
  private targetRead?: Subscription;

  /** What Move closes with: the target, and whether to send new message ids, which only a target that detects duplicates takes. */
  choice(): MoveMessagesDialogResult | undefined {
    return this.selectedTargetQueue
      ? { targetQueueName: this.selectedTargetQueue, newMessageIdOnDuplicateDetection: this.targetDetectsDuplicates() && this.newMessageId() }
      : undefined;
  }

  /** Reads the settings of the chosen target, since the queue list does not carry duplicate detection. */
  readTarget(name: string | null) {
    this.targetRead?.unsubscribe();
    this.targetDetectsDuplicates.set(false);
    this.newMessageId.set(false);
    if (!name) return;
    this.targetRead = this.queueService.getQueue(name).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: queue => this.targetDetectsDuplicates.set(queue.requiresDuplicateDetection === true),
      error: () => this.targetDetectsDuplicates.set(false)
    });
  }

  ngOnInit() {
    this.loadQueues();
  }

  loadQueues() {
    this.loading.set(true);
    this.error.set(null);

    this.queueService.getQueues().pipe(
      finalize(() => this.loading.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (queues) => {
        this.allQueues.set(queues);
        // Filter out current queue from options
        const filtered = queues.filter(q => q.name !== this.data.currentQueueName);
        this.availableQueues.set(filtered);

        if (filtered.length === 0) {
          this.error.set('No other queues available to move messages to.');
        }
      },
      error: (err) => {
        this.error.set('Failed to load queues. Please try again.');
        this.snackBar.open('Failed to load queues', 'Close', { duration: 3000 });
      }
    });
  }
}
