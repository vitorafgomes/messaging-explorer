import { Component, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule, formatDate as formatDateText } from '@angular/common';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { delay } from 'rxjs/operators';
import { EntitySelection, QueueInfo, TopicInfo, SubscriptionInfo, TreeNode, SubscriptionNodeData } from '../../core/models';
import { EntitySelectionService, QueueService, TopicService, ConnectionService, ResubmitRun, ResubmitRunService } from '../../core/services';
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
import { SubscriptionRulesComponent } from './subscription-rules.component';
import { EntitySessionsComponent } from './entity-sessions.component';

const NOT_SET = 'Not set';

/** A property of an entity as shown: its label and its value as text. */
type PropertyRow = [label: string, value: string];

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
    MatTabsModule,
    MatButtonModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    TransferMonitorComponent,
    EntityAdminActionsComponent,
    SubscriptionRulesComponent,
    EntitySessionsComponent
  ],
  template: `
    <ng-template #propertyTable let-rows>
      <div class="property-columns">
        @for (column of halves(rows); track $index) {
          <table class="property-grid info-table">
            <tbody>
              @for (row of column; track row[0]) {
                <tr class="property form-section">
                  <th scope="row" class="property-label section-header label-cell">{{ row[0] }}</th>
                  <td class="property-value value-cell" [class.not-set]="row[1] === notSet">{{ row[1] }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </ng-template>

    <div class="details-container">
      @if (state$ | async; as state) {
        @if (state.loading) {
          <div class="details-state" role="status">
            <mat-progress-spinner mode="indeterminate" diameter="32" aria-hidden="true" />
            <p>Loading the entity</p>
          </div>
        } @else if (!state.selection) {
          <div class="details-state">
            <mat-icon class="state-icon" fontIcon="touch_app" aria-hidden="true" />
            <h3>Select an entity</h3>
            <p>Choose a queue, topic or subscription from the tree to see its counts, its properties and its messages.</p>
          </div>
        } @else if (state.selection.type === 'category') {
          <div class="details-state">
            <mat-icon class="state-icon" fontIcon="folder" aria-hidden="true" />
            <h2>{{ state.selection.node.name }}</h2>
            <p>{{ state.selection.node.children?.length || 0 }} items</p>
          </div>
        } @else if (state.error) {
          <div class="panel">
            <header class="entity-header">
              <div class="entity-title">
                <span class="entity-kind">{{ kindLabel(state.selection.type) }}</span>
                <h2>{{ state.selection.node.name }}</h2>
              </div>
            </header>
            <section class="error-panel" role="alert">
              <mat-icon fontIcon="error" aria-hidden="true" />
              <div class="error-text">
                <h3>Could not load the {{ state.selection.type }} {{ state.selection.node.name }}</h3>
                <p>{{ state.error }}</p>
                <p>Nothing was read, and nothing on the broker was changed.</p>
                <button mat-stroked-button type="button" (click)="refresh()"><mat-icon fontIcon="refresh" />Retry</button>
              </div>
            </section>
          </div>
        } @else if (state.selection.type === 'topic' && state.selection.entity) {
          @let topicEntity = $any(state.selection.entity);
          <div class="panel">
            <header class="entity-header">
              <div class="entity-title">
                <span class="entity-kind">Topic</span>
                <h2>{{ topicEntity.name }}</h2>
              </div>
              <div class="entity-actions">
                <app-entity-admin-actions kind="topic" [entity]="topicEntity" />
              </div>
            </header>
            <section class="entity-properties" aria-labelledby="topic-properties-title">
              <h3 id="topic-properties-title">Properties</h3>
              <ng-container *ngTemplateOutlet="propertyTable; context: { $implicit: topicProperties(topicEntity) }" />
            </section>
          </div>
        } @else if (state.selection.type === 'queue' || state.selection.type === 'subscription') {
          @let isQueue = state.selection.type === 'queue';
          @let holder = $any(state.selection.entity);
          @if (holder) {
            <div class="panel">
              <header class="entity-header">
                <div class="entity-title">
                  <span class="entity-kind">@if (isQueue) {Queue} @else {Subscription in topic {{ holder.topicName }}}</span>
                  <h2>{{ holder.name || state.selection.node.name }}</h2>
                </div>
                <div class="entity-actions">
                  <app-entity-admin-actions [kind]="isQueue ? 'queue' : 'subscription'" [entity]="holder" />
                  <button mat-flat-button type="button" (click)="viewMessages()"><mat-icon fontIcon="visibility" />View Messages</button>
                  @if (isQueue) {
                    <button matButton="tonal" type="button" (click)="sendMessage()"><mat-icon fontIcon="send" />Send Message</button>
                  }
                  <button mat-icon-button type="button" [matMenuTriggerFor]="moreMenu" aria-label="More actions" matTooltip="More actions">
                    <mat-icon fontIcon="more_vert" />
                  </button>
                  <mat-menu #moreMenu="matMenu" xPosition="before" class="entity-more-menu">
                    @if (isQueue) {
                      <button mat-menu-item type="button" (click)="importMessages()">Import messages</button>
                      <mat-divider />
                    }
                    <div class="menu-caption">Cannot be undone</div>
                    @if (isQueue) {
                      <button mat-menu-item type="button" class="danger" (click)="purgeMessages('active')" [disabled]="holder.activeMessageCount === 0">
                        Purge active messages <span class="menu-count">{{ liveActiveCount() ?? holder.activeMessageCount | number }}</span>
                      </button>
                    } @else {
                      <button mat-menu-item type="button" class="danger" (click)="purgeMessages('active')" [disabled]="holder.activeMessageCount === 0">
                        Purge Active Messages <span class="menu-count">{{ liveActiveCount() ?? holder.activeMessageCount | number }}</span>
                      </button>
                      <button mat-menu-item type="button" class="danger" (click)="purgeMessages('deadletter')" [disabled]="holder.deadLetterMessageCount === 0">
                        Purge Dead-letter Messages <span class="menu-count">{{ liveDeadLetterCount() ?? holder.deadLetterMessageCount | number }}</span>
                      </button>
                      <button mat-menu-item type="button" class="danger" (click)="purgeMessages('all')" [disabled]="holder.activeMessageCount === 0 && holder.deadLetterMessageCount === 0">
                        Purge All Messages <span class="menu-count">{{ (liveActiveCount() ?? holder.activeMessageCount) + (liveDeadLetterCount() ?? holder.deadLetterMessageCount) | number }}</span>
                      </button>
                    }
                  </mat-menu>
                </div>
              </header>

              <div class="entity-stats">
                @if (isQueue) {
                  <div class="stat-card metric-card clickable" role="button" tabindex="0"
                    [attr.aria-label]="'View the ' + holder.activeMessageCount + ' active messages'"
                    (click)="viewMessages(0)"
                    (keydown.enter)="viewMessages(0)"
                    (keydown.space)="$event.preventDefault(); viewMessages(0)">
                    <span class="stat-label">Active Messages</span>
                    <span class="stat-value metric-value">{{ holder.activeMessageCount | number }}</span>
                    <span class="stat-note">Open the active messages</span>
                  </div>
                } @else {
                  <app-transfer-monitor class="live-card"
                    [topicName]="holder.topicName"
                    [subscriptionName]="holder.name"
                    (subscriptionUpdated)="onSubscriptionUpdated($event)"
                    (clicked)="viewMessages(0)" />
                }
                @if (supports('supportsDeadLetterQueue')) {
                  @let deadLetter = liveDeadLetterCount() ?? holder.deadLetterMessageCount;
                  <div class="dead-letter-card" [class.warning]="deadLetter > 0">
                    <div class="stat-card metric-card clickable" role="button" tabindex="0"
                      [attr.aria-label]="'View the ' + deadLetter + ' dead-letter messages'"
                      (click)="viewMessages(1)"
                      (keydown.enter)="viewMessages(1)"
                      (keydown.space)="$event.preventDefault(); viewMessages(1)">
                      <span class="stat-label">@if (deadLetter > 0) {<mat-icon class="label-icon" fontIcon="warning" aria-hidden="true" />}Dead Letter</span>
                      <span class="stat-value metric-value">{{ deadLetter | number }}</span>
                      <span class="stat-note">{{ deadLetter > 0 ? 'Open to resubmit or delete' : 'None waiting' }}</span>
                    </div>
                    @if (holder.deadLetterMessageCount > 0 || autoResubmitRun()) {
                      <button mat-stroked-button type="button" class="auto-resubmit" (click)="openAutoResubmit()">
                        <mat-icon fontIcon="replay" />@if (autoResubmitRun(); as run) {Resubmit {{ run.progress().status }}: {{ run.progress().read }} of {{ run.progress().total }}} @else {Auto Resubmit ({{ holder.deadLetterMessageCount }})}
                      </button>
                    }
                  </div>
                  @if (holder.transferDeadLetterMessageCount > 0) {
                    <div class="stat-card metric-card"
                      [class.clickable]="transferDeadLetterReachable()"
                      [attr.role]="transferDeadLetterReachable() ? 'button' : null"
                      [attr.tabindex]="transferDeadLetterReachable() ? 0 : null"
                      [attr.aria-label]="transferDeadLetterReachable() ? 'View the ' + holder.transferDeadLetterMessageCount + ' transfer dead-letter messages' : null"
                      (click)="openTransferDeadLetter()"
                      (keydown.enter)="openTransferDeadLetter()"
                      (keydown.space)="$event.preventDefault(); openTransferDeadLetter()">
                      <span class="stat-label">Transfer Dead Letter</span>
                      <span class="stat-value metric-value">{{ holder.transferDeadLetterMessageCount }}</span>
                      <span class="stat-note">Could not be forwarded</span>
                    </div>
                  }
                }
                @if (isQueue) {
                  @if (supports('supportsScheduledMessages')) {
                    <div class="stat-card metric-card clickable" role="button" tabindex="0"
                      [attr.aria-label]="'View the ' + holder.scheduledMessageCount + ' scheduled messages'"
                      (click)="viewMessages(0, 'Scheduled')"
                      (keydown.enter)="viewMessages(0, 'Scheduled')"
                      (keydown.space)="$event.preventDefault(); viewMessages(0, 'Scheduled')">
                      <span class="stat-label">Scheduled</span>
                      <span class="stat-value metric-value">{{ holder.scheduledMessageCount | number }}</span>
                      <span class="stat-note">Not yet deliverable</span>
                    </div>
                  }
                  <div class="stat-card metric-card">
                    <span class="stat-label">Size</span>
                    <span class="stat-value metric-value">{{ formatSize(holder.sizeInBytes) }}</span>
                    <span class="stat-note">{{ holder.maxSizeInMegabytes != null ? 'Max Size ' + holder.maxSizeInMegabytes + ' MB' : '' }}</span>
                  </div>
                }
              </div>

              @if (isQueue) {
                <mat-tab-group [selectedIndex]="queueTab()" (selectedIndexChange)="setQueueTab($event)" animationDuration="0ms" [preserveContent]="true" mat-stretch-tabs="false" mat-align-tabs="start">
                  <mat-tab label="Properties">
                    <ng-container *ngTemplateOutlet="propertyTable; context: { $implicit: queueProperties(holder) }" />
                  </mat-tab>
                  @if (holder.requiresSession && supports('supportsSessions')) {
                    <mat-tab label="Sessions">
                      <ng-template matTabContent>
                        @if (sessionsOpened()) {
                          <app-entity-sessions [entity]="{ queueName: holder.name }" />
                        }
                      </ng-template>
                    </mat-tab>
                  }
                </mat-tab-group>
              } @else {
                @let hasSessions = holder.requiresSession && supports('supportsSessions');
                <nav mat-tab-nav-bar [tabPanel]="subscriptionPanel" animationDuration="0ms" aria-label="Sections of the subscription" mat-stretch-tabs="false" mat-align-tabs="start">
                  <button mat-tab-link type="button" [active]="activeSubscriptionTab() === 'description'" (click)="setSubscriptionTab('description')">Description</button>
                  @if (hasSessions) {
                    <button mat-tab-link type="button" [active]="activeSubscriptionTab() === 'sessions'" (click)="setSubscriptionTab('sessions')">Sessions</button>
                  }
                  <button mat-tab-link type="button" [active]="activeSubscriptionTab() === 'rules'" (click)="setSubscriptionTab('rules')">Rules</button>
                </nav>
                <mat-tab-nav-panel #subscriptionPanel>
                  <div [hidden]="activeSubscriptionTab() !== 'description'" id="subscription-description-tab">
                    <ng-container *ngTemplateOutlet="propertyTable; context: { $implicit: subscriptionProperties(holder) }" />
                  </div>
                  <div [hidden]="activeSubscriptionTab() !== 'rules'" id="subscription-rules-tab">
                    <app-subscription-rules [subscription]="holder" />
                  </div>
                  @if (hasSessions && sessionsOpened()) {
                    <div [hidden]="activeSubscriptionTab() !== 'sessions'">
                      <app-entity-sessions [entity]="{ topicName: holder.topicName, subscriptionName: holder.name }" />
                    </div>
                  }
                </mat-tab-nav-panel>
              }
            </div>
          } @else if (!isQueue) {
            <div class="details-state" role="status">
              <mat-progress-spinner mode="indeterminate" diameter="32" aria-hidden="true" />
              <p>Loading subscription details...</p>
            </div>
          }
        }
      }
    </div>
  `,
  styleUrl: './entity-details.component.scss'
})
export class EntityDetailsComponent {
  private selectionService = inject(EntitySelectionService);
  private connectionService = inject(ConnectionService);
  private queueService = inject(QueueService);
  private topicService = inject(TopicService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly providerService = inject(ProviderService);
  private readonly resubmitRuns = inject(ResubmitRunService);

  readonly notSet = NOT_SET;

  // Live subscription counts (updated by TransferMonitorComponent polling)
  liveActiveCount = signal<number | null>(null);
  liveDeadLetterCount = signal<number | null>(null);

  // Tab navigation state
  activeSubscriptionTab = signal<'description' | 'rules' | 'sessions'>('description');
  queueTab = signal(0);
  /** The Sessions tab was opened for the entity shown; its list is kept until another entity or a reload. */
  sessionsOpened = signal(false);
  private shownEntityKey: string | null = null;

  // Description tab style selector
  descriptionStyle: 'cards' | 'infobox' | 'list' | 'hybrid' = 'cards';

  // Use observables directly with async pipe
  state$ = this.selectionService.state$;

  constructor() {
    this.state$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(state => {
      const key = state.selection ? `${state.selection.type}/${state.selection.node?.id}` : null;
      if (state.loading || key !== this.shownEntityKey) this.sessionsOpened.set(false);
      this.shownEntityKey = key;
      // Reset tabs and live counts when entity changes
      this.activeSubscriptionTab.set('description');
      this.queueTab.set(0);
      this.liveActiveCount.set(null);
      this.liveDeadLetterCount.set(null);
    });
  }

  /** False only when the connected broker declares it lacks the feature. */
  supports(feature: keyof ProviderCapabilities): boolean {
    return this.providerService.capabilities()?.[feature] !== false;
  }

  /** The transfer dead-letter queue opens only when the API itself said it supports it. */
  transferDeadLetterReachable(): boolean {
    return this.providerService.capabilities()?.supportsTransferDeadLetter === true;
  }

  openTransferDeadLetter() {
    if (this.transferDeadLetterReachable()) {
      this.viewMessages(2);
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

  kindLabel(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  /** The rows in two columns, the first one longer when the count is odd. */
  halves(rows: PropertyRow[]): PropertyRow[][] {
    const half = Math.ceil(rows.length / 2);
    return [rows.slice(0, half), rows.slice(half)];
  }

  queueProperties(queue: QueueInfo): PropertyRow[] {
    return [
      ['Max Delivery Count', queue.maxDeliveryCount != null ? String(queue.maxDeliveryCount) : NOT_SET],
      ['Lock Duration', this.formatDuration(queue.lockDuration)],
      ['Message TTL', this.formatDuration(queue.defaultMessageTimeToLive)],
      ['Max Size', queue.maxSizeInMegabytes != null ? `${queue.maxSizeInMegabytes} MB` : NOT_SET],
      ['Requires Session', queue.requiresSession ? 'Yes' : 'No'],
      ['Partitioning', queue.enablePartitioning ? 'Enabled' : 'Disabled'],
      ['Status', queue.status || NOT_SET],
      ['Dead-lettering On Expiration', this.enabledText(queue.deadLetteringOnMessageExpiration)],
      ['Auto Delete On Idle', this.formatDuration(queue.autoDeleteOnIdle)],
      ['Forward To', queue.forwardTo || NOT_SET],
      ['Forward Dead-lettered To', queue.forwardDeadLetteredMessagesTo || NOT_SET],
      ['Duplicate Detection', this.duplicateDetectionText(queue)],
      ['User Metadata', queue.userMetadata || NOT_SET],
      ['Created At (UTC)', this.formatDate(queue.createdAt)],
      ['Updated At (UTC)', this.formatDate(queue.updatedAt)],
      ['Accessed At (UTC)', this.formatDate(queue.accessedAt)]
    ];
  }

  topicProperties(topic: TopicInfo): PropertyRow[] {
    return [
      ['Status', topic.status || NOT_SET],
      ['Max Size', topic.maxSizeInMegabytes != null ? `${topic.maxSizeInMegabytes} MB` : NOT_SET],
      ['Message Time To Live', this.formatDuration(topic.defaultMessageTimeToLive)],
      ['Auto Delete On Idle', this.formatDuration(topic.autoDeleteOnIdle)],
      ['Duplicate Detection', this.duplicateDetectionText(topic)],
      ['Batched Operations', this.enabledText(topic.enableBatchedOperations)],
      ['Partitioning', this.enabledText(topic.enablePartitioning)],
      ['Support Ordering', this.enabledText(topic.supportOrdering)],
      ['User Metadata', topic.userMetadata || NOT_SET],
      ['Created At (UTC)', this.formatDate(topic.createdAt)],
      ['Updated At (UTC)', this.formatDate(topic.updatedAt)],
      ['Accessed At (UTC)', this.formatDate(topic.accessedAt)]
    ];
  }

  subscriptionProperties(subscription: SubscriptionInfo): PropertyRow[] {
    const yesNo = (value: boolean | null | undefined) => value == null ? NOT_SET : value ? 'Yes' : 'No';
    return [
      ['Topic Name', subscription.topicName || NOT_SET],
      ['Lock Duration', this.formatDuration(subscription.lockDuration)],
      ['Max Delivery Count', subscription.maxDeliveryCount != null ? String(subscription.maxDeliveryCount) : NOT_SET],
      ['Default Message Time To Live', this.formatDuration(subscription.defaultMessageTimeToLive)],
      ['Auto Delete On Idle', this.formatDuration(subscription.autoDeleteOnIdle)],
      ['Forward To', subscription.forwardTo || NOT_SET],
      ['Forward Dead-lettered Messages To', subscription.forwardDeadLetteredMessagesTo || NOT_SET],
      ['Status', subscription.status || NOT_SET],
      ['Enable Sessions', yesNo(subscription.requiresSession)],
      ['Enable Dead Lettering On Message Expiration', yesNo(subscription.deadLetteringOnMessageExpiration)],
      ['Enable Dead Lettering On Filter Evaluation Exceptions', yesNo(subscription.deadLetteringOnFilterEvaluationExceptions)],
      ['Enable Batched Operations', yesNo(subscription.enableBatchedOperations)],
      ['User Metadata', subscription.userMetadata || NOT_SET],
      ['Created At (UTC)', this.formatDate(subscription.createdAt)],
      ['Updated At (UTC)', this.formatDate(subscription.updatedAt)],
      ['Accessed At (UTC)', this.formatDate(subscription.accessedAt)]
    ];
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

  viewMessages(initialTab?: number, initialStateFilter?: 'Scheduled') {
    if (!this.selection) return;

    let entityType: 'queue' | 'subscription';
    let entityName: string;
    let topicName: string | undefined;
    let activeMessageCount: number | undefined;
    let deadLetterMessageCount: number | undefined;
    let transferDeadLetterMessageCount: number | undefined;

    if (this.selection.type === 'queue') {
      entityType = 'queue';
      entityName = this.selection.node.name;
      const queueEntity = this.selection.entity as QueueInfo;
      activeMessageCount = queueEntity?.activeMessageCount;
      deadLetterMessageCount = queueEntity?.deadLetterMessageCount;
      transferDeadLetterMessageCount = queueEntity?.transferDeadLetterMessageCount;
    } else if (this.selection.type === 'subscription') {
      entityType = 'subscription';
      entityName = this.selection.node.name;
      const subscriptionEntity = this.selection.entity as SubscriptionInfo;
      topicName = subscriptionEntity?.topicName;
      activeMessageCount = subscriptionEntity?.activeMessageCount;
      deadLetterMessageCount = subscriptionEntity?.deadLetterMessageCount;
      transferDeadLetterMessageCount = subscriptionEntity?.transferDeadLetterMessageCount;
    } else {
      return;
    }

    this.dialog.open(ViewMessagesDialogComponent, {
      width: '95vw',
      maxWidth: '1400px',
      height: '90vh',
      data: { entityType, entityName, topicName, activeMessageCount, deadLetterMessageCount, transferDeadLetterMessageCount, initialTab, initialStateFilter }
    });
  }

  /** The automatic dead-letter resubmit running or paused on the selected queue or subscription. */
  autoResubmitRun(): ResubmitRun | undefined {
    const selection = this.selection;
    if (!selection || (selection.type !== 'queue' && selection.type !== 'subscription')) return undefined;
    const run = this.resubmitRuns.find({
      entityType: selection.type,
      entityName: selection.node.name,
      topicName: selection.type === 'subscription' ? (selection.node.data as SubscriptionNodeData)?.topicName : undefined,
      subQueue: 'deadletter'
    });
    return run?.isActive() ? run : undefined;
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
    if (tab === 'sessions') this.sessionsOpened.set(true);
  }

  setQueueTab(index: number) {
    this.queueTab.set(index);
    if (index === 1) this.sessionsOpened.set(true);
  }
}
