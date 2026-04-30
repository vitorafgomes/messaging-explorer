import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { BatchOperationResult } from '../../../core/models/message.model';

export interface BulkOperationResultsDialogData {
  operation: 'delete' | 'resubmit' | 'move' | 'export';
  result: BatchOperationResult;
  entityName: string;
  entityType: 'queue' | 'topic';
  isDeadLetter: boolean;
  targetQueue?: string; // For move operations
  allowRetry?: boolean; // Whether retry option should be shown
}

@Component({
  selector: 'app-bulk-operation-results-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule
  ],
  host: {
    '[class.dark-mode-dialog]': 'isDarkMode()'
  },
  template: `
    <div class="modal-header" [class.bg-dark]="isDarkMode()" [class.text-light]="isDarkMode()">
      <h5 class="modal-title d-flex align-items-center gap-2" [class.text-light]="isDarkMode()">
        <i class="fa" [ngClass]="getOperationIcon()"></i>
        {{ getOperationTitle() }}
      </h5>
    </div>

    <div class="modal-body" [class.bg-dark]="isDarkMode()" [class.text-light]="isDarkMode()">
      <!-- Summary -->
      <div class="operation-summary mb-4">
        <p class="mb-2" [class.text-light]="isDarkMode()">
          {{ getOperationSummary() }}
        </p>
      </div>

      <!-- Success/Failure Stats -->
      <div class="result-stats mb-4">
        <div class="stat-card success" [class.border-success]="data.result.successCount > 0">
          <div class="stat-icon">
            <i class="fa fa-check-circle"></i>
          </div>
          <div class="stat-details">
            <div class="stat-value">{{ data.result.successCount }}</div>
            <div class="stat-label">Successful</div>
          </div>
        </div>

        <div class="stat-card failure" [class.border-danger]="data.result.failureCount > 0">
          <div class="stat-icon">
            <i class="fa fa-times-circle"></i>
          </div>
          <div class="stat-details">
            <div class="stat-value">{{ data.result.failureCount }}</div>
            <div class="stat-label">Failed</div>
          </div>
        </div>
      </div>

      <!-- Overall Status -->
      <div class="status-message mb-4" [class.text-light]="isDarkMode()">
        @if (data.result.failureCount === 0) {
          <div class="alert alert-success mb-0" role="alert">
            <i class="fa fa-check-circle me-2"></i>
            <strong>Success!</strong> All messages were processed successfully.
          </div>
        } @else if (data.result.successCount > 0) {
          <div class="alert alert-warning mb-0" role="alert">
            <i class="fa fa-exclamation-triangle me-2"></i>
            <strong>Partial Success:</strong> Some messages failed to process. See details below.
          </div>
        } @else {
          <div class="alert alert-danger mb-0" role="alert">
            <i class="fa fa-times-circle me-2"></i>
            <strong>Failed:</strong> All messages failed to process. See details below.
          </div>
        }
      </div>

      <!-- Failed Messages List -->
      @if (data.result.failureCount > 0) {
        <div class="failures-section">
          <h6 class="failures-title mb-3" [class.text-light]="isDarkMode()">
            <i class="fa fa-list me-2"></i>
            Failed Messages ({{ data.result.failureCount }})
          </h6>

          <div class="failures-list">
            @for (failure of data.result.failures; track failure.sequenceNumber) {
              <div class="failure-item" [class.bg-dark]="isDarkMode()">
                <div class="failure-header">
                  <span class="failure-seq-label">Sequence Number:</span>
                  <span class="failure-seq-value">{{ failure.sequenceNumber }}</span>
                </div>
                <div class="failure-error">
                  <i class="fa fa-exclamation-circle text-danger me-2"></i>
                  <span>{{ failure.error }}</span>
                </div>
              </div>
            }
          </div>

          @if (data.allowRetry && data.result.failureCount > 0) {
            <div class="retry-info mt-3">
              <div class="alert alert-info mb-0" role="alert">
                <i class="fa fa-info-circle me-2"></i>
                <strong>Tip:</strong> You can retry the failed messages by clicking the Retry button below.
              </div>
            </div>
          }
        </div>
      }
    </div>

    <div class="modal-footer" [class.bg-dark]="isDarkMode()">
      @if (data.allowRetry && data.result.failureCount > 0) {
        <button class="btn btn-warning" [mat-dialog-close]="{ retry: true, failedSequenceNumbers: getFailedSequenceNumbers() }">
          <i class="fa-solid fa-arrows-rotate me-2"></i>
          Retry Failed ({{ data.result.failureCount }})
        </button>
      }
      <button class="btn btn-primary" [mat-dialog-close]="{ retry: false }">
        <i class="fa fa-check me-2"></i>
        Close
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
      min-width: 600px;
      max-height: 70vh;
      overflow-y: auto;

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

    .operation-summary {
      p {
        font-size: 0.95rem;
        margin-bottom: 0;
      }
    }

    .result-stats {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;

      .stat-card {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px;
        border-radius: 8px;
        border: 2px solid var(--bs-border-color);
        background-color: var(--bs-light);
        transition: all 0.2s;

        &.success {
          .stat-icon {
            color: var(--bs-success);
            background-color: var(--bs-success-bg-subtle);
          }

          &.border-success {
            border-color: var(--bs-success);
          }
        }

        &.failure {
          .stat-icon {
            color: var(--bs-danger);
            background-color: var(--bs-danger-bg-subtle);
          }

          &.border-danger {
            border-color: var(--bs-danger);
          }
        }

        .stat-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          font-size: 24px;
        }

        .stat-details {
          flex: 1;

          .stat-value {
            font-size: 28px;
            font-weight: 700;
            line-height: 1;
            color: var(--bs-body-color);
            margin-bottom: 4px;
          }

          .stat-label {
            font-size: 0.875rem;
            color: var(--bs-secondary-color);
            font-weight: 500;
          }
        }
      }
    }

    .status-message {
      .alert {
        border-radius: 6px;
        font-size: 0.95rem;
        display: flex;
        align-items: center;

        i {
          font-size: 1.1rem;
        }
      }
    }

    .failures-section {
      .failures-title {
        font-size: 1rem;
        font-weight: 600;
        color: var(--bs-body-color);
        padding-bottom: 8px;
        border-bottom: 2px solid var(--bs-border-color);
      }

      .failures-list {
        max-height: 300px;
        overflow-y: auto;
        border: 1px solid var(--bs-border-color);
        border-radius: 6px;
        background-color: var(--bs-body-bg);
      }

      .failure-item {
        padding: 12px 16px;
        border-bottom: 1px solid var(--bs-border-color);

        &:last-child {
          border-bottom: none;
        }

        &:hover {
          background-color: var(--bs-secondary-bg);
        }

        .failure-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;

          .failure-seq-label {
            font-size: 0.875rem;
            color: var(--bs-secondary-color);
            font-weight: 500;
          }

          .failure-seq-value {
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
            font-weight: 600;
            color: var(--bs-body-color);
            padding: 2px 8px;
            background-color: var(--bs-secondary-bg);
            border-radius: 4px;
          }
        }

        .failure-error {
          display: flex;
          align-items: flex-start;
          gap: 4px;
          font-size: 0.875rem;
          color: var(--bs-body-color);
          padding-left: 4px;

          i {
            margin-top: 2px;
            flex-shrink: 0;
          }

          span {
            flex: 1;
            word-break: break-word;
          }
        }
      }

      .retry-info {
        .alert {
          border-radius: 6px;
          font-size: 0.9rem;
        }
      }
    }

    // Dark mode adjustments
    :host.dark-mode-dialog {
      .result-stats .stat-card {
        background-color: var(--bs-dark);
      }

      .failures-section .failure-item:hover {
        background-color: rgba(255, 255, 255, 0.05);
      }
    }
  `]
})
export class BulkOperationResultsDialogComponent {
  data = inject<BulkOperationResultsDialogData>(MAT_DIALOG_DATA);

