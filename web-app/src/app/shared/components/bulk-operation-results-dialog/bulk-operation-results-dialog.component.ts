import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { BatchOperationResult, SUB_QUEUE_LABEL, SubQueue } from '../../../core/models/message.model';
import { isDuplicateRefusal, isPossibleDuplicate, NEW_MESSAGE_ID_OPTION } from '../../../core/services/bulk-operations.service';
import { connectionContext } from '../../../features/entities/connection-context';
import { EnvironmentLineComponent } from '../../environment-line.component';

export interface BulkOperationResultsDialogData {
  operation: 'delete' | 'resubmit' | 'move' | 'export' | 'cancel-scheduled' | 'deadletter' | 'defer';
  /** The operation ran on deferred messages, named by sequence number. */
  deferred?: boolean;
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
  imports: [EnvironmentLineComponent, 
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule
  ],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon [fontIcon]="getOperationIcon()" [class.danger]="data.operation === 'delete' || data.operation === 'cancel-scheduled' || data.operation === 'deadletter'" aria-hidden="true"></mat-icon>
      {{ getOperationTitle() }}
    </h2>

    <mat-dialog-content class="content">
      <app-environment-line [mark]="context().mark"><b>{{ data.entityName }}</b> on {{ context().where }}</app-environment-line>
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
          <mat-icon fontIcon="report" aria-hidden="true"></mat-icon>
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

      @if (data.result.unselectedDeadLettered?.length) {
        <p class="status-message partial dead-lettered" role="alert">
          <mat-icon fontIcon="warning" aria-hidden="true"></mat-icon>
          <span><strong>Sent to the dead-letter queue:</strong> at least {{ data.result.unselectedDeadLettered!.length }} unselected {{ data.result.unselectedDeadLettered!.length === 1 ? 'message' : 'messages' }} reached the max delivery count during the scan: {{ data.result.unselectedDeadLettered!.join(', ') }}.</span>
        </p>
      }

      @if (data.result.unselectedDeliveryCountRaised) {
        <p class="retry-info delivery-count" role="note">
          <mat-icon fontIcon="info" aria-hidden="true"></mat-icon>
          <span>At least {{ data.result.unselectedDeliveryCountRaised }} unselected {{ data.result.unselectedDeliveryCountRaised === 1 ? 'message' : 'messages' }} had their delivery count raised by one.</span>
        </p>
      }

      @if (newIds().length > 0) {
        <section class="failures-section new-ids" aria-labelledby="new-ids-title">
          <table class="failures-table">
            <caption id="new-ids-title" class="failures-title">Sent with a new message ID ({{ newIds().length }})</caption>
            <thead>
              <tr><th scope="col">Sequence Number</th><th scope="col">New message ID</th></tr>
            </thead>
            <tbody>
              @for (entry of newIds(); track entry.sequenceNumber) {
                <tr><td class="failure-seq-value">{{ entry.sequenceNumber }}</td><td class="failure-error">{{ entry.id }}</td></tr>
              }
            </tbody>
          </table>
          <p class="retry-info">
            <mat-icon fontIcon="info" aria-hidden="true"></mat-icon>
            <span>Each copy keeps its original message ID in the x-original-message-id property.</span>
          </p>
        </section>
      }

      @if (data.result.failureCount > 0) {
        <section class="failures-section" aria-labelledby="failures-title">
          <table class="failures-table">
            <caption id="failures-title" class="failures-title">Failed Messages ({{ data.result.failureCount }})</caption>
            <thead>
              <tr><th scope="col">Sequence Number</th><th scope="col">Result</th><th scope="col">Error</th></tr>
            </thead>
            <tbody>
              @for (failure of data.result.failures; track failure.sequenceNumber) {
                <tr class="failure-item" [class.duplicate]="isPossibleDuplicate(failure)">
                  <td class="failure-seq-value">{{ failure.sequenceNumber }}</td>
                  <td>
                    @if (isPossibleDuplicate(failure)) {
                      <span class="duplicate-chip"><mat-icon fontIcon="warning" aria-hidden="true"></mat-icon>Possible duplicate - do not retry</span>
                    } @else {
                      Failed
                    }
                  </td>
                  <td class="failure-error">{{ failure.error }}</td>
                </tr>
              }
            </tbody>
          </table>

          @if (data.allowRetry && getFailedSequenceNumbers().length > 0) {
            <p class="retry-info">
              <mat-icon fontIcon="info" aria-hidden="true"></mat-icon>
              <span><strong>Tip:</strong> You can retry the failed messages by clicking the Retry button below.@if (hasPossibleDuplicate()) { Retry takes {{ retryList() }} only: a possible duplicate is never sent again.}</span>
            </p>
            @if (offersNewMessageId()) {
              <mat-checkbox class="new-message-id" [checked]="newMessageId()" (change)="newMessageId.set($event.checked)">{{ option.label }}</mat-checkbox>
              <p class="retry-info"><mat-icon fontIcon="info" aria-hidden="true"></mat-icon><span>{{ option.hint }}</span></p>
            }
          }
        </section>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (data.allowRetry && getFailedSequenceNumbers().length > 0) {
        <button matButton="outlined" type="button" [mat-dialog-close]="{ retry: true, failedSequenceNumbers: getFailedSequenceNumbers(), newMessageIdOnDuplicateDetection: newMessageId() }">
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
  /** The active connection and its environment, for the line under the title. */
  readonly context = connectionContext();
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
      case 'deadletter':
        return 'report';
      case 'defer':
        return 'schedule';
      default:
        return 'settings';
    }
  }

