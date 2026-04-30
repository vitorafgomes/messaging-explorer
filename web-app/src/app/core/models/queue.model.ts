import { ProviderType } from './provider.model';

/**
 * Queue entity information supporting multiple messaging providers.
 * Contains common properties from IQueueEntity abstraction plus provider-specific extensions.
 */
export interface QueueInfo {
  // IMessagingEntity base properties (common across all providers)
  name: string;
  sizeInBytes: number;
  createdAt: Date;
  updatedAt: Date;
  accessedAt: Date;
  status: string;
  enablePartitioning: boolean;

  // IQueueEntity properties (common queue properties across providers)
  activeMessageCount: number;
  deadLetterMessageCount: number;
  scheduledMessageCount: number;
  transferMessageCount: number;
  defaultMessageTimeToLive: string;
  lockDuration: string;
  maxDeliveryCount: number;
  maxSizeInMegabytes: number;
  requiresSession: boolean;
  deadLetteringOnMessageExpiration: boolean;

  // Provider identification (optional for backward compatibility)
  providerType?: ProviderType;

  // RabbitMQ-specific optional properties
  /** The virtual host where this queue is located (RabbitMQ). */
  virtualHost?: string;
  /** Indicates whether the queue is durable - survives broker restart (RabbitMQ). */
  durable?: boolean;
  /** Indicates whether the queue will be automatically deleted when no longer in use (RabbitMQ). */
  autoDelete?: boolean;
  /** Indicates whether the queue is exclusive to the connection that created it (RabbitMQ). */
  exclusive?: boolean;
  /** The number of consumers currently consuming from this queue (RabbitMQ). */
  consumerCount?: number;
  /** The number of messages in the queue that are ready to be delivered (RabbitMQ). */
  messagesReady?: number;
  /** The number of messages in the queue that are currently being delivered to consumers (RabbitMQ). */
  messagesUnacknowledged?: number;
  /** The total number of messages in the queue - ready + unacknowledged (RabbitMQ). */
  totalMessages?: number;
  /** The name of the dead letter exchange (DLX) configured for this queue (RabbitMQ). */
  deadLetterExchange?: string;
  /** The routing key used when dead-lettering messages to the DLX (RabbitMQ). */
  deadLetterRoutingKey?: string;
  /** The message TTL in milliseconds for all messages in this queue (RabbitMQ). */
  messageTtlMilliseconds?: number;
  /** The maximum length (number of messages) for this queue (RabbitMQ). */
  maxLength?: number;
  /** The maximum length in bytes for this queue (RabbitMQ). */
  maxLengthBytes?: number;
  /** The overflow behavior when the queue reaches its maximum length (RabbitMQ). Values: "drop-head", "reject-publish", "reject-publish-dlx". */
  overflowBehavior?: string;
  /** The queue type (RabbitMQ). Values: "classic", "quorum", "stream". */
  queueType?: string;
  /** The message delivery rate per second (RabbitMQ). */
  messageRateDeliver?: number;
  /** The message publish rate per second (RabbitMQ). */
  messageRatePublish?: number;
  /** The node where this queue is located (RabbitMQ). */
  node?: string;
  /** The state of the queue (RabbitMQ). Values: "running", "idle", "flow". */
  state?: string;
  /** Queue arguments/options as key-value pairs (RabbitMQ). */
  arguments?: Record<string, unknown>;
}

/**
 * Helper type guard to check if queue is from Azure Service Bus.
 */
export function isAzureQueue(queue: QueueInfo): boolean {
  return queue.providerType === ProviderType.AzureServiceBus || queue.providerType === undefined;
}

/**
 * Helper type guard to check if queue is from RabbitMQ.
 */
export function isRabbitMQQueue(queue: QueueInfo): boolean {
  return queue.providerType === ProviderType.RabbitMQ;
}

/**
 * Gets a display-friendly count of total messages for a queue.
 * Handles differences between Azure (activeMessageCount) and RabbitMQ (totalMessages).
 */
export function getQueueTotalMessageCount(queue: QueueInfo): number {
  if (isRabbitMQQueue(queue) && queue.totalMessages !== undefined) {
    return queue.totalMessages;
  }
  return queue.activeMessageCount;
}

/**
 * Gets a display-friendly description of the dead letter configuration for a queue.
 */
export function getQueueDeadLetterDescription(queue: QueueInfo): string | null {
  if (isRabbitMQQueue(queue)) {
    if (queue.deadLetterExchange) {
      const routingKey = queue.deadLetterRoutingKey ? ` (${queue.deadLetterRoutingKey})` : '';
      return `DLX: ${queue.deadLetterExchange}${routingKey}`;
    }
    return null;
  }
  // Azure Service Bus has built-in dead letter queue
  return queue.deadLetteringOnMessageExpiration ? 'Enabled' : 'Disabled';
}
