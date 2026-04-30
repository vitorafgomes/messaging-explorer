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

export interface DeleteBatchRequest {
  sequenceNumbers: number[];
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
