import { EventEmitter } from '@angular/core';
import { ServiceBusConnection } from './connection.model';
import { QueueInfo } from './queue.model';
import { TopicInfo, SubscriptionInfo } from './topic.model';

/**
 * Union type for all entity types across messaging providers.
 * Includes Azure Service Bus entities (queues, topics, subscriptions) and
 * RabbitMQ entities (queues, exchanges, bindings).
 *
 * Provider-specific components should use type guards to narrow to specific entity types.
 */
export type EntityInfo = QueueInfo | TopicInfo | SubscriptionInfo;

/**
 * Represents an action performed on a messaging entity.
 * Used to communicate entity operations from provider components to container components.
 */
export interface EntityAction {
  /** The type of action being performed */
  actionType: 'delete' | 'purge' | 'peek' | 'send' | 'refresh' | 'subscribe' | 'unsubscribe';

  /** The entity on which the action is performed */
  entity: EntityInfo;

  /** Optional payload data specific to the action type */
  payload?: any;
}

/**
 * Standard interface contract for all provider-specific entity detail components.
 *
 * This interface ensures a consistent API across all messaging providers,
 * enabling dynamic component loading via ProviderShellComponent.
 * All provider implementations (Azure Service Bus, RabbitMQ, Kafka, etc.)
 * must implement this interface to be compatible with the provider registry.
 *
 * @example
 * ```typescript
 * @Component({
 *   selector: 'app-azure-entity-details',
 *   standalone: true,
 *   templateUrl: './azure-entity-details.component.html'
 * })
 * export class AzureEntityDetailsComponent implements IProviderEntityDetailsComponent {
 *   @Input() entity!: EntityInfo;
 *   @Input() connection!: ServiceBusConnection;
 *   @Output() onRefresh = new EventEmitter<void>();
 *   @Output() onAction = new EventEmitter<EntityAction>();
 *
 *   // Azure-specific implementation...
 * }
 * ```
 */
export interface IProviderEntityDetailsComponent {
  /**
   * The entity to display (queue, topic, exchange, subscription, etc.).
   * Provider components should use type guards to narrow to specific entity types.
   *
   * @example
   * ```typescript
   * if (isAzureQueue(this.entity)) {
   *   // Access Azure-specific queue properties
   *   const requiresSession = this.entity.requiresSession;
   * }
   * ```
   */
  entity: EntityInfo;

  /**
   * The active connection configuration.
   * Note: ServiceBusConnection is a legacy name from when only Azure Service Bus
   * was supported. It now represents connections for all messaging providers.
   * Use the providerType property to determine the actual provider.
   */
  connection: ServiceBusConnection;

  /**
   * Event emitted when the entity should be refreshed.
   * The parent container should handle this by reloading entity data from the backend.
   */
  onRefresh: EventEmitter<void>;

  /**
   * Event emitted when an action is performed on the entity.
   * Examples: delete, purge, peek messages, send message, etc.
   * The parent container should handle the action and update state accordingly.
   */
  onAction: EventEmitter<EntityAction>;
}
