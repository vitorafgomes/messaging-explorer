export interface MessageInfo {
  messageId: string;
  correlationId?: string;
  sessionId?: string;
  partitionKey?: string;
  replyTo?: string;
  replyToSessionId?: string;
  to?: string;
  subject?: string;
  contentType?: string;
  body: string;
  bodyType: string;
  sequenceNumber: number;
  deliveryCount: number;
  enqueuedTime: Date;
  scheduledEnqueueTime?: Date;
  expiresAt?: Date;
  timeToLive: string;
  deadLetterSource?: string;
  deadLetterReason?: string;
  deadLetterErrorDescription?: string;
  applicationProperties: { [key: string]: any };
  state?: 'Active' | 'Deferred' | 'Scheduled';
  sizeInBytes?: number;
}

export interface SendMessageRequest {
  body: string;
  contentType?: string;
  messageId?: string;
  correlationId?: string;
  sessionId?: string;
  partitionKey?: string;
  subject?: string;
  to?: string;
  replyTo?: string;
  timeToLive?: string;
  scheduledEnqueueTime?: Date;
  applicationProperties?: { [key: string]: any };
}

/** The part of a queue or subscription a message list reads and a bulk action acts on. */
export type SubQueue = 'active' | 'deadletter' | 'transferdeadletter';

/** How an operation report names the messages of each sub-queue. */
export const SUB_QUEUE_LABEL: Record<SubQueue, string> = {
  active: 'active',
  deadletter: 'dead letter',
  transferdeadletter: 'transfer dead-letter'
};

/** Body of a scheduled-message cancel: 1 to 500 sequence numbers of scheduled messages. */
export interface CancelScheduledRequest {
  sequenceNumbers: number[];
}

export interface DeleteBatchRequest {
  sequenceNumbers: number[];
  /**
   * When true, the backend drains the entire entity server-side and ignores
   * sequenceNumbers. Only set when the selection covers the whole tab with no
   * active filter.
   */
  all?: boolean;
}

export interface ResubmitBatchRequest {
  sequenceNumbers: number[];
}

export interface MoveBatchRequest {
  sequenceNumbers: number[];
  targetQueueName: string;
}

export interface BatchOperationFailure {
  sequenceNumber: number;
  error: string;
}

export interface BatchOperationResult {
  successCount: number;
  failureCount: number;
  failures: BatchOperationFailure[];
  success: boolean;
}

export interface MessageTemplate {
  id: string;
  name: string;
  body: string;
  contentType: string;
  applicationProperties?: Record<string, any>;
  subject?: string;
  to?: string;
  replyTo?: string;
  createdAt: string;
}
