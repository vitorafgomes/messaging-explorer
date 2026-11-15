import { Component, Input, Output, EventEmitter } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * Bulk action type enumeration
 * Represents all available bulk operations
 */
export type BulkActionType = 'delete' | 'resubmit' | 'move' | 'export' | 'compare' | 'cancel-scheduled'
  | 'resubmit-deferred' | 'deadletter-deferred' | 'delete-deferred';

/**
 * Bulk action event payload
 * Contains the action type and any associated data
 */
export interface BulkActionEvent {
  action: BulkActionType;
}

/**
 * The selection bar of the messages dialog: always on screen, it says what the selection covers
 * and offers the bulk actions, with Delete apart from the routine ones in the error colour.
 */
@Component({
  selector: 'app-bulk-actions-toolbar',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="bar" [class.has-selection]="selectedCount > 0">
      <span class="selection" aria-live="polite">
        @if (selectedCount > 0) {
          <mat-icon fontIcon="check_circle" aria-hidden="true"></mat-icon>
          <span><strong class="selected-count">{{ selectedCount }}</strong> {{ detail || (selectedCount === 1 ? 'message selected' : 'messages selected') }}</span>
        } @else {
          {{ showDelete ? 'No message selected. Tick rows to resubmit, move, compare, export or delete them.' : showResubmit ? 'No message selected. Tick rows to resubmit, compare or export them.' : 'No message selected. Tick rows to compare or export them.' }}
        }
      </span>

      @if (selectedCount > 0) {
        <div class="actions">
          @if (showResubmit) {
            <button matButton="outlined" type="button" (click)="onActionClick('resubmit')" [disabled]="disabled"
                    title="Resubmit selected messages to main queue">
              <mat-icon fontIcon="replay" aria-hidden="true"></mat-icon>
              Resubmit
            </button>
          }

          @if (showMove) {
            <button matButton="outlined" type="button" (click)="onActionClick('move')" [disabled]="disabled"
                    title="Move selected messages to another queue">
              <mat-icon fontIcon="swap_horiz" aria-hidden="true"></mat-icon>
              Move
            </button>
          }

          @if (showCompare) {
            <button matButton="outlined" type="button" (click)="onActionClick('compare')" [disabled]="disabled"
                    title="Compare the two selected messages side by side">
              <mat-icon fontIcon="compare" aria-hidden="true"></mat-icon>
              Compare
            </button>
          }

          <button matButton="outlined" type="button" (click)="onActionClick('export')" [disabled]="disabled"
                  title="Export selected messages">
            <mat-icon fontIcon="download" aria-hidden="true"></mat-icon>
            Export
          </button>

          @if (showCancelScheduled) {
            <button matButton="outlined" type="button" class="delete" disabledInteractive
                    (click)="cancelScheduledBlockedReason ? null : onActionClick('cancel-scheduled')"
                    [disabled]="disabled || !!cancelScheduledBlockedReason"
                    [attr.aria-describedby]="cancelScheduledBlockedReason ? 'cancel-scheduled-reason' : null"
                    [title]="cancelScheduledBlockedReason || 'Delete the selected scheduled messages before they are delivered'">Cancel scheduled</button>
          }

          @if (deferredCount > 0) {
            <button matButton="outlined" type="button" (click)="onActionClick('resubmit-deferred')" [disabled]="disabled"
                    title="Resubmit the selected deferred messages as active copies">
              <mat-icon fontIcon="replay" aria-hidden="true"></mat-icon>
              Resubmit deferred
            </button>
            <button matButton="outlined" type="button" (click)="onActionClick('deadletter-deferred')" [disabled]="disabled"
                    title="Send the selected deferred messages to the dead-letter queue">Dead-letter deferred</button>
          }

          <button matButton type="button" (click)="onClearClick()" [disabled]="disabled" title="Clear selection">Clear</button>

          @if (showDelete) {
            <span class="divider" aria-hidden="true"></span>
            <button matButton type="button" class="delete"
                    (click)="onActionClick('delete')" [disabled]="disabled" title="Delete selected messages">
              <mat-icon fontIcon="delete" aria-hidden="true"></mat-icon>
              Delete {{ selectedCount }}
            </button>
          }
          @if (deferredCount > 0) {
            <button matButton type="button" class="delete"
                    (click)="onActionClick('delete-deferred')" [disabled]="disabled" title="Delete the selected deferred messages">
              Delete {{ deferredCount }} deferred
            </button>
          }
        </div>
        @if (showCancelScheduled && cancelScheduledBlockedReason) {
          <p id="cancel-scheduled-reason" class="blocked-reason">Cancel scheduled is off: {{ cancelScheduledBlockedReason }}</p>
        }
        @if (deferredNote) {
          <p class="blocked-reason deferred-note">{{ deferredNote }}</p>
        }
      }
    </div>
  `,
  styleUrl: './bulk-actions-toolbar.component.scss'
})
export class BulkActionsToolbarComponent {
  /**
   * Number of selected messages to display
   */
  @Input() selectedCount = 0;

  /**
   * Text after the count, such as "selected of 20 loaded, 37 in the dead-letter queue";
   * when empty the toolbar says "messages selected"
   */
  @Input() detail = '';

  /**
   * Whether to show the Resubmit button (Dead Letter tab only)
   */
  @Input() showResubmit = false;

  /**
   * Whether to show the Compare button (exactly 2 messages selected)
   */
  @Input() showCompare = false;

  /**
   * Whether to show the Move button; a sub-queue that cannot be moved hides it
   */
  @Input() showMove = true;

  /** Whether Delete is offered; false where the broker declares no safe bulk operations. */
  @Input() showDelete = true;

  /**
   * Whether to show Cancel scheduled; offered on a queue's Active tab only
   */
  @Input() showCancelScheduled = false;

  /**
   * Why Cancel scheduled cannot run for the current selection; empty when it can
   */
  @Input() cancelScheduledBlockedReason = '';

  /**
   * How many selected messages are deferred and reachable by the deferred actions; 0 hides them
   */
  @Input() deferredCount = 0;

  /**
   * What the deferred actions leave out of the selection, and what the other actions cannot reach; empty says nothing
   */
  @Input() deferredNote = '';

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
