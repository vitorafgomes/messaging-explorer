import { Component, OnInit, inject, signal, DestroyRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Observable, Subject, finalize } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { QueueService, TopicService, ConnectionService, MessageSearchService, AdvancedMessageFilterService, BulkOperationsService, MessageExportService, isPossibleDuplicate } from '../../core/services';
import { MessageInfo, AdvancedFilterState, FilterLogic, SubQueue, BatchOperationResult } from '../../core/models';
import { HighlightPipe } from '../../shared/pipes';
import { AdvancedFilterPanelComponent } from '../../shared/components/advanced-filter-panel/advanced-filter-panel.component';
import { BulkActionsToolbarComponent, BulkActionEvent } from '../../shared/components/bulk-actions-toolbar/bulk-actions-toolbar.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';
import { MoveMessagesDialogComponent, MoveMessagesDialogData } from './move-messages-dialog.component';
import { ExportMessagesDialogComponent, ExportMessagesDialogData, ExportOptions } from './export-messages-dialog.component';
import { BulkOperationProgressDialogComponent, BulkOperationProgressDialogData } from '../../shared/components/bulk-operation-progress-dialog/bulk-operation-progress-dialog.component';
import { BulkOperationResultsDialogComponent, BulkOperationResultsDialogData } from '../../shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component';
import { SendMessageDialogComponent, SendMessageDialogData } from './send-message-dialog.component';
import { MessageDiffDialogComponent, MessageDiffDialogData } from './message-diff-dialog.component';
import { CancelScheduledDialogComponent, CancelScheduledDialogData } from './cancel-scheduled-dialog.component';
import { ProviderService } from '../../core/services/provider.service';
import { messageCallFailure } from './message-call-failure';

export interface ViewMessagesDialogData {
  entityType: 'queue' | 'subscription';
  entityName: string;
  topicName?: string; // For subscriptions
  activeMessageCount?: number;
  deadLetterMessageCount?: number;
  initialTab?: number; // 0 = Active Messages, 1 = Dead Letter, 2 = Transfer dead-letter
  transferDeadLetterMessageCount?: number;
  /** Opens the Active tab showing only the scheduled messages among the loaded. */
  initialStateFilter?: 'Scheduled';
}

/** The sub-queue each tab lists, by tab index. */
const TAB_SUB_QUEUES: readonly SubQueue[] = ['active', 'deadletter', 'transferdeadletter'];

/** The most sequence numbers one scheduled-message cancel may carry. */
const MAX_CANCEL_SCHEDULED = 500;

