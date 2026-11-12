/** The three kinds of entity that can be created, edited and enabled or disabled. */
export type EntityKind = 'queue' | 'topic' | 'subscription';

/** An entity status as the API reads and writes it. */
export type EntityStatus = 'Active' | 'Disabled' | 'SendDisabled' | 'ReceiveDisabled';

/** The statuses the API accepts for each kind, from least to most disruptive; anything else is refused with a 400. */
export const ENTITY_STATUSES: Record<EntityKind, readonly EntityStatus[]> = {
  queue: ['Active', 'SendDisabled', 'ReceiveDisabled', 'Disabled'],
  topic: ['Active', 'SendDisabled', 'Disabled'],
  subscription: ['Active', 'ReceiveDisabled', 'Disabled']
};

/** Durations are .NET TimeSpan strings: `hh:mm:ss` or `d.hh:mm:ss`. */
type TimeSpanString = string;

/** Options of `POST api/queues`; an absent field takes the broker's default. */
export interface QueueCreateOptions {
  defaultMessageTimeToLive?: TimeSpanString;
  lockDuration?: TimeSpanString;
  maxDeliveryCount?: number;
  requiresSession?: boolean;
  enablePartitioning?: boolean;
  deadLetteringOnMessageExpiration?: boolean;
  requiresDuplicateDetection?: boolean;
  duplicateDetectionHistoryTimeWindow?: TimeSpanString;
  maxSizeInMegabytes?: number;
  autoDeleteOnIdle?: TimeSpanString;
  enableBatchedOperations?: boolean;
  forwardTo?: string;
  forwardDeadLetteredMessagesTo?: string;
  userMetadata?: string;
}

/** Body of `PATCH api/queues/{name}`; an absent field is left as it is, an empty forward target clears it. */
export interface QueueUpdate {
  defaultMessageTimeToLive?: TimeSpanString;
  lockDuration?: TimeSpanString;
  maxDeliveryCount?: number;
  deadLetteringOnMessageExpiration?: boolean;
  duplicateDetectionHistoryTimeWindow?: TimeSpanString;
  maxSizeInMegabytes?: number;
  autoDeleteOnIdle?: TimeSpanString;
  enableBatchedOperations?: boolean;
  forwardTo?: string;
  forwardDeadLetteredMessagesTo?: string;
  userMetadata?: string;
  status?: EntityStatus;
}

/** Options of `POST api/topics`. */
export interface TopicCreateOptions {
  defaultMessageTimeToLive?: TimeSpanString;
  enablePartitioning?: boolean;
  requiresDuplicateDetection?: boolean;
  duplicateDetectionHistoryTimeWindow?: TimeSpanString;
  maxSizeInMegabytes?: number;
  autoDeleteOnIdle?: TimeSpanString;
  enableBatchedOperations?: boolean;
  supportOrdering?: boolean;
  userMetadata?: string;
}

/** Body of `PATCH api/topics/{name}`. */
export interface TopicUpdate {
  defaultMessageTimeToLive?: TimeSpanString;
  duplicateDetectionHistoryTimeWindow?: TimeSpanString;
  maxSizeInMegabytes?: number;
  autoDeleteOnIdle?: TimeSpanString;
  enableBatchedOperations?: boolean;
  supportOrdering?: boolean;
  userMetadata?: string;
  status?: EntityStatus;
}

/** Options of `POST api/topics/{topicName}/subscriptions`. */
export interface SubscriptionCreateOptions {
  defaultMessageTimeToLive?: TimeSpanString;
  lockDuration?: TimeSpanString;
  maxDeliveryCount?: number;
  requiresSession?: boolean;
  deadLetteringOnMessageExpiration?: boolean;
  deadLetteringOnFilterEvaluationExceptions?: boolean;
  autoDeleteOnIdle?: TimeSpanString;
  enableBatchedOperations?: boolean;
  forwardTo?: string;
  forwardDeadLetteredMessagesTo?: string;
  userMetadata?: string;
}

/** Body of `PATCH api/topics/{topicName}/subscriptions/{subscriptionName}`. */
export interface SubscriptionUpdate {
  defaultMessageTimeToLive?: TimeSpanString;
  lockDuration?: TimeSpanString;
  maxDeliveryCount?: number;
  deadLetteringOnMessageExpiration?: boolean;
  deadLetteringOnFilterEvaluationExceptions?: boolean;
  autoDeleteOnIdle?: TimeSpanString;
  enableBatchedOperations?: boolean;
  forwardTo?: string;
  forwardDeadLetteredMessagesTo?: string;
  userMetadata?: string;
  status?: EntityStatus;
}
