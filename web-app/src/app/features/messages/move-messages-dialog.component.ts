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
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QueueService } from '../../core/services';
import { QueueInfo } from '../../core/models';

export interface MoveMessagesDialogData {
  currentQueueName: string;
  messageCount: number;
  isDeadLetter: boolean;
}

@Component({
  selector: 'app-move-messages-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon fontIcon="swap_horiz" aria-hidden="true"></mat-icon>
      <span>Move {{ data.messageCount }} {{ data.messageCount === 1 ? 'Message' : 'Messages' }}</span>
    </h2>

    <mat-dialog-content class="content">
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
          <strong>{{ data.currentQueueName }}</strong>
          {{ data.isDeadLetter ? '(Dead Letter)' : '' }}.
        </p>

        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Target Queue</mat-label>
          <select
            matNativeControl
            [(ngModel)]="selectedTargetQueue"
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
        [mat-dialog-close]="selectedTargetQueue"
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
  data = inject<MoveMessagesDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<MoveMessagesDialogComponent>);
  private queueService = inject(QueueService);
  private snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  loading = signal(false);
  error = signal<string | null>(null);
  allQueues = signal<QueueInfo[]>([]);
  availableQueues = signal<QueueInfo[]>([]);
  selectedTargetQueue: string | null = null;

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
