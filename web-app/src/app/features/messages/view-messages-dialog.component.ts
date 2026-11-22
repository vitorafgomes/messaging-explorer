import { ChangeDetectorRef, computed, Component, OnInit, inject, signal, effect, untracked, DestroyRef, HostListener } from '@angular/core';
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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { QueueService, TopicService, ConnectionService, MessageSearchService, AdvancedMessageFilterService, BulkOperationsService, MessageExportService, EntityCountsService, isPossibleDuplicate } from '../../core/services';
import { isDuplicateRefusal, NEW_MESSAGE_ID_OPTION } from '../../core/services/bulk-operations.service';
import { MessageInfo, AdvancedFilterState, FilterLogic, SubQueue, BatchOperationResult, DeferredAction, DeferredBatchRequest, ActiveAction, SUB_QUEUE_LABEL } from '../../core/models';
import { hexView, HexView } from '../../shared/message-body';
import { HighlightPipe } from '../../shared/pipes';
import { AdvancedFilterPanelComponent } from '../../shared/components/advanced-filter-panel/advanced-filter-panel.component';
import { BulkActionsToolbarComponent, BulkActionEvent } from '../../shared/components/bulk-actions-toolbar/bulk-actions-toolbar.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';
import { MoveMessagesDialogComponent, MoveMessagesDialogData, MoveMessagesDialogResult } from './move-messages-dialog.component';
import { ExportMessagesDialogComponent, ExportMessagesDialogData, ExportOptions } from './export-messages-dialog.component';
import { BulkOperationProgressDialogComponent, BulkOperationProgressDialogData } from '../../shared/components/bulk-operation-progress-dialog/bulk-operation-progress-dialog.component';
import { BulkOperationResultsDialogComponent, BulkOperationResultsDialogData } from '../../shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component';
import { SendMessageDialogComponent, SendMessageDialogData } from './send-message-dialog.component';
import { MessageDiffDialogComponent, MessageDiffDialogData } from './message-diff-dialog.component';
import { CancelScheduledDialogComponent, CancelScheduledDialogData } from './cancel-scheduled-dialog.component';
import { DeadLetterDeferredDialogComponent, DeadLetterDeferredDialogData, DeadLetterDeferredDialogResult } from './deadletter-deferred-dialog.component';
import { ContinuousResubmitDialogComponent, ContinuousResubmitDialogData } from './continuous-resubmit-dialog.component';
import { EntityStatusDialogComponent, EntityStatusDialogData } from '../entities/entity-status-dialog.component';
import { ProviderService } from '../../core/services/provider.service';
import { messageCallFailure } from './message-call-failure';
import { connectionContext } from '../entities/connection-context';
import { EnvironmentLineComponent } from '../../shared/environment-line.component';

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
  /** Whether the queue, or the topic of the subscription, detects duplicates; absent when the opener does not know. */
  targetDetectsDuplicates?: boolean;
}

/** The sub-queue each tab lists, by tab index. */
const TAB_SUB_QUEUES: readonly SubQueue[] = ['active', 'deadletter', 'transferdeadletter'];

/** What a failed refresh of each sub-queue says. */
const LOAD_FAILED: Record<SubQueue, string> = {
  active: 'Failed to load messages',
  deadletter: 'Failed to load dead letter messages',
  transferdeadletter: 'Failed to load transfer dead-letter messages',
};

/** The most sequence numbers one scheduled-message cancel may carry. */
const MAX_CANCEL_SCHEDULED = 500;

/** The most messages one peek returns: the API clamps the count it is asked for to this. */
const PEEK_LIMIT = 1000;

/** What a failed deferred call says, by action. */
const DEFERRED_FAILED: Record<DeferredAction, string> = {
  delete: 'Failed to delete the deferred messages',
  resubmit: 'Failed to resubmit the deferred messages',
  deadletter: 'Failed to dead-letter the deferred messages',
};

/** What every confirmation of a single-message scan says: the broker locks a message only as it hands it out. */
const SCAN_NOTICE = 'The broker cannot lock one message by its number, so the app receives messages in order until it finds this one. Every other message it receives is released at once with its delivery count raised by one; one at its max delivery count goes to the dead-letter queue and is reported. Operations are at-least-once.';

