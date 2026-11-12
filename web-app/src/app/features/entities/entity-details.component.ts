import { Component, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule, formatDate as formatDateText } from '@angular/common';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { delay } from 'rxjs/operators';
import { EntitySelection, QueueInfo, TopicInfo, SubscriptionInfo, SubscriptionRuleInfo, TreeNode, SubscriptionNodeData, SessionInfo } from '../../core/models';
import { EntitySelectionService, QueueService, TopicService, SessionService, ConnectionService } from '../../core/services';
import { SendMessageDialogComponent } from '../messages/send-message-dialog.component';
import { ImportMessagesDialogComponent } from '../messages/import-messages-dialog.component';
import { ViewMessagesDialogComponent } from '../messages/view-messages-dialog.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';
import { TransferMonitorComponent } from './transfer-monitor.component';
import { ContinuousResubmitDialogComponent, ContinuousResubmitDialogData } from '../messages/continuous-resubmit-dialog.component';
import { ProviderService } from '../../core/services/provider.service';
import { ProviderCapabilities } from '../../core/models/provider.model';
import { MAX_TIMESPAN_DAYS, parseDuration } from './duration';
import { EntityAdminActionsComponent } from './entity-admin-actions.component';

const NOT_SET = 'Not set';

@Component({
  selector: 'app-entity-details',
  standalone: true,
  imports: [
    CommonModule,
    MatSnackBarModule,
    MatDialogModule,
    MatMenuModule,
    MatIconModule,
    MatTooltipModule,
    TransferMonitorComponent,
    EntityAdminActionsComponent
  ],
  template: `
    <div class="details-container">
      @if (state$ | async; as state) {
        @if (state.loading) {
          <div class="details-loading">
            <div class="spinner-border text-primary" role="status">
              <span class="visually-hidden">Loading...</span>
            </div>
          </div>
        } @else if (!state.selection) {
          <div class="details-empty">
            <i class="fa fa-hand-pointer-o fa-3x mb-3 text-muted"></i>
            <h3>Select an entity</h3>
            <p>Choose a queue, topic, or subscription from the tree to view its details</p>
          </div>
        } @else if (state.selection.type === 'category') {
          <div class="details-category">
            <i class="fa fa-folder fa-3x mb-3 text-primary"></i>
            <h2>{{ state.selection.node.name }}</h2>
            <p>{{ state.selection.node.children?.length || 0 }} items</p>
          </div>
        } @else if (state.selection.type === 'queue' && state.selection.entity) {
        @let queueEntity = $any(state.selection.entity);
        <div class="entity-header entity-header-queue">
          <div class="entity-icon-wrapper">
            <i class="fa fa-inbox entity-icon queue-icon"></i>
          </div>
          <div class="entity-title">
            <h2>{{ queueEntity.name }}</h2>
            <span class="badge bg-success-subtle text-success border border-success-subtle">Queue</span>
          </div>
          <app-entity-admin-actions kind="queue" [entity]="queueEntity" />
        </div>

        <div class="entity-actions">
          <button class="btn btn-primary" (click)="sendMessage()">
            <i class="fa fa-paper-plane me-2"></i>Send Message
          </button>
          <button class="btn btn-outline-primary" (click)="importMessages()">
            <i class="fa fa-upload me-2"></i>Import
          </button>
          <button class="btn btn-secondary" (click)="viewMessages()">
            <i class="fa fa-eye me-2"></i>View Messages
          </button>
          <button class="btn btn-danger" (click)="purgeMessages()" [disabled]="queueEntity.activeMessageCount === 0">
            <i class="fa fa-trash me-2"></i>Purge
          </button>
          @if (queueEntity.deadLetterMessageCount > 0 && supports('supportsDeadLetterQueue')) {
            <button class="btn btn-warning" (click)="openAutoResubmit()">
              <i class="fa fa-repeat me-2"></i>Auto Resubmit ({{ queueEntity.deadLetterMessageCount }})
            </button>
          }
        </div>

        <hr class="my-3">

        <div class="entity-stats">
          <div class="stat-card stat-card-queue clickable" (click)="viewMessages(0)">
            <span class="stat-value">{{ queueEntity.activeMessageCount }}</span>
            <span class="stat-label">Active Messages</span>
          </div>
          @if (supports('supportsDeadLetterQueue')) {
            <div class="stat-card stat-card-queue clickable" [class.warning]="queueEntity.deadLetterMessageCount > 0" (click)="viewMessages(1)">
              <span class="stat-value">{{ queueEntity.deadLetterMessageCount }}</span>
              <span class="stat-label">Dead Letter</span>
            </div>
            @if (queueEntity.transferDeadLetterMessageCount > 0) {
              <div class="stat-card stat-card-queue">
                <span class="stat-value">{{ queueEntity.transferDeadLetterMessageCount }}</span>
                <span class="stat-label">Transfer Dead Letter</span>
              </div>
            }
          }
          @if (supports('supportsScheduledMessages')) {
            <div class="stat-card stat-card-queue">
              <span class="stat-value">{{ queueEntity.scheduledMessageCount }}</span>
              <span class="stat-label">Scheduled</span>
            </div>
          }
          <div class="stat-card stat-card-queue">
            <span class="stat-value">{{ formatSize(queueEntity.sizeInBytes) }}</span>
            <span class="stat-label">Size</span>
          </div>
        </div>

        <hr class="my-3">

        <div class="entity-properties">
          <h3>Properties</h3>
          <div class="property-grid">
            <div class="property">
              <span class="property-label">Max Delivery Count</span>
              <span class="property-value">{{ queueEntity.maxDeliveryCount }}</span>
            </div>
            <div class="property">
              <span class="property-label">Lock Duration</span>
              <span class="property-value">{{ formatDuration(queueEntity.lockDuration) }}</span>
            </div>
            <div class="property">
              <span class="property-label">Message TTL</span>
              <span class="property-value">{{ formatDuration(queueEntity.defaultMessageTimeToLive) }}</span>
            </div>
            <div class="property">
              <span class="property-label">Max Size</span>
              <span class="property-value">{{ queueEntity.maxSizeInMegabytes }} MB</span>
            </div>
            <div class="property">
              <span class="property-label">Requires Session</span>
              <span class="property-value">{{ queueEntity.requiresSession ? 'Yes' : 'No' }}</span>
            </div>
            <div class="property">
              <span class="property-label">Partitioning</span>
              <span class="property-value">{{ queueEntity.enablePartitioning ? 'Enabled' : 'Disabled' }}</span>
            </div>
            <div class="property">
              <span class="property-label">Status</span>
              <span class="property-value">{{ queueEntity.status || notSet }}</span>
            </div>
            <div class="property">
              <span class="property-label">Created At (UTC)</span>
              <span class="property-value">{{ formatDate(queueEntity.createdAt) }}</span>
            </div>
            <div class="property">
              <span class="property-label">Updated At (UTC)</span>
              <span class="property-value">{{ formatDate(queueEntity.updatedAt) }}</span>
            </div>
            <div class="property">
              <span class="property-label">Accessed At (UTC)</span>
              <span class="property-value">{{ formatDate(queueEntity.accessedAt) }}</span>
            </div>
            <div class="property">
              <span class="property-label">Dead-lettering On Expiration</span>
              <span class="property-value">{{ enabledText(queueEntity.deadLetteringOnMessageExpiration) }}</span>
            </div>
            <div class="property">
              <span class="property-label">Auto Delete On Idle</span>
              <span class="property-value">{{ formatDuration(queueEntity.autoDeleteOnIdle) }}</span>
            </div>
            <div class="property">
              <span class="property-label">Forward To</span>
              <span class="property-value">{{ queueEntity.forwardTo || notSet }}</span>
            </div>
            <div class="property">
              <span class="property-label">Forward Dead-lettered To</span>
              <span class="property-value">{{ queueEntity.forwardDeadLetteredMessagesTo || notSet }}</span>
            </div>
            <div class="property">
              <span class="property-label">Duplicate Detection</span>
              <span class="property-value">{{ duplicateDetectionText(queueEntity) }}</span>
            </div>
            <div class="property">
              <span class="property-label">User Metadata</span>
              <span class="property-value">{{ queueEntity.userMetadata || notSet }}</span>
            </div>
          </div>
        </div>
      } @else if (state.selection.type === 'topic' && state.selection.entity) {
        @let topicEntity = $any(state.selection.entity);
        <div class="topic-container">
          <div class="entity-header entity-header-topic">
            <div class="entity-icon-wrapper">
              <i class="fa-solid fa-tower-broadcast entity-icon topic-icon"></i>
            </div>
            <div class="entity-title">
              <h2>{{ topicEntity.name }}</h2>
              <span class="badge bg-warning-subtle text-warning border border-warning-subtle">Topic</span>
            </div>
            <app-entity-admin-actions kind="topic" [entity]="topicEntity" />
          </div>

          <hr class="my-3">

          <div class="entity-properties">
            <h3>Properties</h3>
            <div class="property-grid">
              <div class="property">
                <span class="property-label">Status</span>
                <span class="property-value">{{ topicEntity.status || notSet }}</span>
              </div>
              <div class="property">
                <span class="property-label">Max Size</span>
                <span class="property-value">{{ topicEntity.maxSizeInMegabytes != null ? topicEntity.maxSizeInMegabytes + ' MB' : notSet }}</span>
              </div>
              <div class="property">
                <span class="property-label">Message Time To Live</span>
                <span class="property-value">{{ formatDuration(topicEntity.defaultMessageTimeToLive) }}</span>
              </div>
              <div class="property">
                <span class="property-label">Auto Delete On Idle</span>
                <span class="property-value">{{ formatDuration(topicEntity.autoDeleteOnIdle) }}</span>
              </div>
              <div class="property">
                <span class="property-label">Duplicate Detection</span>
                <span class="property-value">{{ duplicateDetectionText(topicEntity) }}</span>
              </div>
              <div class="property">
                <span class="property-label">Batched Operations</span>
                <span class="property-value">{{ enabledText(topicEntity.enableBatchedOperations) }}</span>
              </div>
              <div class="property">
                <span class="property-label">Partitioning</span>
                <span class="property-value">{{ enabledText(topicEntity.enablePartitioning) }}</span>
              </div>
              <div class="property">
                <span class="property-label">Support Ordering</span>
                <span class="property-value">{{ enabledText(topicEntity.supportOrdering) }}</span>
              </div>
              <div class="property">
                <span class="property-label">User Metadata</span>
                <span class="property-value">{{ topicEntity.userMetadata || notSet }}</span>
              </div>
              <div class="property">
                <span class="property-label">Created At (UTC)</span>
                <span class="property-value">{{ formatDate(topicEntity.createdAt) }}</span>
              </div>
              <div class="property">
                <span class="property-label">Updated At (UTC)</span>
                <span class="property-value">{{ formatDate(topicEntity.updatedAt) }}</span>
              </div>
              <div class="property">
                <span class="property-label">Accessed At (UTC)</span>
                <span class="property-value">{{ formatDate(topicEntity.accessedAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      } @else if (state.selection.type === 'subscription') {
        @let subscriptionEntity = $any(state.selection.entity);

        <!-- Subscription Header -->
        <div class="entity-header entity-header-subscription">
          <div class="entity-icon-wrapper">
            <i class="fa-solid fa-bell entity-icon subscription-icon"></i>
          </div>
          <div class="entity-title">
            <h2>{{ subscriptionEntity?.name || state.selection.node.name }}</h2>
            <span class="badge bg-info-subtle text-info border border-info-subtle">Subscription</span>
          </div>
          <app-entity-admin-actions kind="subscription" [entity]="subscriptionEntity" />
        </div>

        <hr class="my-3">

        <div class="entity-actions">
          <button class="btn btn-danger" [matMenuTriggerFor]="purgeMenu" [disabled]="!subscriptionEntity">
            <i class="fa fa-trash"></i> Purge <i class="fa fa-caret-down ms-1"></i>
          </button>
          <mat-menu #purgeMenu="matMenu">
            <button mat-menu-item (click)="purgeMessages('active')" [disabled]="!subscriptionEntity || subscriptionEntity.activeMessageCount === 0">
              <mat-icon>mail</mat-icon>
              <span>Purge Active Messages</span>
            </button>
            <button mat-menu-item (click)="purgeMessages('deadletter')" [disabled]="!subscriptionEntity || subscriptionEntity.deadLetterMessageCount === 0">
              <mat-icon>error</mat-icon>
              <span>Purge Dead-letter Messages</span>
            </button>
            <button mat-menu-item (click)="purgeMessages('all')" [disabled]="!subscriptionEntity || (subscriptionEntity.activeMessageCount === 0 && subscriptionEntity.deadLetterMessageCount === 0)">
              <mat-icon>delete_forever</mat-icon>
              <span>Purge All Messages</span>
            </button>
          </mat-menu>
          @if (subscriptionEntity && subscriptionEntity.deadLetterMessageCount > 0 && supports('supportsDeadLetterQueue')) {
            <button class="btn btn-warning" (click)="openAutoResubmit()">
              <i class="fa fa-repeat me-2"></i>Auto Resubmit ({{ subscriptionEntity.deadLetterMessageCount }})
            </button>
          }
        </div>

        @if (subscriptionEntity) {
          <div class="entity-stats">
            <app-transfer-monitor
              [topicName]="subscriptionEntity.topicName"
              [subscriptionName]="subscriptionEntity.name"
              (subscriptionUpdated)="onSubscriptionUpdated($event)"
              (clicked)="viewMessages(0)" />
            @if (supports('supportsDeadLetterQueue')) {
              <div class="metric-card warning-card clickable" (click)="viewMessages(1)">
                <div class="card-header">
                  <i class="fa fa-exclamation-circle"></i>
                  <span>Dead Letter</span>
                </div>
                <div class="card-body">
                  <div class="metric-value">{{ liveDeadLetterCount() ?? subscriptionEntity.deadLetterMessageCount }}</div>
                  <div class="metric-label">Failed messages</div>
                </div>
              </div>
            }
          </div>

          <hr class="my-3">

          <ul class="nav nav-tabs subscription-tabs mb-3" role="tablist">
            <li class="nav-item" role="presentation">
              <button class="nav-link" [class.active]="activeSubscriptionTab() === 'description'" (click)="setSubscriptionTab('description')" type="button">
                <i class="fa-regular fa-file-lines me-2"></i>Description
              </button>
            </li>
            <li class="nav-item" role="presentation">
              <button class="nav-link" [class.active]="activeSubscriptionTab() === 'rules'" (click)="setSubscriptionTab('rules')" type="button">
                <i class="fa fa-filter me-2"></i>Subscription Rules
              </button>
            </li>
            @if (subscriptionEntity.requiresSession && supports('supportsSessions')) {
              <li class="nav-item" role="presentation">
                <button class="nav-link" [class.active]="activeSubscriptionTab() === 'sessions'" (click)="setSubscriptionTab('sessions')" type="button">
                  <i class="fa-solid fa-layer-group me-2"></i>Sessions
                </button>
              </li>
            }
          </ul>
          <div class="tab-content">
            <!-- Description Tab -->
            <div class="description-tab" [hidden]="activeSubscriptionTab() !== 'description'" id="subscription-description-tab">
                <!-- Subscription Details - 3 Column Layout -->
                <div class="subscription-details-layout">

                    <!-- 3-Column Layout -->
                    <div class="three-column-layout">
                      <!-- Column 1 (30%) - Name, Lock Duration, Subscription Properties -->
                      <div class="column column-1">
                        <!-- Name Section -->
                        <div class="form-section">
                          <div class="section-header">Name</div>
                          <div class="form-group">
                            <label>Subscription Name</label>
                            <input type="text" class="form-control" [value]="subscriptionEntity.name" readonly />
                          </div>
                        </div>

                        <!-- Lock Duration Section -->
                        <div class="form-section">
                          <div class="section-header">Lock Duration</div>
                          <div class="form-group"><span class="property-value">{{ formatDuration(subscriptionEntity.lockDuration) }}</span></div>
                        </div>

                        <!-- Subscription Properties Section -->
                        <div class="form-section">
                          <div class="section-header">Subscription Properties</div>
                          <div class="form-group">
                            <label>Max Delivery Count</label>
                            <input type="number" class="form-control" [value]="subscriptionEntity.maxDeliveryCount" readonly />
                          </div>
                          <div class="form-group">
                            <label>User Description</label>
                            <textarea class="form-control" rows="2" [value]="subscriptionEntity.userMetadata || ''" readonly></textarea>
                          </div>
                          <div class="form-group">
                            <label>Forward To</label>
                            <div class="input-with-button">
                              <input type="text" class="form-control" [value]="subscriptionEntity.forwardTo || ''" readonly />
                              <button class="browse-btn" disabled>[...]</button>
                            </div>
                          </div>
                          <div class="form-group">
                            <label>Forward Dead-lettered Messages To</label>
                            <div class="input-with-button">
                              <input type="text" class="form-control" [value]="subscriptionEntity.forwardDeadLetteredMessagesTo || ''" readonly />
                              <button class="browse-btn" disabled>[...]</button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <!-- Column 2 (35%) - Auto Delete, Default TTL, Subscription Settings -->
                      <div class="column column-2">
                        <!-- Auto Delete On Idle Section -->
                        <div class="form-section">
                          <div class="section-header">Auto Delete On Idle</div>
                          <div class="form-group"><span class="property-value">{{ formatDuration(subscriptionEntity.autoDeleteOnIdle) }}</span></div>
                        </div>

                        <!-- Default Message Time To Live Section -->
                        <div class="form-section">
                          <div class="section-header">Default Message Time To Live</div>
                          <div class="form-group"><span class="property-value">{{ formatDuration(subscriptionEntity.defaultMessageTimeToLive) }}</span></div>
                        </div>

                        <!-- Subscription Settings Section -->
                        <div class="form-section">
                          <div class="section-header">Subscription Settings</div>
                          <div class="checkbox-list">
                            <div class="checkbox-item">
                              <input type="checkbox" [checked]="subscriptionEntity.requiresSession" disabled />
                              <label>Enable Sessions</label>
                            </div>
                            <div class="checkbox-item">
                              <input type="checkbox" [checked]="subscriptionEntity.deadLetteringOnMessageExpiration" disabled />
                              <label>Enable Dead Lettering On Message Expiration</label>
                            </div>
                            <div class="checkbox-item">
                              <input type="checkbox" [checked]="subscriptionEntity.deadLetteringOnFilterEvaluationExceptions" disabled />
                              <label>Enable Dead Lettering On Filter Evaluation Exceptions</label>
                            </div>
                            <div class="checkbox-item">
                              <input type="checkbox" [checked]="subscriptionEntity.enableBatchedOperations" disabled />
                              <label>Enable Batched Operations</label>
                            </div>
                          </div>
                        </div>
                      </div>

                      <!-- Column 3 (35%) - Subscription Information -->
                      <div class="column column-3">
                        <div class="form-section">
                          <div class="section-header">Subscription Information</div>
                          <div class="info-table">
                            <table>
                              <tbody>
                                <tr>
                                  <td class="label-cell">Message Count</td>
                                  <td class="value-cell">{{ subscriptionEntity.activeMessageCount || 0 }}</td>
                                </tr>
                                <tr>
                                  <td class="label-cell">Size in Bytes</td>
                                  <td class="value-cell">{{ subscriptionEntity.sizeInBytes || 0 }}</td>
                                </tr>
                                <tr>
                                  <td class="label-cell">Created At (UTC)</td>
                                  <td class="value-cell">{{ formatDate(subscriptionEntity.createdAt) }}</td>
                                </tr>
                                <tr>
                                  <td class="label-cell">Updated At (UTC)</td>
                                  <td class="value-cell">{{ formatDate(subscriptionEntity.updatedAt) }}</td>
                                </tr>
                                <tr>
                                  <td class="label-cell">Accessed At (UTC)</td>
                                  <td class="value-cell">{{ formatDate(subscriptionEntity.accessedAt) }}</td>
                                </tr>
                                <tr>
                                  <td class="label-cell">User Metadata</td>
                                  <td class="value-cell">{{ subscriptionEntity.userMetadata || '' }}</td>
                                </tr>
                                <tr>
                                  <td class="label-cell">Status</td>
                                  <td class="value-cell">{{ subscriptionEntity.status }}</td>
                                </tr>
                                <tr>
                                  <td class="label-cell">Subscription Name</td>
                                  <td class="value-cell">{{ subscriptionEntity.name }}</td>
                                </tr>
                                <tr>
                                  <td class="label-cell">Topic Name</td>
                                  <td class="value-cell">{{ subscriptionEntity.topicName }}</td>
                                </tr>
                                <tr>
                                  <td class="label-cell">Active Message Count</td>
                                  <td class="value-cell">{{ subscriptionEntity.activeMessageCount || 0 }}</td>
                                </tr>
                                <tr>
                                  <td class="label-cell">Dead Letter Message Count</td>
                                  <td class="value-cell">{{ subscriptionEntity.deadLetterMessageCount || 0 }}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </div>
                </div>
              </div>
            </div>

            <!-- Subscription Rules Tab -->
            <div class="rules-tab" [hidden]="activeSubscriptionTab() !== 'rules'" id="subscription-rules-tab">
                @if (subscriptionEntity.rules && subscriptionEntity.rules.length > 0) {
                  <div class="rules-container">
                    @for (rule of subscriptionEntity.rules; track rule.name) {
                      <div class="rule-card">
                        <div class="rule-header">
                          <i class="fa fa-filter rule-icon"></i>
                          <div class="rule-title">
                            <span class="rule-name">{{ rule.name }}</span>
                          </div>
                        </div>

                        <div class="rule-content">
                          @if (rule.filterExpression) {
                            <div class="rule-section">
                              <div class="section-label">
                                <i class="fa fa-filter"></i>
                                <span>Filter Expression</span>
                              </div>
                              <pre class="code-block">{{ rule.filterExpression }}</pre>
                            </div>
                          }

                          @if (rule.actionExpression) {
                            <div class="rule-section">
                              <div class="section-label">
                                <i class="fa fa-play"></i>
                                <span>Action</span>
                              </div>
                              <pre class="code-block">{{ rule.actionExpression }}</pre>
                            </div>
                          }

                          @if (rule.correlationProperties && Object.keys(rule.correlationProperties).length > 0) {
                            <div class="rule-section">
                              <div class="section-label">
                                <i class="fa fa-cog"></i>
                                <span>Correlation Properties</span>
                              </div>
                              <div class="properties-list">
                                @for (prop of Object.entries(rule.correlationProperties); track prop[0]) {
                                  <div class="property-item">
                                    <span class="property-key">{{ prop[0] }}:</span>
                                    <span class="property-value">{{ prop[1] }}</span>
                                  </div>
                                }
                              </div>
                            </div>
                          }
                        </div>
                      </div>
                    }
                  </div>
                } @else {
                  <div class="empty-tab">
                    <i class="fa fa-filter"></i>
                    <p>No subscription rules found</p>
                    <span class="hint">This subscription has no filter rules configured</span>
                  </div>
                }
              </div>

            <!-- Sessions Tab (only visible when requiresSession is true and the broker supports sessions) -->
            @if (subscriptionEntity.requiresSession && supports('supportsSessions')) {
              <div class="sessions-tab" [hidden]="activeSubscriptionTab() !== 'sessions'" id="subscription-sessions-tab">
                  <div class="sessions-layout">
                    <!-- Sessions List (Left Panel) -->
                    <div class="sessions-panel">
                      <div class="groupbox full-height">
                        <div class="groupbox-header">
                          Sessions
                        </div>
                        <div class="groupbox-content">
                          @if (loadingSessions()) {
                            <div class="loading-sessions">
                              <div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Loading...</span></div>
                              <span>Loading sessions...</span>
                            </div>
                          } @else if (sessions.length === 0) {
                            <div class="empty-sessions">
                              <i class="fa-solid fa-layer-group"></i>
                              <p>No active sessions</p>
                              <span class="hint">Sessions will appear when messages with session IDs are received</span>
                            </div>
                          } @else {
                            <div class="sessions-list">
                              @for (session of sessions; track session.sessionId) {
                                <div class="session-item" [class.selected]="selectedSession?.sessionId === session.sessionId" (click)="selectSession(session)">
                                  <i class="fa-solid fa-hashtag"></i>
                                  <div class="session-info">
                                    <span class="session-id">{{ session.sessionId }}</span>
                                    <span class="session-state">
                                      @if (session.lockedUntil) {
                                        <i class="fa-solid fa-lock" style="color: var(--bs-warning);"></i>
                                        Locked
                                      } @else {
                                        {{ session.state ? 'Has state' : 'No state' }}
                                      }
                                    </span>
                                  </div>
                                  <i class="fa fa-chevron-right arrow-icon"></i>
                                </div>
                              }
                            </div>
                          }
                        </div>
                      </div>
                    </div>

                    <!-- Session Details (Right Panel) -->
                    <div class="session-details-panel">
                      <div class="groupbox full-height">
                        <div class="groupbox-header">Session State</div>
                        <div class="groupbox-content">
                          @if (selectedSession) {
                            <div class="session-details">
                              <div class="field-row">
                                <span class="field-label">Session ID</span>
                                <span class="field-value code-value">{{ selectedSession.sessionId }}</span>
                              </div>
                              <div class="field-row">
                                <span class="field-label">Lock Status</span>
                                <span class="field-value">
                                  @if (selectedSession.lockedUntil) {
                                    <i class="fa-solid fa-lock" style="color: var(--bs-warning); margin-right: 4px;"></i>
                                    Locked until {{ selectedSession.lockedUntil | date:'medium' }}
                                  } @else {
                                    <i class="fa-solid fa-lock-open" style="color: var(--bs-success); margin-right: 4px;"></i>
                                    Unlocked
                                  }
                                </span>
                              </div>
                              <div class="field-row">
                                <span class="field-label">State</span>
                                @if (selectedSession.state) {
                                  <pre class="session-state-content">{{ selectedSession.state }}</pre>
                                } @else {
                                  <span class="field-value">No state data</span>
                                }
                              </div>
                            </div>
                          } @else {
                            <div class="empty-details">
                              <i class="fa fa-hand-pointer-o"></i>
                              <p>Select a session to view its state</p>
                            </div>
                          }
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
            }
        } @else {
          <div class="details-loading" style="padding: 24px;">
            <p>Loading subscription details...</p>
          </div>
        }
      }
    }
    </div>
  `,
  styles: [`
    .details-container {
      flex: 1;
      overflow: auto;
      padding: 0;
      background: var(--bs-secondary-bg);
    }

    .details-loading, .details-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 400px;
      padding: 60px 20px;
      color: var(--bs-secondary-color);
      text-align: center;

      mat-icon {
        font-size: 64px;
        width: 64px;
        height: 64px;
        margin-bottom: 16px;
      }

      h3 {
        margin: 0 0 8px;
        color: var(--bs-body-color);
      }

      p {
        margin: 0;
        max-width: 300px;
      }
    }

    .details-category {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      text-align: center;

      .category-icon {
        font-size: 64px;
        width: 64px;
        height: 64px;
        color: #7b1fa2;
        margin-bottom: 16px;
      }

      h2 {
        margin: 0 0 8px;
      }

      p {
        color: var(--bs-secondary-color);
        margin: 0;
      }
    }

    .entity-header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      border-radius: 8px;
      background: var(--bs-body-bg);
      border: 1px solid var(--bs-border-color);
      margin-bottom: 24px;
      transition: all 0.2s ease;

      // Subscription header needs margin to match topic container padding
      &.entity-header-subscription {
        margin: 16px 16px 24px 16px;
      }

      .entity-icon-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 64px;
        height: 64px;
        border-radius: 50%;
        background: rgba(var(--bs-emphasis-color-rgb), 0.03);
        flex-shrink: 0;
      }

      .entity-icon {
        font-size: 32px;
        width: 32px;
        height: 32px;

        &.queue-icon { color: #66bb6a; }
        &.topic-icon { color: #ffa726; }
        &.subscription-icon { color: #42a5f5; }
      }

      .entity-title {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;

        h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
          color: var(--bs-body-color);
        }

        .badge {
          align-self: flex-start;
        }

        .entity-subtitle {
          display: block;
          color: var(--bs-secondary-color);
          margin-bottom: 8px;
          font-size: 14px;
        }
      }

      // Colored borders for each entity type
      &.entity-header-queue {
        border-left: 4px solid #66bb6a;
        background: linear-gradient(90deg, rgba(102, 187, 106, 0.05) 0%, var(--bs-body-bg) 100%);
      }

      &.entity-header-topic {
        border-left: 4px solid #ffa726;
        background: linear-gradient(90deg, rgba(255, 167, 38, 0.05) 0%, var(--bs-body-bg) 100%);
      }

      &.entity-header-subscription {
        border-left: 4px solid #42a5f5;
        background: linear-gradient(90deg, rgba(66, 165, 245, 0.05) 0%, var(--bs-body-bg) 100%);
      }
    }

    .entity-actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin: 16px 16px 24px 16px;
      justify-content: flex-end;

      button mat-icon {
        margin-right: 8px;
      }
    }

    mat-divider {
      margin: 24px 0;
    }

    .entity-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 16px;
      margin: 0 16px;
      padding: 0;

      .stat-card {
        background: var(--bs-body-bg);
        border: 1px solid var(--bs-border-color);
        border-radius: 8px;
        padding: 16px;
        text-align: center;
        transition: all 0.2s ease;
        position: relative;
        overflow: hidden;

        &::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 4px;
          height: 100%;
          background: var(--bs-primary);
          opacity: 0.5;
          transition: opacity 0.2s ease;
        }

        &.warning {
          border-color: #ff9800;

          &::before {
            background: #ff9800;
            opacity: 1;
          }
        }

        &.clickable {
          cursor: pointer;

          &:hover {
            border-color: var(--bs-primary);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);

            &::before {
              opacity: 1;
              width: 100%;
              background: linear-gradient(90deg, rgba(var(--bs-primary-rgb), 0.1) 0%, transparent 100%);
            }
          }

          &.warning:hover {
            border-color: #ff9800;

            &::before {
              background: linear-gradient(90deg, rgba(255, 152, 0, 0.15) 0%, transparent 100%);
            }
          }
        }

        // Color variations for different entity types
        &.stat-card-queue::before {
          background: #66bb6a;
        }

        &.stat-card-topic::before {
          background: #ffa726;
        }

        &.stat-card-subscription::before {
          background: #42a5f5;
        }

        .stat-value {
          display: block;
          font-size: 28px;
          font-weight: 500;
          color: var(--bs-body-color);
        }

        .stat-label {
          display: block;
          font-size: 12px;
          color: var(--bs-secondary-color);
          margin-top: 4px;
        }
      }
    }

    .entity-properties {
      padding: 0 16px;

      h3 {
        margin: 0 0 16px;
        font-size: 16px;
        font-weight: 500;
      }

      .property-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;

        .property {
          .property-label {
            display: block;
            font-size: 12px;
            color: var(--bs-secondary-color);
            margin-bottom: 4px;
          }

          .property-value {
            display: block;
            font-size: 14px;
            color: var(--bs-body-color);
          }
        }
      }
    }

    .duration-inputs-vertical {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .duration-field-vertical {
      display: flex;
      align-items: center;
      gap: 8px;

      label {
        font-size: 11px;
        color: var(--bs-secondary-color);
        font-weight: 500;
        min-width: 65px;
      }

      input {
        flex: 1;
        padding: 4px 6px;
        border: 1px solid var(--bs-border-color);
        border-radius: 2px;
        font-size: 13px;
        color: var(--bs-body-color);
        background: var(--bs-body-bg);
        text-align: center;
        font-family: 'Consolas', 'Courier New', monospace;

        &:focus {
          outline: none;
          border-color: #1976d2;
        }
      }
    }

    .subscription-tabs {
      margin: 16px 16px 0 16px;

      ::ng-deep .mat-mdc-tab-labels {
        .mat-mdc-tab {
          mat-icon {
            margin-right: 8px;
          }
        }
      }
    }

    .tab-content {
      padding: 16px 0;
    }

    /* Subscription Rules Tab Styles */
    .rules-tab {
      padding: 8px !important;
    }

    .rules-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 0 16px;
    }

    .rule-card {
      border: 1px solid var(--bs-border-color);
      border-radius: 8px;
      background: var(--bs-body-bg);
      overflow: hidden;
      transition: box-shadow 0.2s ease;

      &:hover {
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }
    }

    .rule-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: var(--bs-secondary-bg);
      border-bottom: 1px solid var(--bs-border-color);

      .rule-icon {
        color: #1976d2;
        font-size: 24px;
        width: 24px;
        height: 24px;
      }

      .rule-title {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 12px;

        .rule-name {
          font-weight: 600;
          font-size: 14px;
          color: var(--bs-body-color);
        }
      }
    }

    .rule-content {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .rule-section {
      .section-label {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        color: var(--bs-secondary-color);
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }
      }

      .code-block {
        margin: 0;
        padding: 12px;
        background: var(--bs-secondary-bg);
        border: 1px solid var(--bs-border-color);
        border-radius: 4px;
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 12px;
        color: var(--bs-body-color);
        white-space: pre-wrap;
        word-break: break-word;
        overflow-x: auto;
      }

      .properties-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background: var(--bs-secondary-bg);
        border: 1px solid var(--bs-border-color);
        border-radius: 4px;

        .property-item {
          display: flex;
          gap: 8px;
          font-size: 12px;

          .property-key {
            font-weight: 600;
            color: var(--bs-body-color);
            font-family: 'Consolas', 'Courier New', monospace;
          }

          .property-value {
            color: var(--bs-body-color);
            font-family: 'Consolas', 'Courier New', monospace;
          }
        }
      }
    }

    .empty-tab {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px;
      color: var(--bs-secondary-color);
      text-align: center;

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        margin-bottom: 16px;
        color: var(--bs-tertiary-color);
      }

      p {
        margin: 0 0 8px;
        font-size: 16px;
      }

      .hint {
        font-size: 12px;
        color: var(--bs-tertiary-color);
      }
    }

    /* Description Tab - ServiceBusExplorer-like Layout */
    .description-tab {
      padding: 16px !important;
    }

    .description-layout {
      display: grid;
      grid-template-columns: 1fr 1fr 1.2fr;
      gap: 16px;
      height: 100%;
    }

    .description-column {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .info-column {
      .groupbox {
        height: 100%;
      }
    }

    .groupbox {
      border: 1px solid var(--bs-border-color);
      border-radius: 4px;
      background: var(--bs-body-bg);

      &.full-height {
        flex: 1;
        display: flex;
        flex-direction: column;
      }
    }

    .groupbox-header {
      background: var(--bs-secondary-bg);
      border-bottom: 1px solid var(--bs-border-color);
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 600;
      color: var(--bs-body-color);
    }

    .groupbox-content {
      padding: 10px;
      flex: 1;
      overflow: auto;
    }

    .field-row {
      display: flex;
      flex-direction: column;
      margin-bottom: 10px;

      &:last-child {
        margin-bottom: 0;
      }
    }

    .field-label {
      font-size: 11px;
      color: var(--bs-secondary-color);
      margin-bottom: 2px;
    }

    .field-value {
      font-size: 13px;
      color: var(--bs-body-color);
      padding: 4px 6px;
      background: var(--bs-body-bg);
      border: 1px solid var(--bs-border-color);
      border-radius: 2px;
      min-height: 20px;

      &.path-value {
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 12px;
        word-break: break-all;
      }

      &.code-value {
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 12px;
        background: var(--bs-secondary-bg);
      }
    }

    .timespan-value {
      display: block;
      font-size: 13px;
      color: var(--bs-body-color);
      padding: 6px 8px;
      background: var(--bs-body-bg);
      border: 1px solid var(--bs-border-color);
      border-radius: 2px;
      font-family: 'Consolas', 'Courier New', monospace;
    }

    .settings-list {
      .setting-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
        border: none;
        background: transparent;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--bs-secondary-color);

          &.enabled {
            color: #1976d2;
          }
        }

        span {
          font-size: 12px;
          color: var(--bs-body-color);
        }

        &.disabled {
          opacity: 0.6;
        }
      }
    }

    .info-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;

      th, td {
        padding: 4px 8px;
        text-align: left;
        border-bottom: 1px solid var(--bs-border-color);
      }

      th {
        background: var(--bs-secondary-bg);
        font-weight: 600;
        color: var(--bs-body-color);
      }

      td {
        color: var(--bs-body-color);

        &.status-active {
          color: #4caf50;
          font-weight: 500;
        }

        &.warning {
          color: #f44336;
          font-weight: 500;
        }
      }

      .section-header td {
        background: #e3f2fd;
        font-weight: 600;
        color: #1976d2;
        padding: 6px 8px;
      }
    }

    @media (max-width: 1200px) {
      .description-layout {
        grid-template-columns: 1fr 1fr;
      }

      .info-column {
        grid-column: span 2;
      }
    }

    @media (max-width: 768px) {
      .description-layout {
        grid-template-columns: 1fr;
      }

      .info-column {
        grid-column: span 1;
      }
    }

    /* Style Selector */
    .style-selector {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      padding: 8px;
      background: var(--bs-secondary-bg);
      border-radius: 4px;
    }

    .style-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      border: 1px solid var(--bs-border-color);
      background: var(--bs-body-bg);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover {
        background: #e3f2fd;
        border-color: #1976d2;
      }

      &.active {
        background: #1976d2;
        color: white;
        border-color: #1976d2;
      }
    }

    /* Style 1: Modern Metric Cards */
    .description-style-cards {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }

    .metric-card {
      background: var(--bs-body-bg);
      border: 1px solid var(--bs-border-color);
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow: hidden;
      transition: transform 0.2s, box-shadow 0.2s;

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.15);
      }

      .card-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        font-size: 13px;
        font-weight: 500;

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }
      }

      .card-body {
        padding: 16px;
      }

      .metric-value {
        font-size: 28px;
        font-weight: 600;
        color: var(--bs-body-color);
        margin-bottom: 4px;

        &.status-active {
          color: #4caf50;
        }
      }

      .metric-label {
        font-size: 12px;
        color: var(--bs-secondary-color);
      }

      &.status-card .card-header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      }

      &.primary-card .card-header {
        background: linear-gradient(135deg, #1e88e5 0%, #1565c0 100%);
      }

      &.warning-card .card-header {
        background: linear-gradient(135deg, #f44336 0%, #c62828 100%);
      }

      &.info-card .card-header {
        background: linear-gradient(135deg, #00acc1 0%, #00838f 100%);
      }

      &.success-card .card-header {
        background: linear-gradient(135deg, #66bb6a 0%, #43a047 100%);
      }
    }

    .config-panels {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
    }

    .config-panel {
      background: var(--bs-body-bg);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);

      h3 {
        margin: 0 0 12px;
        font-size: 14px;
        font-weight: 600;
        color: var(--bs-body-color);
        border-bottom: 2px solid #1976d2;
        padding-bottom: 8px;
      }
    }

    /* Style 2: Info Box Grid */
    .description-style-infobox {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .infobox-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
    }

    .info-box {
      background: var(--bs-body-bg);
      border: 1px solid var(--bs-border-color);
      border-radius: 4px;
      padding: 12px;
      transition: all 0.2s;

      &:hover {
        border-color: #1976d2;
        box-shadow: 0 2px 4px rgba(25, 118, 210, 0.1);
      }

      .info-label {
        font-size: 11px;
        color: var(--bs-secondary-color);
        text-transform: uppercase;
        margin-bottom: 6px;
        font-weight: 500;
      }

      .info-value {
        font-size: 14px;
        color: var(--bs-body-color);
        font-weight: 500;

        &.small {
          font-size: 11px;
          word-break: break-all;
        }

        &.large {
          font-size: 24px;
          font-weight: 600;
        }

        &.status-active {
          color: #4caf50;
        }
      }

      &.metric {
        background: var(--bs-tertiary-bg);
        border-color: var(--bs-border-color);

        .info-value {
          color: #1976d2;
        }
      }

      &.warning {
        background: #fff3e0;
        border-color: #ff9800;

        .info-value {
          color: #f57c00;
        }
      }
    }

    .infobox-settings {
      background: var(--bs-body-bg);
      border: 1px solid var(--bs-border-color);
      border-radius: 4px;
      padding: 16px;

      h3 {
        margin: 0 0 12px;
        font-size: 14px;
        font-weight: 600;
        color: var(--bs-body-color);
      }
    }

    .settings-checklist {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .check-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: var(--bs-secondary-bg);
      border-radius: 4px;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--bs-tertiary-color);
      }

      span {
        font-size: 13px;
        color: var(--bs-secondary-color);
      }

      &.checked {
        background: #e8f5e9;

        mat-icon {
          color: #4caf50;
        }

        span {
          color: #2e7d32;
        }
      }
    }

    /* Style 3: Clean Property List */
    .description-style-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .property-section {
      background: var(--bs-body-bg);
      border-radius: 4px;
      overflow: hidden;

      .section-title {
        margin: 0;
        padding: 12px 16px;
        background: linear-gradient(to right, #1976d2, #1565c0);
        color: white;
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
    }

    .property-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 16px;
      border-bottom: 1px solid var(--bs-border-color);
      transition: background 0.2s;

      &:last-child {
        border-bottom: none;
      }

      &:hover {
        background: var(--bs-secondary-bg);
      }

      .prop-label {
        font-size: 13px;
        color: var(--bs-secondary-color);
        font-weight: 500;
      }

      .prop-value {
        font-size: 13px;
        color: var(--bs-body-color);
        text-align: right;

        &.highlight {
          color: #1976d2;
          font-weight: 600;
        }

        &.warning {
          color: #f44336;
          font-weight: 600;
        }

        &.status-active {
          color: #4caf50;
          font-weight: 600;
        }
      }

      .bool-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--bs-tertiary-color);

        &.true {
          color: #4caf50;
        }
      }
    }

    /* Style 4: Hybrid Dashboard */
    .description-style-hybrid {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .metrics-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }

    .metric-tile {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--bs-body-bg);
      border-radius: 4px;
      padding: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      transition: transform 0.2s;

      &:hover {
        transform: translateY(-2px);
      }

      .tile-icon {
        font-size: 32px;
        width: 32px;
        height: 32px;

        &.primary {
          color: #1976d2;
        }

        &.warning {
          color: #f57c00;
        }

        &.info {
          color: #00acc1;
        }

        &.success {
          color: #66bb6a;
        }
      }

      .tile-content {
        flex: 1;
      }

      .tile-value {
        font-size: 20px;
        font-weight: 600;
        color: var(--bs-body-color);
      }

      .tile-label {
        font-size: 11px;
        color: var(--bs-secondary-color);
        text-transform: uppercase;
      }
    }

    .hybrid-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
    }

    .hybrid-panel {
      background: var(--bs-body-bg);
      border-radius: 4px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);

      .panel-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: var(--bs-secondary-bg);
        border-bottom: 1px solid var(--bs-border-color);

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          color: #1976d2;
        }

        h3 {
          margin: 0;
          font-size: 13px;
          font-weight: 600;
          color: var(--bs-body-color);
        }
      }

      .panel-body {
        padding: 12px;
      }
    }

    .compact-table {
      width: 100%;
      font-size: 12px;

      tr {
        border-bottom: 1px solid var(--bs-border-color);

        &:last-child {
          border-bottom: none;
        }
      }

      td {
        padding: 6px 0;

        &:first-child {
          color: var(--bs-secondary-color);
          font-weight: 500;
        }

        &:last-child {
          text-align: right;
          color: var(--bs-body-color);
        }

        &.status-active {
          color: #4caf50;
        }
      }
    }

    .feature-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .feature-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: var(--bs-secondary-bg);
      border-radius: 4px;
      font-size: 12px;
      color: var(--bs-tertiary-color);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--bs-tertiary-color);
      }

      &.enabled {
        background: #e8f5e9;
        color: #2e7d32;

        mat-icon {
          color: #4caf50;
        }
      }
    }

    .hybrid-info-panel {
      background: var(--bs-body-bg);
      border-radius: 4px;
      padding: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      display: flex;
      flex-direction: column;
      gap: 12px;

      .info-item {
        display: flex;
        justify-content: space-between;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--bs-border-color);

        &:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }

        .info-label {
          font-size: 12px;
          color: var(--bs-secondary-color);
          font-weight: 500;
        }

        .info-value {
          font-size: 12px;
          color: var(--bs-body-color);
          text-align: right;
        }
      }
    }

    /* Sessions Tab Styles */
    .sessions-tab {
      padding: 8px !important;
    }

    .sessions-layout {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      height: 400px;
      max-height: 400px;
    }

    .sessions-panel, .session-details-panel {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;

      .groupbox {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
    }

    .sessions-panel .groupbox-content {
      flex: 1;
      overflow-y: scroll;
      min-height: 0;
    }

    .session-details-panel .groupbox-content {
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }

    .groupbox-header {
      display: flex;
      justify-content: space-between;
      align-items: center;

      .header-btn {
        width: 24px;
        height: 24px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
      }
    }

    .loading-sessions {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px;
      gap: 12px;
      color: var(--bs-secondary-color);
    }

    .empty-sessions {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px;
      text-align: center;
      color: var(--bs-secondary-color);

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        color: var(--bs-tertiary-color);
        margin-bottom: 12px;
      }

      p {
        margin: 0 0 8px;
        font-size: 14px;
        color: var(--bs-secondary-color);
      }

      .hint {
        font-size: 12px;
        color: var(--bs-tertiary-color);
      }
    }

    .sessions-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 0 16px;
      overflow-y: auto;
      flex: 1;
    }

    .session-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 0.2s ease;
      border: 1px solid var(--bs-border-color);

      &:hover {
        background: var(--bs-secondary-bg);
      }

      &.selected {
        background: rgba(var(--bs-primary-rgb), 0.15);
        border-color: var(--bs-primary);
      }

      mat-icon {
        color: #1976d2;
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      .session-info {
        flex: 1;
        display: flex;
        flex-direction: column;

        .session-id {
          font-weight: 500;
          font-size: 13px;
          color: var(--bs-body-color);
        }

        .session-state {
          font-size: 11px;
          color: var(--bs-secondary-color);
        }
      }

      .arrow-icon {
        color: var(--bs-tertiary-color);
      }
    }

    .session-details {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .session-state-content {
      margin: 0;
      padding: 10px;
      background: var(--bs-secondary-bg);
      border: 1px solid var(--bs-border-color);
      border-radius: 4px;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow: auto;
    }

    .empty-details {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--bs-tertiary-color);
      text-align: center;

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        margin-bottom: 12px;
      }

      p {
        margin: 0;
        font-size: 14px;
      }
    }

    @media (max-width: 900px) {
      .sessions-layout {
        grid-template-columns: 1fr;
        height: auto;
      }

      .sessions-panel .groupbox,
      .session-details-panel .groupbox {
        min-height: 200px;
      }
    }

    /* Topic Layout Styles - CSS Grid 2x3 with Left/Right Columns */
    .topic-container {
      padding: 16px;
      height: 100%;
      overflow: auto;
      display: flex;
      flex-direction: column;
      background: var(--bs-secondary-bg);
    }

    .topic-info-panel {
      height: 100%;
    }

    /* Subscription 3-Column Layout Styles */
    .subscription-details-layout {
      padding-bottom: 16px;
    }

    .three-column-layout {
      display: flex;
      gap: 20px;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
    }

    .three-column-layout .column {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 0;
      flex-shrink: 1;
      box-sizing: border-box;
    }

    .three-column-layout .column-1 {
      flex: 0 0 calc(30% - 13.33px);
      max-width: calc(30% - 13.33px);
    }

    .three-column-layout .column-2 {
      flex: 0 0 calc(35% - 13.33px);
      max-width: calc(35% - 13.33px);
    }

    .three-column-layout .column-3 {
      flex: 0 0 calc(35% - 13.34px);
      max-width: calc(35% - 13.34px);
    }

    /* Form Sections */
    .form-section {
      background: var(--bs-body-bg);
      border: 1px solid var(--bs-border-color);
      border-radius: 4px;
      overflow: hidden;
    }

    .section-header {
      background: #4a90a4;
      color: white;
      padding: 8px 12px;
      font-weight: 500;
      font-size: 14px;
    }

    .form-group {
      padding: 12px;
      border-bottom: 1px solid var(--bs-border-color);
    }

    .form-group:last-child {
      border-bottom: none;
    }

    .form-group label {
      display: block;
      font-size: 12px;
      color: var(--bs-secondary-color);
      margin-bottom: 4px;
      font-weight: 500;
    }

    .form-control {
      width: 100%;
      padding: 6px 10px;
      border: 1px solid var(--bs-border-color);
      border-radius: 3px;
      font-size: 13px;
      background: var(--bs-secondary-bg);
    }

    .form-control:disabled,
    .form-control[readonly] {
      background: var(--bs-secondary-bg);
      cursor: not-allowed;
    }

    textarea.form-control {
      resize: vertical;
      min-height: 50px;
    }

    /* Input with Browse Button */
    .input-with-button {
      display: flex;
      gap: 4px;
    }

    .input-with-button .form-control {
      flex: 1;
    }

    .browse-btn {
      padding: 6px 12px;
      border: 1px solid var(--bs-border-color);
      border-radius: 3px;
      background: var(--bs-secondary-bg);
      cursor: pointer;
      font-size: 13px;
      min-width: 40px;
    }

    .browse-btn:hover:not(:disabled) {
      background: var(--bs-tertiary-bg);
    }

    .browse-btn:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }

    /* Checkbox List */
    .checkbox-list {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .checkbox-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .checkbox-item input[type="checkbox"] {
      width: 16px;
      height: 16px;
      cursor: pointer;
    }

    .checkbox-item input[type="checkbox"]:disabled {
      cursor: not-allowed;
    }

    .checkbox-item label {
      font-size: 13px;
      color: var(--bs-body-color);
      cursor: pointer;
      margin: 0;
    }

    .checkbox-item input[type="checkbox"]:disabled + label {
      cursor: not-allowed;
      opacity: 0.7;
    }

    /* Info Table */
    .info-table {
      padding: 0;
    }

    .info-table table {
      width: 100%;
      border-collapse: collapse;
    }

    .info-table tbody tr {
      border-bottom: 1px solid var(--bs-border-color);
    }

    .info-table tbody tr:last-child {
      border-bottom: none;
    }

    .info-table tbody tr:nth-child(even) {
      background-color: var(--bs-secondary-bg);
    }

    .info-table .label-cell {
      padding: 10px 12px;
      font-size: 12px;
      color: var(--bs-secondary-color);
      font-weight: 500;
      width: 45%;
      vertical-align: top;
    }

    .info-table .value-cell {
      padding: 10px 12px;
      font-size: 13px;
      color: var(--bs-body-color);
      word-break: break-word;
    }

    /* Responsive adjustments for subscription layout */
    @media (max-width: 1200px) {
      .three-column-layout {
        flex-direction: column;
      }

      .three-column-layout .column-1,
      .three-column-layout .column-2,
      .three-column-layout .column-3 {
        flex: 1 1 100%;
      }
    }

    // Badge animations (like connections)
    .badge {
      font-size: 11px;
      padding: 4px 8px;
      font-weight: 600;
      letter-spacing: 0.3px;
    }

    .pulse-badge {
      animation: pulse-badge 2s ease-in-out infinite;
      position: relative;
      display: inline-flex;
      align-items: center;
      padding: 0.35em 0.65em;
      font-weight: 600;

      i {
        animation: pulse-dot 2s ease-in-out infinite;
      }
    }

    @keyframes pulse-badge {
      0%, 100% {
        box-shadow: 0 0 0 0 rgba(25, 135, 84, 0.4);
      }
      50% {
        box-shadow: 0 0 0 5px rgba(25, 135, 84, 0);
      }
    }

    @keyframes pulse-dot {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.5;
      }
    }
  `]
})
export class EntityDetailsComponent {
  private selectionService = inject(EntitySelectionService);
  private connectionService = inject(ConnectionService);
  private queueService = inject(QueueService);
  private topicService = inject(TopicService);
  private sessionService = inject(SessionService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly providerService = inject(ProviderService);

  readonly notSet = NOT_SET;

  // Make Object available in template
  Object = Object;

  // Live subscription counts (updated by TransferMonitorComponent polling)
  liveActiveCount = signal<number | null>(null);
  liveDeadLetterCount = signal<number | null>(null);

  // Sessions state
  sessions: SessionInfo[] = [];
  selectedSession: SessionInfo | null = null;
  loadingSessions = signal(false);

  // Tab navigation state
  activeSubscriptionTab = signal<'description' | 'rules' | 'sessions'>('description');

  // Description tab style selector
  descriptionStyle: 'cards' | 'infobox' | 'list' | 'hybrid' = 'cards';

  // Use observables directly with async pipe
  state$ = this.selectionService.state$;

  constructor() {
    this.state$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      // Reset tabs and live counts when entity changes
      this.activeSubscriptionTab.set('description');
      this.liveActiveCount.set(null);
      this.liveDeadLetterCount.set(null);
    });
  }

  /** False only when the connected broker declares it lacks the feature. */
  supports(feature: keyof ProviderCapabilities): boolean {
    return this.providerService.capabilities()?.[feature] !== false;
  }

  get selection(): EntitySelection | null {
    return this.selectionService.currentSelection;
  }

  get loading(): boolean {
    return this.selectionService.isLoading;
  }

  get queue(): QueueInfo | null {
    const sel = this.selectionService.currentSelection;
    return sel?.type === 'queue' ? sel.entity as QueueInfo : null;
  }

  get topic(): TopicInfo | null {
    const sel = this.selectionService.currentSelection;
    return sel?.type === 'topic' ? sel.entity as TopicInfo : null;
  }

  get subscription(): SubscriptionInfo | null {
    const sel = this.selectionService.currentSelection;
    return sel?.type === 'subscription' ? sel.entity as SubscriptionInfo : null;
  }

  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  calculateFreeSpace(currentSizeBytes: number, maxSizeMB: number): string {
    if (!currentSizeBytes || !maxSizeMB) return 'N/A';
    const maxSizeBytes = maxSizeMB * 1024 * 1024; // Convert MB to bytes
    const freeSpaceBytes = maxSizeBytes - currentSizeBytes;
    if (freeSpaceBytes < 0) return '0 B (Overused)';
    return this.formatSize(freeSpaceBytes);
  }

  formatDuration(durationString: string | null | undefined): string {
    if (!durationString) return NOT_SET;
    const duration = parseDuration(durationString);
    if (duration.days >= MAX_TIMESPAN_DAYS) return 'Never';
    const parts: string[] = [];

    if (duration.days > 0) parts.push(`${duration.days}d`);
    if (duration.hours > 0) parts.push(`${duration.hours}h`);
    if (duration.minutes > 0) parts.push(`${duration.minutes}m`);
    if (duration.seconds > 0 || duration.milliseconds > 0) {
      const secs = duration.seconds + (duration.milliseconds / 1000);
      parts.push(`${Number(secs.toFixed(3))}s`);
    }

    return parts.length > 0 ? parts.join(' ') : '0s';
  }

  /** A date in UTC; an absent date, or the .NET default of year 1, is not set. */
  formatDate(value: Date | string | null | undefined): string {
    if (!value || new Date(value).getUTCFullYear() <= 1) return NOT_SET;
    return formatDateText(value, 'medium', 'en-US', 'UTC');
  }

  enabledText(value: boolean | null | undefined): string {
    if (value == null) return NOT_SET;
    return value ? 'Enabled' : 'Disabled';
  }

  duplicateDetectionText(entity: { requiresDuplicateDetection?: boolean; duplicateDetectionHistoryTimeWindow?: string }): string {
    if (entity.requiresDuplicateDetection == null) return NOT_SET;
    return entity.requiresDuplicateDetection
      ? `Enabled, window ${this.formatDuration(entity.duplicateDetectionHistoryTimeWindow)}`
      : 'Disabled';
  }

  getTopicNameFromNode(node: TreeNode): string {
    const data = node.data as SubscriptionNodeData | undefined;
    return node.parent?.name || data?.topicName || 'Unknown';
  }

  refresh() {
    this.selectionService.refreshCurrentSelection();
  }

  sendMessage() {
    if (!this.selection) return;

    const entityType = this.selection.type === 'queue' ? 'queue' : 'topic';
    const entityName = this.selection.node.name;

    const dialogRef = this.dialog.open(SendMessageDialogComponent, {
      width: '700px',
      data: { entityType, entityName }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.selectionService.refreshCurrentSelection();
      }
    });
  }

  importMessages() {
    if (!this.selection) return;

    const entityType = this.selection.type === 'queue' ? 'queue' : 'topic';
    const entityName = this.selection.node.name;

    const dialogRef = this.dialog.open(ImportMessagesDialogComponent, {
      width: '750px',
      data: { entityType, entityName }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      this.selectionService.refreshCurrentSelection();
    });
  }

  viewMessages(initialTab?: number) {
    if (!this.selection) return;

    let entityType: 'queue' | 'subscription';
    let entityName: string;
    let topicName: string | undefined;
    let activeMessageCount: number | undefined;
    let deadLetterMessageCount: number | undefined;

    if (this.selection.type === 'queue') {
      entityType = 'queue';
      entityName = this.selection.node.name;
      const queueEntity = this.selection.entity as QueueInfo;
      activeMessageCount = queueEntity?.activeMessageCount;
      deadLetterMessageCount = queueEntity?.deadLetterMessageCount;
    } else if (this.selection.type === 'subscription') {
      entityType = 'subscription';
      entityName = this.selection.node.name;
      const subscriptionEntity = this.selection.entity as SubscriptionInfo;
      topicName = subscriptionEntity?.topicName;
      activeMessageCount = subscriptionEntity?.activeMessageCount;
      deadLetterMessageCount = subscriptionEntity?.deadLetterMessageCount;
    } else {
      return;
    }

    this.dialog.open(ViewMessagesDialogComponent, {
      width: '95vw',
      maxWidth: '1400px',
      height: '90vh',
      data: { entityType, entityName, topicName, activeMessageCount, deadLetterMessageCount, initialTab }
    });
  }

  openAutoResubmit() {
    if (!this.selection) return;

    const data: ContinuousResubmitDialogData = {
      entityType: this.selection.type === 'queue' ? 'queue' : 'subscription',
      entityName: this.selection.node.name,
      topicName: this.selection.type === 'subscription' ? (this.selection.node.data as SubscriptionNodeData)?.topicName : undefined,
      deadLetterMessageCount: this.selection.type === 'queue'
        ? this.queue?.deadLetterMessageCount
        : this.subscription?.deadLetterMessageCount,
    };

    const dialogRef = this.dialog.open(ContinuousResubmitDialogComponent, {
      width: '500px',
      data,
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.refresh();
      }
    });
  }

  /**
   * Asks before a purge, naming the entity, its topic for a subscription, the connection
   * target and the count: the live one when the panel has it, otherwise the one read
   * when the entity was loaded.
   */
  purgeMessages(type: string = 'active') {
    if (!this.selection) return;

    const name = this.selection.node.name;
    const kind = this.selection.type === 'subscription' ? 'subscription' : 'queue';
    const entity = this.queue ?? this.subscription;
    const topicName = this.subscription?.topicName ?? (this.selection.node.data as SubscriptionNodeData | undefined)?.topicName;
    const where = kind === 'subscription' ? `subscription "${name}" of topic "${topicName}"` : `queue "${name}"`;
    const messageType = type === 'all' ? 'active and dead-letter' : type === 'deadletter' ? 'dead-letter' : 'active';
    const live = type === 'all'
      ? (this.liveActiveCount() !== null && this.liveDeadLetterCount() !== null)
      : (type === 'deadletter' ? this.liveDeadLetterCount() : this.liveActiveCount()) !== null;
    const active = this.liveActiveCount() ?? entity?.activeMessageCount ?? 0;
    const deadLetter = this.liveDeadLetterCount() ?? entity?.deadLetterMessageCount ?? 0;
    const count = type === 'all' ? active + deadLetter : type === 'deadletter' ? deadLetter : active;
    const countText = live ? `${count.toLocaleString()} now` : `${count.toLocaleString()} when the ${kind} was loaded`;

    const confirmData: ConfirmDialogData = {
      title: `Purge ${messageType} messages?`,
      message: `This deletes every ${messageType} message in ${where} on ${this.connectionService.currentTarget}: ${countText}. It cannot be undone.`,
      confirmText: `Purge ${count.toLocaleString()} messages`,
      confirmColor: 'warn',
      icon: 'delete_sweep',
      requireAcknowledgement: true,
      acknowledgementText: `I understand this deletes every ${messageType} message in ${name}`
    };
    const dialogRef = this.dialog.open(ConfirmDialogComponent, { data: confirmData });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.executePurge(type);
      }
    });
  }

  private executePurge(type: string = 'active') {
    if (this.selection?.type === 'queue') {
      this.queueService.purgeMessages(this.selection.node.name, type).pipe(
        delay(500),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe({
        next: () => {
          this.snackBar.open('Messages purged successfully', 'Close', { duration: 3000 });
          this.selectionService.refreshCurrentSelection();
          this.selectionService.refreshTree();
        },
        error: () => {
          this.snackBar.open('Failed to purge messages', 'Close', { duration: 3000 });
        }
      });
    } else if (this.selection?.type === 'subscription' && this.subscription) {
      this.topicService.purgeMessages(this.subscription.topicName, this.selection.node.name, type).pipe(
        delay(500),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe({
        next: () => {
          this.snackBar.open('Messages purged successfully', 'Close', { duration: 3000 });
          this.selectionService.refreshCurrentSelection();
          this.selectionService.refreshTree();
        },
        error: () => {
          this.snackBar.open('Failed to purge messages', 'Close', { duration: 3000 });
        }
      });
    }
  }

  // Sessions methods
  refreshSessions() {
    const sub = this.subscription;
    if (!sub?.requiresSession) return;

    this.loadingSessions.set(true);
    this.sessions = [];
    this.selectedSession = null;

    this.sessionService.getSubscriptionSessions(sub.topicName, sub.name).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (sessions) => {
        this.sessions = sessions;
        this.loadingSessions.set(false);
      },
      error: (err) => {
        this.loadingSessions.set(false);
        this.snackBar.open(
          err?.error?.message || 'Failed to load sessions',
          'Close',
          { duration: 5000 }
        );
      }
    });
  }

  selectSession(session: SessionInfo) {
    this.selectedSession = session;
  }

  onSubscriptionUpdated(sub: SubscriptionInfo) {
    this.liveActiveCount.set(sub.activeMessageCount);
    this.liveDeadLetterCount.set(sub.deadLetterMessageCount);

    // Update tree node data so badges in the sidebar update in real-time
    const sel = this.selectionService.currentSelection;
    if (sel?.type === 'subscription' && sel.node?.data) {
      const nodeData = sel.node.data as SubscriptionNodeData;
      nodeData.activeMessageCount = sub.activeMessageCount;
      nodeData.deadLetterMessageCount = sub.deadLetterMessageCount;
    }
  }

  // Tab navigation methods
  setSubscriptionTab(tab: 'description' | 'rules' | 'sessions') {
    this.activeSubscriptionTab.set(tab);
    if (tab === 'sessions' && this.sessions.length === 0 && !this.loadingSessions()) {
      this.refreshSessions();
    }
  }
}
