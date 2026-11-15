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
  /** 'base64' when the bytes of the body are not valid UTF-8 and `body` is their base64; 'text' otherwise. An older API does not send it. */
  bodyEncoding?: BodyEncoding;
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

/** How a body travels as a string: its UTF-8 text, or the base64 of its bytes. */
export type BodyEncoding = 'text' | 'base64';

export interface SendMessageRequest {
  body: string;
  /** 'base64' to send the bytes `body` encodes, on a provider that declares supportsBinaryBody; text when absent. */
  bodyEncoding?: BodyEncoding;
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

/** What a single-message call does to an active message named by its sequence number. */
export type ActiveAction = 'deadletter' | 'defer';

/** What a deferred-message call does to each message it names. */
export type DeferredAction = 'delete' | 'resubmit' | 'deadletter';

/** Body of a deferred-message call: 1 to 1000 sequence numbers of deferred messages, and what the action reads. */
export interface DeferredBatchRequest {
  sequenceNumbers: number[];
  /** Resubmit only: send each copy with a new message id into a target that detects duplicates. */
  newMessageIdOnDuplicateDetection?: boolean;
  /** Dead-letter only: the reason written on each message; absent, the API writes its own. */
  reason?: string;
  /** Dead-letter only: the description written on each message; absent, the API writes its own. */
  description?: string;
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
  /** Into a target that detects duplicates, send each copy with a new message id; without it such a target refuses the call. */
  newMessageIdOnDuplicateDetection?: boolean;
}

export interface MoveBatchRequest {
  sequenceNumbers: number[];
  targetQueueName: string;
  /** Into a target that detects duplicates, send each copy with a new message id; without it such a target refuses the call. */
  newMessageIdOnDuplicateDetection?: boolean;
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
  /** The new message id of each copy sent with one, by sequence number; the copy keeps its original id in x-original-message-id. */
  newMessageIds?: Record<number, string>;
  /** How many unselected messages the scan received and released, a lower bound. */
  unselectedDeliveryCountRaised?: number;
  /** Unselected messages the scan sent to the dead-letter queue, a lower bound. */
  unselectedDeadLettered?: number[];
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
