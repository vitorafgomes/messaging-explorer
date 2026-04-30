import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ApiService } from './api.service';
import { QueueInfo, MessageInfo, SendMessageRequest, BatchOperationResult, DeleteBatchRequest, ResubmitBatchRequest, MoveBatchRequest } from '../models';

/**
 * Service for managing queues and their messages.
 * This service is provider-agnostic - the backend API handles the
 * abstraction between different messaging providers (Azure Service Bus, RabbitMQ).
 *
 * For Azure Service Bus, queues are native entities.
 * For RabbitMQ, queues are represented with their specific properties.
 */
@Injectable({
  providedIn: 'root'
})
export class QueueService {
  private api = inject(ApiService);

  /**
   * Gets all queues from the current messaging provider.
   * @returns Observable array of queue information
   */
  getQueues(): Observable<QueueInfo[]> {
    return this.api.get<QueueInfo[]>('queues');
  }

  /**
   * Gets details for a specific queue.
   * @param name - The queue name
   * @returns Observable with queue information
   */
  getQueue(name: string): Observable<QueueInfo> {
    return this.api.get<QueueInfo>(`queues/${name}`);
  }

  /**
   * Creates a new queue.
   * @param name - The name for the new queue
   * @returns Observable that completes when the queue is created
   */
  createQueue(name: string): Observable<void> {
    return this.api.post<void>('queues', { name });
  }

  /**
   * Deletes a queue.
   * @param name - The name of the queue to delete
   * @returns Observable that completes when the queue is deleted
   */
  deleteQueue(name: string): Observable<void> {
    return this.api.delete<void>(`queues/${name}`);
  }

  /**
   * Peeks messages from a queue without removing them.
   * @param queueName - The queue name
   * @param count - Maximum number of messages to peek (default: 10)
   * @returns Observable array of messages
   */
  peekMessages(queueName: string, count: number = 10): Observable<MessageInfo[]> {
    return this.api.get<MessageInfo[]>(`queues/${queueName}/messages?count=${count}`);
  }

  /**
   * Peeks dead letter messages from a queue.
   * For Azure Service Bus, this accesses the built-in dead letter queue.
   * For RabbitMQ, this accesses the configured dead letter exchange (DLX) queue.
   * @param queueName - The queue name
   * @param count - Maximum number of messages to peek (default: 10)
   * @returns Observable array of dead letter messages
   */
  peekDeadLetterMessages(queueName: string, count: number = 10): Observable<MessageInfo[]> {
    return this.api.get<MessageInfo[]>(`queues/${queueName}/deadletter?count=${count}`);
  }

  /**
   * Sends a message to a queue.
   * @param queueName - The queue name
   * @param message - The message to send
   * @returns Observable with success status
   */
  sendMessage(queueName: string, message: SendMessageRequest): Observable<{ success: boolean }> {
    return this.api.post<{ success: boolean }>(`queues/${queueName}/messages`, message);
  }

  /**
   * Sends multiple messages to a queue in a batch.
   * @param queueName - The queue name
   * @param messages - Array of messages to send
   * @returns Observable with success status and count of sent messages
   */
  sendMessages(queueName: string, messages: SendMessageRequest[]): Observable<{ success: boolean; count: number }> {
    return this.api.post<{ success: boolean; count: number }>(`queues/${queueName}/messages/batch`, messages);
  }

  /**
   * Receives and removes messages from a queue.
   * @param queueName - The queue name
   * @param count - Maximum number of messages to receive (default: 10)
   * @returns Observable array of received messages
   */
  receiveMessages(queueName: string, count: number = 10): Observable<MessageInfo[]> {
    return this.api.post<MessageInfo[]>(`queues/${queueName}/messages/receive?count=${count}`, {});
  }