@Component({
  selector: 'app-view-messages-dialog',
  standalone: true,
  imports: [EnvironmentLineComponent, 
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
    MatCheckboxModule,
    HighlightPipe,
    AdvancedFilterPanelComponent,
    BulkActionsToolbarComponent
  ],
  template: `
    <div class="dialog-head">
      <div class="title">
        <h2 mat-dialog-title>Messages: {{ data.entityName }}</h2>
        <app-environment-line [mark]="context().mark"><b>{{ data.entityName }}</b> on {{ context().where }}</app-environment-line>
      </div>
      <button mat-flat-button type="button" class="tonal" (click)="sendMessage()">
        <mat-icon fontIcon="send" aria-hidden="true"></mat-icon>
        Send
      </button>
      <button mat-icon-button type="button" mat-dialog-close aria-label="Close messages" title="Close">
        <mat-icon fontIcon="close" aria-hidden="true"></mat-icon>
      </button>
    </div>

    <ng-template #skeleton>
      <div class="skeleton" aria-hidden="true">
        @for (width of ['100%', '100%', '100%', '100%', '82%', '64%']; track $index) {
          <div [style.width]="width"></div>
        }
      </div>
    </ng-template>

    <ng-template #loadFailure let-failure let-sq="sq">
      @if (failure.disabled) {
        <section class="load-failure disabled" aria-label="Entity disabled" data-testid="load-disabled">
          <h2><mat-icon fontIcon="block" aria-hidden="true"></mat-icon>The entity is disabled for this operation.</h2>
          <p>The broker refused to read from {{ data.entityName }} because of the status of the {{ data.entityType }}. No message was read and nothing was changed. This is not an empty {{ data.entityType }} and not a lost connection: change the status, then load again.</p>
          <div class="load-failure-actions">
            @if (capabilities()?.supportsEntityUpdate === true) {
              <button mat-stroked-button type="button" (click)="changeStatus(sq)">Change status</button>
            }
            <button mat-stroked-button type="button" (click)="reload(sq)"><mat-icon aria-hidden="true">refresh</mat-icon>Load again</button>
          </div>
        </section>
      } @else {
        <section class="load-failure error" aria-label="Error" role="alert" data-testid="load-error">
          <h2><mat-icon fontIcon="warning" aria-hidden="true"></mat-icon>Failed to load messages</h2>
          <p>{{ failure.detail }} No message is shown because none was read, and nothing on the broker was changed.</p>
          <button mat-stroked-button type="button" (click)="reload(sq)"><mat-icon fontIcon="refresh" aria-hidden="true"></mat-icon>Retry</button>
        </section>
      }
    </ng-template>

    <ng-template #loadMoreTpl let-sq>
      @if (canLoadMore(sq)) {
        <div class="load-more">
          <button mat-stroked-button type="button" (click)="loadMore(sq)" [disabled]="loadingMore()">
            <mat-icon fontIcon="expand_more" aria-hidden="true"></mat-icon>
            Load more
          </button>
          <span>The next {{ pageSize() }} after #{{ lastSequenceNumber(sq) }}</span>
        </div>
      }
    </ng-template>

    <div class="body">
      <nav class="sub-queues" [attr.aria-label]="'Sub-queues of ' + data.entityName">
        <button mat-button type="button" class="sub-queue-tab" [class.current]="selectedTabIndex === 0" [attr.aria-current]="selectedTabIndex === 0 ? 'true' : null" (click)="setTab(0)">
          Active Messages
          <span class="count">{{ (countsReported() ? activeMessageCount() : undefined) ?? activeMessages.length }}</span>
        </button>
        @if (capabilities()?.supportsDeadLetterQueue !== false) {
          <button mat-button type="button" class="sub-queue-tab" [class.current]="selectedTabIndex === 1" [attr.aria-current]="selectedTabIndex === 1 ? 'true' : null" (click)="setTab(1)">
            Dead Letter
            <span class="count dead-letter">{{ (countsReported() ? deadLetterMessageCount() : undefined) ?? deadLetterMessages.length }}</span>
          </button>
        }
        @if (capabilities()?.supportsTransferDeadLetter === true) {
          <button mat-button type="button" class="sub-queue-tab" [class.current]="selectedTabIndex === 2" [attr.aria-current]="selectedTabIndex === 2 ? 'true' : null" (click)="setTab(2)">
            Transfer dead-letter
            <span class="count">{{ (countsReported() ? transferDeadLetterMessageCount() : undefined) ?? transferMessages.length }}</span>
          </button>
        }
      </nav>

      <div class="panes">
      @if (selectedTabIndex === 0) {
        <div class="tab-pane-content">
          @if (selectedDeferred().length > 0) {
            @if (data.entityType === 'subscription') {
              <p class="filter-warning" role="note">
                <mat-icon fontIcon="info" aria-hidden="true"></mat-icon>
                <span><strong>Resubmit publishes to the topic {{ data.topicName }}.</strong> Every subscription of {{ data.topicName }} receives these messages again, not only {{ data.entityName }}, and a filter on {{ data.entityName }} may keep them from coming back to it.</span>
              </p>
            }
            @if (targetDetectsDuplicates()) {
              <div class="new-message-id">
                <mat-checkbox [checked]="newMessageId()" (change)="newMessageId.set($event.checked)">{{ newMessageIdOption.label }}</mat-checkbox>
                <p class="filter-warning" role="note"><mat-icon fontIcon="info" aria-hidden="true"></mat-icon><span>{{ newMessageIdOption.hint }}</span></p>
              </div>
            }
          }
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
              <button mat-stroked-button type="button" class="regex-toggle" [class.on]="activeRegexMode" [attr.aria-pressed]="activeRegexMode" (click)="toggleActiveRegexMode()" title="Toggle regex search mode" aria-label="Regular expression">
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

          <div class="list-pane">
          @if (loadingActive()) {
            <div class="list-state" role="status">
              <mat-progress-spinner mode="indeterminate" diameter="24" aria-hidden="true"></mat-progress-spinner>
              <span>Loading the active messages of {{ data.entityName }} from {{ target }}</span>
            </div>
            <ng-container *ngTemplateOutlet="skeleton" />
          } @else if (loadFailures()['active']; as failure) {
            <ng-container *ngTemplateOutlet="loadFailure; context: { $implicit: failure, sq: 'active' }" />
          } @else if (activeMessages.length === 0) {
            <div class="list-state">
              <mat-icon fontIcon="check_circle" aria-hidden="true"></mat-icon>
              <h2 class="state-title">No active messages</h2>
              <p>The {{ data.entityType }} answered and holds none. Nothing is hidden by a filter: the count asked for was {{ peekCount }} and the broker returned 0.</p>
              <div class="state-actions">
                <button mat-flat-button type="button" class="tonal" (click)="sendMessage()"><mat-icon fontIcon="send" aria-hidden="true"></mat-icon>Send a message</button>
                <button mat-button type="button" (click)="reload('active')">Refresh</button>
              </div>
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
              @if (filterSummary('active'); as summary) {
                <span class="filter-summary">{{ summary }}</span>
              }
            </div>
            @if (filteredActiveMessages.length === 0) {
              <div class="list-state">
                <mat-icon fontIcon="search_off" aria-hidden="true"></mat-icon>
                <h2 class="state-title">No messages match your filter</h2>
                <button mat-stroked-button type="button" (click)="clearAllActiveFilters()">Clear all</button>
              </div>
            } @else {
              <cdk-virtual-scroll-viewport itemSize="64" class="messages-list">
                <ul>
                  @for (msg of filteredActiveMessages; track msg.sequenceNumber) {
                    <li class="message-card" [class.selected]="selectedMessage === msg">
                      <input type="checkbox" [id]="'activeMsg-' + msg.sequenceNumber"
                        [attr.aria-label]="'Select ' + msg.sequenceNumber"
                        [checked]="isActiveMessageSelected(msg.sequenceNumber)"
                        (change)="toggleActiveSelection(msg, $any($event.target).checked)">
                      <button type="button" class="message-content" [attr.aria-current]="selectedMessage === msg ? 'true' : null" (click)="selectMessage(msg)">
                        <span class="message-header">
                          <span class="seq">#{{ msg.sequenceNumber }}</span>
                          <span class="id">{{ msg.messageId }}</span>
                          @if (msg.state === 'Scheduled' || msg.state === 'Deferred') {
                            <span class="state-chip"><mat-icon aria-hidden="true">schedule</mat-icon>{{ msg.state }}</span>
                          }
                          <span class="time">{{ msg.enqueuedTime | date:'short' }}</span>
                        </span>
                        <span class="message-preview" [innerHTML]="getTruncatedBody(msg.body) | highlight:activeFilterText:{ mode: activeRegexMode ? 'regex' : 'text', caseSensitive: false }"></span>
                      </button>
                    </li>
                  }
                </ul>
              </cdk-virtual-scroll-viewport>
            }
            <ng-container *ngTemplateOutlet="loadMoreTpl; context: { $implicit: 'active' }" />
          }
          </div>
        </div>
      }

      @if (selectedTabIndex === 1) {
        <div class="tab-pane-content">
          @if (targetDetectsDuplicates()) {
            <div class="new-message-id">
              <mat-checkbox [checked]="newMessageId()" (change)="newMessageId.set($event.checked)">{{ newMessageIdOption.label }}</mat-checkbox>
              <p class="filter-warning" role="note"><mat-icon fontIcon="info" aria-hidden="true"></mat-icon><span>{{ newMessageIdOption.hint }}</span></p>
            </div>
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
              <button mat-stroked-button type="button" class="regex-toggle" [class.on]="dlRegexMode" [attr.aria-pressed]="dlRegexMode" (click)="toggleDLRegexMode()" title="Toggle regex search mode" aria-label="Regular expression">
                @if (dlRegexMode) { <mat-icon fontIcon="check" aria-hidden="true"></mat-icon> }
                Regex
              </button>
            </div>
            <button mat-stroked-button type="button" class="refresh" (click)="loadDeadLetterMessages()" [disabled]="loadingDL()">
              <mat-icon fontIcon="refresh" aria-hidden="true"></mat-icon>
              Refresh
            </button>
            <button mat-flat-button type="button" class="tonal" (click)="openAutoResubmit()">
              <mat-icon fontIcon="replay" aria-hidden="true"></mat-icon>
              Auto resubmit
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

          <div class="list-pane">
          @if (loadingDL()) {
            <div class="list-state" role="status">
              <mat-progress-spinner mode="indeterminate" diameter="24" aria-hidden="true"></mat-progress-spinner>
              <span>Loading the dead letter messages of {{ data.entityName }} from {{ target }}</span>
            </div>
            <ng-container *ngTemplateOutlet="skeleton" />
          } @else if (loadFailures()['deadletter']; as failure) {
            <ng-container *ngTemplateOutlet="loadFailure; context: { $implicit: failure, sq: 'deadletter' }" />
          } @else if (deadLetterMessages.length === 0) {
            <div class="list-state">
              <mat-icon fontIcon="check_circle" aria-hidden="true"></mat-icon>
              <h2 class="state-title">No dead letter messages</h2>
              <p>The {{ data.entityType }} answered and holds none. Nothing is hidden by a filter: the count asked for was {{ peekCount }} and the broker returned 0.</p>
              <div class="state-actions">
                <button mat-flat-button type="button" class="tonal" (click)="sendMessage()"><mat-icon fontIcon="send" aria-hidden="true"></mat-icon>Send a message</button>
                <button mat-button type="button" (click)="reload('deadletter')">Refresh</button>
              </div>
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
              @if (filterSummary('deadletter'); as summary) {
                <span class="filter-summary">{{ summary }}</span>
              }
            </div>
            @if (filteredDeadLetterMessages.length === 0) {
              <div class="list-state">
                <mat-icon fontIcon="search_off" aria-hidden="true"></mat-icon>
                <h2 class="state-title">No messages match your filter</h2>
                <button mat-stroked-button type="button" (click)="clearAllDLFilters()">Clear all</button>
              </div>
            } @else {
              <cdk-virtual-scroll-viewport itemSize="64" class="messages-list">
                <ul>
                  @for (msg of filteredDeadLetterMessages; track msg.sequenceNumber) {
                    <li class="message-card dead-letter" [class.selected]="selectedMessage === msg">
                      <input type="checkbox" [id]="'dlMsg-' + msg.sequenceNumber"
                        [attr.aria-label]="'Select ' + msg.sequenceNumber"
                        [checked]="isDeadLetterMessageSelected(msg.sequenceNumber)"
                        (change)="toggleDeadLetterSelection(msg, $any($event.target).checked)">
                      <button type="button" class="message-content" [attr.aria-current]="selectedMessage === msg ? 'true' : null" (click)="selectMessage(msg)">
                        <span class="message-header">
                          <span class="seq">#{{ msg.sequenceNumber }}</span>
                          <span class="reason">{{ msg.deadLetterReason || 'Unknown' }}</span>
                          @if (msg.state === 'Scheduled' || msg.state === 'Deferred') {
                            <span class="state-chip"><mat-icon aria-hidden="true">schedule</mat-icon>{{ msg.state }}</span>
                          }
                          <span class="time">{{ msg.enqueuedTime | date:'short' }}</span>
                        </span>
                        <span class="message-preview" [innerHTML]="getTruncatedBody(msg.body) | highlight:dlFilterText:{ mode: dlRegexMode ? 'regex' : 'text', caseSensitive: false }"></span>
                      </button>
                    </li>
                  }
                </ul>
              </cdk-virtual-scroll-viewport>
            }
            <ng-container *ngTemplateOutlet="loadMoreTpl; context: { $implicit: 'deadletter' }" />
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
          @if (targetDetectsDuplicates()) {
            <div class="new-message-id">
              <mat-checkbox [checked]="newMessageId()" (change)="newMessageId.set($event.checked)">{{ newMessageIdOption.label }}</mat-checkbox>
              <p class="filter-warning" role="note"><mat-icon fontIcon="info" aria-hidden="true"></mat-icon><span>{{ newMessageIdOption.hint }}</span></p>
            </div>
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
              <button mat-stroked-button type="button" class="regex-toggle" [class.on]="tdlRegexMode" [attr.aria-pressed]="tdlRegexMode" (click)="toggleTDLRegexMode()" title="Toggle regex search mode" aria-label="Regular expression">
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
              <span>Loading the transfer dead-letter messages of {{ data.entityName }} from {{ target }}</span>
            </div>
            <ng-container *ngTemplateOutlet="skeleton" />
          } @else if (loadFailures()['transferdeadletter']; as failure) {
            <ng-container *ngTemplateOutlet="loadFailure; context: { $implicit: failure, sq: 'transferdeadletter' }" />
          } @else if (transferMessages.length === 0) {
            <div class="list-state">
              <mat-icon fontIcon="check_circle" aria-hidden="true"></mat-icon>
              <h2 class="state-title">No transfer dead-letter messages</h2>
              <p>The {{ data.entityType }} answered and holds none. Nothing is hidden by a filter: the count asked for was {{ peekCount }} and the broker returned 0.</p>
              <div class="state-actions">
                <button mat-flat-button type="button" class="tonal" (click)="sendMessage()"><mat-icon fontIcon="send" aria-hidden="true"></mat-icon>Send a message</button>
                <button mat-button type="button" (click)="reload('transferdeadletter')">Refresh</button>
              </div>
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
              @if (filterSummary('transferdeadletter'); as summary) {
                <span class="filter-summary">{{ summary }}</span>
              }
            </div>
            @if (filteredTransferMessages.length === 0) {
              <div class="list-state">
                <mat-icon fontIcon="search_off" aria-hidden="true"></mat-icon>
                <h2 class="state-title">No messages match your filter</h2>
                <button mat-stroked-button type="button" (click)="clearTDLFilter()">Clear all</button>
              </div>
            } @else {
              <cdk-virtual-scroll-viewport itemSize="64" class="messages-list">
                <ul>
                  @for (msg of filteredTransferMessages; track msg.sequenceNumber) {
                    <li class="message-card dead-letter" [class.selected]="selectedMessage === msg">
                      <input type="checkbox" [id]="'tdlMsg-' + msg.sequenceNumber"
                        [attr.aria-label]="'Select ' + msg.sequenceNumber"
                        [checked]="bulkOperationsService.isSelected('transferdeadletter', msg.sequenceNumber)"
                        (change)="toggleSelection('transferdeadletter', msg, $any($event.target).checked)">
                      <button type="button" class="message-content" [attr.aria-current]="selectedMessage === msg ? 'true' : null" (click)="selectMessage(msg)">
                        <span class="message-header">
                          <span class="seq">#{{ msg.sequenceNumber }}</span>
                          <span class="reason">{{ msg.deadLetterReason || 'Unknown' }}</span>
                          @if (msg.state === 'Scheduled' || msg.state === 'Deferred') {
                            <span class="state-chip"><mat-icon aria-hidden="true">schedule</mat-icon>{{ msg.state }}</span>
                          }
                          <span class="time">{{ msg.enqueuedTime | date:'short' }}</span>
                        </span>
                        <span class="message-preview" [innerHTML]="getTruncatedBody(msg.body) | highlight:tdlFilterText:{ mode: tdlRegexMode ? 'regex' : 'text', caseSensitive: false }"></span>
                      </button>
                    </li>
                  }
                </ul>
              </cdk-virtual-scroll-viewport>
            }
          }
          </div>
        </div>
      }

      @if (selectedMessage) {
        <section class="detail-pane message-detail" aria-label="Message details">
          <div class="pane-head">
            <h2 class="pane-title">Message Details</h2>
            <button mat-icon-button type="button" aria-label="Close message details" title="Close message details" (click)="selectedMessage = null">
              <mat-icon fontIcon="close" aria-hidden="true"></mat-icon>
            </button>
          </div>
          <div class="body-head">
            <h3 class="section-title">Body</h3>
            <button mat-button type="button" (click)="copyBody(selectedMessage)">
              <mat-icon fontIcon="content_copy" aria-hidden="true"></mat-icon>
              {{ selectedMessage.bodyEncoding === 'base64' ? 'Copy base64' : 'Copy body' }}
            </button>
          </div>
          @if (selectedMessage.bodyEncoding === 'base64') {
            @let hex = binaryView(selectedMessage);
            <p class="state-note" role="note" data-testid="binary-body-note">
              <mat-icon fontIcon="info" aria-hidden="true"></mat-icon>
              Binary body of {{ hex.totalBytes | number }} bytes ({{ selectedMessage.contentType || 'no content type' }}): it is not UTF-8 text, so it is shown as hex{{ hex.shownBytes < hex.totalBytes ? ', the first ' + hex.shownBytes + ' bytes' : '' }}. Copy base64 takes every byte as it is.
            </p>
            <pre class="body-content hex" data-testid="binary-body-hex" aria-label="Body as hex">{{ hex.rows.join('\n') }}</pre>
          } @else {
            <pre class="body-content" [innerHTML]="formatBody(selectedMessage.body) | highlight:getActiveFilterText():{ mode: getActiveRegexMode() ? 'regex' : 'text', caseSensitive: false }"></pre>
          }

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
                  <p class="state-note" role="note"><mat-icon fontIcon="info" aria-hidden="true"></mat-icon>{{ capabilities()?.supportsDeferral === true ? 'A deferred message is reached only by its sequence number: tick it to delete, resubmit or dead-letter it.' : 'This app cannot receive a deferred message.' }}</p>
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

          @if (subQueue !== 'active') {
            <div class="why-dead" data-testid="why-dead-lettered">
              <h4 class="section-title">Why it was dead-lettered</h4>
              <dl class="properties">
                <div class="property"><dt class="key">Dead Letter Reason</dt><dd class="value">{{ selectedMessage.deadLetterReason || '-' }}</dd></div>
                <div class="property"><dt class="key">Dead Letter Error Description</dt><dd class="value">{{ selectedMessage.deadLetterErrorDescription || '-' }}</dd></div>
              </dl>
            </div>
          }

          @if (selectedMessage.applicationProperties && hasProperties(selectedMessage.applicationProperties)) {
            <h3 class="section-title">Application Properties</h3>
            <dl class="properties">
              @for (prop of getProperties(selectedMessage.applicationProperties); track prop.key) {
                <div class="property">
                  <dt class="key">{{ prop.key }}:</dt>
                  <dd class="value" [innerHTML]="prop.value | highlight:getActiveFilterText():{ mode: getActiveRegexMode() ? 'regex' : 'text', caseSensitive: false }"></dd>
                </div>
              }
            </dl>
          }

          @if (subQueue === 'active' && isScanReachable(selectedMessage)) {
            <div class="message-actions" role="group" aria-label="Actions on this message">
              @if (capabilities()?.supportsDeferral === true) {
                <button mat-stroked-button type="button" data-testid="defer-one" (click)="settleOne('defer', selectedMessage)">
                  <mat-icon fontIcon="schedule" aria-hidden="true"></mat-icon>
                  Defer
                </button>
              }
              @if (capabilities()?.supportsManualDeadLetter === true) {
                <button mat-stroked-button type="button" data-testid="deadletter-one" (click)="settleOne('deadletter', selectedMessage)">
                  <mat-icon fontIcon="report" aria-hidden="true"></mat-icon>
                  Dead-letter
                </button>
              }
            </div>
          }

          @if (subQueue === 'deadletter') {
            <div class="message-actions">
              @if (bulkOperations() && bodyIsData(selectedMessage)) {
                <button mat-stroked-button type="button" (click)="editAndResubmit(selectedMessage)">
                  <mat-icon fontIcon="edit" aria-hidden="true"></mat-icon>
                  Edit & Resubmit
                </button>
              } @else if (bulkOperations()) {
                <p class="state-note" role="note" data-testid="not-editable-note"><mat-icon fontIcon="info" aria-hidden="true"></mat-icon>This body was not sent as bytes, so what is shown is a rendering of it. Resubmit sends the original; editing it here would send something else, so it is not offered.</p>
              }
              <button mat-flat-button type="button" class="tonal" (click)="resubmit(selectedMessage)">
                <mat-icon fontIcon="replay" aria-hidden="true"></mat-icon>
                Resubmit
              </button>
            </div>
          }

          @if (bulkOperations() && subQueue !== 'transferdeadletter' && capabilities()?.supportsSequenceNumbers === true && (subQueue !== 'active' || isScanReachable(selectedMessage))) {
            <div class="message-actions apart">
              <button mat-button type="button" class="danger-text" data-testid="delete-one" (click)="deleteOne(selectedMessage)">
                <mat-icon fontIcon="delete" aria-hidden="true"></mat-icon>
                Delete this message
              </button>
            </div>
          }
        </section>
      } @else if (shownOf(subQueue).length > 0) {
        <div class="detail-pane detail-empty">
          <mat-icon fontIcon="visibility" aria-hidden="true"></mat-icon>
          <h2 class="state-title">Select a message to see its details</h2>
          <p>Click a row to read its properties and body. Tick rows to act on several at once.</p>
        </div>
      }
      </div>
    </div>

    @if (data.entityType === 'subscription' && subQueue !== 'active' && bulkOperations()) {
      <p class="topic-resubmit-note" role="note">
        <mat-icon fontIcon="warning" aria-hidden="true" />
        <span><strong>Resubmit publishes to the topic {{ data.topicName }}.</strong> Every subscription of {{ data.topicName }} receives these messages again, not only {{ data.entityName }}, and a filter on {{ data.entityName }} may keep them from coming back to it.</span>
      </p>
    }

    <app-bulk-actions-toolbar
      [selectedCount]="getSelectedCount()"
      [detail]="getSelectionSummary()"
      [showResubmit]="subQueue !== 'active'"
      [showCompare]="getSelectedCount() === 2 && subQueue !== 'transferdeadletter'"
      [showMove]="subQueue !== 'transferdeadletter' && bulkOperations()"
      [showDelete]="bulkOperations()"
      [showCancelScheduled]="canOfferCancelScheduled()"
      [cancelScheduledBlockedReason]="canOfferCancelScheduled() ? cancelScheduledBlockedReason() : ''"
      [deferredCount]="selectedDeferred().length"
      [deferredNote]="deferredNote()"
      [disabled]="isBulkOperationInProgress()"
      (actionClicked)="onBulkAction($event)"
      (clearSelection)="onClearSelection()">
    </app-bulk-actions-toolbar>
  `,
  styleUrl: './view-messages-dialog.component.scss'
})
export class ViewMessagesDialogComponent implements OnInit {
  /** Delete, Move and Edit & Resubmit are offered unless the broker declares it cannot do them safely. */
  bulkOperations(): boolean {
    return this.capabilities()?.supportsBulkMessageOperations !== false;
  }