@Component({
  selector: 'app-view-messages-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ScrollingModule,
    MatDialogModule,
    MatSnackBarModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    HighlightPipe,
    AdvancedFilterPanelComponent,
    BulkActionsToolbarComponent
  ],
  template: `
    <h2 mat-dialog-title class="title">Messages: {{ data.entityName }}</h2>

    <div class="body">
      <nav class="sub-queues" [attr.aria-label]="'Sub-queues of ' + data.entityName">
        <button mat-button type="button" class="sub-queue-tab" [class.current]="selectedTabIndex === 0" [attr.aria-current]="selectedTabIndex === 0 ? 'true' : null" (click)="setTab(0)">
          Active Messages
          <span class="count">{{ activeMessageCount() ?? activeMessages.length }}</span>
        </button>
        @if (capabilities()?.supportsDeadLetterQueue !== false) {
          <button mat-button type="button" class="sub-queue-tab" [class.current]="selectedTabIndex === 1" [attr.aria-current]="selectedTabIndex === 1 ? 'true' : null" (click)="setTab(1)">
            Dead Letter
            <span class="count dead-letter">{{ deadLetterMessageCount() ?? deadLetterMessages.length }}</span>
          </button>
        }
        @if (capabilities()?.supportsTransferDeadLetter === true) {
          <button mat-button type="button" class="sub-queue-tab" [class.current]="selectedTabIndex === 2" [attr.aria-current]="selectedTabIndex === 2 ? 'true' : null" (click)="setTab(2)">
            Transfer dead-letter
            <span class="count">{{ transferDeadLetterMessageCount() ?? transferMessages.length }}</span>
          </button>
        }
      </nav>

      <div class="panes">
      @if (selectedTabIndex === 0) {
        <div class="tab-pane-content">
          <div class="toolbar">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="count-field">
              <mat-label>Count</mat-label>
              <input matInput type="number" [(ngModel)]="peekCount" (ngModelChange)="onCountChange($event)" min="0">
            </mat-form-field>
            <div class="filter-field">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search" [class.invalid]="activeRegexError">
                <mat-label>Quick search</mat-label>
                <mat-icon matPrefix fontIcon="search" aria-hidden="true"></mat-icon>
                <input matInput [(ngModel)]="activeFilterText" (ngModelChange)="onFilterChange()" placeholder="Search in any field...">
                @if (activeFilterText) {
                  <button matSuffix mat-icon-button type="button" (click)="clearActiveFilter()" aria-label="Clear the search" matTooltip="Clear the search">
                    <mat-icon fontIcon="close" aria-hidden="true"></mat-icon>
                  </button>
                }
              </mat-form-field>
              <button mat-stroked-button type="button" class="regex-toggle" [class.on]="activeRegexMode" [attr.aria-pressed]="activeRegexMode" (click)="toggleActiveRegexMode()" title="Toggle regex search mode">
                @if (activeRegexMode) { <mat-icon fontIcon="check" aria-hidden="true"></mat-icon> }
                Regex
              </button>
            </div>
            @if (capabilities()?.supportsScheduledMessages !== false) {
              <div class="state-field">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Show</mat-label>
                  <select matNativeControl id="activeStateFilter" [ngModel]="activeStateFilter" (ngModelChange)="setStateFilter($event)">
                    <option value="All">All</option>
                    <option value="Scheduled">Scheduled</option>
                  </select>
                </mat-form-field>
                <span class="state-count">{{ scheduledLoadedCount() }} scheduled of {{ activeMessages.length }} loaded</span>
              </div>
            }
            <button mat-stroked-button type="button" class="refresh" (click)="loadActiveMessages()" [disabled]="loadingActive()">
              <mat-icon fontIcon="refresh" aria-hidden="true"></mat-icon>
              Refresh
            </button>
          </div>
          @if (activeRegexError) {
            <p class="regex-error" role="alert">
              <mat-icon fontIcon="error" aria-hidden="true"></mat-icon>
              {{ activeRegexError }}
            </p>
          }

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
              <button mat-button type="button" (click)="clearAllActiveFilters()">Clear all</button>
            </div>
          }

          <div class="list-pane">
          @if (loadingActive()) {
            <div class="list-state" role="status">
              <mat-progress-spinner mode="indeterminate" diameter="24" aria-hidden="true"></mat-progress-spinner>
              <span>Loading the active messages of {{ data.entityName }}</span>
            </div>
          } @else if (activeMessages.length === 0) {
            <div class="list-state">
              <mat-icon fontIcon="check_circle" aria-hidden="true"></mat-icon>
              <p class="state-title">No active messages</p>
            </div>
          } @else if (filteredActiveMessages.length === 0) {
            <div class="list-state">
              <mat-icon fontIcon="search_off" aria-hidden="true"></mat-icon>
              <p class="state-title">No messages match your filter</p>
            </div>
          } @else {
            <div class="select-all-row">
              <label class="check-label">
                <input type="checkbox" id="selectAllActive"
                  [checked]="isAllActiveSelected()"
                  [indeterminate]="isActiveIndeterminate()"
                  (change)="toggleAllActive($any($event.target).checked)">
                Select All ({{ filteredActiveMessages.length }})
              </label>
            </div>
            <cdk-virtual-scroll-viewport itemSize="64" class="messages-list">
              @for (msg of filteredActiveMessages; track msg.sequenceNumber) {
                <div class="message-card" (click)="selectMessage(msg)" [class.selected]="selectedMessage === msg">
                  <input type="checkbox" [id]="'activeMsg-' + msg.sequenceNumber"
                    [attr.aria-label]="'Select ' + msg.sequenceNumber"
                    [checked]="isActiveMessageSelected(msg.sequenceNumber)"
                    (change)="toggleActiveSelection(msg, $any($event.target).checked)"
                    (click)="$event.stopPropagation()">
                  <div class="message-content">
                    <div class="message-header">
                      <span class="seq">#{{ msg.sequenceNumber }}</span>
                      <span class="id">{{ msg.messageId }}</span>
                      @if (msg.state === 'Scheduled' || msg.state === 'Deferred') {
                        <span class="state-chip">{{ msg.state }}</span>
                      }
                      <span class="time">{{ msg.enqueuedTime | date:'short' }}</span>
                    </div>
                    <div class="message-preview" [innerHTML]="getTruncatedBody(msg.body) | highlight:activeFilterText:{ mode: activeRegexMode ? 'regex' : 'text', caseSensitive: false }"></div>
                  </div>
                </div>
              }
            </cdk-virtual-scroll-viewport>
          }
          </div>
        </div>
      }

      @if (selectedTabIndex === 1) {
        <div class="tab-pane-content">
          @if (data.entityType === 'subscription') {
            <p class="filter-warning" role="note">
              <mat-icon fontIcon="info" aria-hidden="true"></mat-icon>
              <span>Resubmitted messages will be sent to the topic and will pass through all subscription filters. If this subscription has filters configured, the message may not return to it.</span>
            </p>
          }
          <div class="toolbar">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="count-field">
              <mat-label>Count</mat-label>
              <input matInput type="number" [(ngModel)]="peekCount" (ngModelChange)="onCountChange($event)" min="0">
            </mat-form-field>
            <div class="filter-field">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search" [class.invalid]="dlRegexError">
                <mat-label>Quick search</mat-label>
                <mat-icon matPrefix fontIcon="search" aria-hidden="true"></mat-icon>
                <input matInput [(ngModel)]="dlFilterText" (ngModelChange)="onDLFilterChange()" placeholder="Search in any field...">
                @if (dlFilterText) {
                  <button matSuffix mat-icon-button type="button" (click)="clearDLFilter()" aria-label="Clear the search" matTooltip="Clear the search">
                    <mat-icon fontIcon="close" aria-hidden="true"></mat-icon>
                  </button>
                }
              </mat-form-field>
              <button mat-stroked-button type="button" class="regex-toggle" [class.on]="dlRegexMode" [attr.aria-pressed]="dlRegexMode" (click)="toggleDLRegexMode()" title="Toggle regex search mode">
                @if (dlRegexMode) { <mat-icon fontIcon="check" aria-hidden="true"></mat-icon> }
                Regex
              </button>
            </div>
            <button mat-stroked-button type="button" class="refresh" (click)="loadDeadLetterMessages()" [disabled]="loadingDL()">
              <mat-icon fontIcon="refresh" aria-hidden="true"></mat-icon>
              Refresh
            </button>
          </div>
          @if (dlRegexError) {
            <p class="regex-error" role="alert">
              <mat-icon fontIcon="error" aria-hidden="true"></mat-icon>
              {{ dlRegexError }}
            </p>
          }

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
              <button mat-button type="button" (click)="clearAllDLFilters()">Clear all</button>
            </div>
          }

          <div class="list-pane">
          @if (loadingDL()) {
            <div class="list-state" role="status">
              <mat-progress-spinner mode="indeterminate" diameter="24" aria-hidden="true"></mat-progress-spinner>
              <span>Loading the dead-letter messages of {{ data.entityName }}</span>
            </div>
          } @else if (deadLetterMessages.length === 0) {
            <div class="list-state">
              <mat-icon fontIcon="check_circle" aria-hidden="true"></mat-icon>
              <p class="state-title">No dead letter messages</p>
            </div>
          } @else if (filteredDeadLetterMessages.length === 0) {
            <div class="list-state">
              <mat-icon fontIcon="search_off" aria-hidden="true"></mat-icon>
              <p class="state-title">No messages match your filter</p>
            </div>
          } @else {
            <div class="select-all-row">
              <label class="check-label">
                <input type="checkbox" id="selectAllDL"
                  [checked]="isAllDeadLetterSelected()"
                  [indeterminate]="isDeadLetterIndeterminate()"
                  (change)="toggleAllDeadLetter($any($event.target).checked)">
                Select All ({{ filteredDeadLetterMessages.length }})
              </label>
            </div>
            <cdk-virtual-scroll-viewport itemSize="64" class="messages-list">
              @for (msg of filteredDeadLetterMessages; track msg.sequenceNumber) {
                <div class="message-card dead-letter" (click)="selectMessage(msg)" [class.selected]="selectedMessage === msg">
                  <input type="checkbox" [id]="'dlMsg-' + msg.sequenceNumber"
                    [attr.aria-label]="'Select ' + msg.sequenceNumber"
                    [checked]="isDeadLetterMessageSelected(msg.sequenceNumber)"
                    (change)="toggleDeadLetterSelection(msg, $any($event.target).checked)"
                    (click)="$event.stopPropagation()">
                  <div class="message-content">
                    <div class="message-header">
                      <span class="seq">#{{ msg.sequenceNumber }}</span>
                      <span class="reason">{{ msg.deadLetterReason || 'Unknown' }}</span>
                      @if (msg.state === 'Scheduled' || msg.state === 'Deferred') {
                        <span class="state-chip">{{ msg.state }}</span>
                      }
                      <span class="time">{{ msg.enqueuedTime | date:'short' }}</span>
                    </div>
                    <div class="message-preview" [innerHTML]="getTruncatedBody(msg.body) | highlight:dlFilterText:{ mode: dlRegexMode ? 'regex' : 'text', caseSensitive: false }"></div>
                  </div>
                </div>
              }
            </cdk-virtual-scroll-viewport>
          }
          </div>
        </div>
      }

      @if (selectedTabIndex === 2) {
        <div class="tab-pane-content">
          <p class="sub-queue-note">
            Messages this {{ data.entityType }} could not forward to another entity.
            They can be resubmitted to the {{ data.entityType === 'queue' ? 'queue' : 'topic' }} or deleted.
          </p>
          @if (data.entityType === 'subscription') {
            <p class="filter-warning" role="note">
              <mat-icon fontIcon="info" aria-hidden="true"></mat-icon>
              <span>Resubmitted messages will be sent to the topic and will pass through all subscription filters. If this subscription has filters configured, the message may not return to it.</span>
            </p>
          }
          <div class="toolbar">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="count-field">
              <mat-label>Count</mat-label>
              <input matInput id="tdlCount" type="number" [(ngModel)]="peekCount" (ngModelChange)="onCountChange($event)" min="0">
            </mat-form-field>
            <div class="filter-field">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search" [class.invalid]="tdlRegexError">
                <mat-label>Quick search</mat-label>
                <mat-icon matPrefix fontIcon="search" aria-hidden="true"></mat-icon>
                <input matInput id="tdlSearch" [(ngModel)]="tdlFilterText" (ngModelChange)="applyTDLFilter()" placeholder="Search in any field...">
                @if (tdlFilterText) {
                  <button matSuffix mat-icon-button type="button" (click)="clearTDLFilter()" aria-label="Clear the search" matTooltip="Clear the search">
                    <mat-icon fontIcon="close" aria-hidden="true"></mat-icon>
                  </button>
                }
              </mat-form-field>
              <button mat-stroked-button type="button" class="regex-toggle" [class.on]="tdlRegexMode" [attr.aria-pressed]="tdlRegexMode" (click)="toggleTDLRegexMode()" title="Toggle regex search mode">
                @if (tdlRegexMode) { <mat-icon fontIcon="check" aria-hidden="true"></mat-icon> }
                Regex
              </button>
            </div>
            <button mat-stroked-button type="button" class="refresh" (click)="loadTransferDeadLetterMessages()" [disabled]="loadingTDL()">
              <mat-icon fontIcon="refresh" aria-hidden="true"></mat-icon>
              Refresh
            </button>
          </div>
          @if (tdlRegexError) {
            <p class="regex-error" role="alert">
              <mat-icon fontIcon="error" aria-hidden="true"></mat-icon>
              {{ tdlRegexError }}
            </p>
          }

          <div class="list-pane">
          @if (loadingTDL()) {
            <div class="list-state" role="status">
              <mat-progress-spinner mode="indeterminate" diameter="24" aria-hidden="true"></mat-progress-spinner>
              <span>Loading the transfer dead-letter messages of {{ data.entityName }}</span>
            </div>
          } @else if (transferMessages.length === 0) {
            <div class="list-state">
              <mat-icon fontIcon="check_circle" aria-hidden="true"></mat-icon>
              <p class="state-title">No transfer dead-letter messages</p>
            </div>
          } @else if (filteredTransferMessages.length === 0) {
            <div class="list-state">
              <mat-icon fontIcon="search_off" aria-hidden="true"></mat-icon>
              <p class="state-title">No messages match your filter</p>
            </div>
          } @else {
            <div class="select-all-row">
              <label class="check-label">
                <input type="checkbox" id="selectAllTDL"
                  [checked]="isAllSelectedIn('transferdeadletter')"
                  [indeterminate]="bulkOperationsService.isIndeterminate('transferdeadletter')"
                  (change)="toggleAll('transferdeadletter', $any($event.target).checked)">
                Select All ({{ filteredTransferMessages.length }})
              </label>
            </div>
            <cdk-virtual-scroll-viewport itemSize="64" class="messages-list">
              @for (msg of filteredTransferMessages; track msg.sequenceNumber) {
                <div class="message-card dead-letter" (click)="selectMessage(msg)" [class.selected]="selectedMessage === msg">
                  <input type="checkbox" [id]="'tdlMsg-' + msg.sequenceNumber"
                    [attr.aria-label]="'Select ' + msg.sequenceNumber"
                    [checked]="bulkOperationsService.isSelected('transferdeadletter', msg.sequenceNumber)"
                    (change)="toggleSelection('transferdeadletter', msg, $any($event.target).checked)"
                    (click)="$event.stopPropagation()">
                  <div class="message-content">
                    <div class="message-header">
                      <span class="seq">#{{ msg.sequenceNumber }}</span>
                      <span class="reason">{{ msg.deadLetterReason || 'Unknown' }}</span>
                      @if (msg.state === 'Scheduled' || msg.state === 'Deferred') {
                        <span class="state-chip">{{ msg.state }}</span>
                      }
                      <span class="time">{{ msg.enqueuedTime | date:'short' }}</span>
                    </div>
                    <div class="message-preview" [innerHTML]="getTruncatedBody(msg.body) | highlight:tdlFilterText:{ mode: tdlRegexMode ? 'regex' : 'text', caseSensitive: false }"></div>
                  </div>
                </div>
              }
            </cdk-virtual-scroll-viewport>
          }
          </div>
        </div>
      }

      @if (selectedMessage) {
        <section class="detail-pane message-detail" aria-label="Message details">
          <h3 class="pane-title">Message Details</h3>
          <div class="detail-grid">
            <div class="detail-item">
              <label>Message ID</label>
              <span>{{ selectedMessage.messageId }}</span>
            </div>
            <div class="detail-item">
              <label>Sequence Number</label>
              <span>{{ selectedMessage.sequenceNumber }}</span>
            </div>
            <div class="detail-item">
              <label>Correlation ID</label>
              <span>{{ selectedMessage.correlationId || '-' }}</span>
            </div>
            <div class="detail-item">
              <label>Content Type</label>
              <span>{{ selectedMessage.contentType || '-' }}</span>
            </div>
            <div class="detail-item">
              <label>Enqueued Time</label>
              <span>{{ selectedMessage.enqueuedTime | date:'medium' }}</span>
            </div>
            <div class="detail-item">
              <label>Delivery Count</label>
              <span>{{ selectedMessage.deliveryCount }}</span>
            </div>
            @if (selectedMessage.state && selectedMessage.state !== 'Active') {
              <div class="detail-item">
                <label>State</label>
                <span>{{ selectedMessage.state }}</span>
                @if (selectedMessage.state === 'Deferred') {
                  <small class="state-note">This app cannot receive a deferred message.</small>
                }
              </div>
            }
            <div class="detail-item">
              <label>Size</label>
              <span>{{ selectedMessage.sizeInBytes != null ? (selectedMessage.sizeInBytes | number) + ' bytes' : '-' }}</span>
            </div>
            <div class="detail-item">
              <label>Session ID</label>
              <span>{{ selectedMessage.sessionId || '-' }}</span>
            </div>
            <div class="detail-item">
              <label>Subject</label>
              <span>{{ selectedMessage.subject || '-' }}</span>
            </div>
            <div class="detail-item">
              <label>To</label>
              <span>{{ selectedMessage.to || '-' }}</span>
            </div>
            <div class="detail-item">
              <label>Reply To</label>
              <span>{{ selectedMessage.replyTo || '-' }}</span>
            </div>
            <div class="detail-item">
              <label>Scheduled Time</label>
              <span>{{ isDateSet(selectedMessage.scheduledEnqueueTime) ? (selectedMessage.scheduledEnqueueTime | date:'medium') : '-' }}</span>
            </div>
            <div class="detail-item">
              <label>Expires At</label>
              <span>{{ isDateSet(selectedMessage.expiresAt) ? (selectedMessage.expiresAt | date:'medium') : '-' }}</span>
            </div>
          </div>

          <h4 class="section-title">Body</h4>
          <pre class="body-content" [innerHTML]="formatBody(selectedMessage.body) | highlight:getActiveFilterText():{ mode: getActiveRegexMode() ? 'regex' : 'text', caseSensitive: false }"></pre>

          @if (selectedMessage.applicationProperties && hasProperties(selectedMessage.applicationProperties)) {
            <h4 class="section-title">Application Properties</h4>
            <dl class="properties">
              @for (prop of getProperties(selectedMessage.applicationProperties); track prop.key) {
                <div class="property">
                  <dt class="key">{{ prop.key }}:</dt>
                  <dd class="value" [innerHTML]="prop.value | highlight:getActiveFilterText():{ mode: getActiveRegexMode() ? 'regex' : 'text', caseSensitive: false }"></dd>
                </div>
              }
            </dl>
          }

          @if (subQueue === 'deadletter') {
            <div class="message-actions">
              <button mat-stroked-button type="button" (click)="editAndResubmit(selectedMessage)">
                <mat-icon fontIcon="edit" aria-hidden="true"></mat-icon>
                Edit & Resubmit
              </button>
              <button mat-flat-button type="button" class="tonal" (click)="resubmit(selectedMessage)">
                <mat-icon fontIcon="replay" aria-hidden="true"></mat-icon>
                Resubmit
              </button>
            </div>
          }
        </section>
      } @else if (shownOf(subQueue).length > 0) {
        <div class="detail-pane detail-empty">
          <mat-icon fontIcon="visibility" aria-hidden="true"></mat-icon>
          <p class="state-title">Select a message to see its details</p>
          <p>Click a row to read its properties and body. Tick rows to act on several at once.</p>
        </div>
      }
      </div>
    </div>

    <app-bulk-actions-toolbar
      [selectedCount]="getSelectedCount()"
      [detail]="getSelectionSummary()"
      [showResubmit]="subQueue !== 'active'"
      [showCompare]="getSelectedCount() === 2 && subQueue !== 'transferdeadletter'"
      [showMove]="subQueue !== 'transferdeadletter'"
      [showCancelScheduled]="canOfferCancelScheduled()"
      [cancelScheduledBlockedReason]="canOfferCancelScheduled() ? cancelScheduledBlockedReason() : ''"
      [disabled]="isBulkOperationInProgress()"
      (actionClicked)="onBulkAction($event)"
      (clearSelection)="onClearSelection()">
    </app-bulk-actions-toolbar>
  `,
  styleUrl: './view-messages-dialog.component.scss'
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
  protected readonly capabilities = inject(ProviderService).capabilities;

  activeMessages: MessageInfo[] = [];
  deadLetterMessages: MessageInfo[] = [];
  transferMessages: MessageInfo[] = [];
  filteredActiveMessages: MessageInfo[] = [];
  filteredDeadLetterMessages: MessageInfo[] = [];
  filteredTransferMessages: MessageInfo[] = [];
  selectedMessage: MessageInfo | null = null;

  loadingActive = signal(false);
  loadingDL = signal(false);
  loadingTDL = signal(false);
  resubmitting = signal(false);
  deleting = signal(false);
  moving = signal(false);
  cancellingScheduled = signal(false);
  peekCount = 20;
  selectedTabIndex = 0;

  // Message count signals for automatic UI updates
  activeMessageCount = signal<number | undefined>(undefined);
  deadLetterMessageCount = signal<number | undefined>(undefined);
  transferDeadLetterMessageCount = signal<number | undefined>(undefined);

  // Filter properties
  activeFilterText = '';
  activeFilterProperty: string | null = null;
  activeRegexMode = false;
  activeRegexError = '';
  activeStateFilter: 'All' | 'Scheduled' = 'All';
  dlFilterText = '';
  dlFilterProperty: string | null = null;
  dlRegexMode = false;
  dlRegexError = '';
  tdlFilterText = '';
  tdlRegexMode = false;
  tdlRegexError = '';

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
      const transferShown = this.capabilities()?.supportsTransferDeadLetter === true;
      this.selectedTabIndex = this.data.initialTab === 2 && !transferShown ? 0 : this.data.initialTab;
    }

    // Initialize message count signals from data
    if (this.data.activeMessageCount !== undefined) {
      this.activeMessageCount.set(this.data.activeMessageCount);
    }
    if (this.data.deadLetterMessageCount !== undefined) {
      this.deadLetterMessageCount.set(this.data.deadLetterMessageCount);
    }
    if (this.data.transferDeadLetterMessageCount !== undefined) {
      this.transferDeadLetterMessageCount.set(this.data.transferDeadLetterMessageCount);
    }

    if (this.data.initialStateFilter === 'Scheduled' && this.subQueue === 'active') {
      this.activeStateFilter = 'Scheduled';
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

    this.load(this.subQueue);
  }

  /** The sub-queue of the tab shown now; every list, selection and action of the dialog reads it. */
  get subQueue(): SubQueue {
    return TAB_SUB_QUEUES[this.selectedTabIndex];
  }

  /** An absent date, or the .NET default of year 1, is not set. */
  isDateSet(value: Date | string | undefined): boolean {
    return !!value && new Date(value).getUTCFullYear() > 1;
  }

  onCountChange(value: number) {
    this.countChange$.next(value);
  }

  setTab(index: number) {
    this.selectedTabIndex = index;
    this.selectedMessage = null;

    // Clear selections when switching tabs for better UX
    this.bulkOperationsService.clearAllSelections();

    if (this.loadedOf(this.subQueue).length === 0) {
      this.load(this.subQueue);
    }
  }

  private reloadCurrentTab() {
    this.load(this.subQueue);
  }

  private clearCurrentTab() {
    this.selectedMessage = null;
    switch (this.subQueue) {
      case 'active': this.activeMessages = []; break;
      case 'deadletter': this.deadLetterMessages = []; break;
      case 'transferdeadletter': this.transferMessages = []; break;
    }
  }

  private load(subQueue: SubQueue) {
    switch (subQueue) {
      case 'active': return this.loadActiveMessages();
      case 'deadletter': return this.loadDeadLetterMessages();
      case 'transferdeadletter': return this.loadTransferDeadLetterMessages();
    }
  }

  /** The one place a sub-queue becomes a peek route. */
  private peek(subQueue: SubQueue): Observable<MessageInfo[]> {
    const { entityName, topicName } = this.data;
    const queue = this.data.entityType === 'queue';
    switch (subQueue) {
      case 'active':
        return queue ? this.queueService.peekMessages(entityName, this.peekCount) : this.topicService.peekMessages(topicName!, entityName, this.peekCount);
      case 'deadletter':
        return queue ? this.queueService.peekDeadLetterMessages(entityName, this.peekCount) : this.topicService.peekDeadLetterMessages(topicName!, entityName, this.peekCount);
      case 'transferdeadletter':
        return queue ? this.queueService.peekTransferDeadLetterMessages(entityName, this.peekCount) : this.topicService.peekTransferDeadLetterMessages(topicName!, entityName, this.peekCount);
    }
  }

  /** The one place a sub-queue becomes a delete-batch route; the transfer dead-letter queue is never drained whole. */
  private deleteBatch(subQueue: SubQueue, sequenceNumbers: number[], all: boolean): Observable<BatchOperationResult> {
    const { entityName, topicName } = this.data;
    const queue = this.data.entityType === 'queue';
    switch (subQueue) {
      case 'active':
      case 'deadletter': {
        const isDeadLetter = subQueue === 'deadletter';
        return queue
          ? this.queueService.deleteMessages(entityName, sequenceNumbers, isDeadLetter, all)
          : this.topicService.deleteMessages(topicName!, entityName, sequenceNumbers, isDeadLetter, all);
      }
      case 'transferdeadletter':
        return queue
          ? this.queueService.deleteTransferDeadLetterMessages(entityName, sequenceNumbers)
          : this.topicService.deleteTransferDeadLetterMessages(topicName!, entityName, sequenceNumbers);
    }
  }

  /** The one place a sub-queue becomes a resubmit-batch route. */
  private resubmitBatch(subQueue: 'deadletter' | 'transferdeadletter', sequenceNumbers: number[]): Observable<BatchOperationResult> {
    const { entityName, topicName } = this.data;
    const queue = this.data.entityType === 'queue';
    if (subQueue === 'transferdeadletter') {
      return queue
        ? this.queueService.resubmitTransferDeadLetterMessages(entityName, sequenceNumbers)
        : this.topicService.resubmitTransferDeadLetterMessages(topicName!, entityName, sequenceNumbers);
    }
    return queue
      ? this.queueService.resubmitDeadLetterMessages(entityName, sequenceNumbers)
      : this.topicService.resubmitDeadLetterMessages(topicName!, entityName, sequenceNumbers);
  }

  /** The messages loaded in a sub-queue. */
  loadedOf(subQueue: SubQueue): MessageInfo[] {
    switch (subQueue) {
      case 'active': return this.activeMessages;
      case 'deadletter': return this.deadLetterMessages;
      case 'transferdeadletter': return this.transferMessages;
    }
  }

  /** The messages a sub-queue's tab shows after its search and filters. */
  shownOf(subQueue: SubQueue): MessageInfo[] {
    switch (subQueue) {
      case 'active': return this.filteredActiveMessages;
      case 'deadletter': return this.filteredDeadLetterMessages;
      case 'transferdeadletter': return this.filteredTransferMessages;
    }
  }

  private countOf(subQueue: SubQueue) {
    switch (subQueue) {
      case 'active': return this.activeMessageCount;
      case 'deadletter': return this.deadLetterMessageCount;
      case 'transferdeadletter': return this.transferDeadLetterMessageCount;
    }
  }

  loadActiveMessages() {
    this.loadingActive.set(true);

    this.peek('active').pipe(
      finalize(() => this.loadingActive.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (messages) => {
        // A new list replaces the old one, so the selection and the detail of the old one go with it
        this.selectedMessage = null;
        this.activeMessages = messages;
        this.applyActiveFilter();
      },
      error: (err) => {
        this.snackBar.open(messageCallFailure(err, 'Failed to load messages'), 'Close', { duration: 3000 });
      }
    });
  }

  applyActiveFilter() {
    this.bulkOperationsService.clearSelection('active');
    let messages = this.activeMessages;

    // First apply quick search filter if present
    if (this.activeFilterText) {
      // Validate regex pattern if in regex mode
      if (this.activeRegexMode) {
        if (!this.messageSearchService.isValidRegex(this.activeFilterText)) {
          this.activeRegexError = this.getRegexError(this.activeFilterText);
          this.filteredActiveMessages = this.byState(this.activeMessages); // Don't filter with invalid regex
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

    this.filteredActiveMessages = this.byState(messages);
  }

  /** The Active tab's state filter, applied to the loaded messages only. */
  private byState(messages: MessageInfo[]): MessageInfo[] {
    return this.activeStateFilter === 'Scheduled' ? messages.filter(m => m.state === 'Scheduled') : messages;
  }

  setStateFilter(value: 'All' | 'Scheduled') {
    this.activeStateFilter = value;
    this.applyActiveFilter();
  }

  scheduledLoadedCount(): number {
    return this.activeMessages.filter(m => m.state === 'Scheduled').length;
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
    this.bulkOperationsService.clearSelection('deadletter');
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

    this.peek('deadletter').pipe(
      finalize(() => this.loadingDL.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (messages) => {
        this.deadLetterMessages = messages;
        this.applyDLFilter();
      },
      error: (err) => {
        console.error('Failed to load dead letter messages:', err);
        this.snackBar.open(messageCallFailure(err, 'Failed to load dead letter messages'), 'Close', { duration: 3000 });
      }
    });
  }

  loadTransferDeadLetterMessages() {
    this.loadingTDL.set(true);

    this.peek('transferdeadletter').pipe(
      finalize(() => this.loadingTDL.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (messages) => {
        this.transferMessages = messages;
        this.applyTDLFilter();
      },
      error: (err) => {
        this.snackBar.open(messageCallFailure(err, 'Failed to load transfer dead-letter messages'), 'Close', { duration: 3000 });
      }
    });
  }

  applyTDLFilter() {
    this.bulkOperationsService.clearSelection('transferdeadletter');
    const invalid = !!this.tdlFilterText && this.tdlRegexMode && !this.messageSearchService.isValidRegex(this.tdlFilterText);
    this.tdlRegexError = invalid ? this.getRegexError(this.tdlFilterText) : '';
    this.filteredTransferMessages = !this.tdlFilterText || invalid
      ? this.transferMessages
      : this.messageSearchService.searchMessages(this.transferMessages, this.tdlFilterText, {
        mode: this.tdlRegexMode ? 'regex' : 'text',
        caseSensitive: false,
        property: null
      });
  }

  clearTDLFilter() {
    this.tdlFilterText = '';
    this.applyTDLFilter();
  }

  toggleTDLRegexMode() {
    this.tdlRegexMode = !this.tdlRegexMode;
    this.applyTDLFilter();
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
      error: (err) => {
        this.snackBar.open(messageCallFailure(err, 'Failed to resubmit message'), 'Close', { duration: 3000 });
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

  toggleSelection(subQueue: SubQueue, msg: MessageInfo, checked: boolean) {
    const shown = this.shownOf(subQueue).length;
    if (checked) {
      this.bulkOperationsService.selectMessage(subQueue, msg.sequenceNumber, shown);
    } else {
      this.bulkOperationsService.deselectMessage(subQueue, msg.sequenceNumber, shown);
    }
  }

  toggleAll(subQueue: SubQueue, checked: boolean) {
    const shown = this.shownOf(subQueue);
    if (!checked) {
      this.bulkOperationsService.clearSelection(subQueue);
      return;
    }
    // Warn user about large selections (>500 messages)
    if (shown.length <= 500) {
      this.bulkOperationsService.selectAll(subQueue, shown);
      return;
    }
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Large Selection',
        message: `You are about to select ${shown.length} messages. This may take some time to process. Do you want to continue?`,
        confirmText: 'Select All',
        confirmColor: 'primary',
        icon: 'info-circle'
      }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.bulkOperationsService.selectAll(subQueue, shown);
      }
    });
  }

  isAllSelectedIn(subQueue: SubQueue): boolean {
    return this.bulkOperationsService.isAllSelected(subQueue, this.shownOf(subQueue));
  }

  toggleActiveSelection(msg: MessageInfo, checked: boolean) {
    this.toggleSelection('active', msg, checked);
  }

  toggleAllActive(checked: boolean) {
    this.toggleAll('active', checked);
  }

  isAllActiveSelected(): boolean {
    return this.isAllSelectedIn('active');
  }

  isActiveIndeterminate(): boolean {
    return this.bulkOperationsService.isIndeterminate('active');
  }

  isActiveMessageSelected(sequenceNumber: number): boolean {
    return this.bulkOperationsService.isSelected('active', sequenceNumber);
  }

  toggleDeadLetterSelection(msg: MessageInfo, checked: boolean) {
    this.toggleSelection('deadletter', msg, checked);
  }

  toggleAllDeadLetter(checked: boolean) {
    this.toggleAll('deadletter', checked);
  }

  isAllDeadLetterSelected(): boolean {
    return this.isAllSelectedIn('deadletter');
  }

  isDeadLetterIndeterminate(): boolean {
    return this.bulkOperationsService.isIndeterminate('deadletter');
  }

  isDeadLetterMessageSelected(sequenceNumber: number): boolean {
    return this.bulkOperationsService.isSelected('deadletter', sequenceNumber);
  }

  resubmitSelected(sequenceNumbersToResubmit?: number[],
    subQueue: 'deadletter' | 'transferdeadletter' = this.subQueue === 'transferdeadletter' ? 'transferdeadletter' : 'deadletter') {
    // Use provided sequence numbers or get from service
    const sequenceNumbers = sequenceNumbersToResubmit || this.bulkOperationsService.getSelectedSequenceNumbers(subQueue);
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
        subQueue
      } as BulkOperationProgressDialogData,
      disableClose: true
    });

    const observable = this.resubmitBatch(subQueue, sequenceNumbers);

    const progressComponent = progressDialogRef.componentInstance;

    // Track cancellation so no success callback runs after the user aborts.
    // Unsubscribing via takeUntil also aborts the XHR, which stops the batch on
    // the server through RequestAborted.
    let cancelled = false;
    progressComponent.cancelRequested$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      cancelled = true;
    });

    observable.pipe(
      finalize(() => this.resubmitting.set(false)),
      takeUntil(progressComponent.cancelRequested$),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        if (cancelled) {
          return;
        }
        // Update progress to complete
        progressComponent.updateProgress({
          processed: selectedCount,
          total: selectedCount,
          successCount: result.successCount,
          failureCount: result.failureCount
        });

        // Close progress dialog after a brief delay to show completion
        setTimeout(() => {
          if (cancelled) {
            return;
          }
          progressDialogRef.close();

          const retryable = result.failures.filter(f => !isPossibleDuplicate(f)).map(f => f.sequenceNumber);
          const resultsDialogRef = this.dialog.open(BulkOperationResultsDialogComponent, {
            data: {
              operation: 'resubmit',
              result: result,
              entityName: this.data.entityName,
              entityType: this.data.entityType,
              subQueue,
              allowRetry: retryable.length > 0
            } as BulkOperationResultsDialogData
          });

          resultsDialogRef.afterClosed().pipe(
            takeUntilDestroyed(this.destroyRef)
          ).subscribe((resultsResponse) => {
            // Clear selection (only if not retrying)
            if (!resultsResponse?.retry) {
              this.bulkOperationsService.clearSelection(subQueue);
            }

            // Update message counts based on successful resubmissions
            if (result.successCount > 0) {
              // Decrease the count of the sub-queue the messages left
              this.countOf(subQueue).update(count =>
                count !== undefined ? Math.max(0, count - result.successCount) : undefined
              );

              // Increase active message count (messages are going back to active queue)
              this.activeMessageCount.update(count =>
                count !== undefined ? count + result.successCount : undefined
              );
            }

            // Refresh the list the messages left
            this.load(subQueue);

            if (resultsResponse?.retry && retryable.length > 0) {
              setTimeout(() => {
                this.resubmitSelected(retryable, subQueue);
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
          this.snackBar.open(messageCallFailure(err, 'Failed to resubmit messages'), 'Close', { duration: 3000 });
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
    switch (this.subQueue) {
      case 'active': return this.activeFilterText;
      case 'deadletter': return this.dlFilterText;
      case 'transferdeadletter': return this.tdlFilterText;
    }
  }

  /**
   * Gets the active regex mode based on the current tab
   * Returns the appropriate regex mode for highlighting
   */
  getActiveRegexMode(): boolean {
    switch (this.subQueue) {
      case 'active': return this.activeRegexMode;
      case 'deadletter': return this.dlRegexMode;
      case 'transferdeadletter': return this.tdlRegexMode;
    }
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
    return this.bulkOperationsService.getSelectionCount(this.subQueue);
  }

  /**
   * The selection bar text after the count: how many messages are loaded in the current
   * tab and how many the entity holds, so a selection never reads as more than it is.
   */
  getSelectionSummary(): string {
    const subQueue = this.subQueue;
    const loaded = this.loadedOf(subQueue).length;
    const total = this.countOf(subQueue)();
    const where = subQueue === 'active' ? this.data.entityType
      : subQueue === 'deadletter' ? 'dead-letter queue' : 'transfer dead-letter queue';
    return total === undefined
      ? `selected of ${loaded} loaded`
      : `selected of ${loaded} loaded, ${total.toLocaleString()} in the ${where}`;
  }

  /**
   * Checks if any bulk operation is currently in progress
   * @returns True if any operation is running
   */
  isBulkOperationInProgress(): boolean {
    return this.loadingActive() || this.loadingDL() || this.loadingTDL() || this.resubmitting() || this.deleting() || this.moving() || this.cancellingScheduled();
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
      case 'cancel-scheduled':
        this.handleCancelScheduled();
        break;
    }
  }

  /** Cancel scheduled is offered on a queue's Active tab, unless the broker has no scheduled messages. */
  canOfferCancelScheduled(): boolean {
    return this.data.entityType === 'queue' && this.subQueue === 'active' && this.capabilities()?.supportsScheduledMessages !== false;
  }

  /** Why the active selection cannot be cancelled as scheduled messages; empty when it can. */
  cancelScheduledBlockedReason(): string {
    const selected = this.bulkOperationsService.getSelectedSequenceNumbers('active');
    if (selected.length > MAX_CANCEL_SCHEDULED) {
      return `Cancel takes at most ${MAX_CANCEL_SCHEDULED} messages at a time; ${selected.length} are selected.`;
    }
    const scheduled = new Set(this.activeMessages.filter(m => m.state === 'Scheduled').map(m => m.sequenceNumber));
    const notScheduled = selected.filter(n => !scheduled.has(n)).length;
    return notScheduled === 0 ? ''
      : `Only scheduled messages can be cancelled; ${notScheduled} of the ${selected.length} selected ${notScheduled === 1 ? 'is' : 'are'} not scheduled.`;
  }

  private handleCancelScheduled(): void {
    const sequenceNumbers = this.bulkOperationsService.getSelectedSequenceNumbers('active');
    if (!this.canOfferCancelScheduled() || sequenceNumbers.length === 0 || this.cancelScheduledBlockedReason()) {
      return;
    }
    const dialogRef = this.dialog.open(CancelScheduledDialogComponent, {
      data: { queueName: this.data.entityName, sequenceNumbers } as CancelScheduledDialogData
    });
    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(confirmed => {
      if (confirmed === true) {
        this.executeCancelScheduled(sequenceNumbers);
      }
    });
  }

  private executeCancelScheduled(sequenceNumbers: number[]): void {
    if (this.cancellingScheduled()) {
      return;
    }
    this.cancellingScheduled.set(true);
    this.queueService.cancelScheduledMessages(this.data.entityName, sequenceNumbers).pipe(
      finalize(() => this.cancellingScheduled.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        const resultsDialogRef = this.dialog.open(BulkOperationResultsDialogComponent, {
          data: {
            operation: 'cancel-scheduled',
            result,
            entityName: this.data.entityName,
            entityType: 'queue',
            subQueue: 'active',
            allowRetry: false
          } as BulkOperationResultsDialogData
        });
        resultsDialogRef.afterClosed().pipe(
          takeUntilDestroyed(this.destroyRef)
        ).subscribe(() => {
          this.bulkOperationsService.clearSelection('active');
          this.loadActiveMessages();
        });
      },
      error: (err) => {
        this.snackBar.open(messageCallFailure(err, 'Failed to cancel the scheduled messages'), 'Close', { duration: 5000 });
      }
    });
  }

  /**
   * Handles clear selection event from the toolbar
   * Clears the selection for the current tab
   */
  onClearSelection(): void {
    this.bulkOperationsService.clearSelection(this.subQueue);
  }

  /**
   * Handles bulk delete action
   * Shows confirmation dialog and executes bulk delete operation
   */
  private handleBulkDelete(): void {
    const subQueue = this.subQueue;
    const selectedCount = this.bulkOperationsService.getSelectionCount(subQueue);

    if (selectedCount === 0) {
      this.snackBar.open('Please select at least one message to delete', 'Close', { duration: 3000 });
      return;
    }

    const messageType = subQueue === 'active' ? 'messages'
      : subQueue === 'deadletter' ? 'dead letter messages' : 'transfer dead-letter messages';
    const entityName = this.data.entityName;

    // A drain-all delete tells the backend to purge the whole tab server-side at
    // execution time, so it affects every message present then, including any
    // that arrive after this dialog opened, not just the ones currently loaded.
    // That case warrants a stronger, explicit confirmation.
    const drainAll = this.shouldDrainEntireTab(subQueue);
    const entityLabel = this.data.entityType === 'queue' ? 'queue' : 'subscription';

    const confirmData: ConfirmDialogData = drainAll
      ? {
          title: 'Delete ALL Messages',
          message: `This will permanently delete ALL ${messageType} currently in ${this.data.entityType} "${entityName}" at the moment of execution — including any messages that arrive after this dialog was opened, not just the ${selectedCount} currently loaded. This action is irreversible.`,
          confirmText: 'Delete all',
          confirmColor: 'warn',
          icon: 'delete_forever',
          requireAcknowledgement: true,
          acknowledgementText: `I understand this drains the entire ${entityLabel}`
        }
      : {
          title: 'Delete Messages',
          message: `Are you sure you want to delete ${selectedCount} ${messageType} from ${this.data.entityType} "${entityName}"? This action cannot be undone.`,
          confirmText: 'Delete',
          confirmColor: 'warn',
          icon: 'delete'
        };

    // Open confirmation dialog
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: confirmData
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.executeDeleteOperation(subQueue);
      }
    });
  }

  /**
   * Executes the bulk delete operation
   * @param subQueue - The sub-queue the selection belongs to, captured when the action started
   */
  private executeDeleteOperation(subQueue: SubQueue): void {
    if (this.deleting()) {
      return;
    }
    this.deleting.set(true);
    const selectedSequenceNumbers = this.bulkOperationsService.getSelectedSequenceNumbers(subQueue);
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
    const drainAll = this.shouldDrainEntireTab(subQueue);
    const sequenceNumbers = drainAll ? [] : selectedSequenceNumbers;

    // Open progress dialog
    const progressDialogRef = this.dialog.open(BulkOperationProgressDialogComponent, {
      data: {
        operation: 'delete',
        totalCount: totalCount,
        entityName: this.data.entityName,
        entityType: this.data.entityType,
        subQueue
      } as BulkOperationProgressDialogData,
      disableClose: true
    });

    const observable = this.deleteBatch(subQueue, sequenceNumbers, drainAll);

    const progressComponent = progressDialogRef.componentInstance;

    // Track cancellation so no success callback runs after the user aborts.
    // Unsubscribing via takeUntil also aborts the XHR, which stops the batch on
    // the server through RequestAborted.
    let cancelled = false;
    progressComponent.cancelRequested$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      cancelled = true;
    });

    observable.pipe(
      finalize(() => this.deleting.set(false)),
      takeUntil(progressComponent.cancelRequested$),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        if (cancelled) {
          return;
        }
        // Update progress to complete
        progressComponent.updateProgress({
          processed: totalCount,
          total: totalCount,
          successCount: result.successCount,
          failureCount: result.failureCount
        });

        // Close progress dialog after a brief delay to show completion
        setTimeout(() => {
          if (cancelled) {
            return;
          }
          progressDialogRef.close();

          // Show results dialog
          const resultsDialogRef = this.dialog.open(BulkOperationResultsDialogComponent, {
            data: {
              operation: 'delete',
              result: result,
              entityName: this.data.entityName,
              entityType: this.data.entityType,
              subQueue,
              allowRetry: false // Delete operations cannot be retried
            } as BulkOperationResultsDialogData
          });

          resultsDialogRef.afterClosed().pipe(
            takeUntilDestroyed(this.destroyRef)
          ).subscribe(() => {
            // Clear selection
            this.bulkOperationsService.clearSelection(subQueue);

            // Update message counts based on successful deletions
            if (result.successCount > 0) {
              this.countOf(subQueue).update(count =>
                count !== undefined ? Math.max(0, count - result.successCount) : undefined
              );
            }

            // Refresh the message list
            this.load(subQueue);
          });
        }, 1000);
      },
      error: (err) => {
        console.error('Failed to delete messages:', err);
        // Close the progress dialog instead of leaving it fake-completed, and
        // surface a retry hint so the user knows the operation can be reattempted.
        progressDialogRef.close();
        this.snackBar.open(messageCallFailure(err, 'Failed to delete messages. Please try again.'), 'Close', { duration: 5000 });
      }
    });
  }

  /**
   * Determines whether a bulk delete should drain the entire tab server-side: only when
   * the number of selected messages equals the entity's count for that tab and no search
   * or filter is applied. A selected page, or the hits of a search, is sent as its
   * sequence numbers.
   * The transfer dead-letter queue has no purge, so it is never drained.
   * @param subQueue - The sub-queue of the selection
   */
  private shouldDrainEntireTab(subQueue: SubQueue): boolean {
    if (subQueue === 'transferdeadletter') {
      return false;
    }
    const entityCount = this.countOf(subQueue)();
    return entityCount !== undefined
      && entityCount > 0
      && this.bulkOperationsService.getSelectionCount(subQueue) === entityCount
      && !this.hasActiveFilter(subQueue);
  }

  /**
   * Reports whether a text or advanced filter is currently applied to a tab.
   * @param subQueue - The sub-queue of the tab
   */
  private hasActiveFilter(subQueue: SubQueue): boolean {
    switch (subQueue) {
      case 'active':
        return this.activeFilterText.trim() !== '' || this.activeAdvancedFilterState.conditions.length > 0 || this.activeStateFilter !== 'All';
      case 'deadletter':
        return this.dlFilterText.trim() !== '' || this.dlAdvancedFilterState.conditions.length > 0;
      case 'transferdeadletter':
        return this.tdlFilterText.trim() !== '';
    }
  }

  /**
   * Handles bulk resubmit action
   * Uses the existing resubmitSelected method for Dead Letter messages
   */
  private handleBulkResubmit(): void {
    const subQueue = this.subQueue;
    if (subQueue !== 'active') {
      this.resubmitSelected(undefined, subQueue);
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

    const subQueue = this.subQueue;
    if (subQueue === 'transferdeadletter') {
      return;
    }
    const selectedCount = this.bulkOperationsService.getSelectionCount(subQueue);

    if (selectedCount === 0) {
      this.snackBar.open('Please select at least one message to move', 'Close', { duration: 3000 });
      return;
    }

    const isDeadLetter = subQueue === 'deadletter';

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
        this.executeMoveOperation(subQueue, targetQueueName);
      }
    });
  }

  /**
   * Executes the bulk move operation
   * @param subQueue - The sub-queue the selection belongs to, captured when the action started
   * @param targetQueueName - The destination queue name
   * @param sequenceNumbersToMove - Optional array of specific sequence numbers to move (for retry)
   */
  private executeMoveOperation(subQueue: 'active' | 'deadletter', targetQueueName: string, sequenceNumbersToMove?: number[]): void {
    this.moving.set(true);
    const isDeadLetter = subQueue === 'deadletter';
    const sequenceNumbers = sequenceNumbersToMove || this.bulkOperationsService.getSelectedSequenceNumbers(subQueue);
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
        subQueue,
        targetQueue: targetQueueName
      } as BulkOperationProgressDialogData,
      disableClose: true
    });

    const progressComponent = progressDialogRef.componentInstance;

    // Track cancellation so no success callback runs after the user aborts.
    // Unsubscribing via takeUntil also aborts the XHR, which stops the batch on
    // the server through RequestAborted.
    let cancelled = false;
    progressComponent.cancelRequested$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      cancelled = true;
    });

    this.queueService.moveMessages(this.data.entityName, targetQueueName, sequenceNumbers, isDeadLetter).pipe(
      finalize(() => this.moving.set(false)),
      takeUntil(progressComponent.cancelRequested$),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        if (cancelled) {
          return;
        }
        // Update progress to complete
        progressComponent.updateProgress({
          processed: totalCount,
          total: totalCount,
          successCount: result.successCount,
          failureCount: result.failureCount
        });

        // Close progress dialog after a brief delay to show completion
        setTimeout(() => {
          if (cancelled) {
            return;
          }
          progressDialogRef.close();

          const retryable = result.failures.filter(f => !isPossibleDuplicate(f)).map(f => f.sequenceNumber);
          const resultsDialogRef = this.dialog.open(BulkOperationResultsDialogComponent, {
            data: {
              operation: 'move',
              result: result,
              entityName: this.data.entityName,
              entityType: this.data.entityType,
              subQueue,
              targetQueue: targetQueueName,
              allowRetry: retryable.length > 0
            } as BulkOperationResultsDialogData
          });

          resultsDialogRef.afterClosed().pipe(
            takeUntilDestroyed(this.destroyRef)
          ).subscribe((resultsResponse) => {
            // Clear selection (only if not retrying)
            if (!resultsResponse?.retry) {
              this.bulkOperationsService.clearSelection(subQueue);
            }

            // Update message counts based on successful moves
            // Messages moved out of current queue
            if (result.successCount > 0) {
              this.countOf(subQueue).update(count =>
                count !== undefined ? Math.max(0, count - result.successCount) : undefined
              );
            }

            // Refresh the message list
            this.load(subQueue);

            if (resultsResponse?.retry && retryable.length > 0) {
              setTimeout(() => {
                this.executeMoveOperation(subQueue, targetQueueName, retryable);
              }, 500);
            }
          });
        }, 1000);
      },
      error: (err) => {
        console.error('Failed to move messages:', err);
        progressDialogRef.close();
        this.snackBar.open(messageCallFailure(err, 'Failed to move messages'), 'Close', { duration: 3000 });
      }
    });
  }

  /**
   * Handles bulk export action
   * Opens dialog to select export format and options, then generates and downloads the file
   */
  private handleBulkExport(): void {
    const subQueue = this.subQueue;
    const selectedCount = this.bulkOperationsService.getSelectionCount(subQueue);

    if (selectedCount === 0) {
      this.snackBar.open('Please select at least one message to export', 'Close', { duration: 3000 });
      return;
    }

    const isDeadLetter = subQueue !== 'active';

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
        this.executeExportOperation(subQueue, exportOptions);
      }
    });
  }

  /**
   * Handles compare action when exactly 2 messages are selected.
   * Opens the MessageDiffDialogComponent for side-by-side comparison.
   */
  private handleCompare(): void {
    const subQueue = this.subQueue;
    const sequenceNumbers = this.bulkOperationsService.getSelectedSequenceNumbers(subQueue);

    if (sequenceNumbers.length !== 2) {
      this.snackBar.open('Please select exactly 2 messages to compare', 'Close', { duration: 3000 });
      return;
    }

    const allMessages = this.loadedOf(subQueue);
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
      maxWidth: '95vw',
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
   * @param subQueue - The sub-queue the selection belongs to
   * @param exportOptions - Export format and options selected by user
   */
  private executeExportOperation(subQueue: SubQueue, exportOptions: ExportOptions): void {
    try {
      // Get selected sequence numbers
      const sequenceNumbers = this.bulkOperationsService.getSelectedSequenceNumbers(subQueue);

      // Defensive check: ensure we have sequence numbers
      if (!sequenceNumbers || sequenceNumbers.length === 0) {
        this.snackBar.open('No messages selected for export', 'Close', { duration: 3000 });
        return;
      }

      const sequenceNumberSet = new Set(sequenceNumbers);

      // Get the appropriate message array
      const allMessages = this.loadedOf(subQueue);

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
      const messageType = subQueue === 'active' ? 'messages' : subQueue;

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
          this.bulkOperationsService.clearSelection(subQueue);
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
      this.bulkOperationsService.clearSelection(subQueue);
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

    if (this.isBulkOperationInProgress() || this.dialog.openDialogs.some(ref => ref !== this.dialogRef)) {
      return;
    }

    const tabType = this.subQueue;
    const filteredMessages = this.shownOf(tabType);

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
