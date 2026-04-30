import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QueueService, ConnectionService } from '../../core/services';
import { QueueInfo } from '../../core/models';
import { SendMessageDialogComponent } from '../messages/send-message-dialog.component';
import { ViewMessagesDialogComponent } from '../messages/view-messages-dialog.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';

@Component({
  selector: 'app-queues',
  standalone: true,
  imports: [
    CommonModule,
    MatSnackBarModule,
    MatDialogModule
  ],
  template: `
    <div class="queues-container">
      <div class="header d-flex justify-content-between align-items-center mb-4">
        <h2 class="mb-0">Queues</h2>
        <button class="btn btn-primary" (click)="loadQueues()" [disabled]="!isConnected">
          <i class="fa-solid fa-arrows-rotate me-2"></i>
          Refresh
        </button>
      </div>

      @if (!isConnected) {
        <div class="card text-center py-5">
          <div class="card-body">
            <i class="fa fa-exclamation-triangle fa-4x text-warning mb-3"></i>
            <p class="mb-0">Please connect to a Service Bus namespace first</p>
          </div>
        </div>
      } @else if (loading()) {
        <div class="text-center py-5">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
        </div>
      } @else if (queues().length === 0) {
        <div class="card text-center py-5">
          <div class="card-body">
            <i class="fa fa-inbox fa-4x text-secondary mb-3"></i>
            <p class="mb-0">No queues found</p>
          </div>
        </div>
      } @else {
        <div class="table-responsive">
          <table class="table table-hover">
            <thead>
              <tr>
                <th>Name</th>
                <th>Active</th>
                <th>Dead Letter</th>
                <th>Scheduled</th>
                <th>Size</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (queue of queues(); track queue.name) {
                <tr>
                  <td>
                    <div class="d-flex align-items-center">
                      <i class="fa fa-inbox text-primary me-2"></i>
                      {{ queue.name }}
                    </div>
                  </td>
                  <td>
                    <span class="badge bg-primary clickable-stat" (click)="viewMessages(queue, 0)">
                      {{ queue.activeMessageCount }}
                    </span>
                  </td>
                  <td>
                    <span class="badge clickable-stat" [class.bg-danger]="queue.deadLetterMessageCount > 0" [class.bg-secondary]="queue.deadLetterMessageCount === 0" (click)="viewMessages(queue, 1)">
                      {{ queue.deadLetterMessageCount }}
                    </span>
                  </td>
                  <td>
                    <span class="badge bg-info">{{ queue.scheduledMessageCount }}</span>
                  </td>
                  <td>{{ formatSize(queue.sizeInBytes) }}</td>
                  <td>
                    <div class="btn-group">
                      <button class="btn btn-sm btn-outline-primary" (click)="viewMessages(queue)" title="View Messages">
                        <i class="fa fa-eye"></i>
                      </button>
                      <button class="btn btn-sm btn-outline-primary" (click)="sendMessage(queue)" title="Send Message">
                        <i class="fa fa-paper-plane"></i>
                      </button>
                      <button class="btn btn-sm btn-outline-secondary" (click)="purgeMessages(queue)" [disabled]="queue.activeMessageCount === 0" title="Purge Messages">
                        <i class="fa fa-trash"></i>
                      </button>
                      <button class="btn btn-sm btn-outline-danger" (click)="purgeDeadLetter(queue)" [disabled]="queue.deadLetterMessageCount === 0" title="Purge Dead Letter">
                        <i class="fa fa-times-circle"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [`
    .queues-container {
      max-width: 1200px;
      margin: 0 auto;
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 12px;
    }

    .table-responsive {
      flex: 1;
      overflow-y: auto;
    }

    .clickable-stat {
      cursor: pointer;
      transition: opacity 0.2s ease;

      &:hover {
        opacity: 0.8;
      }
    }
  `]
})
export class QueuesComponent implements OnInit {
  private queueService = inject(QueueService);
  private connectionService = inject(ConnectionService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  queues = signal<QueueInfo[]>([]);
  loading = signal(false);
  displayedColumns = ['name', 'activeMessages', 'deadLetter', 'scheduled', 'size', 'actions'];

  get isConnected(): boolean {
    return this.connectionService.isConnected;
  }

  ngOnInit() {
    if (this.isConnected) {
      this.loadQueues();
    }

    this.connectionService.connectionStatus$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(status => {
      if (status.connected) {
        this.loadQueues();
      } else {
        this.queues.set([]);
      }
    });
  }

  loadQueues() {
    this.loading.set(true);
    this.queueService.getQueues().pipe(
      finalize(() => {
        this.loading.set(false);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (queues) => {
        this.queues.set(queues);
      },
      error: () => {
        this.snackBar.open('Failed to load queues', 'Close', { duration: 3000 });
      }
    });
  }

  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  viewMessages(queue: QueueInfo, initialTab?: number) {
    this.dialog.open(ViewMessagesDialogComponent, {
      width: '95vw',
      maxWidth: '1400px',
      height: '90vh',
      data: {
        entityType: 'queue',
        entityName: queue.name,
        activeMessageCount: queue.activeMessageCount,
        deadLetterMessageCount: queue.deadLetterMessageCount,
        initialTab
      }
    });
  }

  sendMessage(queue: QueueInfo) {
    const dialogRef = this.dialog.open(SendMessageDialogComponent, {
      width: '700px',
      data: {
        entityType: 'queue',
        entityName: queue.name
      }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.loadQueues();
      }
    });
  }

  purgeMessages(queue: QueueInfo) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Purge Messages',
        message: `Are you sure you want to delete all ${queue.activeMessageCount} active messages from queue "${queue.name}"? This action cannot be undone.`,
        confirmText: 'Purge',
        confirmColor: 'warn',
        icon: 'delete_sweep'
      }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.queueService.purgeMessages(queue.name).pipe(
          takeUntilDestroyed(this.destroyRef)
        ).subscribe({
          next: () => {
            this.snackBar.open(`Purged all messages from ${queue.name}`, 'Close', { duration: 3000 });
            this.loadQueues();
          },
          error: () => {
            this.snackBar.open('Failed to purge messages', 'Close', { duration: 3000 });
          }
        });
      }
    });
  }

  purgeDeadLetter(queue: QueueInfo) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Purge Dead Letter Queue',
        message: `Are you sure you want to delete all ${queue.deadLetterMessageCount} dead letter messages from queue "${queue.name}"? This action cannot be undone.`,
        confirmText: 'Purge',
        confirmColor: 'warn',
        icon: 'delete_forever'
      }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.queueService.purgeDeadLetterMessages(queue.name).pipe(
          takeUntilDestroyed(this.destroyRef)
        ).subscribe({
          next: () => {
            this.snackBar.open(`Purged all dead letter messages from ${queue.name}`, 'Close', { duration: 3000 });
            this.loadQueues();
          },
          error: () => {
            this.snackBar.open('Failed to purge dead letter messages', 'Close', { duration: 3000 });
          }
        });
      }
    });
  }
}
