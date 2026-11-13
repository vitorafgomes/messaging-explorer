import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
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
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatSnackBarModule,
    MatDialogModule
  ],
  template: `
    <div class="queues-container">
      <div class="header">
        <h2>Queues</h2>
        <button matButton="outlined" type="button" (click)="loadQueues()" [disabled]="!isConnected || loading()">
          <mat-icon fontIcon="refresh" aria-hidden="true"></mat-icon>
          Refresh
        </button>
      </div>

      @if (!isConnected) {
        <div class="state">
          <mat-icon class="state-icon" fontIcon="cloud_off" aria-hidden="true"></mat-icon>
          <h3>Not connected</h3>
          <p>Please connect to a Service Bus namespace first</p>
        </div>
      } @else if (loading()) {
        <div class="state" role="status">
          <mat-progress-spinner mode="indeterminate" diameter="32" aria-label="Loading"></mat-progress-spinner>
          <span>Loading the queues</span>
        </div>
      } @else if (loadError()) {
        <section class="load-error" role="alert" aria-label="Error">
          <mat-icon fontIcon="error" aria-hidden="true"></mat-icon>
          <div class="load-error-body">
            <h3>Could not load the queues</h3>
            <p>The API did not return the queue list. Nothing is shown because nothing was read, and nothing on the broker was changed.</p>
            <button matButton="outlined" type="button" (click)="loadQueues()">
              <mat-icon fontIcon="refresh" aria-hidden="true"></mat-icon>
              Retry
            </button>
          </div>
        </section>
      } @else if (queues().length === 0) {
        <div class="state">
          <mat-icon class="state-icon" fontIcon="inbox" aria-hidden="true"></mat-icon>
          <h3>No queues found</h3>
          <p>The broker answered and holds no queue.</p>
        </div>
      } @else {
        <div class="table-wrapper">
          <table mat-table [dataSource]="queues()" [trackBy]="queueName" aria-label="Queues">
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>Name</th>
              <td mat-cell *matCellDef="let queue" class="name"><span>{{ queue.name }}</span></td>
            </ng-container>
            <ng-container matColumnDef="activeMessages">
              <th mat-header-cell *matHeaderCellDef class="number">Active</th>
              <td mat-cell *matCellDef="let queue" class="number">
                <button matButton type="button" class="count" (click)="viewMessages(queue, 0)"
                        [attr.aria-label]="'View the ' + queue.activeMessageCount + ' active messages of ' + queue.name">{{ queue.activeMessageCount }}</button>
              </td>
            </ng-container>
            <ng-container matColumnDef="deadLetter">
              <th mat-header-cell *matHeaderCellDef class="number">Dead Letter</th>
              <td mat-cell *matCellDef="let queue" class="number">
                <button matButton type="button" class="count" [class.dead-letter]="queue.deadLetterMessageCount > 0" (click)="viewMessages(queue, 1)"
                        [attr.aria-label]="'View the ' + queue.deadLetterMessageCount + ' dead-letter messages of ' + queue.name">{{ queue.deadLetterMessageCount }}</button>
              </td>
            </ng-container>
            <ng-container matColumnDef="scheduled">
              <th mat-header-cell *matHeaderCellDef class="number">Scheduled</th>
              <td mat-cell *matCellDef="let queue" class="number">{{ queue.scheduledMessageCount }}</td>
            </ng-container>
            <ng-container matColumnDef="size">
              <th mat-header-cell *matHeaderCellDef class="number">Size</th>
              <td mat-cell *matCellDef="let queue" class="number">{{ formatSize(queue.sizeInBytes) }}</td>
            </ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef class="actions">Actions</th>
              <td mat-cell *matCellDef="let queue" class="actions">
                <button matIconButton type="button" (click)="viewMessages(queue)" title="View Messages" [attr.aria-label]="'View the messages of ' + queue.name">
                  <mat-icon fontIcon="visibility" aria-hidden="true"></mat-icon>
                </button>
                <button matIconButton type="button" (click)="sendMessage(queue)" title="Send Message" [attr.aria-label]="'Send a message to ' + queue.name">
                  <mat-icon fontIcon="send" aria-hidden="true"></mat-icon>
                </button>
                <button matIconButton type="button" [matMenuTriggerFor]="purgeMenu" title="More actions" [attr.aria-label]="'More actions for ' + queue.name">
                  <mat-icon fontIcon="more_vert" aria-hidden="true"></mat-icon>
                </button>
                <mat-menu #purgeMenu="matMenu">
                  <button mat-menu-item class="danger" (click)="purgeMessages(queue)" [disabled]="queue.activeMessageCount === 0">
                    <mat-icon fontIcon="delete_sweep" aria-hidden="true"></mat-icon>
                    Purge Messages
                  </button>
                  <button mat-menu-item class="danger" (click)="purgeDeadLetter(queue)" [disabled]="queue.deadLetterMessageCount === 0">
                    <mat-icon fontIcon="delete_forever" aria-hidden="true"></mat-icon>
                    Purge Dead Letter
                  </button>
                </mat-menu>
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="displayedColumns; sticky: true"></tr>
            <tr mat-row *matRowDef="let queue; columns: displayedColumns"></tr>
          </table>
        </div>
      }
    </div>
  `,
  styleUrl: './queues.component.scss'
})
export class QueuesComponent implements OnInit {
  private queueService = inject(QueueService);
  private connectionService = inject(ConnectionService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  queues = signal<QueueInfo[]>([]);
  loading = signal(false);
  loadError = signal(false);
  readonly queueName = (_: number, queue: QueueInfo) => queue.name;
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
    this.loadError.set(false);
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
        this.queues.set([]);
        this.loadError.set(true);
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
