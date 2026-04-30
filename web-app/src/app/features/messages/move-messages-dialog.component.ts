import { Component, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
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
    MatDialogModule,
    MatSnackBarModule
  ],
  host: {
    '[class.dark-mode-dialog]': 'isDarkMode()'
  },
  template: `
    <div class="modal-header" [class.bg-dark]="isDarkMode()" [class.text-light]="isDarkMode()">
      <h5 class="modal-title d-flex align-items-center gap-2" [class.text-light]="isDarkMode()">
        <i class="fa fa-exchange text-primary"></i>
        Move {{ data.messageCount }} {{ data.messageCount === 1 ? 'Message' : 'Messages' }}
      </h5>
    </div>

    <div class="modal-body" [class.bg-dark]="isDarkMode()" [class.text-light]="isDarkMode()">
      @if (loading()) {
        <div class="text-center py-4">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading queues...</span>
          </div>
          <p class="mt-2 mb-0">Loading available queues...</p>
        </div>
      } @else if (error()) {
        <div class="alert alert-danger mb-0" role="alert">
          <i class="fa fa-exclamation-triangle me-2"></i>
          {{ error() }}
        </div>
      } @else {
        <div class="mb-3">
          <p class="mb-3" [class.text-light]="isDarkMode()">
            Select the target queue to move
            <strong>{{ data.messageCount }}</strong>
            {{ data.messageCount === 1 ? 'message' : 'messages' }}
            from
            <strong>{{ data.currentQueueName }}</strong>
            {{ data.isDeadLetter ? '(Dead Letter)' : '' }}.
          </p>

          <label class="form-label">Target Queue</label>
          <select
            class="form-select"
            [(ngModel)]="selectedTargetQueue"
            [disabled]="availableQueues().length === 0"
            required>
            <option [ngValue]="null">-- Select a queue --</option>
            @for (queue of availableQueues(); track queue.name) {
              <option [value]="queue.name">{{ queue.name }}</option>
            }
          </select>

          @if (availableQueues().length === 0) {
            <div class="form-text text-warning">
              <i class="fa fa-exclamation-triangle me-1"></i>
              No other queues available
            </div>
          } @else {
            <div class="form-text">
              Select the destination queue for the selected messages
            </div>
          }
        </div>

        @if (selectedTargetQueue) {
          <div class="alert alert-info mb-0" role="alert">
            <i class="fa fa-info-circle me-2"></i>
            <strong>Note:</strong> Messages will be moved from
            <strong>{{ data.currentQueueName }}</strong> to
            <strong>{{ selectedTargetQueue }}</strong>.
            The original messages will be removed from the source queue.
          </div>
        }
      }
    </div>

    <div class="modal-footer" [class.bg-dark]="isDarkMode()">
      <button class="btn btn-secondary" mat-dialog-close [disabled]="loading()">
        Cancel
      </button>
      <button
        class="btn btn-primary"
        [mat-dialog-close]="selectedTargetQueue"
        [disabled]="!selectedTargetQueue || loading() || error()">
        <i class="fa fa-exchange me-2"></i>
        Move Messages
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
      min-width: 500px;

      p {
        color: var(--bs-secondary-color);
      }
    }

    .modal-footer {
      border-top: 1px solid var(--bs-border-color);
      padding: 16px 24px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .form-select {
      min-height: 38px;
    }

    .alert {
      border-radius: 6px;
    }
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

  isDarkMode(): boolean {
    if (typeof document === 'undefined') return false;
    const bsTheme = document.documentElement.getAttribute('data-bs-theme');
    const hasThemeDark = document.body.classList.contains('theme-dark');
    return bsTheme === 'dark' || hasThemeDark;
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