  getOperationTitle(): string {
    if (this.data.operation === 'cancel-scheduled') {
      return 'Cancel scheduled results';
    }
    if (this.data.operation === 'deadletter') {
      return 'Dead-letter Results';
    }
    const operation = this.data.operation.charAt(0).toUpperCase() + this.data.operation.slice(1);
    return `${operation} Results`;
  }

  getOperationSummary(): string {
    const total = this.data.result.successCount + this.data.result.failureCount;
    const entity = this.data.entityName;
    const subQueue = this.data.subQueue ?? (this.data.isDeadLetter ? 'deadletter' : 'active');
    const type = this.data.deferred ? 'deferred' : SUB_QUEUE_LABEL[subQueue];

    switch (this.data.operation) {
      case 'delete':
        return `Attempted to delete ${total} ${type} ${total === 1 ? 'message' : 'messages'} from ${entity}.`;
      case 'resubmit':
        return `Attempted to resubmit ${total} ${this.data.deferred ? type : SUB_QUEUE_LABEL[subQueue === 'transferdeadletter' ? 'transferdeadletter' : 'deadletter']} ${total === 1 ? 'message' : 'messages'} from ${entity}.`;
      case 'move':
        return `Attempted to move ${total} ${type} ${total === 1 ? 'message' : 'messages'} from ${entity} to ${this.data.targetQueue}.`;
      case 'export':
        return `Attempted to export ${total} ${type} ${total === 1 ? 'message' : 'messages'} from ${entity}.`;
      case 'deadletter':
        return `Attempted to dead-letter ${total} ${type} ${total === 1 ? 'message' : 'messages'} in ${entity}.`;
      case 'defer':
        return `Attempted to defer ${total} ${type} ${total === 1 ? 'message' : 'messages'} in ${entity}.`;
      case 'cancel-scheduled':
        return `Attempted to cancel ${total} scheduled ${total === 1 ? 'message' : 'messages'} in ${entity}.`;
      default:
        return `Processed ${total} ${total === 1 ? 'message' : 'messages'}.`;
    }
  }

  readonly isPossibleDuplicate = isPossibleDuplicate;
  readonly option = NEW_MESSAGE_ID_OPTION;
  /** Whether Retry sends each copy with a new message id; off until the user ticks it. */
  readonly newMessageId = signal(false);

  /** The new message ids the result reports, by sequence number. */
  newIds(): { sequenceNumber: number; id: string }[] {
    return Object.entries(this.data.result.newMessageIds ?? {}).map(([sequenceNumber, id]) => ({ sequenceNumber: Number(sequenceNumber), id }));
  }

  /** True when a resubmit or move was refused because its target detects duplicates, so Retry may ask for new ids. */
  offersNewMessageId(): boolean {
    return (this.data.operation === 'resubmit' || this.data.operation === 'move') && this.data.result.failures.some(isDuplicateRefusal);
  }

  /** Whether any failure of the result may have been sent already. */
  hasPossibleDuplicate(): boolean {
    return this.data.result.failures.some(f => this.isPossibleDuplicate(f));
  }

  /** The sequence numbers Retry takes, the first ten and how many more. */
  retryList(): string {
    const all = this.getFailedSequenceNumbers();
    const shown = all.slice(0, 10).join(', ');
    return all.length > 10 ? `${shown} and ${all.length - 10} more` : shown;
  }

  /**
   * The failures a retry may resend: every failure except a possible duplicate.
   */
  getFailedSequenceNumbers(): number[] {
    return this.data.result.failures.filter(f => !isPossibleDuplicate(f)).map(f => f.sequenceNumber);
  }
}
