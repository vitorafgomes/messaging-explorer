export interface MonitoringSnapshot {
  timestamp: string;
  queues: MonitoringEntity[];
  subscriptions: MonitoringSubscription[];
}

export interface MonitoringEntity {
  name: string;
  activeMessageCount: number;
  deadLetterMessageCount: number;
  transferMessageCount: number;
  scheduledMessageCount?: number;
}

export interface MonitoringSubscription extends MonitoringEntity {
  topicName: string;
}
