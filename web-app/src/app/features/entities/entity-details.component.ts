import { Component, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { delay } from 'rxjs/operators';
import { EntitySelection, QueueInfo, TopicInfo, SubscriptionInfo, SubscriptionRuleInfo, TreeNode, SubscriptionNodeData, SessionInfo } from '../../core/models';
import { EntitySelectionService, QueueService, TopicService, SessionService } from '../../core/services';
import { SendMessageDialogComponent } from '../messages/send-message-dialog.component';
import { ImportMessagesDialogComponent } from '../messages/import-messages-dialog.component';
import { ViewMessagesDialogComponent } from '../messages/view-messages-dialog.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { TransferMonitorComponent } from './transfer-monitor.component';
import { ContinuousResubmitDialogComponent, ContinuousResubmitDialogData } from '../messages/continuous-resubmit-dialog.component';
import { NgApexchartsModule } from 'ng-apexcharts';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexYAxis,
  ApexStroke,
  ApexTooltip,
  ApexLegend,
  ApexDataLabels,
  ApexGrid
} from 'ng-apexcharts';

@Component({
  selector: 'app-entity-details',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatSnackBarModule,
    MatDialogModule,
    MatMenuModule,
    MatIconModule,
    MatTooltipModule,
    NgApexchartsModule,
    TransferMonitorComponent
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
          @if (queueEntity.deadLetterMessageCount > 0) {
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
          <div class="stat-card stat-card-queue clickable" [class.warning]="queueEntity.deadLetterMessageCount > 0" (click)="viewMessages(1)">
            <span class="stat-value">{{ queueEntity.deadLetterMessageCount }}</span>
            <span class="stat-label">Dead Letter</span>
          </div>
          <div class="stat-card stat-card-queue">
            <span class="stat-value">{{ queueEntity.scheduledMessageCount }}</span>
            <span class="stat-label">Scheduled</span>
          </div>
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
            <div class="property lock-duration-property">
              <span class="property-label">Lock Duration</span>
              @let lockDuration = parseLockDuration(queueEntity.lockDuration);
              <div class="duration-inputs">
                <div class="duration-field">
                  <label>Days:</label>
                  <input type="text" readonly [value]="lockDuration.days">
                </div>
                <div class="duration-field">
                  <label>Hours:</label>
                  <input type="text" readonly [value]="lockDuration.hours">
                </div>
                <div class="duration-field">
                  <label>Minutes:</label>
                  <input type="text" readonly [value]="lockDuration.minutes">
                </div>
                <div class="duration-field">
                  <label>Seconds:</label>
                  <input type="text" readonly [value]="lockDuration.seconds">
                </div>
                <div class="duration-field">
                  <label>Millisecs:</label>
                  <input type="text" readonly [value]="lockDuration.milliseconds">
                </div>
              </div>
            </div>
            <div class="property lock-duration-property">
              <span class="property-label">Message TTL</span>
              @if (queueEntity.defaultMessageTimeToLive && queueEntity.defaultMessageTimeToLive !== 'Max Value') {
                @let ttl = parseLockDuration(queueEntity.defaultMessageTimeToLive);
                <div class="duration-inputs">
                  <div class="duration-field">
                    <label>Days:</label>
                    <input type="text" readonly [value]="ttl.days">
                  </div>
                  <div class="duration-field">
                    <label>Hours:</label>
                    <input type="text" readonly [value]="ttl.hours">
                  </div>
                  <div class="duration-field">
                    <label>Minutes:</label>
                    <input type="text" readonly [value]="ttl.minutes">
                  </div>
                  <div class="duration-field">
                    <label>Seconds:</label>
                    <input type="text" readonly [value]="ttl.seconds">
                  </div>
                  <div class="duration-field">
                    <label>Millisecs:</label>
                    <input type="text" readonly [value]="ttl.milliseconds">
                  </div>
                </div>
              } @else {
                <span class="property-value">Max Value</span>
              }
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
          </div>
        </div>
      } @else if (state.selection.type === 'topic' && state.selection.entity) {
        @let topicEntity = $any(state.selection.entity);
        <div class="topic-container">
          <!-- Topic Header -->
          <div class="entity-header entity-header-topic">
            <div class="entity-icon-wrapper">
              <i class="fa-solid fa-tower-broadcast entity-icon topic-icon"></i>
            </div>
            <div class="entity-title">
              <h2>{{ topicEntity.name }}</h2>
              <span class="badge bg-warning-subtle text-warning border border-warning-subtle">Topic</span>
            </div>
          </div>

          <hr class="my-3">

          <form [formGroup]="topicForm">
            <div class="topic-layout">
            <!-- Left Column: Path + Config Grid -->
            <div class="topic-left-column">
              <!-- Path - Full Width -->
              <div class="topic-path-section">
                <div class="form-section">
                  <div class="section-header">Path</div>
                  <div class="form-group">
                    <label class="form-label">Relative URI</label>
                    <input class="form-control" formControlName="path" placeholder="Enter topic path">
                  </div>
                </div>
              </div>

              <!-- Config Panels Grid: 2 columns x 3 rows -->
              <div class="topic-config-grid">
                <!-- Row 1, Col 1: Auto Delete On Idle -->
                <div class="form-section">
                  <div class="section-header">Auto Delete On Idle</div>
                  <div class="duration-inputs">
                    <div class="duration-field">
                      <label class="form-label">Days</label>
                      <input class="form-control" type="number" formControlName="autoDeleteDays" min="0">
                    </div>
                    <div class="duration-field">
                      <label class="form-label">H</label>
                      <input class="form-control" type="number" formControlName="autoDeleteHours" min="0" max="23">
                    </div>
                    <div class="duration-field">
                      <label class="form-label">M</label>
                      <input class="form-control" type="number" formControlName="autoDeleteMinutes" min="0" max="59">
                    </div>
                    <div class="duration-field">
                      <label class="form-label">S</label>
                      <input class="form-control" type="number" formControlName="autoDeleteSeconds" min="0" max="59">
                    </div>
                    <div class="duration-field">
                      <label class="form-label">Ms</label>
                      <input class="form-control" type="number" formControlName="autoDeleteMillisecs" min="0" max="999">
                    </div>
                  </div>
                </div>

                <!-- Row 1, Col 2: Default Message Time To Live -->
                <div class="form-section">
                  <div class="section-header">Default Message Time To Live</div>
                  <div class="duration-inputs">
                    <div class="duration-field">
                      <label class="form-label">Days</label>
                      <input class="form-control" type="number" formControlName="ttlDays" min="0">
                    </div>
                    <div class="duration-field">
                      <label class="form-label">H</label>
                      <input class="form-control" type="number" formControlName="ttlHours" min="0" max="23">
                    </div>
                    <div class="duration-field">
                      <label class="form-label">M</label>
                      <input class="form-control" type="number" formControlName="ttlMinutes" min="0" max="59">
                    </div>
                    <div class="duration-field">
                      <label class="form-label">S</label>
                      <input class="form-control" type="number" formControlName="ttlSeconds" min="0" max="59">
                    </div>
                    <div class="duration-field">
                      <label class="form-label">Ms</label>
                      <input class="form-control" type="number" formControlName="ttlMillisecs" min="0" max="999">
                    </div>
                  </div>
                </div>

                <!-- Row 2-3, Col 1: Topic Properties (spans 2 rows) -->
                <div class="form-section topic-properties-panel">
                  <div class="section-header">Topic Properties</div>
                  <div class="form-group">
                    <div class="config-row">
                      <span class="config-label">Max Queue Size In GB</span>
                      <span class="config-value">{{ topicForm.get('maxSizeInGB')?.value }} GB</span>
                    </div>
                    <input type="range" class="form-range w-100 mb-3" min="1" max="5" step="1" formControlName="maxSizeInGB">
                    <div>
                      <label class="form-label">User Description</label>
                      <textarea class="form-control" formControlName="userDescription" rows="3" placeholder="Enter description"></textarea>
                    </div>
                  </div>
                </div>

                <!-- Row 2, Col 2: Duplicate Detection -->
                <div class="form-section">
                  <div class="section-header">Duplicate Detection History Time Window</div>
                  <div class="duration-inputs">
                    <div class="duration-field">
                      <label class="form-label">Days</label>
                      <input class="form-control" type="number" formControlName="duplicateDetectionDays" min="0">
                    </div>
                    <div class="duration-field">
                      <label class="form-label">H</label>
                      <input class="form-control" type="number" formControlName="duplicateDetectionHours" min="0" max="23">
                    </div>
                    <div class="duration-field">
                      <label class="form-label">M</label>
                      <input class="form-control" type="number" formControlName="duplicateDetectionMinutes" min="0" max="59">
                    </div>
                    <div class="duration-field">
                      <label class="form-label">S</label>
                      <input class="form-control" type="number" formControlName="duplicateDetectionSeconds" min="0" max="59">
                    </div>
                    <div class="duration-field">
                      <label class="form-label">Ms</label>
                      <input class="form-control" type="number" formControlName="duplicateDetectionMillisecs" min="0" max="999">
                    </div>
                  </div>
                </div>

                <!-- Row 3, Col 2: Topic Settings -->
                <div class="form-section topic-settings-panel">
                  <div class="section-header">Topic Settings</div>
                  <div class="form-group">
                    <div class="settings-grid">
                      <div class="setting-badge"
                           [class.active]="topicForm.get('enableBatchedOperations')?.value"
                           (click)="toggleSetting('enableBatchedOperations')">
                        <i class="fa" [class.fa-check-circle]="topicForm.get('enableBatchedOperations')?.value" [class.fa-circle-o]="!topicForm.get('enableBatchedOperations')?.value"></i>
                        <span class="setting-label">Batched Operations</span>
                      </div>
                      <div class="setting-badge"
                           [class.active]="topicForm.get('enableFilteringMessagesBeforePublishing')?.value"
                           (click)="toggleSetting('enableFilteringMessagesBeforePublishing')">
                        <i class="fa" [class.fa-check-circle]="topicForm.get('enableFilteringMessagesBeforePublishing')?.value" [class.fa-circle-o]="!topicForm.get('enableFilteringMessagesBeforePublishing')?.value"></i>
                        <span class="setting-label">Filter Before Publish</span>
                      </div>
                      <div class="setting-badge"
                           [class.active]="topicForm.get('enablePartitioning')?.value"
                           (click)="toggleSetting('enablePartitioning')">
                        <i class="fa" [class.fa-check-circle]="topicForm.get('enablePartitioning')?.value" [class.fa-circle-o]="!topicForm.get('enablePartitioning')?.value"></i>
                        <span class="setting-label">Partitioning</span>
                      </div>
                      <div class="setting-badge"
                           [class.active]="topicForm.get('enableExpress')?.value"
                           (click)="toggleSetting('enableExpress')">
                        <i class="fa" [class.fa-check-circle]="topicForm.get('enableExpress')?.value" [class.fa-circle-o]="!topicForm.get('enableExpress')?.value"></i>
                        <span class="setting-label">Express</span>
                      </div>
                      <div class="setting-badge"
                           [class.active]="topicForm.get('requiresDuplicateDetection')?.value"
                           (click)="toggleSetting('requiresDuplicateDetection')">
                        <i class="fa" [class.fa-check-circle]="topicForm.get('requiresDuplicateDetection')?.value" [class.fa-circle-o]="!topicForm.get('requiresDuplicateDetection')?.value"></i>
                        <span class="setting-label">Duplicate Detection</span>
                      </div>
                      <div class="setting-badge"
                           [class.active]="topicForm.get('enforceMessageOrdering')?.value"
                           (click)="toggleSetting('enforceMessageOrdering')">
                        <i class="fa" [class.fa-check-circle]="topicForm.get('enforceMessageOrdering')?.value" [class.fa-circle-o]="!topicForm.get('enforceMessageOrdering')?.value"></i>
                        <span class="setting-label">Message Ordering</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Right Column: Topic Information with Tabs -->
            <div class="topic-right-column">
              <ul class="nav nav-tabs topic-tabs mb-3" role="tablist">
                <li class="nav-item" role="presentation">
                  <button class="nav-link" [class.active]="activeTopicTab() === 'description'" (click)="setTopicTab('description')" type="button">
                    <i class="fa-regular fa-file-lines me-2"></i>Description
                  </button>
                </li>
                <!-- Metrics tab hidden — not yet implemented -->
                <!--<li class="nav-item" role="presentation">
                  <button class="nav-link" [class.active]="activeTopicTab() === 'metrics'" (click)="setTopicTab('metrics')" type="button">
                    <i class="fa fa-line-chart me-2"></i>Metrics
                  </button>
                </li>-->
              </ul>
              <div class="tab-content">
                <!-- Description Tab -->
                <div class="description-tab" [hidden]="activeTopicTab() !== 'description'" id="topic-description-tab">
                    <div class="form-section">
                      <div class="section-header">Configuration</div>
                      <div class="form-group">
                        <div class="config-row">
                          <span class="config-label">Status</span>
                          <span class="config-value">{{ topicEntity.status }}</span>
                        </div>
                        <div class="config-row">
                          <span class="config-label">Max Size</span>
                          <span class="config-value">{{ topicEntity.maxSizeInMegabytes }} MB</span>
                        </div>
                        <div class="config-row">
                          <span class="config-label">Message Time To Live</span>
                          <span class="config-value">{{ formatDuration(topicEntity.defaultMessageTimeToLive) }}</span>
                        </div>
                        <div class="config-row">
                          <span class="config-label">Auto-Delete</span>
                          <span class="config-value">{{ formatDuration(topicEntity.autoDeleteOnIdle) }}</span>
                        </div>
                        <div class="config-row">
                          <span class="config-label">User Metadata</span>
                          <span class="config-value">{{ topicEntity.userMetadata || 'None' }}</span>
                        </div>
                      </div>
                    </div>

                    <div class="form-section">
                      <div class="section-header">Timestamps</div>
                      <div class="form-group">
                        <div class="config-row">
                          <span class="config-label">Created At</span>
                          <span class="config-value">{{ formatDate(topicEntity.createdAt) }}</span>
                        </div>
                        <div class="config-row">
                          <span class="config-label">Accessed At</span>
                          <span class="config-value">{{ formatDate(topicEntity.accessedAt) }}</span>
                        </div>
                        <div class="config-row">
                          <span class="config-label">Updated At</span>
                          <span class="config-value">{{ formatDate(topicEntity.updatedAt) }}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                <!-- Metrics Tab -->
                <div class="metrics-tab" [hidden]="activeTopicTab() !== 'metrics'" id="topic-metrics-tab">
                    <!-- Time Range Selector Header -->
                    <div class="metrics-header">
                      <div class="time-range-selector">
                        @for (range of timeRanges; track range.value) {
                          <button
                            class="time-range-btn"
                            [class.selected]="selectedTimeRange === range.value"
                            (click)="selectTimeRange(range.value)">
                            {{ range.label }}
                          </button>
                        }
                      </div>
                    </div>

                    <!-- Charts Grid -->
                    <div class="charts-grid">
                      <!-- Requests Chart -->
                      <div class="chart-container">
                        <h3 class="chart-title">Requests</h3>
                        <apx-chart
                          [series]="requestsChartOptions.series!"
                          [chart]="requestsChartOptions.chart!"
                          [xaxis]="requestsChartOptions.xaxis!"
                          [yaxis]="requestsChartOptions.yaxis!"
                          [stroke]="requestsChartOptions.stroke!"
                          [tooltip]="requestsChartOptions.tooltip!"
                          [legend]="requestsChartOptions.legend!"
                          [dataLabels]="requestsChartOptions.dataLabels!"
                          [grid]="requestsChartOptions.grid!">
                        </apx-chart>
                      </div>

                      <!-- Messages Chart -->
                      <div class="chart-container">
                        <h3 class="chart-title">Messages</h3>
                        <apx-chart
                          [series]="messagesChartOptions.series!"
                          [chart]="messagesChartOptions.chart!"
                          [xaxis]="messagesChartOptions.xaxis!"
                          [yaxis]="messagesChartOptions.yaxis!"
                          [stroke]="messagesChartOptions.stroke!"
                          [tooltip]="messagesChartOptions.tooltip!"
                          [legend]="messagesChartOptions.legend!"
                          [dataLabels]="messagesChartOptions.dataLabels!"
                          [grid]="messagesChartOptions.grid!">
                        </apx-chart>
                      </div>
                    </div>
                  </div>
              </div>
            </div>
          </div>
        </form>
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
          @if (subscriptionEntity && subscriptionEntity.deadLetterMessageCount > 0) {
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
            <!-- Metrics tab hidden — not yet implemented -->
            <!--<li class="nav-item" role="presentation">
              <button class="nav-link" [class.active]="activeSubscriptionTab() === 'metrics'" (click)="setSubscriptionTab('metrics')" type="button">
                <i class="fa fa-line-chart me-2"></i>Metrics
              </button>
            </li>-->
            @if (subscriptionEntity.requiresSession) {
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
                    @let lockDuration = parseLockDuration(subscriptionEntity.lockDuration || '00:01:00');
                    @let autoDeleteDuration = parseLockDuration(subscriptionEntity.autoDeleteOnIdle || '10675199.02:48:05.4775807');
                    @let defaultTTL = parseLockDuration(subscriptionEntity.defaultMessageTimeToLive || '10675199.02:48:05.4775807');

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
                          <div class="timespan-inputs">
                            <div class="timespan-group">
                              <label>Days</label>
                              <input type="number" class="form-control" [value]="lockDuration.days" readonly />
                            </div>
                            <div class="timespan-group">
                              <label>Hours</label>
                              <input type="number" class="form-control" [value]="lockDuration.hours" readonly />
                            </div>
                            <div class="timespan-group">
                              <label>Minutes</label>
                              <input type="number" class="form-control" [value]="lockDuration.minutes" readonly />
                            </div>
                            <div class="timespan-group">
                              <label>Seconds</label>
                              <input type="number" class="form-control" [value]="lockDuration.seconds" readonly />
                            </div>
                            <div class="timespan-group">
                              <label>Milliseconds</label>
                              <input type="number" class="form-control" [value]="lockDuration.milliseconds" readonly />
                            </div>
                          </div>
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
                          <div class="timespan-inputs">
                            <div class="timespan-group">
                              <label>Days</label>
                              <input type="number" class="form-control" [value]="autoDeleteDuration.days" readonly />
                            </div>
                            <div class="timespan-group">
                              <label>Hours</label>
                              <input type="number" class="form-control" [value]="autoDeleteDuration.hours" readonly />
                            </div>
                            <div class="timespan-group">
                              <label>Minutes</label>
                              <input type="number" class="form-control" [value]="autoDeleteDuration.minutes" readonly />
                            </div>
                            <div class="timespan-group">
                              <label>Seconds</label>
                              <input type="number" class="form-control" [value]="autoDeleteDuration.seconds" readonly />
                            </div>
                            <div class="timespan-group">
                              <label>Milliseconds</label>
                              <input type="number" class="form-control" [value]="autoDeleteDuration.milliseconds" readonly />
                            </div>
                          </div>
                        </div>

                        <!-- Default Message Time To Live Section -->
                        <div class="form-section">
                          <div class="section-header">Default Message Time To Live</div>
                          <div class="timespan-inputs">
                            <div class="timespan-group">
                              <label>Days</label>
                              <input type="number" class="form-control" [value]="defaultTTL.days" readonly />
                            </div>
                            <div class="timespan-group">
                              <label>Hours</label>
                              <input type="number" class="form-control" [value]="defaultTTL.hours" readonly />
                            </div>
                            <div class="timespan-group">
                              <label>Minutes</label>
                              <input type="number" class="form-control" [value]="defaultTTL.minutes" readonly />
                            </div>
                            <div class="timespan-group">
                              <label>Seconds</label>
                              <input type="number" class="form-control" [value]="defaultTTL.seconds" readonly />
                            </div>
                            <div class="timespan-group">
                              <label>Milliseconds</label>
                              <input type="number" class="form-control" [value]="defaultTTL.milliseconds" readonly />
                            </div>
                          </div>
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
                                  <td class="value-cell">{{ subscriptionEntity.createdAt | date:'medium' }}</td>
                                </tr>
                                <tr>
                                  <td class="label-cell">Updated At (UTC)</td>
                                  <td class="value-cell">{{ subscriptionEntity.updatedAt | date:'medium' }}</td>
                                </tr>
                                <tr>
                                  <td class="label-cell">Accessed At (UTC)</td>
                                  <td class="value-cell">{{ subscriptionEntity.accessedAt | date:'medium' }}</td>
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

            <!-- Metrics Tab -->
            <div class="metrics-tab" [hidden]="activeSubscriptionTab() !== 'metrics'" id="subscription-metrics-tab">
                <div class="metrics-grid">
                  <div class="metric-card">
                    <i class="fa fa-inbox"></i>
                    <div class="metric-info">
                      <span class="metric-value">{{ subscriptionEntity.activeMessageCount }}</span>
                      <span class="metric-label">Active Messages</span>
                    </div>
                  </div>
                  <div class="metric-card">
                    <i class="fa fa-exclamation-circle"></i>
                    <div class="metric-info">
                      <span class="metric-value" [class.warning]="subscriptionEntity.deadLetterMessageCount > 0">{{ subscriptionEntity.deadLetterMessageCount }}</span>
                      <span class="metric-label">Dead Letter Messages</span>
                    </div>
                  </div>
                  <div class="metric-card">
                    <i class="fa fa-exchange"></i>
                    <div class="metric-info">
                      <span class="metric-value">{{ subscriptionEntity.transferMessageCount }}</span>
                      <span class="metric-label">Transfer Messages</span>
                    </div>
                  </div>
                  <div class="metric-card">
                    <i class="fa fa-clock-o"></i>
                    <div class="metric-info">
                      <span class="metric-value">{{ subscriptionEntity.scheduledMessageCount || 0 }}</span>
                      <span class="metric-label">Scheduled Messages</span>
                    </div>
                  </div>
                  <div class="metric-card full-width">
                    <i class="fa fa-clock-o"></i>
                    <div class="metric-info">
                      <span class="metric-value">{{ subscriptionEntity.accessedAt | date:'medium' }}</span>
                      <span class="metric-label">Last Accessed</span>
                    </div>
                  </div>
                  <div class="metric-card full-width">
                    <i class="fa fa-history"></i>
                    <div class="metric-info">
                      <span class="metric-value">{{ subscriptionEntity.updatedAt | date:'medium' }}</span>
                      <span class="metric-label">Last Updated</span>
                    </div>
                  </div>
                </div>
              </div>

            <!-- Sessions Tab (only visible when requiresSession is true) -->
            @if (subscriptionEntity.requiresSession) {
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

          &.lock-duration-property {
            grid-column: span 2;
          }
        }
      }
    }

    .duration-inputs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;

      mat-form-field {
        flex: 0 0 auto;

        &:first-child {
          width: 90px; // Days field - slightly wider
        }

        &:not(:first-child) {
          width: 60px; // H, M, S, Ms fields - compact
        }
      }
    }

    .duration-field {
      display: flex;
      flex-direction: column;
      gap: 2px;

      label {
        font-size: 11px;
        color: var(--bs-secondary-color);
        font-weight: 500;
      }

      input {
        width: 70px;
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

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      padding: 0 16px;

      .metric-card {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px;
        background: var(--bs-secondary-bg);
        border-radius: 8px;

        &.full-width {
          grid-column: span 2;
        }

        mat-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;
          color: #1976d2;
        }

        .metric-info {
          display: flex;
          flex-direction: column;

          .metric-value {
            font-size: 20px;
            font-weight: 500;
            color: var(--bs-body-color);

            &.warning {
              color: #f44336;
            }
          }

          .metric-label {
            font-size: 12px;
            color: var(--bs-secondary-color);
          }
        }
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

      // Reduce right padding for duration input panels
      &:has(.duration-inputs) {
        padding-right: 8px;
      }
    }

    .config-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--bs-border-color);

      &:last-child {
        border-bottom: none;
      }

      .config-label {
        font-size: 12px;
        color: var(--bs-secondary-color);
      }

      .config-value {
        font-size: 12px;
        font-weight: 500;
        color: var(--bs-body-color);
      }
    }

    // Remove extra padding when config-row is inside form-group
    .form-group .config-row {
      padding: 0;
      margin-bottom: 8px;

      &:last-child {
        margin-bottom: 0;
      }
    }

    .settings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 8px;
    }

    .setting-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px;
      background: var(--bs-secondary-bg);
      border-radius: 4px;
      font-size: 11px;
      color: var(--bs-secondary-color);
      cursor: pointer;
      transition: all 0.2s ease;
      user-select: none;

      &:hover {
        background: var(--bs-tertiary-bg);
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--bs-tertiary-color);
        transition: color 0.2s ease;
      }

      .setting-label {
        flex: 1;
      }

      &.active {
        background: #e8f5e9;
        color: #2e7d32;

        &:hover {
          background: #dcedc8;
        }

        mat-icon {
          color: #4caf50;
        }
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

    .topic-layout {
      display: flex;
      gap: 16px;
      flex: 1;
      min-height: 0;
    }

    .topic-left-column {
      flex: 2;
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 0;
    }

    .topic-path-section {
      width: 100%;
    }

    .topic-config-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: auto auto auto;
      gap: 16px;
    }

    /* Grid positioning:
       Row 1: Auto Delete (col 1) | Default TTL (col 2)
       Row 2: Topic Properties (col 1, spans 2 rows) | Duplicate Detection (col 2)
       Row 3: Topic Properties continues | Topic Settings (col 2)
    */
    .topic-properties-panel {
      grid-row: 2 / span 2;
      grid-column: 1;
    }

    .topic-settings-panel {
      grid-row: 3;
      grid-column: 2;
    }

    .topic-right-column {
      flex: 1;
      min-width: 0;
    }

    .topic-info-panel {
      height: 100%;
    }

    .full-width {
      width: 100%;
    }

    @media (max-width: 1200px) {
      .topic-layout {
        flex-direction: column;
      }

      .topic-config-grid {
        grid-template-columns: 1fr;
        grid-template-rows: auto;
      }

      .topic-properties-panel {
        grid-row: auto;
        grid-column: 1;
      }

      .topic-settings-panel {
        grid-row: auto;
        grid-column: 1;
      }
    }

    /* Metrics Dashboard Styles */
    .metrics-header {
      padding: 16px;
      border-bottom: 1px solid var(--bs-border-color);
      margin-bottom: 24px;
    }

    .time-range-selector {
      display: flex;
      gap: 8px;
      justify-content: flex-start;
    }

    .time-range-btn {
      padding: 8px 16px;
      border: 1px solid var(--bs-border-color);
      background: var(--bs-body-bg);
      color: var(--bs-body-color);
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }

    .time-range-btn:hover {
      border-color: #3b82f6;
    }

    .time-range-btn.selected {
      background: #3b82f6;
      color: white;
      border-color: #3b82f6;
    }

    .charts-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      padding: 0 16px;
    }

    .chart-container {
      background: var(--bs-body-bg);
      border: 1px solid var(--bs-border-color);
      padding: 16px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .chart-title {
      margin: 0 0 16px 0;
      font-size: 16px;
      font-weight: 500;
      color: var(--bs-body-color);
    }

    @media (max-width: 768px) {
      .charts-grid {
        grid-template-columns: 1fr;
      }

      .time-range-selector {
        flex-wrap: wrap;
      }
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

      // Add padding for duration inputs
      &:has(.duration-inputs) {
        .duration-inputs {
          padding: 12px;
        }
      }
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

    /* TimeSpan Inputs */
    .timespan-inputs {
      padding: 12px;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 8px;
    }

    .timespan-group {
      display: flex;
      flex-direction: column;
    }

    .timespan-group label {
      font-size: 11px;
      color: var(--bs-secondary-color);
      margin-bottom: 4px;
      font-weight: 500;
      text-align: center;
    }

    .timespan-group input {
      padding: 6px 4px;
      border: 1px solid var(--bs-border-color);
      border-radius: 3px;
      font-size: 12px;
      text-align: center;
      background: var(--bs-secondary-bg);
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

      .timespan-inputs {
        grid-template-columns: repeat(3, 1fr);
      }
    }

    @media (max-width: 600px) {
      .timespan-inputs {
        grid-template-columns: repeat(2, 1fr);
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
  private queueService = inject(QueueService);
  private topicService = inject(TopicService);
  private sessionService = inject(SessionService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);

  // Topic form
  topicForm = this.fb.group({
    path: [''],
    autoDeleteDays: [0],
    autoDeleteHours: [0],
    autoDeleteMinutes: [0],
    autoDeleteSeconds: [0],
    autoDeleteMillisecs: [0],
    ttlDays: [0],
    ttlHours: [0],
    ttlMinutes: [0],
    ttlSeconds: [0],
    ttlMillisecs: [0],
    maxSizeInGB: [1],
    userDescription: [''],
    duplicateDetectionDays: [0],
    duplicateDetectionHours: [0],
    duplicateDetectionMinutes: [0],
    duplicateDetectionSeconds: [0],
    duplicateDetectionMillisecs: [0],
    enableBatchedOperations: [false],
    enableFilteringMessagesBeforePublishing: [false],
    enablePartitioning: [false],
    enableExpress: [false],
    requiresDuplicateDetection: [false],
    enforceMessageOrdering: [false]
  });

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
  activeTopicTab = signal<'description' | 'metrics'>('description');
  activeSubscriptionTab = signal<'description' | 'rules' | 'metrics' | 'sessions'>('description');

  // Description tab style selector
  descriptionStyle: 'cards' | 'infobox' | 'list' | 'hybrid' = 'cards';

  // Metrics dashboard - Time range selector
  timeRanges = [
    { label: '1 hour', value: '1h' },
    { label: '6 hours', value: '6h' },
    { label: '12 hours', value: '12h' },
    { label: '1 day', value: '1d' },
    { label: '7 days', value: '7d' },
    { label: '30 days', value: '30d' }
  ];
  selectedTimeRange = '1h';

  // Metrics dashboard - Chart options
  requestsChartOptions: {
    series?: ApexAxisChartSeries;
    chart?: ApexChart;
    xaxis?: ApexXAxis;
    yaxis?: ApexYAxis;
    stroke?: ApexStroke;
    tooltip?: ApexTooltip;
    legend?: ApexLegend;
    dataLabels?: ApexDataLabels;
    grid?: ApexGrid;
  } = {};

  messagesChartOptions: {
    series?: ApexAxisChartSeries;
    chart?: ApexChart;
    xaxis?: ApexXAxis;
    yaxis?: ApexYAxis;
    stroke?: ApexStroke;
    tooltip?: ApexTooltip;
    legend?: ApexLegend;
    dataLabels?: ApexDataLabels;
    grid?: ApexGrid;
  } = {};

  // Use observables directly with async pipe
  state$ = this.selectionService.state$;

  constructor() {
    // Initialize charts
    this.initializeCharts();

    // Load topic data when selection changes
    this.state$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(state => {
      // Reset tabs and live counts when entity changes
      this.activeTopicTab.set('description');
      this.activeSubscriptionTab.set('description');
      this.liveActiveCount.set(null);
      this.liveDeadLetterCount.set(null);

      if (state.selection && state.selection.type === 'topic' && state.selection.entity) {
        const topic = state.selection.entity as TopicInfo;
        this.loadTopicData(topic);
      }
    });
  }

  /**
   * Parse ISO 8601 duration string (TimeSpan from .NET) into components
   * Format: P{days}DT{hours}H{minutes}M{seconds}.{milliseconds}S
   * Example: "P10DT12H30M15.500S" = 10 days, 12 hours, 30 minutes, 15.5 seconds
   */
  private parseDuration(durationString: string): { days: number; hours: number; minutes: number; seconds: number; milliseconds: number } {
    const result = { days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };

    if (!durationString || durationString === '00:00:00') {
      return result;
    }

    // Parse ISO 8601 duration: P[n]Y[n]M[n]DT[n]H[n]M[n]S or simple format DD.HH:MM:SS.FFF
    const iso8601Match = durationString.match(/P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
    if (iso8601Match) {
      result.days = parseInt(iso8601Match[1] || '0', 10);
      result.hours = parseInt(iso8601Match[2] || '0', 10);
      result.minutes = parseInt(iso8601Match[3] || '0', 10);
      const seconds = parseFloat(iso8601Match[4] || '0');
      result.seconds = Math.floor(seconds);
      result.milliseconds = Math.round((seconds - result.seconds) * 1000);
      return result;
    }

    // Fallback: Parse .NET TimeSpan format: DD.HH:MM:SS.FFF or HH:MM:SS.FFF
    const parts = durationString.split('.');
    if (parts.length >= 2) {
      // Format: DD.HH:MM:SS or DD.HH:MM:SS.FFF
      if (parts[0].includes(':')) {
        // No days, format: HH:MM:SS or HH:MM:SS.FFF
        const timeParts = parts[0].split(':');
        result.hours = parseInt(timeParts[0] || '0', 10);
        result.minutes = parseInt(timeParts[1] || '0', 10);
        result.seconds = parseInt(timeParts[2] || '0', 10);
        if (parts[1]) {
          result.milliseconds = parseInt(parts[1].substring(0, 3).padEnd(3, '0'), 10);
        }
      } else {
        // Has days: DD.HH:MM:SS
        result.days = parseInt(parts[0], 10);
        const timeParts = parts[1].split(':');
        result.hours = parseInt(timeParts[0] || '0', 10);
        result.minutes = parseInt(timeParts[1] || '0', 10);
        result.seconds = parseInt(timeParts[2] || '0', 10);
        if (parts[2]) {
          result.milliseconds = parseInt(parts[2].substring(0, 3).padEnd(3, '0'), 10);
        }
      }
    } else if (parts[0].includes(':')) {
      // Simple format: HH:MM:SS
      const timeParts = parts[0].split(':');
      result.hours = parseInt(timeParts[0] || '0', 10);
      result.minutes = parseInt(timeParts[1] || '0', 10);
      result.seconds = parseInt(timeParts[2] || '0', 10);
    }

    return result;
  }

  /**
   * Load all topic data into the form
   */
  private loadTopicData(topic: TopicInfo) {
    // Parse durations
    const ttl = this.parseDuration(topic.defaultMessageTimeToLive || '');
    const autoDelete = this.parseDuration(topic.autoDeleteOnIdle || '');
    const dupDetection = this.parseDuration(topic.duplicateDetectionHistoryTimeWindow || '');

    // Load all topic data into the form
    this.topicForm.patchValue({
      // Basic properties
      path: topic.name || '',

      // Durations - Default Message Time To Live
      ttlDays: ttl.days,
      ttlHours: ttl.hours,
      ttlMinutes: ttl.minutes,
      ttlSeconds: ttl.seconds,
      ttlMillisecs: ttl.milliseconds,

      // Durations - Auto Delete On Idle
      autoDeleteDays: autoDelete.days,
      autoDeleteHours: autoDelete.hours,
      autoDeleteMinutes: autoDelete.minutes,
      autoDeleteSeconds: autoDelete.seconds,
      autoDeleteMillisecs: autoDelete.milliseconds,

      // Durations - Duplicate Detection History Time Window
      duplicateDetectionDays: dupDetection.days,
      duplicateDetectionHours: dupDetection.hours,
      duplicateDetectionMinutes: dupDetection.minutes,
      duplicateDetectionSeconds: dupDetection.seconds,
      duplicateDetectionMillisecs: dupDetection.milliseconds,

      // Size and capacity (using maxSizeInGB which is the form control)
      maxSizeInGB: Math.floor((topic.maxSizeInMegabytes || 1024) / 1024),

      // Features
      enableBatchedOperations: topic.enableBatchedOperations || false,
      enablePartitioning: topic.enablePartitioning || false,
      requiresDuplicateDetection: topic.requiresDuplicateDetection || false,
      enforceMessageOrdering: topic.supportOrdering || false,

      // Metadata
      userDescription: topic.userMetadata || ''
    });
  }

  toggleSetting(controlName: string) {
    const control = this.topicForm.get(controlName);
    if (control) {
      control.setValue(!control.value);
    }
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

  formatDuration(durationString: string | undefined): string {
    if (!durationString) return 'N/A';
    const duration = this.parseDuration(durationString);
    const parts: string[] = [];

    if (duration.days > 0) parts.push(`${duration.days}d`);
    if (duration.hours > 0) parts.push(`${duration.hours}h`);
    if (duration.minutes > 0) parts.push(`${duration.minutes}m`);
    if (duration.seconds > 0 || duration.milliseconds > 0) {
      const secs = duration.seconds + (duration.milliseconds / 1000);
      parts.push(`${secs.toFixed(3)}s`);
    }

    return parts.length > 0 ? parts.join(' ') : '0s';
  }

  formatDate(dateString: string | undefined): string {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return 'Invalid Date';
    }
  }

  parseLockDuration(duration: string): { days: number; hours: number; minutes: number; seconds: number; milliseconds: number } {
    if (!duration) return { days: 0, hours: 0, minutes: 1, seconds: 0, milliseconds: 0 };

    // Parse ISO 8601 duration format (e.g., "PT1M" or "P0DT0H1M0S") or simple timespan format (e.g., "00:01:00")
    const timespanMatch = duration.match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/);

    if (timespanMatch) {
      // Simple timespan format: HH:MM:SS.fff
      const hours = parseInt(timespanMatch[1], 10);
      const minutes = parseInt(timespanMatch[2], 10);
      const seconds = parseInt(timespanMatch[3], 10);
      const milliseconds = timespanMatch[4] ? parseInt(timespanMatch[4].padEnd(3, '0').substring(0, 3), 10) : 0;

      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;

      return { days, hours: remainingHours, minutes, seconds, milliseconds };
    }

    // ISO 8601 duration format: P[n]DT[n]H[n]M[n]S
    const iso8601Match = duration.match(/P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.(\d+))?S)?/);

    if (iso8601Match) {
      const days = parseInt(iso8601Match[1] || '0', 10);
      const hours = parseInt(iso8601Match[2] || '0', 10);
      const minutes = parseInt(iso8601Match[3] || '0', 10);
      const seconds = parseInt(iso8601Match[4] || '0', 10);
      const milliseconds = iso8601Match[5] ? parseInt(iso8601Match[5].padEnd(3, '0').substring(0, 3), 10) : 0;

      return { days, hours, minutes, seconds, milliseconds };
    }

    // Fallback
    return { days: 0, hours: 0, minutes: 1, seconds: 0, milliseconds: 0 };
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

  purgeMessages(type: string = 'active') {
    if (!this.selection) return;

    const entityName = this.selection.node.name;
    let messageCount = 0;
    let messageType = '';

    if (this.selection.type === 'queue' && this.queue) {
      if (type === 'active') {
        messageCount = this.queue.activeMessageCount;
        messageType = 'active';
      } else if (type === 'deadletter') {
        messageCount = this.queue.deadLetterMessageCount;
        messageType = 'dead-letter';
      } else if (type === 'all') {
        messageCount = this.queue.activeMessageCount + this.queue.deadLetterMessageCount;
        messageType = 'all';
      }
    } else if (this.selection.type === 'subscription' && this.subscription) {
      if (type === 'active') {
        messageCount = this.subscription.activeMessageCount;
        messageType = 'active';
      } else if (type === 'deadletter') {
        messageCount = this.subscription.deadLetterMessageCount;
        messageType = 'dead-letter';
      } else if (type === 'all') {
        messageCount = this.subscription.activeMessageCount + this.subscription.deadLetterMessageCount;
        messageType = 'all';
      }
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Purge Messages',
        message: `Are you sure you want to delete all ${messageCount} ${messageType} messages? This action cannot be undone.`,
        confirmText: 'Purge',
        confirmColor: 'warn',
        icon: 'delete_sweep'
      }
    });

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

  // Metrics Dashboard Methods

  /**
   * Initialize ApexCharts configuration for both charts
   */
  private initializeCharts() {
    const commonChartConfig: ApexChart = {
      type: 'line',
      height: 350,
      toolbar: {
        show: false
      },
      zoom: {
        enabled: false
      }
    };

    const commonStroke: ApexStroke = {
      curve: 'smooth',
      width: 2
    };

    const commonDataLabels: ApexDataLabels = {
      enabled: false
    };

    const commonGrid: ApexGrid = {
      borderColor: '#e7e7e7',
      row: {
        colors: ['#f3f3f3', 'transparent'],
        opacity: 0.5
      }
    };

    // Requests Chart Configuration
    this.requestsChartOptions = {
      series: [
        {
          name: 'Incoming Requests (Sum)',
          data: this.generateMockData(20, 0, 6),
          color: '#3b82f6' // Blue
        },
        {
          name: 'Successful Requests (Sum)',
          data: this.generateMockData(20, 0, 5),
          color: '#ec4899' // Pink/Magenta
        },
        {
          name: 'Server Errors (Sum)',
          data: this.generateMockData(20, 0, 2),
          color: '#9ca3af' // Light gray
        },
        {
          name: 'Throttled Requests (Sum)',
          data: this.generateMockData(20, 0, 1),
          color: '#6b7280' // Gray
        }
      ],
      chart: commonChartConfig,
      stroke: commonStroke,
      dataLabels: commonDataLabels,
      grid: commonGrid,
      xaxis: {
        categories: this.generateTimeLabels(20),
        labels: {
          rotate: -45,
          rotateAlways: true,
          style: {
            fontSize: '10px'
          }
        }
      },
      yaxis: {
        title: {
          text: 'Count'
        },
        min: 0,
        max: 8
      },
      tooltip: {
        shared: true,
        intersect: false,
        y: {
          formatter: (value: number, opts: any) => {
            const seriesName = opts.w.config.series[opts.seriesIndex].name;
            return `${seriesName}: ${value}`;
          }
        }
      },
      legend: {
        position: 'bottom',
        horizontalAlign: 'center',
        fontSize: '12px'
      }
    };

    // Messages Chart Configuration
    this.messagesChartOptions = {
      series: [
        {
          name: 'Incoming Messages (Sum)',
          data: this.generateMockData(20, 0, 100),
          color: '#3b82f6' // Blue
        },
        {
          name: 'Outgoing Messages (Sum)',
          data: this.generateMockData(20, 0, 95),
          color: '#ec4899' // Pink/Magenta
        }
      ],
      chart: commonChartConfig,
      stroke: commonStroke,
      dataLabels: commonDataLabels,
      grid: commonGrid,
      xaxis: {
        categories: this.generateTimeLabels(20),
        labels: {
          rotate: -45,
          rotateAlways: true,
          style: {
            fontSize: '10px'
          }
        }
      },
      yaxis: {
        title: {
          text: 'Count'
        },
        min: 0,
        max: 120
      },
      tooltip: {
        shared: true,
        intersect: false,
        y: {
          formatter: (value: number, opts: any) => {
            const seriesName = opts.w.config.series[opts.seriesIndex].name;
            return `${seriesName}: ${value}`;
          }
        }
      },
      legend: {
        position: 'bottom',
        horizontalAlign: 'center',
        fontSize: '12px'
      }
    };
  }

  /**
   * Generate mock data for charts
   * TODO: Replace with actual Azure Monitor API call to fetch real metrics
   */
  private generateMockData(points: number, min: number, max: number): number[] {
    const data: number[] = [];
    for (let i = 0; i < points; i++) {
      data.push(Math.floor(Math.random() * (max - min + 1)) + min);
    }
    return data;
  }

  /**
   * Generate time labels for X-axis
   */
  private generateTimeLabels(count: number): string[] {
    const labels: string[] = [];
    const now = new Date();

    for (let i = count - 1; i >= 0; i--) {
      const time = new Date(now.getTime() - i * 15 * 60 * 1000); // 15 minute intervals
      const hours = time.getHours().toString().padStart(2, '0');
      const minutes = time.getMinutes().toString().padStart(2, '0');
      labels.push(`${hours}:${minutes}`);
    }

    return labels;
  }

  /**
   * Handle time range selection change
   * TODO: Fetch new data from Azure Monitor API based on selected time range
   */
  selectTimeRange(range: string) {
    this.selectedTimeRange = range;

    // Update chart data based on new time range
    // For now, just regenerate mock data
    // In production, this would call the backend API:
    // this.topicService.getMetrics(topicName, range).subscribe(data => {...})

    this.initializeCharts();

    this.snackBar.open(`Time range updated to ${range}`, 'Close', { duration: 2000 });
  }

  // Tab navigation methods
  setTopicTab(tab: 'description' | 'metrics') {
    this.activeTopicTab.set(tab);
  }

  setSubscriptionTab(tab: 'description' | 'rules' | 'metrics' | 'sessions') {
    this.activeSubscriptionTab.set(tab);
    if (tab === 'sessions' && this.sessions.length === 0 && !this.loadingSessions()) {
      this.refreshSessions();
    }
  }
}
