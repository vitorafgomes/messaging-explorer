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
import { QueueInfo, isRabbitMQQueue } from '../../../core/models/queue.model';
import { TopicInfo, isRabbitMQExchange, BindingInfo } from '../../../core/models/topic.model';

/**
 * RabbitMQ entity details component.
 * Displays RabbitMQ-specific properties for queues and exchanges.
 *
 * This component implements the IProviderEntityDetailsComponent interface
 * and is dynamically loaded by the ProviderShellComponent when a
 * RabbitMQ connection is active.
 *
 * @example
 * ```typescript
 * // Dynamically loaded via ProviderShellComponent
 * <app-provider-shell [entity]="selectedEntity" [connection]="activeConnection"></app-provider-shell>
 * ```
 */
@Component({
  selector: 'app-rabbitmq-entity-details',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatDialogModule
  ],
  templateUrl: './rabbitmq-entity-details.component.html',
  styleUrls: ['./rabbitmq-entity-details.component.scss']
})
export class RabbitMQEntityDetailsComponent implements IProviderEntityDetailsComponent, OnInit {
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private destroyRef = inject(DestroyRef);

  // Expose Object.keys for use in templates
  readonly objectKeys = Object.keys;

  /**
   * The entity to display (queue or exchange).
   * Type guards are used to narrow to specific RabbitMQ entity types.
   */
  @Input() entity!: EntityInfo;

  /**
   * The active RabbitMQ connection.
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
    // Validate that the entity is a RabbitMQ entity
    if (!this.isRabbitMQEntity()) {
      console.error('RabbitMQEntityDetailsComponent received non-RabbitMQ entity:', this.entity);
    }
  }

  /**
   * Type guard to check if this is a RabbitMQ entity.
   */
  private isRabbitMQEntity(): boolean {
    return isRabbitMQQueue(this.entity as QueueInfo) || isRabbitMQExchange(this.entity as TopicInfo);
  }

  /**
   * Checks if the current entity is a queue.
   */
  isQueue(): boolean {
    return isRabbitMQQueue(this.entity as QueueInfo);
  }

  /**
   * Checks if the current entity is an exchange.
   */
  isExchange(): boolean {
    return isRabbitMQExchange(this.entity as TopicInfo);
  }

  /**
   * Gets the entity as a QueueInfo.
   */
  asQueue(): QueueInfo {
    return this.entity as QueueInfo;
  }

  /**
   * Gets the entity as a TopicInfo (Exchange).
   */
  asExchange(): TopicInfo {
    return this.entity as TopicInfo;
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
   * Formats a TTL in milliseconds to a human-readable string.
   */
  formatTTL(milliseconds: number | undefined): string {
    if (!milliseconds || milliseconds === 0) return 'Not Set';

    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
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
    if (this.isExchange()) return 'Exchange';
    return 'Entity';
  }

  /**
   * Gets the display name for the entity.
   */
  getEntityName(): string {
    return (this.entity as any).name || 'Unknown';
  }

  /**
   * Gets a display-friendly exchange type label.
   */
  getExchangeTypeDisplay(exchangeType: string | undefined): string {
    if (!exchangeType) return 'Unknown';

    const typeMap: Record<string, string> = {
      'direct': 'Direct',
      'fanout': 'Fanout',
      'topic': 'Topic',
      'headers': 'Headers'
    };
    return typeMap[exchangeType.toLowerCase()] ?? exchangeType;
  }

  /**
   * Gets a display-friendly queue type label.
   */
  getQueueTypeDisplay(queueType: string | undefined): string {
    if (!queueType) return 'Classic';

    const typeMap: Record<string, string> = {
      'classic': 'Classic',
      'quorum': 'Quorum',
      'stream': 'Stream'
    };
    return typeMap[queueType.toLowerCase()] ?? queueType;
  }

  /**
   * Formats the overflow behavior for display.
   */
  formatOverflowBehavior(behavior: string | undefined): string {
    if (!behavior) return 'Not Set';

    const behaviorMap: Record<string, string> = {
      'drop-head': 'Drop Head',
      'reject-publish': 'Reject Publish',
      'reject-publish-dlx': 'Reject Publish (DLX)'
    };
    return behaviorMap[behavior] ?? behavior;
  }
}
