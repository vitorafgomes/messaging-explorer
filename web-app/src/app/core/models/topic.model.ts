import { ProviderType } from './provider.model';

/**
 * Topic/Exchange entity information supporting multiple messaging providers.
 * For Azure Service Bus, this represents a Topic with Subscriptions.
 * For RabbitMQ, this represents an Exchange with Bindings.
 */
export interface TopicInfo {
  // IMessagingEntity base properties (common across all providers)
  name: string;
  sizeInBytes: number;
  createdAt: Date;
  updatedAt: Date;
  accessedAt: Date;
  status: string;
  enablePartitioning: boolean;

  // ITopicEntity properties (common topic/exchange properties across providers)
  subscriptionCount: number;
  scheduledMessageCount: number;
  defaultMessageTimeToLive: string;
  autoDeleteOnIdle: string;
  duplicateDetectionHistoryTimeWindow: string;
  maxSizeInMegabytes: number;
  maxMessageSizeInKilobytes: number;
  requiresDuplicateDetection: boolean;
  enableBatchedOperations: boolean;
  supportOrdering: boolean;
  enableExpress: boolean;
  userMetadata: string;

  // Azure Service Bus subscriptions or RabbitMQ bindings
  subscriptions: SubscriptionInfo[];

  // UI state
  expanded?: boolean;

  // Provider identification (optional for backward compatibility)
  providerType?: ProviderType;

  // RabbitMQ-specific optional properties (for Exchanges)
  /** The virtual host where this exchange is located (RabbitMQ). */
  virtualHost?: string;
  /** The type of the exchange (RabbitMQ). Values: "direct", "fanout", "topic", "headers". */
  exchangeType?: string;
  /** Indicates whether the exchange is durable - survives broker restart (RabbitMQ). */
  durable?: boolean;
  /** Indicates whether the exchange will be automatically deleted when no longer in use (RabbitMQ). */
  autoDelete?: boolean;
  /** Indicates whether this is an internal exchange - cannot receive messages directly from clients (RabbitMQ). */
  internal?: boolean;
  /** The message delivery rate per second (RabbitMQ). */
  messageRateIn?: number;
  /** The message publish rate per second (RabbitMQ). */
  messageRateOut?: number;
  /** The number of queues bound to this exchange (RabbitMQ). */
  boundQueueCount?: number;
  /** The alternate exchange for unroutable messages (RabbitMQ). */
  alternateExchange?: string;
  /** Exchange arguments/options as key-value pairs (RabbitMQ). */
  arguments?: Record<string, unknown>;
  /** The bindings associated with this exchange (RabbitMQ). */
  bindings?: BindingInfo[];
  /** Detected messaging pattern for this exchange (RabbitMQ). */
  detectedPattern?: PatternDetectionResult;
  /** Secondary patterns that may also apply to this exchange (RabbitMQ). */
  secondaryPatterns?: PatternDetectionResult[];
}

/**
 * Subscription information for Azure Service Bus.
 * In RabbitMQ, subscriptions map to queue bindings (represented as BindingInfo).
 */
export interface SubscriptionInfo {
  topicName: string;
  name: string;
  activeMessageCount: number;
  deadLetterMessageCount: number;
  transferMessageCount: number;
  scheduledMessageCount: number;
  transferDeadLetterMessageCount: number;
  createdAt: Date;
  updatedAt: Date;
  accessedAt: Date;
  defaultMessageTimeToLive: string;
  autoDeleteOnIdle: string;
  lockDuration: string;
  maxDeliveryCount: number;
  requiresSession: boolean;
  deadLetteringOnMessageExpiration: boolean;
  deadLetteringOnFilterEvaluationExceptions: boolean;
  enableBatchedOperations: boolean;
  status: string;
  userMetadata?: string;
  forwardTo?: string;
  forwardDeadLetteredMessagesTo?: string;
  rules: SubscriptionRuleInfo[];

  // Provider identification (optional for backward compatibility)
  providerType?: ProviderType;
}

/**
 * Subscription rule information for Azure Service Bus filtering.
 */
export interface SubscriptionRuleInfo {
  name: string;
  filterType: string;
  filterExpression?: string;
  actionExpression?: string;
  correlationProperties?: Record<string, unknown>;
}

/**
 * Binding information for RabbitMQ.
 * Represents a binding connecting an exchange to a queue or another exchange.
 */
export interface BindingInfo {
  /** The source exchange name. */
  source: string;
  /** The destination (queue or exchange name). */
  destination: string;
  /** The type of destination. Values: "queue", "exchange". */
  destinationType: string;
  /** The routing key used for this binding. */
  routingKey: string;
  /** The virtual host where this binding is located. */
  virtualHost: string;
  /** Binding arguments/options as key-value pairs. Used for header exchange bindings. */
  arguments?: Record<string, unknown>;
  /** A unique key that identifies this binding (for use in API operations). */
  propertiesKey?: string;
}

