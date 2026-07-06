import { Component, OnInit, inject, signal, DestroyRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Subject, finalize } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { QueueService, TopicService, ConnectionService, MessageSearchService, AdvancedMessageFilterService, BulkOperationsService, MessageExportService } from '../../core/services';
import { MessageInfo, AdvancedFilterState, FilterLogic } from '../../core/models';
import { HighlightPipe } from '../../shared/pipes';
import { AdvancedFilterPanelComponent } from '../../shared/components/advanced-filter-panel/advanced-filter-panel.component';
import { BulkActionsToolbarComponent, BulkActionEvent } from '../../shared/components/bulk-actions-toolbar/bulk-actions-toolbar.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { MoveMessagesDialogComponent, MoveMessagesDialogData } from './move-messages-dialog.component';
import { ExportMessagesDialogComponent, ExportMessagesDialogData, ExportOptions } from './export-messages-dialog.component';
import { BulkOperationProgressDialogComponent, BulkOperationProgressDialogData } from '../../shared/components/bulk-operation-progress-dialog/bulk-operation-progress-dialog.component';
import { BulkOperationResultsDialogComponent, BulkOperationResultsDialogData } from '../../shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component';
import { SendMessageDialogComponent, SendMessageDialogData } from './send-message-dialog.component';
import { MessageDiffDialogComponent, MessageDiffDialogData } from './message-diff-dialog.component';

export interface ViewMessagesDialogData {
  entityType: 'queue' | 'subscription';
  entityName: string;
  topicName?: string; // For subscriptions
  activeMessageCount?: number;
  deadLetterMessageCount?: number;
  initialTab?: number; // 0 = Active Messages, 1 = Dead Letter
}