  /** The broker names a message by its place in the queue, as RabbitMQ does, so a number shown is stale once a message ahead of it is removed. */
  byPosition(): boolean {
    return this.capabilities()?.supportsSequenceNumbers === false;
  }

  /**
   * By position, an operation that was cancelled or whose call failed leaves ticks that may name other messages:
   * the rows are unticked and the list is read again, after the given dialog is closed when there is one.
   */
  private forgetPositions(subQueue: SubQueue, afterClosed?: { afterClosed(): Observable<unknown> }) {
    if (!this.byPosition()) {
      return;
    }
    this.bulkOperationsService.clearSelection(subQueue);
    if (afterClosed) {
      afterClosed.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load(subQueue));
    } else {
      this.load(subQueue);
    }
  }

  /** The active connection and its environment, for the line under the title. */
  readonly context = connectionContext();
  data = inject<ViewMessagesDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<ViewMessagesDialogComponent>);
  private dialog = inject(MatDialog);
  private queueService = inject(QueueService);
  private topicService = inject(TopicService);
  private connectionService = inject(ConnectionService);
  /** The host the messages are read from, as the loading line names it. */
  readonly target = this.connectionService.currentTarget ?? 'the connection';
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
  /** Why the last load of a sub-queue failed; a failed load shows no message, never the previous list. */
  readonly loadFailures = signal<Partial<Record<SubQueue, { disabled: boolean; detail: string }>>>({});
  loadingDL = signal(false);
  loadingTDL = signal(false);
  resubmitting = signal(false);
  /** Shows the new message id option: the target detects duplicates, or refused a resubmit as a duplicate. */
  readonly targetDetectsDuplicates = signal(this.data.targetDetectsDuplicates === true);
  /** Whether a resubmit sends each copy with a new message id; off until the user ticks it. */
  readonly newMessageId = signal(false);
  readonly newMessageIdOption = NEW_MESSAGE_ID_OPTION;
  deleting = signal(false);
  moving = signal(false);
  cancellingScheduled = signal(false);
  settlingDeferred = signal(false);
  loadingMore = signal(false);
  /** Whether the last read of a sub-queue returned a full page, so a next page may follow. */
  private readonly fullPage = signal<Partial<Record<SubQueue, boolean>>>({});
  peekCount = 20;
  selectedTabIndex = 0;

  // Message count signals for automatic UI updates
  /** False on a broker that answers no message counts: a tab then shows how many messages it loaded. */
  readonly countsReported = computed(() => this.capabilities()?.supportsMessageCounts !== false);
  activeMessageCount = signal<number | undefined>(undefined);
  deadLetterMessageCount = signal<number | undefined>(undefined);
  private readonly counts = inject(EntityCountsService);
  private readonly countsKey = EntityCountsService.key(this.data.entityName, this.data.entityType === 'subscription' ? this.data.topicName : null);

  /** The tabs show the counts last read for the entity anywhere in the app, as the tree and the panel do. */
  private readonly followCounts = effect(() => {
    const read = this.counts.of(this.countsKey);
    if (read) {
      untracked(() => {
        this.activeMessageCount.set(read.activeMessageCount);
        this.deadLetterMessageCount.set(read.deadLetterMessageCount);
      });
    }
  });

  /** A count this dialog changes, after an operation or a new read, is the one the tree and the panel then show. */
  private readonly shareCounts = effect(() => {
    const activeMessageCount = this.activeMessageCount();
    const deadLetterMessageCount = this.deadLetterMessageCount();
    if (activeMessageCount !== undefined && deadLetterMessageCount !== undefined) {
      untracked(() => this.counts.put(this.countsKey, { activeMessageCount, deadLetterMessageCount }));
    }
  });
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
  private readonly changeDetector = inject(ChangeDetectorRef, { optional: true });

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
    if (this.data.activeMessageCount !== undefined && this.data.deadLetterMessageCount !== undefined) {
      this.counts.put(this.countsKey, { activeMessageCount: this.data.activeMessageCount, deadLetterMessageCount: this.data.deadLetterMessageCount });
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
      case 'active': this.activeMessages = []; this.filteredActiveMessages = []; break;
      case 'deadletter': this.deadLetterMessages = []; this.filteredDeadLetterMessages = []; break;
      case 'transferdeadletter': this.transferMessages = []; this.filteredTransferMessages = []; break;
    }
    this.changeDetector?.markForCheck();
  }

  /** Opens the automatic resubmit of this dead-letter queue, as the entity panel does, and reads the tab again after a run. */
  openAutoResubmit() {
    const data: ContinuousResubmitDialogData = {
      entityType: this.data.entityType,
      entityName: this.data.entityName,
      topicName: this.data.topicName,
      deadLetterMessageCount: this.data.deadLetterMessageCount,
      targetDetectsDuplicates: this.data.targetDetectsDuplicates
    };
    this.dialog.open(ContinuousResubmitDialogComponent, { width: '720px', maxWidth: '95vw', data })
      .afterClosed().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(result => { if (result) this.afterAutoResubmit(); });
  }

  /** A run moves messages from the dead-letter queue to the active one: both tabs are read again, with the counts the broker has now. */
  private afterAutoResubmit() {
    this.reload('deadletter');
    this.reload('active');
    const counts: Observable<{ activeMessageCount?: number; deadLetterMessageCount?: number }> = this.data.entityType === 'queue'
      ? this.queueService.getQueue(this.data.entityName)
      : this.topicService.getSubscription(this.data.topicName!, this.data.entityName);
    counts.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: entity => {
        this.activeMessageCount.set(entity.activeMessageCount);
        this.deadLetterMessageCount.set(entity.deadLetterMessageCount);
      },
      error: () => undefined
    });
  }

  /** Opens Change status for this entity; the status as read is not known here. A status that was set loads the tab again. */
  changeStatus(subQueue: SubQueue) {
    const data: EntityStatusDialogData = {
      kind: this.data.entityType,
      entityName: this.data.entityName,
      topicName: this.data.topicName,
      status: ''
    };
    this.dialog.open(EntityStatusDialogComponent, { data, width: '560px', maxWidth: '95vw' })
      .afterClosed().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(updated => { if (updated) this.reload(subQueue); });
  }

  reload(subQueue: SubQueue) {
    this.load(subQueue);
  }

  /**
   * A failed first load shows why, in place of the list. A failed refresh keeps the list and the
   * selection already on screen and says why in a snack bar, so a selection is never lost to a retry.
   */
  private loadFailed(subQueue: SubQueue, err: unknown) {
    if (this.loadedOf(subQueue).length > 0) {
      this.snackBar.open(messageCallFailure(err, LOAD_FAILED[subQueue]), 'Close', { duration: 3000 });
      return;
    }
    const disabled = (err as { status?: number } | null)?.status === 409;
    this.selectedMessage = null;
    switch (subQueue) {
      case 'active': this.activeMessages = []; this.applyActiveFilter(); break;
      case 'deadletter': this.deadLetterMessages = []; this.applyDLFilter(); break;
      case 'transferdeadletter': this.transferMessages = []; this.applyTDLFilter(); break;
    }
    this.loadFailures.update(f => ({
      ...f,
      [subQueue]: { disabled, detail: disabled ? '' : `${messageCallFailure(err, 'The local API answered with an error').replace(/\.$/, '')}.` },
    }));
  }

  private loadSucceeded(subQueue: SubQueue) {
    this.loadFailures.update(f => ({ ...f, [subQueue]: undefined }));
  }

  sendMessage() {
    const entityType = this.data.entityType === 'subscription' ? 'topic' : 'queue';
    const entityName = this.data.entityType === 'subscription' ? this.data.topicName! : this.data.entityName;
    this.dialog.open(SendMessageDialogComponent, {
      width: '1100px', maxWidth: '95vw',
      data: { entityType, entityName, topicName: this.data.topicName } as SendMessageDialogData
    }).afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(sent => {
      if (sent) this.loadActiveMessages();
    });
  }

  copyBody(msg: MessageInfo) {
    navigator.clipboard.writeText(msg.body ?? '').then(
      () => this.snackBar.open('Body copied', 'Close', { duration: 2000 }),
      () => this.snackBar.open('The body was not copied: the clipboard refused it.', 'Close', { duration: 4000 })
    );
  }

  /** The bounded hex view of a binary body, kept per message so the template does not decode it on every check. */
  private hexCache = new WeakMap<MessageInfo, HexView>();

  binaryView(msg: MessageInfo): HexView {
    let view = this.hexCache.get(msg);
    if (!view) {
      view = hexView(msg.body ?? '');
      this.hexCache.set(msg, view);
    }
    return view;
  }

  /**
   * The scan that receives an active message by its sequence number reaches only an active one: a deferred or
   * scheduled message is never handed out by it, so the scan would only raise the delivery count of the others.
   */
  isScanReachable(msg: MessageInfo): boolean {
    return !msg.state || msg.state === 'Active';
  }

  /**
   * Defers or dead-letters one active message after a confirmation that names the entity and says what the scan
   * does to the other messages; the result, per sequence number, opens in the results dialog.
   */
  settleOne(action: ActiveAction, msg: MessageInfo): void {
    const sequenceNumbers = [msg.sequenceNumber];
    const confirmed$ = action === 'deadletter'
      ? this.dialog.open<DeadLetterDeferredDialogComponent, DeadLetterDeferredDialogData, DeadLetterDeferredDialogResult>(DeadLetterDeferredDialogComponent, {
          data: { entityName: this.data.entityName, entityType: this.data.entityType, sequenceNumbers, active: true }, width: '560px', maxWidth: '95vw'
        }).afterClosed()
      : this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: `Defer message ${msg.sequenceNumber}?`,
            message: 'The message leaves the active messages and can then be reached only by its sequence number, from the deferred messages.',
            notice: SCAN_NOTICE,
            confirmText: 'Defer it',
            confirmColor: 'primary',
            icon: 'schedule',
            facts: [{ label: this.data.entityType === 'queue' ? 'Queue' : 'Subscription', value: this.data.entityName }, { label: 'Sequence number', value: String(msg.sequenceNumber) }],
            context: { subject: this.data.entityName }
          } as ConfirmDialogData
        }).afterClosed();
    confirmed$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(choice => {
      if (!choice) {
        return;
      }
      const options = action === 'deadletter' ? choice as DeadLetterDeferredDialogResult : {};
      const { entityName, topicName } = this.data;
      const call = this.data.entityType === 'queue'
        ? this.queueService.settleActiveMessages(entityName, action, { sequenceNumbers, ...options })
        : this.topicService.settleActiveMessages(topicName!, entityName, action, { sequenceNumbers, ...options });
      this.showSingleResult(action, call);
    });
  }

  /** Deletes one message of the shown sub-queue by its sequence number, through the delete-batch route, after a confirmation. */
  deleteOne(msg: MessageInfo): void {
    const subQueue = this.subQueue;
    const confirmData: ConfirmDialogData = {
      title: `Delete message ${msg.sequenceNumber}?`,
      message: `The message is received and removed from the ${SUB_QUEUE_LABEL[subQueue]} messages of ${this.data.entityType} "${this.data.entityName}". This cannot be undone.`,
      notice: subQueue === 'active' ? SCAN_NOTICE : undefined,
      confirmText: 'Delete it',
      confirmColor: 'warn',
      icon: 'delete',
      facts: [{ label: this.data.entityType === 'queue' ? 'Queue' : 'Subscription', value: this.data.entityName }, { label: 'Sequence number', value: String(msg.sequenceNumber) }],
      context: { subject: this.data.entityName }
    };
    this.dialog.open(ConfirmDialogComponent, { data: confirmData }).afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(confirmed => {
      if (confirmed) {
        this.showSingleResult('delete', this.deleteBatch(subQueue, [msg.sequenceNumber], false));
      }
    });
  }

  private showSingleResult(operation: 'delete' | ActiveAction, call: Observable<BatchOperationResult>): void {
    const subQueue = this.subQueue;
    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        this.dialog.open(BulkOperationResultsDialogComponent, {
          data: {
            operation,
            result,
            entityName: this.data.entityName,
            entityType: this.data.entityType === 'queue' ? 'queue' : 'topic',
            subQueue
          } as BulkOperationResultsDialogData
        });
        this.load(subQueue);
      },
      error: err => this.snackBar.open(messageCallFailure(err, 'The message was not changed'), 'Close', { duration: 5000 })
    });
  }

  private load(subQueue: SubQueue) {
    switch (subQueue) {
      case 'active': return this.loadActiveMessages();
      case 'deadletter': return this.loadDeadLetterMessages();
      case 'transferdeadletter': return this.loadTransferDeadLetterMessages();
    }
  }

  /** The one place a sub-queue becomes a peek route. */
  private peek(subQueue: SubQueue, fromSequenceNumber?: number): Observable<MessageInfo[]> {
    const { entityName, topicName } = this.data;
    const queue = this.data.entityType === 'queue';
    const from: [] | [number] = fromSequenceNumber === undefined ? [] : [fromSequenceNumber];
    switch (subQueue) {
      case 'active':
        return queue ? this.queueService.peekMessages(entityName, this.peekCount, ...from) : this.topicService.peekMessages(topicName!, entityName, this.peekCount, ...from);
      case 'deadletter':
        return queue ? this.queueService.peekDeadLetterMessages(entityName, this.peekCount, ...from) : this.topicService.peekDeadLetterMessages(topicName!, entityName, this.peekCount, ...from);
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
  private resubmitBatch(subQueue: 'deadletter' | 'transferdeadletter', sequenceNumbers: number[], newMessageId: boolean): Observable<BatchOperationResult> {
    const { entityName, topicName } = this.data;
    const queue = this.data.entityType === 'queue';
    if (subQueue === 'transferdeadletter') {
      return queue
        ? this.queueService.resubmitTransferDeadLetterMessages(entityName, sequenceNumbers, newMessageId)
        : this.topicService.resubmitTransferDeadLetterMessages(topicName!, entityName, sequenceNumbers, newMessageId);
    }
    return queue
      ? this.queueService.resubmitDeadLetterMessages(entityName, sequenceNumbers, newMessageId)
      : this.topicService.resubmitDeadLetterMessages(topicName!, entityName, sequenceNumbers, newMessageId);
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

  /** The page one peek reads: the count asked for, never more than the API returns. */
  pageSize(): number {
    return Math.min(this.peekCount, PEEK_LIMIT);
  }

  private setFullPage(subQueue: SubQueue, page: MessageInfo[]) {
    this.fullPage.update(f => ({ ...f, [subQueue]: page.length > 0 && page.length >= this.pageSize() }));
  }

  /** The highest sequence number loaded in a sub-queue. */
  lastSequenceNumber(subQueue: SubQueue): number {
    return this.loadedOf(subQueue).reduce((last, m) => Math.max(last, m.sequenceNumber), 0);
  }

  /** Load more is offered when the last read filled its page and the API reads from a position. */
  canLoadMore(subQueue: SubQueue): boolean {
    return this.capabilities()?.supportsPeekFromSequenceNumber === true && this.fullPage()[subQueue] === true;
  }

  /**
   * Reads one more page after the highest sequence number loaded and appends it, keeping the
   * selection. A failure keeps the list and says why in a snack bar.
   */
  loadMore(subQueue: 'active' | 'deadletter') {
    if (!this.canLoadMore(subQueue) || this.loadingMore()) {
      return;
    }
    this.loadingMore.set(true);
    this.peek(subQueue, this.lastSequenceNumber(subQueue) + 1).pipe(
      finalize(() => this.loadingMore.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (page) => {
        const kept = this.bulkOperationsService.getSelectedSequenceNumbers(subQueue);
        const known = new Set(this.loadedOf(subQueue).map(m => m.sequenceNumber));
        const added = page.filter(m => !known.has(m.sequenceNumber));
        this.setFullPage(subQueue, page);
        if (subQueue === 'active') {
          this.activeMessages = [...this.activeMessages, ...added];
          this.applyActiveFilter();
        } else {
          this.deadLetterMessages = [...this.deadLetterMessages, ...added];
          this.applyDLFilter();
        }
        const total = this.shownOf(subQueue).length;
        kept.forEach(n => this.bulkOperationsService.selectMessage(subQueue, n, total));
      },
      error: (err) => this.loadFailed(subQueue, err)
    });
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
        this.loadSucceeded('active');
        this.setFullPage('active', messages);
        this.activeMessages = messages;
        this.applyActiveFilter();
      },
      error: (err) => this.loadFailed('active', err)
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
        this.loadSucceeded('deadletter');
        this.setFullPage('deadletter', messages);
        this.deadLetterMessages = messages;
        this.applyDLFilter();
      },
      error: (err) => this.loadFailed('deadletter', err)
    });
  }

  loadTransferDeadLetterMessages() {
    this.loadingTDL.set(true);

    this.peek('transferdeadletter').pipe(
      finalize(() => this.loadingTDL.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (messages) => {
        this.loadSucceeded('transferdeadletter');
        this.transferMessages = messages;
        this.applyTDLFilter();
      },
      error: (err) => this.loadFailed('transferdeadletter', err)
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
    if (this.byPosition()) {
      this.resubmitAsBatchOfOne(msg);
      return;
    }
    const observable = this.data.entityType === 'queue'
      ? this.queueService.resubmitDeadLetterMessage(this.data.entityName, msg.sequenceNumber, this.newMessageId())
      : this.topicService.resubmitDeadLetterMessage(this.data.topicName!, this.data.entityName, msg.sequenceNumber, this.newMessageId());

    observable.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.snackBar.open('Message resubmitted', 'Close', { duration: 3000 });
        this.loadDeadLetterMessages();
      },
      error: (err) => {
        if (isDuplicateRefusal({ error: err?.error?.message })) {
          this.targetDetectsDuplicates.set(true);
        }
        this.snackBar.open(messageCallFailure(err, 'Failed to resubmit message'), 'Close', { duration: 3000 });
      }
    });
  }

  /** Where the single route answers a failure without its reason, as on RabbitMQ, the batch route says why, a possible duplicate included. */
  private resubmitAsBatchOfOne(msg: MessageInfo) {
    const sequenceNumbers = [msg.sequenceNumber];
    const observable = this.data.entityType === 'queue'
      ? this.queueService.resubmitDeadLetterMessages(this.data.entityName, sequenceNumbers, this.newMessageId())
      : this.topicService.resubmitDeadLetterMessages(this.data.topicName!, this.data.entityName, sequenceNumbers, this.newMessageId());

    observable.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        const failure = result.failures?.[0];
        if (failure) {
          this.snackBar.open(failure.error, 'Close', { duration: 8000 });
        } else {
          this.snackBar.open('Message resubmitted', 'Close', { duration: 3000 });
        }
        this.loadDeadLetterMessages();
      },
      error: err => {
        this.forgetPositions('deadletter');
        this.snackBar.open(messageCallFailure(err, 'Failed to resubmit message'), 'Close', { duration: 3000 });
      }
    });
  }

  /** Whether the body shown is the body itself: one sent as an AMQP value or sequence is shown as a rendering of it. */
  bodyIsData(msg: MessageInfo): boolean {
    return msg.bodyType !== 'AmqpValue' && msg.bodyType !== 'AmqpSequence';
  }

  editAndResubmit(msg: MessageInfo) {
    const entityType = this.data.entityType === 'subscription' ? 'topic' : 'queue';
    const entityName = this.data.entityType === 'subscription' ? this.data.topicName! : this.data.entityName;

    const dialogRef = this.dialog.open(SendMessageDialogComponent, {
      width: '1100px', maxWidth: '95vw',
      data: {
        entityType,
        entityName,
        topicName: this.data.topicName,
        mode: 'resubmit',
        sourceSequenceNumber: msg.sequenceNumber,
        prefill: {
          body: msg.body,
          bodyEncoding: msg.bodyEncoding,
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
    subQueue: 'deadletter' | 'transferdeadletter' = this.subQueue === 'transferdeadletter' ? 'transferdeadletter' : 'deadletter',
    newMessageId = this.newMessageId()) {
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

    const observable = this.resubmitBatch(subQueue, sequenceNumbers, newMessageId);

    const progressComponent = progressDialogRef.componentInstance;

    // Track cancellation so no success callback runs after the user aborts.
    // Unsubscribing via takeUntil also aborts the XHR, which stops the batch on
    // the server through RequestAborted.
    let cancelled = false;
    progressComponent.cancelRequested$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      cancelled = true;
      this.forgetPositions(subQueue, progressDialogRef);
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
        if (result.failures.some(isDuplicateRefusal)) {
          this.targetDetectsDuplicates.set(true);
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
              allowRetry: retryable.length > 0 && !this.byPosition()
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
                this.resubmitSelected(retryable, subQueue, newMessageId || resultsResponse.newMessageIdOnDuplicateDetection === true);
              }, 500);
            }
          });
        }, 1000);
      },
      error: (err) => {
        console.error('Failed to resubmit messages:', err);
        progressDialogRef.close();
        this.forgetPositions(subQueue);

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
   * What the Select All row of a filtered tab says: how many of the loaded messages its search,
   * advanced conditions and Show let through. Empty when nothing filters the tab.
   * @param subQueue - The sub-queue of the tab
   */
  filterSummary(subQueue: SubQueue): string {
    return this.hasActiveFilter(subQueue)
      ? `Showing ${this.shownOf(subQueue).length} of ${this.loadedOf(subQueue).length} messages`
      : '';
  }

  /**
   * Clears all active filters: the quick search, the advanced filters and Show, which goes back to All.
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

    this.activeStateFilter = 'All';

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
    return this.loadingActive() || this.loadingDL() || this.loadingTDL() || this.resubmitting() || this.deleting() || this.moving() || this.cancellingScheduled() || this.settlingDeferred() || this.loadingMore();
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
      case 'delete-deferred':
        this.handleDeleteDeferred();
        break;
      case 'resubmit-deferred':
        this.settleDeferred('resubmit', this.selectedDeferred(), { newMessageIdOnDuplicateDetection: this.newMessageId() });
        break;
      case 'deadletter-deferred':
        this.handleDeadLetterDeferred();
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
   * The selected messages of the Active tab that are deferred, when the provider declares deferral;
   * empty on any other tab. The deferred actions send these and nothing else.
   */
  selectedDeferred(): number[] {
    if (this.subQueue !== 'active' || this.capabilities()?.supportsDeferral !== true) {
      return [];
    }
    const deferred = new Set(this.activeMessages.filter(m => m.state === 'Deferred').map(m => m.sequenceNumber));
    return this.bulkOperationsService.getSelectedSequenceNumbers('active').filter(n => deferred.has(n));
  }

  /** What the deferred actions leave out of a mixed selection, and what the other actions cannot reach. */
  deferredNote(): string {
    const deferred = this.selectedDeferred().length;
    if (deferred === 0) {
      return '';
    }
    const selected = this.getSelectedCount();
    const left = selected - deferred;
    const leftOut = left === 0 ? ''
      : `The deferred actions act on the ${deferred} deferred only; ${left} of the ${selected} selected ${left === 1 ? 'is' : 'are'} not deferred and left out. `;
    return `${leftOut}Delete ${selected} and Move do not reach a deferred message: the broker hands one out only by its sequence number.`;
  }

  private handleDeleteDeferred(): void {
    const sequenceNumbers = this.selectedDeferred();
    if (sequenceNumbers.length === 0) {
      return;
    }
    const entityName = this.data.entityName;
    const count = sequenceNumbers.length;
    const left = this.getSelectedCount() - count;
    const confirmData: ConfirmDialogData = {
      title: 'Delete deferred messages',
      message: `Are you sure you want to delete ${count} deferred ${count === 1 ? 'message' : 'messages'} from ${this.data.entityType} "${entityName}"? This action cannot be undone.`
        + (left > 0 ? ` ${left} selected ${left === 1 ? 'message is' : 'messages are'} not deferred and left out.` : ''),
      confirmText: `Delete ${count} deferred`,
      confirmColor: 'warn',
      icon: 'delete',
      typedName: entityName,
      typedLabel: `Type the ${this.data.entityType} name to confirm`,
      context: { subject: entityName }
    };
    this.dialog.open(ConfirmDialogComponent, { data: confirmData }).afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(confirmed => {
      if (confirmed) {
        this.settleDeferred('delete', sequenceNumbers, {});
      }
    });
  }

  private handleDeadLetterDeferred(): void {
    const sequenceNumbers = this.selectedDeferred();
    if (sequenceNumbers.length === 0) {
      return;
    }
    const data: DeadLetterDeferredDialogData = { entityName: this.data.entityName, entityType: this.data.entityType, sequenceNumbers };
    this.dialog.open<DeadLetterDeferredDialogComponent, DeadLetterDeferredDialogData, DeadLetterDeferredDialogResult>(DeadLetterDeferredDialogComponent, { data, width: '560px', maxWidth: '95vw' })
      .afterClosed().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(choice => {
        if (choice) {
          this.settleDeferred('deadletter', sequenceNumbers, choice);
        }
      });
  }

  /** The one place a deferred action becomes a route of the queue or of the subscription. */
  private deferredCall(action: DeferredAction, request: DeferredBatchRequest): Observable<BatchOperationResult> {
    const { entityName, topicName } = this.data;
    return this.data.entityType === 'queue'
      ? this.queueService.settleDeferredMessages(entityName, action, request)
      : this.topicService.settleDeferredMessages(topicName!, entityName, action, request);
  }

  /**
   * Sends one deferred call for exactly the given sequence numbers and shows the result per
   * sequence number. The call runs under the progress dialog, which cannot be dismissed, so the
   * messages dialog cannot be closed mid-call; its Cancel aborts the call and says what may have
   * been affected. Retry, for a resubmit only, never takes a possible duplicate. A failed call
   * keeps the selection and says why.
   */
  private settleDeferred(action: DeferredAction, sequenceNumbers: number[], options: Omit<DeferredBatchRequest, 'sequenceNumbers'>): void {
    if (sequenceNumbers.length === 0 || this.settlingDeferred()) {
      return;
    }
    this.settlingDeferred.set(true);
    const progressDialogRef = this.dialog.open(BulkOperationProgressDialogComponent, {
      data: {
        operation: action,
        deferred: true,
        totalCount: sequenceNumbers.length,
        entityName: this.data.entityName,
        entityType: this.data.entityType === 'queue' ? 'queue' : 'topic',
        subQueue: 'active'
      } as BulkOperationProgressDialogData,
      disableClose: true
    });
    const cancelRequested$ = progressDialogRef.componentInstance.cancelRequested$;
    this.deferredCall(action, { sequenceNumbers, ...options }).pipe(
      finalize(() => this.settlingDeferred.set(false)),
      takeUntil(cancelRequested$),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        progressDialogRef.close();
        if (result.failures.some(isDuplicateRefusal)) {
          this.targetDetectsDuplicates.set(true);
        }
        const retryable = action === 'resubmit' ? result.failures.filter(f => !isPossibleDuplicate(f)).map(f => f.sequenceNumber) : [];
        this.dialog.open(BulkOperationResultsDialogComponent, {
          data: {
            operation: action,
            deferred: true,
            result,
            entityName: this.data.entityName,
            entityType: this.data.entityType === 'queue' ? 'queue' : 'topic',
            subQueue: 'active',
            allowRetry: retryable.length > 0
          } as BulkOperationResultsDialogData
        }).afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(response => {
          if (!response?.retry) {
            this.bulkOperationsService.clearSelection('active');
          }
          if (action !== 'resubmit' && result.successCount > 0) {
            this.activeMessageCount.update(count => count !== undefined ? Math.max(0, count - result.successCount) : undefined);
          }
          if (action === 'deadletter' && result.successCount > 0) {
            this.deadLetterMessageCount.update(count => count !== undefined ? count + result.successCount : undefined);
          }
          this.loadActiveMessages();
          if (response?.retry && retryable.length > 0) {
            this.settleDeferred('resubmit', retryable, {
              newMessageIdOnDuplicateDetection: options.newMessageIdOnDuplicateDetection === true || response.newMessageIdOnDuplicateDetection === true
            });
          }
        });
      },
      error: (err) => {
        progressDialogRef.close();
        this.snackBar.open(messageCallFailure(err, DEFERRED_FAILED[action]), 'Close', { duration: 5000 });
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
          typedName: entityName,
          typedLabel: `Type the ${entityLabel} name to confirm`,
          context: { subject: entityName }
        }
      : {
          title: 'Delete Messages',
          message: `Are you sure you want to delete ${selectedCount} ${messageType} from ${this.data.entityType} "${entityName}"? This action cannot be undone.`,
          confirmText: 'Delete',
          confirmColor: 'warn',
          icon: 'delete',
          context: { subject: entityName }
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
      this.forgetPositions(subQueue, progressDialogRef);
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
        this.forgetPositions(subQueue);
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
    const dialogRef = this.dialog.open<MoveMessagesDialogComponent, MoveMessagesDialogData, MoveMessagesDialogResult>(MoveMessagesDialogComponent, {
      data: {
        currentQueueName: this.data.entityName,
        messageCount: selectedCount,
        isDeadLetter: isDeadLetter
      }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(choice => {
      if (choice?.targetQueueName) {
        this.executeMoveOperation(subQueue, choice.targetQueueName, undefined, choice.newMessageIdOnDuplicateDetection);
      }
    });
  }

  /**
   * Executes the bulk move operation
   * @param subQueue - The sub-queue the selection belongs to, captured when the action started
   * @param targetQueueName - The destination queue name
   * @param sequenceNumbersToMove - Optional array of specific sequence numbers to move (for retry)
   * @param newMessageId - Send each copy with a new message id into a target that detects duplicates
   */
  private executeMoveOperation(subQueue: 'active' | 'deadletter', targetQueueName: string, sequenceNumbersToMove?: number[], newMessageId = false): void {
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
      this.forgetPositions(subQueue, progressDialogRef);
    });

    this.queueService.moveMessages(this.data.entityName, targetQueueName, sequenceNumbers, isDeadLetter, newMessageId).pipe(
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
              allowRetry: retryable.length > 0 && !this.byPosition()
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
                this.executeMoveOperation(subQueue, targetQueueName, retryable, newMessageId || resultsResponse.newMessageIdOnDuplicateDetection === true);
              }, 500);
            }
          });
        }, 1000);
      },
      error: (err) => {
        console.error('Failed to move messages:', err);
        progressDialogRef.close();
        this.forgetPositions(subQueue);
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
