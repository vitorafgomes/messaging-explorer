import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface BulkOperationProgressDialogData {
  operation: 'delete' | 'resubmit' | 'move' | 'export';
  totalCount: number;
  entityName: string;
  entityType: 'queue' | 'topic';
  isDeadLetter: boolean;
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
      <div class="operation-details mb-4">
        <p class="mb-2" [class.text-light]="isDarkMode()">
          {{ getOperationDescription() }}
        </p>
      </div>

      <!-- Progress Section -->
      <div class="progress-section mb-4">
        <div class="progress-stats mb-2">
          <span class="progress-label">Progress:</span>
          <span class="progress-count">
            <strong>{{ progress().processed }}</strong> of <strong>{{ progress().total }}</strong> messages
          </span>
          <span class="progress-percentage">{{ getProgressPercentage() }}%</span>
        </div>

        <div class="progress" style="height: 24px;">
          <div
            class="progress-bar progress-bar-striped progress-bar-animated"
            [class.bg-success]="isComplete() && progress().failureCount === 0"
            [class.bg-warning]="isComplete() && progress().failureCount > 0 && progress().successCount > 0"
            [class.bg-danger]="isComplete() && progress().successCount === 0"
            role="progressbar"
            [style.width.%]="getProgressPercentage()"
            [attr.aria-valuenow]="progress().processed"
            [attr.aria-valuemin]="0"
            [attr.aria-valuemax]="progress().total">
          </div>
        </div>
      </div>

      <!-- Success/Failure Counts -->
      @if (progress().processed > 0) {
        <div class="result-stats">
          <div class="stat-item success">
            <i class="fa fa-check-circle me-2"></i>
            <span>Success: <strong>{{ progress().successCount }}</strong></span>
          </div>
          @if (progress().failureCount > 0) {
            <div class="stat-item failure">
              <i class="fa fa-exclamation-circle me-2"></i>
              <span>Failed: <strong>{{ progress().failureCount }}</strong></span>
            </div>
          }
        </div>
      }

      <!-- Status Message -->
      <div class="status-message mt-3" [class.text-light]="isDarkMode()">
        @if (!isComplete()) {
          <i class="fa fa-spinner fa-spin me-2"></i>
          <span>{{ getStatusMessage() }}</span>
        } @else if (progress().failureCount === 0) {
          <i class="fa fa-check-circle text-success me-2"></i>
          <span class="text-success">Operation completed successfully!</span>
        } @else if (progress().successCount > 0) {
          <i class="fa fa-exclamation-triangle text-warning me-2"></i>
          <span class="text-warning">Operation completed with some failures</span>
        } @else {
          <i class="fa fa-times-circle text-danger me-2"></i>
          <span class="text-danger">Operation failed</span>
        }
      </div>

      <!-- Cancellation Info -->
      @if (cancelled()) {
        <div class="alert alert-warning mt-3 mb-0" role="alert">
          <i class="fa fa-info-circle me-2"></i>
          <strong>Cancelled:</strong> The operation was cancelled by the user.
          {{ progress().successCount }} {{ progress().successCount === 1 ? 'message was' : 'messages were' }} processed before cancellation.
        </div>
      }
    </div>

    <div class="modal-footer" [class.bg-dark]="isDarkMode()">
      @if (!isComplete() && !cancelled()) {
        <button class="btn btn-warning" (click)="cancel()">
          <i class="fa fa-ban me-2"></i>
          Cancel
        </button>
      } @else {
        <button class="btn btn-primary" [mat-dialog-close]="true">
          <i class="fa fa-check me-2"></i>
          Close
        </button>
      }
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

    .operation-details {
      p {
        font-size: 0.95rem;
        margin-bottom: 0;
      }
    }

    .progress-section {
      .progress-stats {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.9rem;
        color: var(--bs-secondary-color);

        .progress-label {
          font-weight: 500;
        }

        .progress-count {
          flex: 1;
          text-align: center;
        }

        .progress-percentage {
          font-weight: 600;
          color: var(--bs-body-color);
          min-width: 50px;
          text-align: right;
        }
      }

      .progress {
        border-radius: 6px;
        background-color: var(--bs-secondary-bg);
      }
    }

    .result-stats {
      display: flex;
      gap: 24px;
      padding: 12px;
      background-color: var(--bs-light);
      border-radius: 6px;
      border: 1px solid var(--bs-border-color);

      .stat-item {
        display: flex;
        align-items: center;
        font-size: 0.95rem;

        &.success {
          color: var(--bs-success);
        }

        &.failure {
          color: var(--bs-danger);
        }

        i {
          font-size: 1.1rem;
        }
      }
    }

    .status-message {
      text-align: center;
      font-size: 0.95rem;
      padding: 12px;
      background-color: var(--bs-light);
      border-radius: 6px;

      i {
        font-size: 1rem;
      }
    }

    .alert {
      border-radius: 6px;
      font-size: 0.9rem;
    }

    // Dark mode adjustments
    :host.dark-mode-dialog {
      .result-stats,
      .status-message {
        background-color: var(--bs-dark);
      }
    }
  `]
})
export class BulkOperationProgressDialogComponent {
  data = inject<BulkOperationProgressDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<BulkOperationProgressDialogComponent>);

  progress = signal<ProgressUpdate>({
    processed: 0,
    total: this.data.totalCount,
    successCount: 0,
    failureCount: 0
  });

  cancelled = signal(false);

  constructor() {
    // Prevent dialog from being dismissed by clicking outside or pressing ESC
    this.dialogRef.disableClose = true;
  }

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
    return `${operation} Messages`;
  }

  getOperationDescription(): string {
    const count = this.data.totalCount;
    const entity = this.data.entityName;
    const type = this.data.isDeadLetter ? 'dead letter' : 'active';

    switch (this.data.operation) {
      case 'delete':
        return `Deleting ${count} ${type} ${count === 1 ? 'message' : 'messages'} from ${entity}...`;
      case 'resubmit':
        return `Resubmitting ${count} dead letter ${count === 1 ? 'message' : 'messages'} from ${entity}...`;
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
   * Cancels the operation
   * The parent component should handle the actual cancellation logic
   */
  cancel(): void {
    this.cancelled.set(true);
    this.dialogRef.close({ cancelled: true, progress: this.progress() });
  }
}