  /**
   * Resubmits a dead letter message back to the main queue.
   * Note: This operation requires sequence number support. Azure Service Bus supports this.
   * For providers that don't support sequence numbers (e.g., RabbitMQ), this may fail.
   * @param queueName - The queue name
   * @param sequenceNumber - The sequence number of the dead letter message
   * @returns Observable with success status
   */
  resubmitDeadLetterMessage(queueName: string, sequenceNumber: number): Observable<{ success: boolean }> {
    const url = `queues/${queueName}/deadletter/${sequenceNumber}/resubmit`;
    return this.api.post<{ success: boolean }>(url, {});
  }

  /**
   * Resubmits multiple dead letter messages back to the main queue.
   * Note: This operation requires sequence number support. Azure Service Bus supports this.
   * For providers that don't support sequence numbers (e.g., RabbitMQ), this may fail.
   * @param queueName - The queue name
   * @param sequenceNumbers - Array of sequence numbers to resubmit
   * @returns Observable with batch operation result containing success/failure counts and details
   */
  resubmitDeadLetterMessages(queueName: string, sequenceNumbers: number[]): Observable<BatchOperationResult> {
    const request: ResubmitBatchRequest = { sequenceNumbers };
    return this.api.post<BatchOperationResult>(`queues/${queueName}/deadletter/resubmit-batch`, request);
  }

  /**
   * Deletes multiple messages from a queue by sequence number.
   * @param queueName - The queue name
   * @param sequenceNumbers - Array of sequence numbers to delete
   * @param isDeadLetter - Whether to delete from dead letter queue (default: false)
   * @returns Observable with batch operation result containing success/failure counts and details
   */
  deleteMessages(queueName: string, sequenceNumbers: number[], isDeadLetter: boolean = false): Observable<BatchOperationResult> {
    const request: DeleteBatchRequest = { sequenceNumbers };
    const path = isDeadLetter ? 'deadletter' : 'messages';
    return this.api.post<BatchOperationResult>(`queues/${queueName}/${path}/delete-batch`, request);
  }

  /**
   * Moves multiple messages from a source queue to a target queue.
   * @param sourceQueueName - The source queue name
   * @param targetQueueName - The target queue name
   * @param sequenceNumbers - Array of sequence numbers to move
   * @param isDeadLetter - Whether to move from dead letter queue (default: false)
   * @returns Observable with batch operation result containing success/failure counts and details
   */
  moveMessages(sourceQueueName: string, targetQueueName: string, sequenceNumbers: number[], isDeadLetter: boolean = false): Observable<BatchOperationResult> {
    const request: MoveBatchRequest = { sequenceNumbers, targetQueueName };
    const path = isDeadLetter ? 'deadletter' : 'messages';
    return this.api.post<BatchOperationResult>(`queues/${sourceQueueName}/${path}/move-batch`, request);
  }

  /**
   * Purges messages from a queue.
   * @param queueName - The queue name
   * @param type - The type of messages to purge: 'active', 'deadletter', or 'all'
   * @returns Observable with success status
   */
  purgeMessages(queueName: string, type: string = 'active'): Observable<{ success: boolean }> {
    if (type === 'deadletter') {
      return this.api.delete<{ success: boolean }>(`queues/${queueName}/deadletter`);
    } else if (type === 'all') {
      // For 'all', we need to purge both active and dead-letter messages
      // We'll purge active first, then dead-letter
      return this.api.delete<{ success: boolean }>(`queues/${queueName}/messages`).pipe(
        switchMap(() => this.api.delete<{ success: boolean }>(`queues/${queueName}/deadletter`))
      );
    }
    // Default: purge only active messages
    return this.api.delete<{ success: boolean }>(`queues/${queueName}/messages`);
  }

  /**
   * Purges all dead letter messages from a queue.
   * @param queueName - The queue name
   * @returns Observable with success status
   */
  purgeDeadLetterMessages(queueName: string): Observable<{ success: boolean }> {
    return this.api.delete<{ success: boolean }>(`queues/${queueName}/deadletter`);
  }
}