  isDarkMode(): boolean {
    if (typeof document === 'undefined') return false;
    const bsTheme = document.documentElement.getAttribute('data-bs-theme');
    const hasThemeDark = document.body.classList.contains('theme-dark');
    return bsTheme === 'dark' || hasThemeDark;
  }

  getOperationIcon(): string {
    switch (this.data.operation) {
      case 'delete':
        return 'fa-trash text-danger';
      case 'resubmit':
        return 'fa-sync text-success';
      case 'move':
        return 'fa-exchange text-primary';
      case 'export':
        return 'fa-download text-info';
      default:
        return 'fa-cog text-secondary';
    }
  }

  getOperationTitle(): string {
    const operation = this.data.operation.charAt(0).toUpperCase() + this.data.operation.slice(1);
    return `${operation} Results`;
  }

  getOperationSummary(): string {
    const total = this.data.result.successCount + this.data.result.failureCount;
    const entity = this.data.entityName;
    const type = this.data.isDeadLetter ? 'dead letter' : 'active';

    switch (this.data.operation) {
      case 'delete':
        return `Attempted to delete ${total} ${type} ${total === 1 ? 'message' : 'messages'} from ${entity}.`;
      case 'resubmit':
        return `Attempted to resubmit ${total} dead letter ${total === 1 ? 'message' : 'messages'} from ${entity}.`;
      case 'move':
        return `Attempted to move ${total} ${type} ${total === 1 ? 'message' : 'messages'} from ${entity} to ${this.data.targetQueue}.`;
      case 'export':
        return `Attempted to export ${total} ${type} ${total === 1 ? 'message' : 'messages'} from ${entity}.`;
      default:
        return `Processed ${total} ${total === 1 ? 'message' : 'messages'}.`;
    }
  }

  getFailedSequenceNumbers(): number[] {
    return this.data.result.failures.map(f => f.sequenceNumber);
  }
}
