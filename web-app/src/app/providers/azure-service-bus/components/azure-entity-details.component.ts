import { Component, Input, Output, EventEmitter, OnInit, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { IProviderEntityDetailsComponent, EntityInfo, EntityAction } from '../../../core/models/provider-component.interface';
import { ServiceBusConnection } from '../../../core/models/connection.model';
import { QueueInfo, isAzureQueue } from '../../../core/models/queue.model';
import { TopicInfo, SubscriptionInfo, isAzureTopic } from '../../../core/models/topic.model';
import { EntitySelectionService } from '../../../core/services/entity-selection.service';

/**
 * Azure Service Bus entity details component.
 * Displays Azure-specific properties for queues, topics, and subscriptions.
 *
 * This component implements the IProviderEntityDetailsComponent interface
 * and is dynamically loaded by the ProviderShellComponent when an
 * Azure Service Bus connection is active.
 *
 * @example
 * ```typescript
 * // Dynamically loaded via ProviderShellComponent
 * <app-provider-shell [entity]="selectedEntity" [connection]="activeConnection"></app-provider-shell>
 * ```
 */
@Component({
  selector: 'app-azure-entity-details',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatDialogModule
  ],
  templateUrl: './azure-entity-details.component.html',
  styleUrls: ['./azure-entity-details.component.scss']
})
export class AzureEntityDetailsComponent implements IProviderEntityDetailsComponent, OnInit {
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private destroyRef = inject(DestroyRef);
  private entitySelectionService = inject(EntitySelectionService);

  /**
   * The entity to display (queue, topic, or subscription).
   * Type guards are used to narrow to specific Azure entity types.
   */
  @Input() entity!: EntityInfo;

  /**
   * The active Azure Service Bus connection.
   */
  @Input() connection!: ServiceBusConnection;

  /**
   * Emits when the entity should be refreshed.
   */
  @Output() onRefresh = new EventEmitter<void>();

  /**
   * Emits when an action is performed on the entity.
   */
  @Output() onAction = new EventEmitter<EntityAction>();

  ngOnInit(): void {
    // Validate that the entity is an Azure entity
    if (!this.isAzureEntity()) {
      console.error('AzureEntityDetailsComponent received non-Azure entity:', this.entity);
    }
  }

  /**
   * Type guard to check if this is an Azure entity.
   */
  private isAzureEntity(): boolean {
    return isAzureQueue(this.entity as QueueInfo) || isAzureTopic(this.entity as TopicInfo);
  }

  /**
   * Checks if the current entity is a queue.
   * Must exclude subscriptions which also have activeMessageCount and requiresSession.
   */
  isQueue(): boolean {
    return 'activeMessageCount' in this.entity && 'requiresSession' in this.entity && !('topicName' in this.entity);
  }

  /**
   * Checks if the current entity is a topic.
   */
  isTopic(): boolean {
    return 'subscriptionCount' in this.entity;
  }

  /**
   * Checks if the current entity is a subscription.
   */
  isSubscription(): boolean {
    return 'topicName' in this.entity;
  }

  /**
   * Gets the entity as a QueueInfo.
   */
  asQueue(): QueueInfo {
    return this.entity as QueueInfo;
  }

  /**
   * Gets the entity as a TopicInfo.
   */
  asTopic(): TopicInfo {
    return this.entity as TopicInfo;
  }

  /**
   * Gets the entity as a SubscriptionInfo.
   */
  asSubscription(): SubscriptionInfo {
    return this.entity as SubscriptionInfo;
  }

  /**
   * Handles the send message action.
   */
  handleSendMessage(): void {
    this.onAction.emit({
      actionType: 'send',
      entity: this.entity
    });
  }

  /**
   * Handles the view messages action.
   */
  handleViewMessages(queueType: number = 0): void {
    this.onAction.emit({
      actionType: 'peek',
      entity: this.entity,
      payload: { queueType }
    });
  }

  /**
   * Handles the purge messages action.
   */
  handlePurgeMessages(): void {
    this.onAction.emit({
      actionType: 'purge',
      entity: this.entity
    });
  }

  /**
   * Handles the delete entity action.
   */
  handleDelete(): void {
    this.onAction.emit({
      actionType: 'delete',
      entity: this.entity
    });
  }

  /**
   * Handles the refresh entity action.
   */
  handleRefresh(): void {
    this.onRefresh.emit();
  }

  /**
   * Formats a size in bytes to a human-readable string.
   */
  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Parses an ISO 8601 duration string into components.
   * Handles Azure Service Bus duration format: "P[n]DT[n]H[n]M[n]S" or "P[n]Y[n]M[n]DT[n]H[n]M[n]S"
   */
  parseDuration(duration: string): { days: number; hours: number; minutes: number; seconds: number; milliseconds: number } {
    if (!duration || duration === 'Max Value' || duration === 'PT0S') {
      return { days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };
    }

    const result = { days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };

    try {
      // Match ISO 8601 duration format
      const daysMatch = duration.match(/(\d+)D/);
      const hoursMatch = duration.match(/(\d+)H/);
      const minutesMatch = duration.match(/(\d+)M(?!S)/); // Match M not followed by S
      const secondsMatch = duration.match(/(\d+(?:\.\d+)?)S/);

      if (daysMatch) result.days = parseInt(daysMatch[1], 10);
      if (hoursMatch) result.hours = parseInt(hoursMatch[1], 10);
      if (minutesMatch) result.minutes = parseInt(minutesMatch[1], 10);

      if (secondsMatch) {
        const seconds = parseFloat(secondsMatch[1]);
        result.seconds = Math.floor(seconds);
        result.milliseconds = Math.round((seconds - result.seconds) * 1000);
      }
    } catch (e) {
      console.error('Failed to parse duration:', duration, e);
    }

    return result;
  }

  /**
   * Formats a date to a locale string.
   */
  formatDate(date: Date): string {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString();
  }

  /**
   * Gets the display name for the entity type.
   */
  getEntityTypeName(): string {
    if (this.isQueue()) return 'Queue';
    if (this.isTopic()) return 'Topic';
    if (this.isSubscription()) return 'Subscription';
    return 'Entity';
  }

  /**
   * Gets the display name for the entity.
   */
  getEntityName(): string {
    if (this.isSubscription()) {
      const sub = this.asSubscription();
      return `${sub.topicName}/${sub.name}`;
    }
    return (this.entity as any).name || 'Unknown';
  }

  navigateToSubscription(topicName: string, subscriptionName: string): void {
    this.entitySelectionService.navigateToSubscription(topicName, subscriptionName);
  }
}