@Component({
  selector: 'app-view-messages-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ScrollingModule,
    MatDialogModule,
    MatSnackBarModule,
    HighlightPipe,
    AdvancedFilterPanelComponent,
    BulkActionsToolbarComponent
  ],
  template: `
    <div class="modal-header">
      <h5 class="modal-title d-flex align-items-center gap-2">
        <i class="fa fa-envelope text-primary"></i>
        Messages: {{ data.entityName }}
      </h5>
    </div>

    <div class="modal-body">
      <ul class="nav nav-tabs mb-3" role="tablist">
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="selectedTabIndex === 0" (click)="setTab(0)" type="button">
            <i class="fa fa-inbox me-2"></i>
            Active Messages
            <span class="badge bg-primary ms-2">{{ activeMessageCount() ?? activeMessages.length }}</span>
          </button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="selectedTabIndex === 1" (click)="setTab(1)" type="button">
            <i class="fa fa-exclamation-triangle me-2"></i>
            Dead Letter
            <span class="badge bg-danger ms-2">{{ deadLetterMessageCount() ?? deadLetterMessages.length }}</span>
          </button>
        </li>
      </ul>

      @if (selectedTabIndex === 0) {
        <div class="tab-pane-content">
          <div class="toolbar">
            <div class="count-field">
              <label class="form-label">Count</label>
              <input class="form-control" type="number" [(ngModel)]="peekCount" (ngModelChange)="onCountChange($event)" min="0">
            </div>
            <div class="filter-field">
              <label class="form-label">Quick search</label>
              <div class="input-group" [class.has-error]="activeRegexError">
                <span class="input-group-text"><i class="fa fa-search"></i></span>
                <input class="form-control" [class.is-invalid]="activeRegexError" [(ngModel)]="activeFilterText" (ngModelChange)="onFilterChange()" placeholder="Search in any field...">
                <button
                  class="btn btn-outline-secondary regex-toggle"
                  [class.active]="activeRegexMode"
                  (click)="toggleActiveRegexMode()"
                  title="Toggle regex search mode">
                  <span class="regex-icon">.*</span>
                </button>
                @if (activeFilterText) {
                  <button class="btn btn-outline-secondary" (click)="clearActiveFilter()">
                    <i class="fa fa-times"></i>
                  </button>
                }
              </div>
              @if (activeRegexError) {
                <div class="regex-error">
                  <i class="fa fa-exclamation-circle"></i>
                  {{ activeRegexError }}
                </div>
              }
            </div>
            <div class="refresh-button-container">
              <button class="btn btn-outline-primary" (click)="loadActiveMessages()" [disabled]="loadingActive()">
                <i class="fa-solid fa-arrows-rotate me-2"></i>
                Refresh
              </button>
            </div>
          </div>

          <!-- Advanced Filter Panel -->
          <div class="advanced-filter-wrapper">
            <app-advanced-filter-panel
              [filterState]="activeAdvancedFilterState"
              [messages]="activeMessages"
              [isCollapsed]="activeFilterPanelCollapsed"
              (filterStateChange)="onActiveAdvancedFilterChange($event)"
              (collapsedChange)="activeFilterPanelCollapsed = $event">
            </app-advanced-filter-panel>
          </div>

          @if (activeFilterText || activeAdvancedFilterState.conditions.length > 0) {
            <div class="filter-info">
              <span class="filter-summary">{{ getActiveFilterSummary() }}</span>
              <button class="clear-link" (click)="clearAllActiveFilters()">
                <i class="fa fa-times-circle me-1"></i>Clear all
              </button>
            </div>
          }

          @if (loadingActive()) {
            <div class="loading">
              <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
              </div>
            </div>
          } @else if (activeMessages.length === 0) {
            <div class="text-center py-5">
              <i class="fa fa-check-circle fa-4x text-secondary mb-3"></i>
              <p class="mb-0">No active messages</p>
            </div>
          } @else if (filteredActiveMessages.length === 0) {
            <div class="text-center py-5">
              <i class="fa fa-search fa-4x text-secondary mb-3"></i>
              <p class="mb-0">No messages match your filter</p>
            </div>
          } @else {
            <div class="select-all-row">
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="selectAllActive"
                  [checked]="isAllActiveSelected()"
                  [indeterminate]="isActiveIndeterminate()"
                  (change)="toggleAllActive($any($event.target).checked)">
                <label class="form-check-label" for="selectAllActive">
                  Select All ({{ filteredActiveMessages.length }})
                </label>
              </div>
            </div>
            <cdk-virtual-scroll-viewport itemSize="80" class="messages-list">
              @for (msg of filteredActiveMessages; track msg.sequenceNumber) {
                <div class="message-card" (click)="selectMessage(msg)" [class.selected]="selectedMessage === msg">
                  <div class="message-row">
                    <div class="form-check">
                      <input class="form-check-input" type="checkbox" [id]="'activeMsg-' + msg.sequenceNumber"
                        [checked]="isActiveMessageSelected(msg.sequenceNumber)"
                        (change)="toggleActiveSelection(msg, $any($event.target).checked)"
                        (click)="$event.stopPropagation()">
                    </div>
                    <div class="message-content">
                      <div class="message-header">
                        <span class="seq">#{{ msg.sequenceNumber }}</span>
                        <span class="id">{{ msg.messageId }}</span>
                        <span class="time">{{ msg.enqueuedTime | date:'short' }}</span>
                      </div>
                      <div class="message-preview" [innerHTML]="getTruncatedBody(msg.body) | highlight:activeFilterText:{ mode: activeRegexMode ? 'regex' : 'text', caseSensitive: false }"></div>
                    </div>
                  </div>
                </div>
              }
            </cdk-virtual-scroll-viewport>
          }
        </div>
      }

      @if (selectedTabIndex === 1) {
        <div class="tab-pane-content">
          @if (data.entityType === 'subscription') {
            <div class="filter-warning">
              <i class="fa fa-info-circle"></i>
              <span>Resubmitted messages will be sent to the topic and will pass through all subscription filters. If this subscription has filters configured, the message may not return to it.</span>
            </div>
          }
          <div class="toolbar">
            <div class="count-field">
              <label class="form-label">Count</label>
              <input class="form-control" type="number" [(ngModel)]="peekCount" (ngModelChange)="onCountChange($event)" min="0">
            </div>
            <div class="filter-field">
              <label class="form-label">Quick search</label>
              <div class="input-group" [class.has-error]="dlRegexError">
                <span class="input-group-text"><i class="fa fa-search"></i></span>
                <input class="form-control" [class.is-invalid]="dlRegexError" [(ngModel)]="dlFilterText" (ngModelChange)="onDLFilterChange()" placeholder="Search in any field...">
                <button
                  class="btn btn-outline-secondary regex-toggle"
                  [class.active]="dlRegexMode"
                  (click)="toggleDLRegexMode()"
                  title="Toggle regex search mode">
                  <span class="regex-icon">.*</span>
                </button>
                @if (dlFilterText) {
                  <button class="btn btn-outline-secondary" (click)="clearDLFilter()">
                    <i class="fa fa-times"></i>
                  </button>
                }
              </div>
              @if (dlRegexError) {
                <div class="regex-error">
                  <i class="fa fa-exclamation-circle"></i>
                  {{ dlRegexError }}
                </div>
              }
            </div>
            <div class="refresh-button-container">
              <button class="btn btn-outline-primary" (click)="loadDeadLetterMessages()" [disabled]="loadingDL()">
                <i class="fa-solid fa-arrows-rotate me-2"></i>
                Refresh
              </button>
            </div>
          </div>

          <!-- Advanced Filter Panel -->
          <div class="advanced-filter-wrapper">
            <app-advanced-filter-panel
              [filterState]="dlAdvancedFilterState"
              [messages]="deadLetterMessages"
              [isCollapsed]="dlFilterPanelCollapsed"
              (filterStateChange)="onDLAdvancedFilterChange($event)"
              (collapsedChange)="dlFilterPanelCollapsed = $event">
            </app-advanced-filter-panel>
          </div>

          @if (dlFilterText || dlAdvancedFilterState.conditions.length > 0) {
            <div class="filter-info">
              <span class="filter-summary">{{ getDLFilterSummary() }}</span>
              <button class="clear-link" (click)="clearAllDLFilters()">
                <i class="fa fa-times-circle me-1"></i>Clear all
              </button>
            </div>
          }

            @if (loadingDL()) {
              <div class="text-center py-5">
                <div class="spinner-border text-primary" role="status">
                  <span class="visually-hidden">Loading...</span>
                </div>
              </div>
            } @else if (deadLetterMessages.length === 0) {
              <div class="text-center py-5">
                <i class="fa fa-check-circle fa-4x text-secondary mb-3"></i>
                <p class="mb-0">No dead letter messages</p>
              </div>
            } @else if (filteredDeadLetterMessages.length === 0) {
              <div class="text-center py-5">
                <i class="fa fa-search fa-4x text-secondary mb-3"></i>
                <p class="mb-0">No messages match your filter</p>
              </div>
            } @else {
              <div class="select-all-row">
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="selectAllDL"
                    [checked]="isAllDeadLetterSelected()"
                    [indeterminate]="isDeadLetterIndeterminate()"
                    (change)="toggleAllDeadLetter($any($event.target).checked)">
                  <label class="form-check-label" for="selectAllDL">
                    Select All ({{ filteredDeadLetterMessages.length }})
                  </label>
                </div>
              </div>
              <cdk-virtual-scroll-viewport itemSize="80" class="messages-list">
                @for (msg of filteredDeadLetterMessages; track msg.sequenceNumber) {
                  <div class="message-card dead-letter" (click)="selectMessage(msg)" [class.selected]="selectedMessage === msg">
                    <div class="message-row">
                      <div class="form-check">
                        <input class="form-check-input" type="checkbox" [id]="'dlMsg-' + msg.sequenceNumber"
                          [checked]="isDeadLetterMessageSelected(msg.sequenceNumber)"
                          (change)="toggleDeadLetterSelection(msg, $any($event.target).checked)"
                          (click)="$event.stopPropagation()">
                      </div>
                      <div class="message-content">
                        <div class="message-header">
                          <span class="seq">#{{ msg.sequenceNumber }}</span>
                          <span class="reason">{{ msg.deadLetterReason || 'Unknown' }}</span>
                          <span class="time">{{ msg.enqueuedTime | date:'short' }}</span>
                        </div>
                        <div class="message-preview" [innerHTML]="getTruncatedBody(msg.body) | highlight:dlFilterText:{ mode: dlRegexMode ? 'regex' : 'text', caseSensitive: false }"></div>
                      </div>
                    </div>
                  </div>
                }
              </cdk-virtual-scroll-viewport>
            }
          </div>
        }

      @if (selectedMessage) {
        <div class="message-detail">
          <h4 class="mb-3">Message Details</h4>
          <div class="detail-grid">
            <div class="detail-item">
              <label class="text-muted small">Message ID</label>
              <span class="fw-medium">{{ selectedMessage.messageId }}</span>
            </div>
            <div class="detail-item">
              <label class="text-muted small">Sequence Number</label>
              <span class="fw-medium">{{ selectedMessage.sequenceNumber }}</span>
            </div>
            <div class="detail-item">
              <label class="text-muted small">Correlation ID</label>
              <span class="fw-medium">{{ selectedMessage.correlationId || '-' }}</span>
            </div>
            <div class="detail-item">
              <label class="text-muted small">Content Type</label>
              <span class="fw-medium">{{ selectedMessage.contentType || '-' }}</span>
            </div>
            <div class="detail-item">
              <label class="text-muted small">Enqueued Time</label>
              <span class="fw-medium">{{ selectedMessage.enqueuedTime | date:'medium' }}</span>
            </div>
            <div class="detail-item">
              <label class="text-muted small">Delivery Count</label>
              <span class="fw-medium">{{ selectedMessage.deliveryCount }}</span>
            </div>
          </div>

          <h4 class="mb-3 mt-4">Body</h4>
          <pre class="body-content" [innerHTML]="formatBody(selectedMessage.body) | highlight:getActiveFilterText():{ mode: getActiveRegexMode() ? 'regex' : 'text', caseSensitive: false }"></pre>

          @if (selectedMessage.applicationProperties && hasProperties(selectedMessage.applicationProperties)) {
            <h4 class="mb-3 mt-4">Application Properties</h4>
            <div class="properties">
              @for (prop of getProperties(selectedMessage.applicationProperties); track prop.key) {
                <div class="property">
                  <span class="key">{{ prop.key }}:</span>
                  <span class="value" [innerHTML]="prop.value | highlight:getActiveFilterText():{ mode: getActiveRegexMode() ? 'regex' : 'text', caseSensitive: false }"></span>
                </div>
              }
            </div>
          }

          @if (selectedTabIndex === 1) {
            <div class="message-actions mt-4">
              <button class="btn btn-outline-warning" (click)="editAndResubmit(selectedMessage)">
                <i class="fa fa-pencil me-2"></i>
                Edit & Resubmit
              </button>
              <button class="btn btn-outline-success" (click)="resubmit(selectedMessage)">
                <i class="fa fa-rotate-right me-2"></i>
                Resubmit
              </button>
            </div>
          }
        </div>
      }
    </div>

    <!-- Bulk Actions Toolbar -->
    <app-bulk-actions-toolbar
      [selectedCount]="getSelectedCount()"
      [showResubmit]="selectedTabIndex === 1"
      [showCompare]="getSelectedCount() === 2"
      [disabled]="isBulkOperationInProgress()"
      (actionClicked)="onBulkAction($event)"
      (clearSelection)="onClearSelection()">
    </app-bulk-actions-toolbar>
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
      min-width: 800px;
      min-height: 500px;
      display: flex;
      flex-direction: column;
    }

    .tab-content {
      padding: 16px 0;
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .tab-pane-content {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .filter-warning {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      background: var(--bs-warning-bg-subtle);
      border-left: 4px solid var(--bs-warning);
      border-radius: 4px;
      margin-bottom: 16px;
      font-size: 13px;
      line-height: 1.5;

      i {
        color: var(--bs-warning);
        font-size: 20px;
        margin-top: 2px;
      }

      span {
        flex: 1;
        color: var(--bs-warning-text-emphasis);
      }
    }

    .toolbar {
      display: flex;
      gap: 12px;
      align-items: flex-end;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .advanced-filter-wrapper {
      margin-bottom: 16px;
    }

    .count-field,
    .filter-property-field,
    .filter-field,
    .refresh-button-container,
    .resubmit-button-container {
      label {
        display: block;
        font-size: 13px;
        margin-bottom: 4px;
        color: var(--bs-secondary-color);
      }
    }

    .count-field {
      width: 100px;
    }

    .filter-field {
      flex: 1;
      min-width: 200px;

      .input-group.has-error {
        .form-control.is-invalid {
          border-color: var(--bs-danger);
          border-right: none;

          &:focus {
            border-color: var(--bs-danger);
            box-shadow: 0 0 0 0.25rem rgba(var(--bs-danger-rgb), 0.25);
          }
        }

        .input-group-text {
          border-color: var(--bs-danger);
        }

        .btn-outline-secondary {
          border-color: var(--bs-danger);
        }
      }
    }

    .regex-error {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      padding: 6px 10px;
      background: var(--bs-danger-bg-subtle);
      border-left: 3px solid var(--bs-danger);
      border-radius: 4px;
      font-size: 12px;
      color: var(--bs-danger-text-emphasis);

      i {
        color: var(--bs-danger);
        font-size: 14px;
      }
    }

    .filter-property-field {
      width: 180px;
    }

    .regex-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: monospace;
      font-weight: 600;
      font-size: 14px;
      min-width: 48px;
      transition: all 0.2s;

      &:hover {
        background: var(--bs-secondary-bg);
      }

      &.active {
        background: var(--bs-primary);
        color: var(--bs-white);
        border-color: var(--bs-primary);

        &:hover {
          background: var(--bs-primary-text-emphasis);
          border-color: var(--bs-primary-text-emphasis);
        }
      }

      .regex-icon {
        display: inline-block;
        line-height: 1;
      }
    }

    .filter-info {
      padding: 8px 12px;
      background: var(--bs-primary-bg-subtle);
      border-left: 4px solid var(--bs-primary);
      border-radius: 4px;
      margin-bottom: 12px;
      font-size: 13px;
      color: var(--bs-primary-text-emphasis);
      font-weight: 500;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;

      .filter-summary {
        flex: 1;
      }

      .clear-link {
        background: transparent;
        border: none;
        color: var(--bs-primary);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        transition: all 0.2s;
        white-space: nowrap;

        &:hover {
          background: var(--bs-primary);
          color: var(--bs-white);
        }

        i {
          font-size: 14px;
        }
      }
    }

    .messages-list {
      height: 250px;
      width: 100%;
    }

    // Virtual scroll viewport styles
    cdk-virtual-scroll-viewport {
      height: 100%;
      width: 100%;
    }

    // Content wrapper for virtual scroll items
    ::ng-deep .cdk-virtual-scroll-content-wrapper {
      width: 100%;
    }

    .message-card {
      padding: 12px;
      border: 1px solid var(--bs-border-color);
      border-radius: 4px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        background: var(--bs-secondary-bg);
      }

      &.selected {
        border-color: var(--bs-primary);
        background: var(--bs-primary-bg-subtle);
      }

      &.dead-letter {
        border-left: 4px solid var(--bs-danger);
      }
    }

    .message-header {
      display: flex;
      gap: 16px;
      font-size: 12px;
      color: var(--bs-secondary-color);
      margin-bottom: 8px;

      .seq {
        font-weight: 500;
        color: var(--bs-primary);
      }

      .reason {
        color: var(--bs-danger);
      }

      .time {
        margin-left: auto;
      }
    }

    .message-preview {
      font-family: monospace;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .select-all-row {
      padding: 8px 12px;
      background: var(--bs-secondary-bg);
      border-radius: 4px;
      margin-bottom: 8px;
    }

    .message-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .message-content {
      flex: 1;
      min-width: 0;
    }

    .message-detail {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid var(--bs-border-color);

      h4 {
        color: var(--bs-secondary-color);
        font-size: 14px;
        font-weight: 500;
      }
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }

    .detail-item {
      display: flex;
      flex-direction: column;
      gap: 4px;

      label {
        font-size: 11px;
        text-transform: uppercase;
      }

      span {
        font-size: 13px;
      }
    }

    .body-content {
      background: var(--bs-dark);
      color: var(--bs-light);
      padding: 16px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 13px;
      max-height: 200px;
    }

    .properties {
      background: var(--bs-secondary-bg);
      padding: 12px;
      border-radius: 4px;
    }

    .property {
      margin-bottom: 8px;

      .key {
        font-weight: 500;
        color: var(--bs-primary);
      }

      .value {
        margin-left: 8px;
      }
    }

    .message-actions {
      display: flex;
      gap: 8px;
      padding-top: 16px;
      border-top: 1px solid var(--bs-border-color);
    }

    // Highlight styles for search matches
    mark,
    ::ng-deep mark {
      background-color: var(--bs-warning);
      color: var(--bs-dark);
      padding: 2px 4px;
      border-radius: 2px;
      font-weight: 500;

      // Ensure visibility in dark theme
      [data-bs-theme="dark"] & {
        background-color: #ffc107;
        color: #212529;
      }
    }

    // Special handling for highlights within code/pre blocks
    .body-content {
      mark,
      ::ng-deep mark {
        background-color: #ffc107;
        color: #212529;
        padding: 2px 4px;
        border-radius: 2px;
        font-weight: 600;
        box-shadow: 0 0 0 1px rgba(255, 193, 7, 0.3);
      }
    }

    // Ensure proper rendering of consecutive highlights
    .message-preview,
    .body-content,
    .properties {
      ::ng-deep mark + mark {
        margin-left: 0;
      }
    }
  `]
})
export class ViewMessagesDialogComponent implements OnInit {
  data = inject<ViewMessagesDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<ViewMessagesDialogComponent>);
  private dialog = inject(MatDialog);
  private queueService = inject(QueueService);
  private topicService = inject(TopicService);
  private connectionService = inject(ConnectionService);
  private messageSearchService = inject(MessageSearchService);
  private advancedFilterService = inject(AdvancedMessageFilterService);
  private snackBar = inject(MatSnackBar);
  private messageExportService = inject(MessageExportService);
  private readonly destroyRef = inject(DestroyRef);
  bulkOperationsService = inject(BulkOperationsService);

  activeMessages: MessageInfo[] = [];
  deadLetterMessages: MessageInfo[] = [];
  filteredActiveMessages: MessageInfo[] = [];
  filteredDeadLetterMessages: MessageInfo[] = [];
  selectedMessage: MessageInfo | null = null;

  loadingActive = signal(false);
  loadingDL = signal(false);
  resubmitting = signal(false);
  deleting = signal(false);
  moving = signal(false);
  peekCount = 20;
  selectedTabIndex = 0;

  // Message count signals for automatic UI updates
  activeMessageCount = signal<number | undefined>(undefined);
  deadLetterMessageCount = signal<number | undefined>(undefined);

  // Filter properties
  activeFilterText = '';
  activeFilterProperty: string | null = null;
  activeRegexMode = false;
  activeRegexError = '';
  dlFilterText = '';
  dlFilterProperty: string | null = null;
  dlRegexMode = false;
  dlRegexError = '';

  // Advanced filter state
  activeAdvancedFilterState: AdvancedFilterState = {
    conditions: [],
    logicOperator: FilterLogic.And
  };
  dlAdvancedFilterState: AdvancedFilterState = {
    conditions: [],
    logicOperator: FilterLogic.And
  };

  // Filter panel collapsed state
  activeFilterPanelCollapsed = true;
  dlFilterPanelCollapsed = true;

  // Filterable properties
  activeFilterableProperties = [
    { label: 'Message ID', value: 'messageId' },
    { label: 'Correlation ID', value: 'correlationId' },
    { label: 'Session ID', value: 'sessionId' },
    { label: 'Subject', value: 'subject' },
    { label: 'Content Type', value: 'contentType' },
    { label: 'Body', value: 'body' },
    { label: 'Sequence Number', value: 'sequenceNumber' }
  ];

  dlFilterableProperties = [
    ...this.activeFilterableProperties,
    { label: 'Dead Letter Reason', value: 'deadLetterReason' },
    { label: 'Dead Letter Description', value: 'deadLetterErrorDescription' }
  ];

  private countChange$ = new Subject<number>();

  ngOnInit() {
    // Set initial tab from data
    if (this.data.initialTab !== undefined) {
      this.selectedTabIndex = this.data.initialTab;
    }

    // Initialize message count signals from data
    if (this.data.activeMessageCount !== undefined) {
      this.activeMessageCount.set(this.data.activeMessageCount);
    }
    if (this.data.deadLetterMessageCount !== undefined) {
      this.deadLetterMessageCount.set(this.data.deadLetterMessageCount);
    }

    // Load saved filter states from session storage
    this.loadSavedFilterStates();

    // Setup debounced count change handler
    this.countChange$.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(count => {
      if (count === 0) {
        this.clearCurrentTab();
      } else if (count >= 1) {
        this.reloadCurrentTab();
      }
    });

    // Load messages based on initial tab
    if (this.selectedTabIndex === 1) {
      this.loadDeadLetterMessages();
    } else {
      this.loadActiveMessages();
    }
  }

  onCountChange(value: number) {
    this.countChange$.next(value);
  }

  setTab(index: number) {
    this.selectedTabIndex = index;
    this.selectedMessage = null;

    // Clear selections when switching tabs for better UX
    this.bulkOperationsService.clearSelection('active');
    this.bulkOperationsService.clearSelection('deadletter');

    if (index === 1 && this.deadLetterMessages.length === 0) {
      this.loadDeadLetterMessages();
    } else if (index === 0 && this.activeMessages.length === 0) {
      this.loadActiveMessages();
    }
  }

  private reloadCurrentTab() {
    if (this.selectedTabIndex === 1) {
      this.loadDeadLetterMessages();
    } else {
      this.loadActiveMessages();
    }
  }

  private clearCurrentTab() {
    this.selectedMessage = null;
    if (this.selectedTabIndex === 1) {
      this.deadLetterMessages = [];
    } else {
      this.activeMessages = [];
    }
  }

  onTabChange(event: any) {
    if (event.index === 1 && this.deadLetterMessages.length === 0) {
      this.loadDeadLetterMessages();
    }
  }

  loadActiveMessages() {
    this.loadingActive.set(true);
    this.selectedMessage = null;

    // Clear selection when reloading to avoid stale selections
    this.bulkOperationsService.clearSelection('active');

    const observable = this.data.entityType === 'queue'
      ? this.queueService.peekMessages(this.data.entityName, this.peekCount)
      : this.topicService.peekMessages(this.data.topicName!, this.data.entityName, this.peekCount);

    observable.pipe(
      finalize(() => this.loadingActive.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (messages) => {
        this.activeMessages = messages;
        this.applyActiveFilter();
      },
      error: () => {
        this.snackBar.open('Failed to load messages', 'Close', { duration: 3000 });
      }
    });
  }

  applyActiveFilter() {
    let messages = this.activeMessages;

    // First apply quick search filter if present
    if (this.activeFilterText) {
      // Validate regex pattern if in regex mode
      if (this.activeRegexMode) {
        if (!this.messageSearchService.isValidRegex(this.activeFilterText)) {
          this.activeRegexError = this.getRegexError(this.activeFilterText);
          this.filteredActiveMessages = this.activeMessages; // Don't filter with invalid regex
          return;
        }
        this.activeRegexError = '';
      } else {
        this.activeRegexError = '';
      }

      // Use MessageSearchService with the current filter settings
      messages = this.messageSearchService.searchMessages(
        messages,
        this.activeFilterText,
        {
          mode: this.activeRegexMode ? 'regex' : 'text',
          caseSensitive: false,
          property: this.activeFilterProperty
        }
      );
    } else {
      this.activeRegexError = '';
    }

    // Then apply advanced filters if present
    if (this.activeAdvancedFilterState.conditions.length > 0) {
      messages = this.advancedFilterService.filterMessages(messages, this.activeAdvancedFilterState);
    }

    this.filteredActiveMessages = messages;
  }

  onFilterChange() {
    this.applyActiveFilter();
  }

  clearActiveFilter() {
    this.activeFilterText = '';
    this.activeFilterProperty = null;
    this.activeRegexError = '';
    this.applyActiveFilter();
  }

  toggleActiveRegexMode() {
    this.activeRegexMode = !this.activeRegexMode;
    this.applyActiveFilter();
  }

  // Dead Letter filter methods
  applyDLFilter() {
    let messages = this.deadLetterMessages;

    // First apply quick search filter if present
    if (this.dlFilterText) {
      // Validate regex pattern if in regex mode
      if (this.dlRegexMode) {
        if (!this.messageSearchService.isValidRegex(this.dlFilterText)) {
          this.dlRegexError = this.getRegexError(this.dlFilterText);
          this.filteredDeadLetterMessages = this.deadLetterMessages; // Don't filter with invalid regex
          return;
        }
        this.dlRegexError = '';
      } else {
        this.dlRegexError = '';
      }

      // Use MessageSearchService with the current filter settings
      messages = this.messageSearchService.searchMessages(
        messages,
        this.dlFilterText,
        {
          mode: this.dlRegexMode ? 'regex' : 'text',
          caseSensitive: false,
          property: this.dlFilterProperty
        }
      );
    } else {
      this.dlRegexError = '';
    }

    // Then apply advanced filters if present
    if (this.dlAdvancedFilterState.conditions.length > 0) {
      messages = this.advancedFilterService.filterMessages(messages, this.dlAdvancedFilterState);
    }

    this.filteredDeadLetterMessages = messages;
  }

  onDLFilterChange() {
    this.applyDLFilter();
  }

  clearDLFilter() {
    this.dlFilterText = '';
    this.dlFilterProperty = null;
    this.dlRegexError = '';
    this.applyDLFilter();
  }

  toggleDLRegexMode() {
    this.dlRegexMode = !this.dlRegexMode;
    this.applyDLFilter();
  }

  // Advanced filter event handlers
  onActiveAdvancedFilterChange(filterState: AdvancedFilterState) {
    this.activeAdvancedFilterState = filterState;
    this.saveActiveFilterState();
    this.applyActiveFilter();
  }

  onDLAdvancedFilterChange(filterState: AdvancedFilterState) {
    this.dlAdvancedFilterState = filterState;
    this.saveDLFilterState();
    this.applyDLFilter();
  }

  loadDeadLetterMessages() {
    this.loadingDL.set(true);
    this.bulkOperationsService.clearSelection('deadletter');

    const observable = this.data.entityType === 'queue'
      ? this.queueService.peekDeadLetterMessages(this.data.entityName, this.peekCount)
      : this.topicService.peekDeadLetterMessages(this.data.topicName!, this.data.entityName, this.peekCount);

    observable.pipe(
      finalize(() => this.loadingDL.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (messages) => {
        this.deadLetterMessages = messages;
        this.applyDLFilter();
      },
      error: (err) => {
        console.error('Failed to load dead letter messages:', err);
        this.snackBar.open('Failed to load dead letter messages', 'Close', { duration: 3000 });
      }
    });
  }

  selectMessage(msg: MessageInfo) {
    this.selectedMessage = msg;
  }

  resubmit(msg: MessageInfo) {
    const observable = this.data.entityType === 'queue'
      ? this.queueService.resubmitDeadLetterMessage(this.data.entityName, msg.sequenceNumber)
      : this.topicService.resubmitDeadLetterMessage(this.data.topicName!, this.data.entityName, msg.sequenceNumber);

    observable.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.snackBar.open('Message resubmitted', 'Close', { duration: 3000 });
        this.loadDeadLetterMessages();
      },
      error: () => {
        this.snackBar.open('Failed to resubmit message', 'Close', { duration: 3000 });
      }
    });
  }

  editAndResubmit(msg: MessageInfo) {
    const entityType = this.data.entityType === 'subscription' ? 'topic' : 'queue';
    const entityName = this.data.entityType === 'subscription' ? this.data.topicName! : this.data.entityName;

    const dialogRef = this.dialog.open(SendMessageDialogComponent, {
      width: '700px',
      data: {
        entityType,
        entityName,
        topicName: this.data.topicName,
        mode: 'resubmit',
        prefill: {
          body: msg.body,
          contentType: msg.contentType,
          messageId: msg.messageId,
          correlationId: msg.correlationId,
          sessionId: msg.sessionId,
          subject: msg.subject,
          to: msg.to,
          replyTo: msg.replyTo,
          applicationProperties: msg.applicationProperties
        }
      } as SendMessageDialogData
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.loadDeadLetterMessages();
      }
    });
  }

  // Active Messages selection methods
  toggleActiveSelection(msg: MessageInfo, checked: boolean) {
    if (checked) {
      this.bulkOperationsService.selectMessage('active', msg.sequenceNumber, this.filteredActiveMessages.length);
    } else {
      this.bulkOperationsService.deselectMessage('active', msg.sequenceNumber, this.filteredActiveMessages.length);
    }
  }

  toggleAllActive(checked: boolean) {
    if (checked) {
      // Warn user about large selections (>500 messages)
      if (this.filteredActiveMessages.length > 500) {
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: 'Large Selection',
            message: `You are about to select ${this.filteredActiveMessages.length} messages. This may take some time to process. Do you want to continue?`,
            confirmText: 'Select All',
            confirmColor: 'primary',
            icon: 'info-circle'
          }
        });

        dialogRef.afterClosed().pipe(
          takeUntilDestroyed(this.destroyRef)
        ).subscribe(result => {
          if (result) {
            this.bulkOperationsService.selectAll('active', this.filteredActiveMessages);
          }
        });
      } else {
        this.bulkOperationsService.selectAll('active', this.filteredActiveMessages);
      }
    } else {
      this.bulkOperationsService.clearSelection('active');
    }
  }

  isAllActiveSelected(): boolean {
    return this.bulkOperationsService.isAllSelected('active') && this.filteredActiveMessages.length > 0;
  }

  isActiveIndeterminate(): boolean {
    return this.bulkOperationsService.isIndeterminate('active');
  }

  isActiveMessageSelected(sequenceNumber: number): boolean {
    return this.bulkOperationsService.isSelected('active', sequenceNumber);
  }

  // Dead Letter selection methods
  toggleDeadLetterSelection(msg: MessageInfo, checked: boolean) {
    if (checked) {
      this.bulkOperationsService.selectMessage('deadletter', msg.sequenceNumber, this.filteredDeadLetterMessages.length);
    } else {
      this.bulkOperationsService.deselectMessage('deadletter', msg.sequenceNumber, this.filteredDeadLetterMessages.length);
    }
  }

  toggleAllDeadLetter(checked: boolean) {
    if (checked) {
      // Warn user about large selections (>500 messages)
      if (this.filteredDeadLetterMessages.length > 500) {
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: 'Large Selection',
            message: `You are about to select ${this.filteredDeadLetterMessages.length} messages. This may take some time to process. Do you want to continue?`,
            confirmText: 'Select All',
            confirmColor: 'primary',
            icon: 'info-circle'
          }
        });

        dialogRef.afterClosed().pipe(
          takeUntilDestroyed(this.destroyRef)
        ).subscribe(result => {
          if (result) {
            this.bulkOperationsService.selectAll('deadletter', this.filteredDeadLetterMessages);
          }
        });
      } else {
        this.bulkOperationsService.selectAll('deadletter', this.filteredDeadLetterMessages);
      }
    } else {
      this.bulkOperationsService.clearSelection('deadletter');
    }
  }

  isAllDeadLetterSelected(): boolean {
    return this.bulkOperationsService.isAllSelected('deadletter') && this.filteredDeadLetterMessages.length > 0;
  }

  isDeadLetterIndeterminate(): boolean {
    return this.bulkOperationsService.isIndeterminate('deadletter');
  }

  isDeadLetterMessageSelected(sequenceNumber: number): boolean {
    return this.bulkOperationsService.isSelected('deadletter', sequenceNumber);
  }

  resubmitSelected(sequenceNumbersToResubmit?: number[]) {
    // Use provided sequence numbers or get from service
    const sequenceNumbers = sequenceNumbersToResubmit || this.bulkOperationsService.getSelectedSequenceNumbers('deadletter');
    const selectedCount = sequenceNumbers.length;

    if (selectedCount === 0) {
      this.snackBar.open('Please select at least one message to resubmit', 'Close', { duration: 3000 });
      return;
    }

    // Check if connected to Service Bus
    if (!this.connectionService.isConnected) {
      console.error('[COMPONENT] Not connected to Service Bus!');
      this.snackBar.open('Not connected to Service Bus. Please connect first.', 'Close', { duration: 5000 });
      return;
    }

    this.resubmitting.set(true);

    // Open progress dialog
    const progressDialogRef = this.dialog.open(BulkOperationProgressDialogComponent, {
      data: {
        operation: 'resubmit',
        totalCount: selectedCount,
        entityName: this.data.entityName,
        entityType: this.data.entityType,
        isDeadLetter: true
      } as BulkOperationProgressDialogData,
      disableClose: true
    });

    const observable = this.data.entityType === 'queue'
      ? this.queueService.resubmitDeadLetterMessages(this.data.entityName, sequenceNumbers)
      : this.topicService.resubmitDeadLetterMessages(this.data.topicName!, this.data.entityName, sequenceNumbers);

    observable.pipe(
      finalize(() => this.resubmitting.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        // Update progress to complete
        const progressComponent = progressDialogRef.componentInstance;
        progressComponent.updateProgress({
          processed: selectedCount,
          total: selectedCount,
          successCount: result.successCount,
          failureCount: result.failureCount
        });

        // Close progress dialog after a brief delay to show completion
        setTimeout(() => {
          progressDialogRef.close();

          // Show results dialog
          const resultsDialogRef = this.dialog.open(BulkOperationResultsDialogComponent, {
            data: {
              operation: 'resubmit',
              result: result,
              entityName: this.data.entityName,
              entityType: this.data.entityType,
              isDeadLetter: true,
              allowRetry: result.failureCount > 0 // Allow retry if there are failures
            } as BulkOperationResultsDialogData
          });

          resultsDialogRef.afterClosed().pipe(
            takeUntilDestroyed(this.destroyRef)
          ).subscribe((resultsResponse) => {
            // Clear selection (only if not retrying)
            if (!resultsResponse?.retry) {
              this.bulkOperationsService.clearSelection('deadletter');
            }

            // Update message counts based on successful resubmissions
            if (result.successCount > 0) {
              // Decrease dead letter count
              this.deadLetterMessageCount.update(count =>
                count !== undefined ? Math.max(0, count - result.successCount) : undefined
              );

              // Increase active message count (messages are going back to active queue)
              this.activeMessageCount.update(count =>
                count !== undefined ? count + result.successCount : undefined
              );
            }

            // Refresh the dead letter message list
            this.loadDeadLetterMessages();

            // Handle retry if requested
            if (resultsResponse?.retry && resultsResponse?.failedSequenceNumbers) {
              // Retry failed messages
              setTimeout(() => {
                this.resubmitSelected(resultsResponse.failedSequenceNumbers);
              }, 500);
            }
          });
        }, 1000);
      },
      error: (err) => {
        console.error('Failed to resubmit messages:', err);
        progressDialogRef.close();

        // Check if it's a connection error
        if (err.status === 500 && err.error?.error?.includes('Not connected')) {
          this.snackBar.open('Connection lost. Please reconnect to Service Bus.', 'Close', { duration: 5000 });
        } else {
          this.snackBar.open('Failed to resubmit messages', 'Close', { duration: 3000 });
        }
      }
    });
  }

  formatBody(body: string): string {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return body;
    }
  }

  hasProperties(props: { [key: string]: any }): boolean {
    return Object.keys(props).length > 0;
  }

  getProperties(props: { [key: string]: any }): { key: string; value: any }[] {
    return Object.entries(props).map(([key, value]) => ({ key, value }));
  }

  /**
   * Gets a user-friendly error message for an invalid regex pattern
   */
  private getRegexError(pattern: string): string {
    try {
      new RegExp(pattern);
      return '';
    } catch (e: any) {
      return e.message || 'Invalid regular expression';
    }
  }

  /**
   * Gets truncated body text for message preview
   * Truncates to 100 characters and adds ellipsis if needed
   */
  getTruncatedBody(body: string): string {
    if (!body) {
      return '';
    }
    const maxLength = 100;
    if (body.length > maxLength) {
      return body.substring(0, maxLength) + '...';
    }
    return body;
  }

  /**
   * Gets the active filter text based on the current tab
   * Returns the appropriate filter text for highlighting
   */
  getActiveFilterText(): string {
    return this.selectedTabIndex === 0 ? this.activeFilterText : this.dlFilterText;
  }

  /**
   * Gets the active regex mode based on the current tab
   * Returns the appropriate regex mode for highlighting
   */
  getActiveRegexMode(): boolean {
    return this.selectedTabIndex === 0 ? this.activeRegexMode : this.dlRegexMode;
  }

  /**
   * Gets a summary of active filters for the active messages tab
   * Shows count of conditions, logic operator, and results count
   */
  getActiveFilterSummary(): string {
    const parts: string[] = [];

    // Add results count
    parts.push(`Showing ${this.filteredActiveMessages.length} of ${this.activeMessages.length} messages`);

    // Add quick search info if active
    if (this.activeFilterText) {
      parts.push(`quick search active`);
    }

    // Add advanced filter info if active
    if (this.activeAdvancedFilterState.conditions.length > 0) {
      const conditionCount = this.activeAdvancedFilterState.conditions.length;
      const logic = this.activeAdvancedFilterState.logicOperator;
      parts.push(`${conditionCount} advanced filter${conditionCount > 1 ? 's' : ''} (${logic})`);
    }

    return parts.join(' • ');
  }

  /**
   * Gets a summary of active filters for the dead letter messages tab
   * Shows count of conditions, logic operator, and results count
   */
  getDLFilterSummary(): string {
    const parts: string[] = [];

    // Add results count
    parts.push(`Showing ${this.filteredDeadLetterMessages.length} of ${this.deadLetterMessages.length} messages`);

    // Add quick search info if active
    if (this.dlFilterText) {
      parts.push(`quick search active`);
    }

    // Add advanced filter info if active
    if (this.dlAdvancedFilterState.conditions.length > 0) {
      const conditionCount = this.dlAdvancedFilterState.conditions.length;
      const logic = this.dlAdvancedFilterState.logicOperator;
      parts.push(`${conditionCount} advanced filter${conditionCount > 1 ? 's' : ''} (${logic})`);
    }

    return parts.join(' • ');
  }

  /**
   * Clears all active filters (both quick search and advanced filters)
   */
  clearAllActiveFilters() {
    // Clear quick search
    this.activeFilterText = '';
    this.activeFilterProperty = null;
    this.activeRegexError = '';

    // Clear advanced filters
    this.activeAdvancedFilterState = {
      conditions: [],
      logicOperator: FilterLogic.And
    };

    // Clear from session storage
    this.clearActiveFilterState();

    // Reapply filters (which will show all messages)
    this.applyActiveFilter();
  }

  /**
   * Clears all dead letter filters (both quick search and advanced filters)
   */
  clearAllDLFilters() {
    // Clear quick search
    this.dlFilterText = '';
    this.dlFilterProperty = null;
    this.dlRegexError = '';

    // Clear advanced filters
    this.dlAdvancedFilterState = {
      conditions: [],
      logicOperator: FilterLogic.And
    };

    // Clear from session storage
    this.clearDLFilterState();

    // Reapply filters (which will show all messages)
    this.applyDLFilter();
  }

  /**
   * Loads saved filter states from session storage for both active and dead letter tabs
   */
  private loadSavedFilterStates() {
    // Load active messages filter state
    const activeStorageKey = this.getFilterStorageKey('active');
    const savedActiveFilterState = this.advancedFilterService.loadFilterState(
      this.data.entityType,
      activeStorageKey
    );
    if (savedActiveFilterState.conditions.length > 0) {
      this.activeAdvancedFilterState = savedActiveFilterState;
      // Expand the panel if filters are loaded
      this.activeFilterPanelCollapsed = false;
    }

    // Load dead letter filter state
    const dlStorageKey = this.getFilterStorageKey('deadletter');
    const savedDLFilterState = this.advancedFilterService.loadFilterState(
      this.data.entityType,
      dlStorageKey
    );
    if (savedDLFilterState.conditions.length > 0) {
      this.dlAdvancedFilterState = savedDLFilterState;
      // Expand the panel if filters are loaded
      this.dlFilterPanelCollapsed = false;
    }
  }

  /**
   * Saves the active filter state to session storage
   * If filter state is empty, clears it from storage instead
   */
  private saveActiveFilterState() {
    const storageKey = this.getFilterStorageKey('active');

    // If no conditions, clear from storage instead of saving empty state
    if (this.activeAdvancedFilterState.conditions.length === 0) {
      this.advancedFilterService.clearFilterState(
        this.data.entityType,
        storageKey
      );
    } else {
      this.advancedFilterService.saveFilterState(
        this.data.entityType,
        storageKey,
        this.activeAdvancedFilterState
      );
    }
  }

  /**
   * Saves the dead letter filter state to session storage
   * If filter state is empty, clears it from storage instead
   */
  private saveDLFilterState() {
    const storageKey = this.getFilterStorageKey('deadletter');

    // If no conditions, clear from storage instead of saving empty state
    if (this.dlAdvancedFilterState.conditions.length === 0) {
      this.advancedFilterService.clearFilterState(
        this.data.entityType,
        storageKey
      );
    } else {
      this.advancedFilterService.saveFilterState(
        this.data.entityType,
        storageKey,
        this.dlAdvancedFilterState
      );
    }
  }

  /**
   * Clears the active filter state from session storage
   */
  private clearActiveFilterState() {
    const storageKey = this.getFilterStorageKey('active');
    this.advancedFilterService.clearFilterState(
      this.data.entityType,
      storageKey
    );
  }

  /**
   * Clears the dead letter filter state from session storage
   */
  private clearDLFilterState() {
    const storageKey = this.getFilterStorageKey('deadletter');
    this.advancedFilterService.clearFilterState(
      this.data.entityType,
      storageKey
    );
  }

  /**
   * Gets the filter storage key for the current entity, scoped by tab type
   * This ensures filters are separate for active and dead letter tabs
   *
   * @param tabType - 'active' or 'deadletter'
   * @returns Storage key combining entity name and tab type
   */
  private getFilterStorageKey(tabType: 'active' | 'deadletter'): string {
    // For subscriptions, include topic name in the key to ensure uniqueness
    if (this.data.entityType === 'subscription' && this.data.topicName) {
      return `${this.data.topicName}/${this.data.entityName}-${tabType}`;
    }
    return `${this.data.entityName}-${tabType}`;
  }

  /**
   * Gets the selected count for the current tab
   * @returns Number of selected messages in the current tab
   */
  getSelectedCount(): number {
    const tabType = this.selectedTabIndex === 0 ? 'active' : 'deadletter';
    return this.bulkOperationsService.getSelectionCount(tabType);
  }

  /**
   * Checks if any bulk operation is currently in progress
   * @returns True if any operation is running
   */
  isBulkOperationInProgress(): boolean {
    return this.loadingActive() || this.loadingDL() || this.resubmitting() || this.deleting() || this.moving();
  }

  /**
   * Handles bulk action events from the toolbar
   * Routes the action to the appropriate handler based on action type
   * @param event - The bulk action event containing the action type
   */
  onBulkAction(event: BulkActionEvent): void {
    switch (event.action) {
      case 'delete':
        this.handleBulkDelete();
        break;
      case 'resubmit':
        this.handleBulkResubmit();
        break;
      case 'move':
        this.handleBulkMove();
        break;
      case 'export':
        this.handleBulkExport();
        break;
      case 'compare':
        this.handleCompare();
        break;
    }
  }

  /**
   * Handles clear selection event from the toolbar
   * Clears the selection for the current tab
   */
  onClearSelection(): void {
    const tabType = this.selectedTabIndex === 0 ? 'active' : 'deadletter';
    this.bulkOperationsService.clearSelection(tabType);
  }

  /**
   * Handles bulk delete action
   * Shows confirmation dialog and executes bulk delete operation
   */
  private handleBulkDelete(): void {
    const tabType = this.selectedTabIndex === 0 ? 'active' : 'deadletter';
    const selectedCount = this.bulkOperationsService.getSelectionCount(tabType);

    if (selectedCount === 0) {
      this.snackBar.open('Please select at least one message to delete', 'Close', { duration: 3000 });
      return;
    }

    const isDeadLetter = this.selectedTabIndex === 1;
    const messageType = isDeadLetter ? 'dead letter messages' : 'messages';
    const entityName = this.data.entityName;

    // Open confirmation dialog
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Messages',
        message: `Are you sure you want to delete ${selectedCount} ${messageType} from ${this.data.entityType} "${entityName}"? This action cannot be undone.`,
        confirmText: 'Delete',
        confirmColor: 'warn',
        icon: 'delete'
      }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.executeDeleteOperation(tabType, isDeadLetter);
      }
    });
  }

  /**
   * Executes the bulk delete operation
   * @param tabType - The current tab type ('active' or 'deadletter')
   * @param isDeadLetter - Whether deleting from dead letter queue
   */
  private executeDeleteOperation(tabType: 'active' | 'deadletter', isDeadLetter: boolean): void {
    this.deleting.set(true);
    const selectedSequenceNumbers = this.bulkOperationsService.getSelectedSequenceNumbers(tabType);
    const totalCount = selectedSequenceNumbers.length;

    // Defensive check: ensure we have messages to delete
    if (totalCount === 0) {
      this.snackBar.open('No messages selected to delete', 'Close', { duration: 3000 });
      this.deleting.set(false);
      return;
    }

    // When the selection covers the whole tab with no active filter, ask the
    // backend to drain the entity server-side. In that mode sequenceNumbers are
    // ignored, so send an empty array.
    const drainAll = this.shouldDrainEntireTab(tabType, totalCount);
    const sequenceNumbers = drainAll ? [] : selectedSequenceNumbers;

    // Open progress dialog
    const progressDialogRef = this.dialog.open(BulkOperationProgressDialogComponent, {
      data: {
        operation: 'delete',
        totalCount: totalCount,
        entityName: this.data.entityName,
        entityType: this.data.entityType,
        isDeadLetter: isDeadLetter
      } as BulkOperationProgressDialogData,
      disableClose: true
    });

    const observable = this.data.entityType === 'queue'
      ? this.queueService.deleteMessages(this.data.entityName, sequenceNumbers, isDeadLetter, drainAll)
      : this.topicService.deleteMessages(this.data.topicName!, this.data.entityName, sequenceNumbers, isDeadLetter, drainAll);

    observable.pipe(
      finalize(() => this.deleting.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        // Update progress to complete
        const progressComponent = progressDialogRef.componentInstance;
        progressComponent.updateProgress({
          processed: totalCount,
          total: totalCount,
          successCount: result.successCount,
          failureCount: result.failureCount
        });

        // Close progress dialog after a brief delay to show completion
        setTimeout(() => {
          progressDialogRef.close();

          // Show results dialog
          const resultsDialogRef = this.dialog.open(BulkOperationResultsDialogComponent, {
            data: {
              operation: 'delete',
              result: result,
              entityName: this.data.entityName,
              entityType: this.data.entityType,
              isDeadLetter: isDeadLetter,
              allowRetry: false // Delete operations cannot be retried
            } as BulkOperationResultsDialogData
          });

          resultsDialogRef.afterClosed().pipe(
            takeUntilDestroyed(this.destroyRef)
          ).subscribe(() => {
            // Clear selection
            this.bulkOperationsService.clearSelection(tabType);

            // Update message counts based on successful deletions
            if (result.successCount > 0) {
              if (isDeadLetter) {
                this.deadLetterMessageCount.update(count =>
                  count !== undefined ? Math.max(0, count - result.successCount) : undefined
                );
              } else {
                this.activeMessageCount.update(count =>
                  count !== undefined ? Math.max(0, count - result.successCount) : undefined
                );
              }
            }

            // Refresh the message list
            if (isDeadLetter) {
              this.loadDeadLetterMessages();
            } else {
              this.loadActiveMessages();
            }
          });
        }, 1000);
      },
      error: (err) => {
        console.error('Failed to delete messages:', err);
        // Close the progress dialog instead of leaving it fake-completed, and
        // surface a retry hint so the user knows the operation can be reattempted.
        progressDialogRef.close();
        this.snackBar.open('Failed to delete messages. Please try again.', 'Close', { duration: 5000 });
      }
    });
  }

  /**
   * Determines whether a bulk delete should drain the entire tab server-side.
   * Returns true only when select-all is active for the tab, no filter is
   * applied, and the selection count matches the entity's message count for
   * that tab. In every other case the caller sends the explicit selection.
   * @param tabType - The current tab type ('active' or 'deadletter')
   * @param selectedCount - Number of currently selected messages in the tab
   */
  private shouldDrainEntireTab(tabType: 'active' | 'deadletter', selectedCount: number): boolean {
    if (!this.bulkOperationsService.isAllSelected(tabType)) {
      return false;
    }
    if (this.hasActiveFilter(tabType)) {
      return false;
    }
    const entityCount = tabType === 'deadletter'
      ? this.deadLetterMessageCount()
      : this.activeMessageCount();
    return entityCount !== undefined && selectedCount === entityCount;
  }

  /**
   * Reports whether a text or advanced filter is currently applied to a tab.
   * @param tabType - The current tab type ('active' or 'deadletter')
   */
  private hasActiveFilter(tabType: 'active' | 'deadletter'): boolean {
    if (tabType === 'deadletter') {
      return this.dlFilterText.trim() !== '' || this.dlAdvancedFilterState.conditions.length > 0;
    }
    return this.activeFilterText.trim() !== '' || this.activeAdvancedFilterState.conditions.length > 0;
  }

  /**
   * Handles bulk resubmit action
   * Uses the existing resubmitSelected method for Dead Letter messages
   */
  private handleBulkResubmit(): void {
    if (this.selectedTabIndex === 1) {
      this.resubmitSelected();
    }
  }

  /**
   * Handles bulk move action
   * Opens dialog to select target queue and executes move operation
   */
  private handleBulkMove(): void {
    // Only support queue moves for now
    if (this.data.entityType !== 'queue') {
      this.snackBar.open('Move operation is only supported for queues', 'Close', { duration: 3000 });
      return;
    }

    const tabType = this.selectedTabIndex === 0 ? 'active' : 'deadletter';
    const selectedCount = this.bulkOperationsService.getSelectionCount(tabType);

    if (selectedCount === 0) {
      this.snackBar.open('Please select at least one message to move', 'Close', { duration: 3000 });
      return;
    }

    const isDeadLetter = this.selectedTabIndex === 1;

    // Open move dialog
    const dialogRef = this.dialog.open<MoveMessagesDialogComponent, MoveMessagesDialogData, string>(MoveMessagesDialogComponent, {
      data: {
        currentQueueName: this.data.entityName,
        messageCount: selectedCount,
        isDeadLetter: isDeadLetter
      }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(targetQueueName => {
      if (targetQueueName) {
        this.executeMoveOperation(tabType, isDeadLetter, targetQueueName);
      }
    });
  }

  /**
   * Executes the bulk move operation
   * @param tabType - The current tab type ('active' or 'deadletter')
   * @param isDeadLetter - Whether moving from dead letter queue
   * @param targetQueueName - The destination queue name
   * @param sequenceNumbersToMove - Optional array of specific sequence numbers to move (for retry)
   */
  private executeMoveOperation(tabType: 'active' | 'deadletter', isDeadLetter: boolean, targetQueueName: string, sequenceNumbersToMove?: number[]): void {
    this.moving.set(true);
    const sequenceNumbers = sequenceNumbersToMove || this.bulkOperationsService.getSelectedSequenceNumbers(tabType);
    const totalCount = sequenceNumbers.length;

    // Defensive check: ensure we have messages to move
    if (totalCount === 0) {
      this.snackBar.open('No messages selected to move', 'Close', { duration: 3000 });
      this.moving.set(false);
      return;
    }

    // Defensive check: ensure target queue name is provided
    if (!targetQueueName || targetQueueName.trim() === '') {
      this.snackBar.open('Target queue name is required', 'Close', { duration: 3000 });
      this.moving.set(false);
      return;
    }

    // Open progress dialog
    const progressDialogRef = this.dialog.open(BulkOperationProgressDialogComponent, {
      data: {
        operation: 'move',
        totalCount: totalCount,
        entityName: this.data.entityName,
        entityType: this.data.entityType,
        isDeadLetter: isDeadLetter,
        targetQueue: targetQueueName
      } as BulkOperationProgressDialogData,
      disableClose: true
    });

    this.queueService.moveMessages(this.data.entityName, targetQueueName, sequenceNumbers, isDeadLetter).pipe(
      finalize(() => this.moving.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        // Update progress to complete
        const progressComponent = progressDialogRef.componentInstance;
        progressComponent.updateProgress({
          processed: totalCount,
          total: totalCount,
          successCount: result.successCount,
          failureCount: result.failureCount
        });

        // Close progress dialog after a brief delay to show completion
        setTimeout(() => {
          progressDialogRef.close();

          // Show results dialog
          const resultsDialogRef = this.dialog.open(BulkOperationResultsDialogComponent, {
            data: {
              operation: 'move',
              result: result,
              entityName: this.data.entityName,
              entityType: this.data.entityType,
              isDeadLetter: isDeadLetter,
              targetQueue: targetQueueName,
              allowRetry: result.failureCount > 0 // Allow retry if there are failures
            } as BulkOperationResultsDialogData
          });

          resultsDialogRef.afterClosed().pipe(
            takeUntilDestroyed(this.destroyRef)
          ).subscribe((resultsResponse) => {
            // Clear selection (only if not retrying)
            if (!resultsResponse?.retry) {
              this.bulkOperationsService.clearSelection(tabType);
            }

            // Update message counts based on successful moves
            // Messages moved out of current queue
            if (result.successCount > 0) {
              if (isDeadLetter) {
                this.deadLetterMessageCount.update(count =>
                  count !== undefined ? Math.max(0, count - result.successCount) : undefined
                );
              } else {
                this.activeMessageCount.update(count =>
                  count !== undefined ? Math.max(0, count - result.successCount) : undefined
                );
              }
            }

            // Refresh the message list
            if (isDeadLetter) {
              this.loadDeadLetterMessages();
            } else {
              this.loadActiveMessages();
            }

            // Handle retry if requested
            if (resultsResponse?.retry && resultsResponse?.failedSequenceNumbers) {
              // Retry failed messages
              setTimeout(() => {
                this.executeMoveOperation(tabType, isDeadLetter, targetQueueName, resultsResponse.failedSequenceNumbers);
              }, 500);
            }
          });
        }, 1000);
      },
      error: (err) => {
        console.error('Failed to move messages:', err);
        progressDialogRef.close();
        this.snackBar.open('Failed to move messages', 'Close', { duration: 3000 });
      }
    });
  }

  /**
   * Handles bulk export action
   * Opens dialog to select export format and options, then generates and downloads the file
   */
  private handleBulkExport(): void {
    const tabType = this.selectedTabIndex === 0 ? 'active' : 'deadletter';
    const selectedCount = this.bulkOperationsService.getSelectionCount(tabType);

    if (selectedCount === 0) {
      this.snackBar.open('Please select at least one message to export', 'Close', { duration: 3000 });
      return;
    }

    const isDeadLetter = this.selectedTabIndex === 1;

    // Open export dialog
    const dialogRef = this.dialog.open<ExportMessagesDialogComponent, ExportMessagesDialogData, ExportOptions>(ExportMessagesDialogComponent, {
      data: {
        messageCount: selectedCount,
        entityName: this.data.entityName,
        entityType: this.data.entityType === 'subscription' ? 'topic' : this.data.entityType,
        isDeadLetter: isDeadLetter
      }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(exportOptions => {
      if (exportOptions) {
        this.executeExportOperation(tabType, isDeadLetter, exportOptions);
      }
    });
  }

  /**
   * Handles compare action when exactly 2 messages are selected.
   * Opens the MessageDiffDialogComponent for side-by-side comparison.
   */
  private handleCompare(): void {
    const tabType = this.selectedTabIndex === 0 ? 'active' : 'deadletter';
    const sequenceNumbers = this.bulkOperationsService.getSelectedSequenceNumbers(tabType);

    if (sequenceNumbers.length !== 2) {
      this.snackBar.open('Please select exactly 2 messages to compare', 'Close', { duration: 3000 });
      return;
    }

    const isDeadLetter = this.selectedTabIndex === 1;
    const allMessages = isDeadLetter ? this.deadLetterMessages : this.activeMessages;
    const sequenceSet = new Set(sequenceNumbers);
    const selected = allMessages.filter(m => sequenceSet.has(m.sequenceNumber));

    if (selected.length !== 2) {
      this.snackBar.open('Selected messages are no longer available', 'Close', { duration: 3000 });
      return;
    }

    // Sort so the lower sequence number is on the left
    selected.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    this.dialog.open(MessageDiffDialogComponent, {
      width: '1000px',
      data: {
        left: selected[0],
        right: selected[1],
        entityName: this.data.entityName,
      } as MessageDiffDialogData
    });
  }

  /**
   * Executes the export operation
   * Filters selected messages, generates export content, and triggers download
   * @param tabType - The current tab type ('active' or 'deadletter')
   * @param isDeadLetter - Whether exporting from dead letter queue
   * @param exportOptions - Export format and options selected by user
   */
  private executeExportOperation(tabType: 'active' | 'deadletter', isDeadLetter: boolean, exportOptions: ExportOptions): void {
    try {
      // Get selected sequence numbers
      const sequenceNumbers = this.bulkOperationsService.getSelectedSequenceNumbers(tabType);

      // Defensive check: ensure we have sequence numbers
      if (!sequenceNumbers || sequenceNumbers.length === 0) {
        this.snackBar.open('No messages selected for export', 'Close', { duration: 3000 });
        return;
      }

      const sequenceNumberSet = new Set(sequenceNumbers);

      // Get the appropriate message array
      const allMessages = isDeadLetter ? this.deadLetterMessages : this.activeMessages;

      // Defensive check: ensure messages array exists
      if (!allMessages || allMessages.length === 0) {
        this.snackBar.open('No messages available to export', 'Close', { duration: 3000 });
        return;
      }

      // Filter to only include selected messages
      const selectedMessages = allMessages.filter(msg => sequenceNumberSet.has(msg.sequenceNumber));

      if (selectedMessages.length === 0) {
        this.snackBar.open('Selected messages are no longer available', 'Close', { duration: 3000 });
        return;
      }

      // Generate filename parts
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      const messageType = isDeadLetter ? 'deadletter' : 'messages';

      // Handle XLSX format (async) separately from synchronous formats
      if (exportOptions.format === 'xlsx') {
        this.messageExportService.exportToXlsx(selectedMessages, exportOptions).then(blob => {
          const filename = `${this.data.entityName}-${messageType}-${timestamp}.xlsx`;
          this.messageExportService.downloadBlob(blob, filename);
          this.snackBar.open(
            `Successfully exported ${selectedMessages.length} message(s) as XLSX`,
            'Close',
            { duration: 3000 }
          );
          this.bulkOperationsService.clearSelection(tabType);
        }).catch(error => {
          console.error('Failed to export messages as XLSX:', error);
          this.snackBar.open('Failed to export messages as XLSX', 'Close', { duration: 3000 });
        });
        return;
      }

      // Generate export content based on format (JSON / CSV)
      let content: string;
      let mimeType: string;
      let fileExtension: string;

      if (exportOptions.format === 'json') {
        content = this.messageExportService.exportToJson(selectedMessages, exportOptions);
        mimeType = 'application/json';
        fileExtension = 'json';
      } else {
        content = this.messageExportService.exportToCsv(selectedMessages, exportOptions);
        mimeType = 'text/csv';
        fileExtension = 'csv';
      }

      // Generate filename
      const filename = `${this.data.entityName}-${messageType}-${timestamp}.${fileExtension}`;

      // Trigger download
      this.messageExportService.downloadFile(content, filename, mimeType);

      // Show success notification
      this.snackBar.open(
        `Successfully exported ${selectedMessages.length} message(s) as ${exportOptions.format.toUpperCase()}`,
        'Close',
        { duration: 3000 }
      );

      // Clear selection after export
      this.bulkOperationsService.clearSelection(tabType);
    } catch (error) {
      console.error('Failed to export messages:', error);
      this.snackBar.open('Failed to export messages', 'Close', { duration: 3000 });
    }
  }

  /**
   * Handles keyboard shortcuts for bulk operations
   * @param event - The keyboard event
   */
  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcut(event: KeyboardEvent): void {
    // Ignore shortcuts if user is typing in an input field
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    // Ignore shortcuts if an operation is in progress
    if (this.isBulkOperationInProgress()) {
      return;
    }

    const tabType = this.selectedTabIndex === 0 ? 'active' : 'deadletter';
    const filteredMessages = this.selectedTabIndex === 0 ? this.filteredActiveMessages : this.filteredDeadLetterMessages;

    // Check if there are any messages to operate on
    const hasMessages = filteredMessages.length > 0;

    // Ctrl+A or Cmd+A: Select all messages in current tab
    if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
      if (hasMessages) {
        event.preventDefault();
        this.bulkOperationsService.selectAll(tabType, filteredMessages);
      } else {
        // Provide feedback when there are no messages to select
        event.preventDefault();
        this.snackBar.open('No messages available to select', 'Close', { duration: 2000 });
      }
      return;
    }

    // Escape: Clear selection in current tab
    if (event.key === 'Escape') {
      const selectionCount = this.bulkOperationsService.getSelectionCount(tabType);
      if (selectionCount > 0) {
        event.preventDefault();
        this.bulkOperationsService.clearSelection(tabType);
      }
      return;
    }

    // Delete: Initiate bulk delete with confirmation
    if (event.key === 'Delete') {
      const selectionCount = this.bulkOperationsService.getSelectionCount(tabType);
      if (selectionCount > 0) {
        event.preventDefault();
        this.handleBulkDelete();
      }
      return;
    }
  }
}