/**
 * Helper type guard to check if topic/exchange is from Azure Service Bus.
 */
export function isAzureTopic(topic: TopicInfo): boolean {
  return topic.providerType === ProviderType.AzureServiceBus || topic.providerType === undefined;
}

/**
 * Helper type guard to check if topic/exchange is from RabbitMQ (Exchange).
 */
export function isRabbitMQExchange(topic: TopicInfo): boolean {
  return topic.providerType === ProviderType.RabbitMQ;
}

/**
 * Gets a display-friendly label for the entity type based on provider.
 * Azure: "Topic", RabbitMQ: "Exchange"
 */
export function getTopicEntityLabel(topic: TopicInfo): string {
  return isRabbitMQExchange(topic) ? 'Exchange' : 'Topic';
}

/**
 * Gets a display-friendly label for subscriptions/bindings based on provider.
 * Azure: "Subscriptions", RabbitMQ: "Bindings"
 */
export function getSubscriptionsLabel(topic: TopicInfo): string {
  return isRabbitMQExchange(topic) ? 'Bindings' : 'Subscriptions';
}

/**
 * Gets the count of subscriptions or bindings.
 */
export function getSubscriptionOrBindingCount(topic: TopicInfo): number {
  if (isRabbitMQExchange(topic)) {
    return topic.bindings?.length ?? topic.boundQueueCount ?? 0;
  }
  return topic.subscriptionCount;
}

/**
 * RabbitMQ/AMQP messaging patterns from official tutorials.
 * Reference: https://www.rabbitmq.com/tutorials
 */
export enum MessagingPattern {
  /** No specific pattern detected or pattern cannot be determined. */
  None = 0,
  /** Hello World: Single producer, single queue, single consumer. */
  HelloWorld = 1,
  /** Work Queues (Task Queue): Multiple consumers competing for messages. */
  WorkQueue = 2,
  /** Publish/Subscribe: Fanout exchange broadcasting to multiple queues. */
  PubSub = 3,
  /** Routing: Direct exchange with selective message routing. */
  Routing = 4,
  /** Topics: Topic exchange with wildcard routing patterns. */
  Topics = 5,
  /** RPC (Request/Reply): Two queues for bidirectional communication. */
  RPC = 6,
  /** Publisher Confirms: Reliable publishing with acknowledgments. */
  PublisherConfirms = 7
}

/**
 * Pattern detection result with confidence scoring.
 */
export interface PatternDetectionResult {
  /** The detected messaging pattern. */
  pattern: MessagingPattern;
  /** Confidence score (0.0 to 1.0) indicating detection accuracy. */
  confidence: number;
  /** Human-readable explanation of why this pattern was detected. */
  reason: string;
  /** Additional metadata about the pattern characteristics. */
  metadata?: Record<string, unknown>;
}

/**
 * Gets a display-friendly description of the exchange type (RabbitMQ only).
 */
export function getExchangeTypeDisplay(topic: TopicInfo): string | null {
  if (!isRabbitMQExchange(topic) || !topic.exchangeType) {
    return null;
  }
  const typeMap: Record<string, string> = {
    'direct': 'Direct',
    'fanout': 'Fanout',
    'topic': 'Topic',
    'headers': 'Headers'
  };
  return typeMap[topic.exchangeType.toLowerCase()] ?? topic.exchangeType;
}

/**
 * Gets a display-friendly name for a messaging pattern.
 */
export function getPatternDisplay(pattern: MessagingPattern): string {
  const patternMap: Record<MessagingPattern, string> = {
    [MessagingPattern.None]: 'None',
    [MessagingPattern.HelloWorld]: 'Hello World',
    [MessagingPattern.WorkQueue]: 'Work Queue',
    [MessagingPattern.PubSub]: 'Pub/Sub',
    [MessagingPattern.Routing]: 'Routing',
    [MessagingPattern.Topics]: 'Topics',
    [MessagingPattern.RPC]: 'RPC',
    [MessagingPattern.PublisherConfirms]: 'Publisher Confirms'
  };
  return patternMap[pattern] ?? 'Unknown';
}

/**
 * Gets the detected pattern for an exchange (RabbitMQ only).
 */
export function getDetectedPattern(topic: TopicInfo): PatternDetectionResult | null {
  if (!isRabbitMQExchange(topic) || !topic.detectedPattern) {
    return null;
  }
  return topic.detectedPattern;
}

/**
 * Gets all patterns (primary + secondary) for an exchange (RabbitMQ only).
 */
export function getAllPatterns(topic: TopicInfo): PatternDetectionResult[] {
  if (!isRabbitMQExchange(topic)) {
    return [];
  }
  const patterns: PatternDetectionResult[] = [];
  if (topic.detectedPattern) {
    patterns.push(topic.detectedPattern);
  }
  if (topic.secondaryPatterns) {
    patterns.push(...topic.secondaryPatterns);
  }
  return patterns;
}
