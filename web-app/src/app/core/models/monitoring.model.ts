export interface MonitoringSnapshot {
  timestamp: string;
  queues: MonitoringEntity[];
  subscriptions: MonitoringSubscription[];
}

/**
 * The answer of the snapshot route: the latest snapshot, null until the API has polled the broker once;
 * how often the API polls; and when its last poll failed, null once a later poll succeeded.
 */
export interface MonitoringStatus {
  snapshot: MonitoringSnapshot | null;
  pollIntervalSeconds: number;
  lastPollFailedAt: string | null;
}

/** The counts of one entity. A null count is one the broker does not count for this entity. */
export interface MonitoringEntity {
  name: string;
  activeMessageCount: number;
  deadLetterMessageCount: number;
  transferMessageCount: number;
  scheduledMessageCount: number | null;
  transferDeadLetterMessageCount: number | null;
}

export interface MonitoringSubscription extends MonitoringEntity {
  topicName: string;
}
