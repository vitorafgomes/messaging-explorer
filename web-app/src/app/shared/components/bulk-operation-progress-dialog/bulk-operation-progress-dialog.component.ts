import { Component, OnDestroy, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subject } from 'rxjs';
import { SUB_QUEUE_LABEL, SubQueue } from '../../../core/models/message.model';

export interface BulkOperationProgressDialogData {
  operation: 'delete' | 'resubmit' | 'move' | 'export';
  totalCount: number;
  entityName: string;
  entityType: 'queue' | 'topic';
  subQueue: SubQueue;
  targetQueue?: string; // For move operations
}

export interface ProgressUpdate {
  processed: number;
  total: number;
  successCount: number;
  failureCount: number;
}

@Component({
  selector: 'app-bulk-operation-progress-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule
  ],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon [fontIcon]="getOperationIcon()" [class.danger]="data.operation === 'delete'" aria-hidden="true"></mat-icon>
      {{ getOperationTitle() }}
    </h2>

    <mat-dialog-content class="content">
      <p class="description">{{ getOperationDescription() }}</p>

      <!--
        The backend processes each batch as a single request without streaming
        per-message progress, so a determinate percentage would be dishonest.
        Show an indeterminate indicator while the request is in flight instead.
      -->
      <div class="progress-section">
        @if (!isComplete() && !cancelled()) {
          <span class="progress-label" aria-live="polite">
            Processing {{ progress().total }} {{ progress().total === 1 ? 'message' : 'messages' }}...
          </span>
          <mat-progress-bar mode="indeterminate" aria-label="Operation in progress"></mat-progress-bar>
        } @else {
          <span class="progress-label">
            <strong>{{ progress().processed }}</strong> of <strong>{{ progress().total }}</strong> messages processed
          </span>
          <mat-progress-bar mode="determinate" value="100" aria-hidden="true"
            [class.success]="isComplete() && progress().failureCount === 0"
            [class.partial]="isComplete() && progress().failureCount > 0 && progress().successCount > 0"
            [class.failed]="isComplete() && progress().successCount === 0"
            [class.cancelled]="cancelled()"></mat-progress-bar>
        }
      </div>

      @if (progress().processed > 0 && !cancelled()) {
        <div class="result-stats">
          <span class="stat">
            <mat-icon fontIcon="check_circle" aria-hidden="true"></mat-icon>
            <span>Success: <strong>{{ progress().successCount }}</strong></span>
          </span>
          @if (progress().failureCount > 0) {
            <span class="stat failure">
              <mat-icon fontIcon="error" aria-hidden="true"></mat-icon>
              <span>Failed: <strong>{{ progress().failureCount }}</strong></span>
            </span>
          }
        </div>
      }

      <p class="status-message" role="status"
        [class.success]="!cancelled() && isComplete() && progress().failureCount === 0"
        [class.partial]="!cancelled() && isComplete() && progress().failureCount > 0 && progress().successCount > 0"
        [class.failed]="!cancelled() && isComplete() && progress().failureCount > 0 && progress().successCount === 0">
        @if (cancelled()) {
          <mat-icon fontIcon="block" aria-hidden="true"></mat-icon>
          <span>Operation cancelled</span>
        } @else if (!isComplete()) {
          <mat-progress-spinner mode="indeterminate" diameter="18" aria-hidden="true"></mat-progress-spinner>
          <span>{{ getStatusMessage() }}</span>
        } @else if (progress().failureCount === 0) {
          <mat-icon fontIcon="check_circle" aria-hidden="true"></mat-icon>
          <span>Operation completed successfully!</span>
        } @else if (progress().successCount > 0) {
          <mat-icon fontIcon="warning" aria-hidden="true"></mat-icon>
          <span>Operation completed with some failures</span>
        } @else {
          <mat-icon fontIcon="cancel" aria-hidden="true"></mat-icon>
          <span>Operation failed</span>
        }
      </p>

      @if (cancelled()) {
        <p class="cancelled-info" role="alert">
          <mat-icon fontIcon="info" aria-hidden="true"></mat-icon>
          <span><strong>Cancelled:</strong> The request was aborted. Any messages already
          processed by the server before the abort may still have been affected.
          Refresh the list to see the current state.</span>
        </p>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (!isComplete() && !cancelled()) {
        <button matButton="outlined" type="button" (click)="cancel()">
          <mat-icon fontIcon="block" aria-hidden="true"></mat-icon>
          Cancel
        </button>
      } @else {
        <button matButton="filled" type="button" [mat-dialog-close]="true">
          <mat-icon fontIcon="check" aria-hidden="true"></mat-icon>
          Close
        </button>
      }
    </mat-dialog-actions>
  `,
  styleUrl: './bulk-operation-progress-dialog.component.scss'
})
export class BulkOperationProgressDialogComponent implements OnDestroy {
  data = inject<BulkOperationProgressDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<BulkOperationProgressDialogComponent>);

  progress = signal<ProgressUpdate>({
    processed: 0,
    total: this.data.totalCount,
    successCount: 0,
    failureCount: 0
  });

  cancelled = signal(false);

  /**
   * Emits when the user requests cancellation. The parent component wires this
   * into takeUntil() on the in-flight HTTP subscription so unsubscribing aborts
   * the XHR, which in turn signals RequestAborted on the server and stops the
   * batch for real.
   */
  readonly cancelRequested$ = new Subject<void>();

  constructor() {
    // Prevent dialog from being dismissed by clicking outside or pressing ESC
    this.dialogRef.disableClose = true;
  }

  ngOnDestroy(): void {
    this.cancelRequested$.complete();
  }

  getOperationIcon(): string {
    switch (this.data.operation) {
      case 'delete':
        return 'delete';
      case 'resubmit':
        return 'replay';
      case 'move':
        return 'swap_horiz';
      case 'export':
        return 'download';
      default:
        return 'settings';
    }
  }

  getOperationTitle(): string {
    const operation = this.data.operation.charAt(0).toUpperCase() + this.data.operation.slice(1);
    return `${operation} Messages`;
  }

  getOperationDescription(): string {
    const count = this.data.totalCount;
    const entity = this.data.entityName;
    const type = SUB_QUEUE_LABEL[this.data.subQueue];

    switch (this.data.operation) {
      case 'delete':
        return `Deleting ${count} ${type} ${count === 1 ? 'message' : 'messages'} from ${entity}...`;
      case 'resubmit':
        return `Resubmitting ${count} ${SUB_QUEUE_LABEL[this.data.subQueue === 'transferdeadletter' ? 'transferdeadletter' : 'deadletter']} ${count === 1 ? 'message' : 'messages'} from ${entity}...`;
      case 'move':
        return `Moving ${count} ${type} ${count === 1 ? 'message' : 'messages'} from ${entity} to ${this.data.targetQueue}...`;
      case 'export':
        return `Exporting ${count} ${type} ${count === 1 ? 'message' : 'messages'} from ${entity}...`;
      default:
        return `Processing ${count} ${count === 1 ? 'message' : 'messages'}...`;
    }
  }

  getProgressPercentage(): number {
    const total = this.progress().total;
    if (total === 0) return 0;
    return Math.round((this.progress().processed / total) * 100);
  }

  getStatusMessage(): string {
    const { processed, total } = this.progress();
    if (processed === 0) {
      return 'Starting operation...';
    }
    return `Processing message ${processed} of ${total}...`;
  }

  isComplete(): boolean {
    return this.progress().processed >= this.progress().total;
  }

  /**
   * Updates the progress with new values
   * This method will be called from the parent component
   */
  updateProgress(update: Partial<ProgressUpdate>): void {
    this.progress.update(current => ({
      ...current,
      ...update
    }));
  }

  /**
   * Requests cancellation of the operation. This does not close the dialog; it
   * emits so the parent can abort the HTTP request and then leaves the dialog in
   * a neutral "cancelled" state with a Close button for the user to dismiss.
   */
  cancel(): void {
    if (this.cancelled()) {
      return;
    }
    this.cancelled.set(true);
    this.cancelRequested$.next();
  }
}
