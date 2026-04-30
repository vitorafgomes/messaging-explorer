import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, state, style, transition, animate } from '@angular/animations';

/**
 * Bulk action type enumeration
 * Represents all available bulk operations
 */
export type BulkActionType = 'delete' | 'resubmit' | 'move' | 'export' | 'compare';

/**
 * Bulk action event payload
 * Contains the action type and any associated data
 */
export interface BulkActionEvent {
  action: BulkActionType;
}

/**
 * BulkActionsToolbarComponent provides a floating toolbar for bulk operations.
 *
 * Features:
 * - Displays count of selected messages
 * - Action buttons: Delete, Resubmit, Move, Export
 * - Clear selection button
 * - Animated slide-in/out appearance
 * - Responsive to available actions based on tab context
 * - Bootstrap 5 themed styling
 *
 * @example
 * <app-bulk-actions-toolbar
 *   [selectedCount]="5"
 *   [showResubmit]="true"
 *   [disabled]="false"
 *   (actionClicked)="onBulkAction($event)"
 *   (clearSelection)="onClearSelection()"
 * ></app-bulk-actions-toolbar>
 */
@Component({
  selector: 'app-bulk-actions-toolbar',
  standalone: true,
  imports: [CommonModule],
  animations: [
    trigger('slideIn', [
      state('void', style({
        transform: 'translateY(100%)',
        opacity: 0
      })),
      state('*', style({
        transform: 'translateY(0)',
        opacity: 1
      })),
      transition('void => *', animate('300ms cubic-bezier(0.4, 0.0, 0.2, 1)')),
      transition('* => void', animate('200ms cubic-bezier(0.4, 0.0, 0.2, 1)'))
    ])
  ],
  template: `
    @if (selectedCount > 0) {
      <div class="bulk-actions-toolbar" [@slideIn]>
        <div class="toolbar-content">
          <!-- Selection Info -->
          <div class="selection-info">
            <i class="fa fa-check-circle text-primary me-2"></i>
            <span class="selected-count">{{ selectedCount }}</span>
            <span class="selected-text">{{ selectedCount === 1 ? 'message' : 'messages' }} selected</span>
          </div>

          <!-- Action Buttons -->
          <div class="action-buttons">
            <!-- Delete Button -->
            <button
              class="btn btn-outline-danger btn-sm"
              (click)="onActionClick('delete')"
              [disabled]="disabled"
              title="Delete selected messages">
              <i class="fa fa-trash me-1"></i>
              Delete
            </button>

            <!-- Resubmit Button (Dead Letter only) -->
            @if (showResubmit) {
              <button
                class="btn btn-outline-primary btn-sm"
                (click)="onActionClick('resubmit')"
                [disabled]="disabled"
                title="Resubmit selected messages to main queue">
                <i class="fa fa-repeat me-1"></i>
                Resubmit
              </button>
            }

            <!-- Move Button -->
            <button
              class="btn btn-outline-secondary btn-sm"
              (click)="onActionClick('move')"
              [disabled]="disabled"
              title="Move selected messages to another queue">
              <i class="fa fa-exchange me-1"></i>
              Move
            </button>

            <!-- Compare Button (exactly 2 selected) -->
            @if (showCompare) {
              <button
                class="btn btn-outline-primary btn-sm"
                (click)="onActionClick('compare')"
                [disabled]="disabled"
                title="Compare the two selected messages side by side">
                <i class="fa fa-code-compare me-1"></i>
                Compare
              </button>
            }

            <!-- Export Button -->
            <button
              class="btn btn-outline-info btn-sm"
              (click)="onActionClick('export')"
              [disabled]="disabled"
              title="Export selected messages">
              <i class="fa fa-download me-1"></i>
              Export
            </button>
          </div>

          <!-- Clear Selection Button -->
          <div class="clear-section">
            <button
              class="btn btn-link btn-sm text-muted"
              (click)="onClearClick()"
              [disabled]="disabled"
              title="Clear selection">
              <i class="fa fa-times me-1"></i>
              Clear
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .bulk-actions-toolbar {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15), 0 2px 4px rgba(0, 0, 0, 0.1);
      border-radius: var(--bs-border-radius, 0.375rem);
      background: var(--bs-body-bg, #fff);
      border: 1px solid var(--bs-border-color, #dee2e6);
      max-width: 90vw;
    }

    .toolbar-content {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 20px;
      flex-wrap: wrap;
    }

    .selection-info {
      display: flex;
      align-items: center;
      gap: 6px;
      padding-right: 16px;
      border-right: 1px solid var(--bs-border-color, #dee2e6);
      white-space: nowrap;

      i {
        font-size: 18px;
      }

      .selected-count {
        font-size: 18px;
        font-weight: 600;
        color: var(--bs-primary, #0d6efd);
        line-height: 1;
      }

      .selected-text {
        font-size: 14px;
        color: var(--bs-secondary-color, #6c757d);
        font-weight: 500;
      }
    }

    .action-buttons {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      flex: 1;
    }

    .clear-section {
      padding-left: 8px;
      border-left: 1px solid var(--bs-border-color, #dee2e6);

      .btn-link {
        text-decoration: none;
        padding: 4px 8px;

        &:hover:not(:disabled) {
          background: var(--bs-light, #f8f9fa);
          border-radius: var(--bs-border-radius-sm, 0.25rem);
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      }
    }

    .btn-sm {
      font-size: 13px;
      padding: 6px 14px;
      font-weight: 500;
      transition: all 0.15s ease;

      i {
        font-size: 13px;
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    /* Responsive adjustments */
    @media (max-width: 768px) {
      .bulk-actions-toolbar {
        bottom: 16px;
        border-radius: 0.25rem;
        max-width: 95vw;
      }

      .toolbar-content {
        padding: 10px 14px;
        gap: 12px;
      }

      .selection-info {
        padding-right: 12px;
        font-size: 13px;

        .selected-count {
          font-size: 16px;
        }

        .selected-text {
          font-size: 13px;
        }
      }

      .action-buttons {
        gap: 6px;
        width: 100%;
        order: 3;

        .btn-sm {
          flex: 1;
          min-width: calc(50% - 3px);
        }
      }

      .clear-section {
        order: 2;
        padding-left: 0;
        border-left: none;
      }
    }

    @media (max-width: 480px) {
      .bulk-actions-toolbar {
        bottom: 12px;
        max-width: calc(100vw - 24px);
      }

      .toolbar-content {
        padding: 8px 12px;
        gap: 10px;
      }

      .selection-info {
        flex-wrap: wrap;

        .selected-text {
          width: 100%;
          padding-left: 24px;
        }
      }

      .action-buttons .btn-sm {
        min-width: 100%;
        flex: 1 1 100%;
      }
    }

    /* Animation support */
    @media (prefers-reduced-motion: reduce) {
      .bulk-actions-toolbar {
        transition: none;
        animation: none;
      }
    }
  `]
})
export class BulkActionsToolbarComponent {
  /**
   * Number of selected messages to display
   */
  @Input() selectedCount = 0;

  /**
   * Whether to show the Resubmit button (Dead Letter tab only)
   */
  @Input() showResubmit = false;

  /**
   * Whether to show the Compare button (exactly 2 messages selected)
   */
  @Input() showCompare = false;

  /**
   * Whether all action buttons should be disabled
   */
  @Input() disabled = false;

  /**
   * Emitted when a bulk action button is clicked
   */
  @Output() actionClicked = new EventEmitter<BulkActionEvent>();

  /**
   * Emitted when the clear selection button is clicked
   */
  @Output() clearSelection = new EventEmitter<void>();

  /**
   * Handles action button clicks
   * @param action - The action type that was clicked
   */
  onActionClick(action: BulkActionType): void {
    if (!this.disabled) {
      this.actionClicked.emit({ action });
    }
  }

  /**
   * Handles clear selection button click
   */
  onClearClick(): void {
    if (!this.disabled) {
      this.clearSelection.emit();
    }
  }
}
