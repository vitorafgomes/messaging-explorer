import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { BatchOperationResult, SUB_QUEUE_LABEL, SubQueue } from '../../../core/models/message.model';
import { isPossibleDuplicate } from '../../../core/services/bulk-operations.service';

export interface BulkOperationResultsDialogData {
  operation: 'delete' | 'resubmit' | 'move' | 'export' | 'cancel-scheduled';
  result: BatchOperationResult;
  entityName: string;
  entityType: 'queue' | 'topic';
  /** The sub-queue the operation ran on; callers pass this. */
  subQueue?: SubQueue;
  /** Older form of subQueue, read only when subQueue is absent. */
  isDeadLetter?: boolean;
  targetQueue?: string; // For move operations
  allowRetry?: boolean; // Whether retry option should be shown
}

@Component({
  selector: 'app-bulk-operation-results-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule
  ],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon [fontIcon]="getOperationIcon()" [class.danger]="data.operation === 'delete' || data.operation === 'cancel-scheduled'" aria-hidden="true"></mat-icon>
      {{ getOperationTitle() }}
    </h2>

    <mat-dialog-content class="content">
      <p class="operation-summary">{{ getOperationSummary() }}</p>

      <div class="result-stats">
        <div class="stat-card" [class.success]="data.result.successCount > 0">
          <mat-icon fontIcon="check_circle" aria-hidden="true"></mat-icon>
          <span class="stat-details">
            <span class="stat-value">{{ data.result.successCount }}</span>
            <span class="stat-label">Successful</span>
          </span>
        </div>
        <div class="stat-card" [class.failure]="data.result.failureCount > 0">
          <mat-icon fontIcon="cancel" aria-hidden="true"></mat-icon>
          <span class="stat-details">
            <span class="stat-value">{{ data.result.failureCount }}</span>
            <span class="stat-label">Failed</span>
          </span>
        </div>
      </div>

      @if (data.result.failureCount === 0) {
        <p class="status-message success" role="status">
          <mat-icon fontIcon="check_circle" aria-hidden="true"></mat-icon>
          <span><strong>Success!</strong> All messages were processed successfully.</span>
        </p>
      } @else if (data.result.successCount > 0) {
        <p class="status-message partial" role="alert">
          <mat-icon fontIcon="warning" aria-hidden="true"></mat-icon>
          <span><strong>Partial Success:</strong> Some messages failed to process. See details below.</span>
        </p>
      } @else {
        <p class="status-message failed" role="alert">
          <mat-icon fontIcon="cancel" aria-hidden="true"></mat-icon>
          <span><strong>Failed:</strong> All messages failed to process. See details below.</span>
        </p>
      }

      @if (data.result.failureCount > 0) {
        <section class="failures-section" aria-labelledby="failures-title">
          <h3 id="failures-title" class="failures-title">Failed Messages ({{ data.result.failureCount }})</h3>
          <ul class="failures-list">
            @for (failure of data.result.failures; track failure.sequenceNumber) {
              <li class="failure-item" [class.duplicate]="isPossibleDuplicate(failure)">
                <span class="failure-header">
                  <span class="failure-seq-label">Sequence Number:</span>
                  <span class="failure-seq-value">{{ failure.sequenceNumber }}</span>
                </span>
                <span class="failure-error">
                  <mat-icon [fontIcon]="isPossibleDuplicate(failure) ? 'warning' : 'error'" aria-hidden="true"></mat-icon>
                  <span>{{ isPossibleDuplicate(failure) ? 'Possible duplicate - do not retry' : 'Failed' }}: {{ failure.error }}</span>
                </span>
              </li>
            }
          </ul>

          @if (data.allowRetry && getFailedSequenceNumbers().length > 0) {
            <p class="retry-info">
              <mat-icon fontIcon="info" aria-hidden="true"></mat-icon>
              <span><strong>Tip:</strong> You can retry the failed messages by clicking the Retry button below.</span>
            </p>
          }
        </section>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (data.allowRetry && getFailedSequenceNumbers().length > 0) {
        <button matButton="outlined" type="button" [mat-dialog-close]="{ retry: true, failedSequenceNumbers: getFailedSequenceNumbers() }">
          <mat-icon fontIcon="replay" aria-hidden="true"></mat-icon>
          Retry Failed ({{ getFailedSequenceNumbers().length }})
        </button>
      }
      <button matButton="filled" type="button" [mat-dialog-close]="{ retry: false }">
        <mat-icon fontIcon="check" aria-hidden="true"></mat-icon>
        Close
      </button>
    </mat-dialog-actions>
  `,
  styleUrl: './bulk-operation-results-dialog.component.scss'
})
export class BulkOperationResultsDialogComponent {
  data = inject<BulkOperationResultsDialogData>(MAT_DIALOG_DATA);

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
      case 'cancel-scheduled':
        return 'event_busy';
      default:
        return 'settings';
    }
  }

  getOperationTitle(): string {
    if (this.data.operation === 'cancel-scheduled') {
      return 'Cancel scheduled results';
    }
    const operation = this.data.operation.charAt(0).toUpperCase() + this.data.operation.slice(1);
    return `${operation} Results`;
  }

  getOperationSummary(): string {
    const total = this.data.result.successCount + this.data.result.failureCount;
    const entity = this.data.entityName;
    const subQueue = this.data.subQueue ?? (this.data.isDeadLetter ? 'deadletter' : 'active');
    const type = SUB_QUEUE_LABEL[subQueue];

    switch (this.data.operation) {
      case 'delete':
        return `Attempted to delete ${total} ${type} ${total === 1 ? 'message' : 'messages'} from ${entity}.`;
      case 'resubmit':
        return `Attempted to resubmit ${total} ${SUB_QUEUE_LABEL[subQueue === 'transferdeadletter' ? 'transferdeadletter' : 'deadletter']} ${total === 1 ? 'message' : 'messages'} from ${entity}.`;
      case 'move':
        return `Attempted to move ${total} ${type} ${total === 1 ? 'message' : 'messages'} from ${entity} to ${this.data.targetQueue}.`;
      case 'export':
        return `Attempted to export ${total} ${type} ${total === 1 ? 'message' : 'messages'} from ${entity}.`;
      case 'cancel-scheduled':
        return `Attempted to cancel ${total} scheduled ${total === 1 ? 'message' : 'messages'} in ${entity}.`;
      default:
        return `Processed ${total} ${total === 1 ? 'message' : 'messages'}.`;
    }
  }

  readonly isPossibleDuplicate = isPossibleDuplicate;

  /**
   * The failures a retry may resend: every failure except a possible duplicate.
   */
  getFailedSequenceNumbers(): number[] {
    return this.data.result.failures.filter(f => !isPossibleDuplicate(f)).map(f => f.sequenceNumber);
  }
}
