import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ApiService } from './api.service';
import { TopicInfo, SubscriptionInfo, MessageInfo, SendMessageRequest, BatchOperationResult, DeleteBatchRequest, ResubmitBatchRequest } from '../models';

/**
 * Service for managing topics/exchanges and their subscriptions/bindings.
 * This service is provider-agnostic - the backend API handles the
 * abstraction between different messaging providers (Azure Service Bus, RabbitMQ).
 *
 * For Azure Service Bus, topics and subscriptions are native entities.
 * For RabbitMQ, topics map to exchanges, and subscriptions map to queue bindings.
 */
@Injectable({
  providedIn: 'root'
})
export class TopicService {
  private api = inject(ApiService);

  // =========================================================================
  // Topics / Exchanges
  // =========================================================================

  /**
   * Gets all topics/exchanges from the current messaging provider.
   * @returns Observable array of topic/exchange information
   */
  getTopics(): Observable<TopicInfo[]> {
    return this.api.get<TopicInfo[]>('topics');
  }

  /**
   * Gets details for a specific topic/exchange.
   * @param name - The topic/exchange name
   * @returns Observable with topic/exchange information
   */
  getTopic(name: string): Observable<TopicInfo> {
    return this.api.get<TopicInfo>(`topics/${name}`);
  }

  /**
   * Creates a new topic/exchange.
   * @param name - The name for the new topic/exchange
   * @returns Observable that completes when the topic/exchange is created
   */
  createTopic(name: string): Observable<void> {
    return this.api.post<void>('topics', { name });
  }

  /**
   * Deletes a topic/exchange.
   * @param name - The name of the topic/exchange to delete
   * @returns Observable that completes when the topic/exchange is deleted
   */
  deleteTopic(name: string): Observable<void> {
    return this.api.delete<void>(`topics/${name}`);
  }

  /**
   * Sends a message to a topic/exchange.
   * @param topicName - The topic/exchange name
   * @param message - The message to send
   * @returns Observable with success status
   */
  sendMessage(topicName: string, message: SendMessageRequest): Observable<{ success: boolean }> {
    return this.api.post<{ success: boolean }>(`topics/${topicName}/messages`, message);
  }

  /**
   * Sends multiple messages to a topic/exchange in a batch.
   * @param topicName - The topic/exchange name
   * @param messages - Array of messages to send
   * @returns Observable with success status and count of sent messages
   */
  sendMessages(topicName: string, messages: SendMessageRequest[]): Observable<{ success: boolean; count: number }> {
    return this.api.post<{ success: boolean; count: number }>(`topics/${topicName}/messages/batch`, messages);
  }

  // =========================================================================
  // Subscriptions / Bindings
  // =========================================================================

  /**
   * Gets all subscriptions/bindings for a topic/exchange.
   * For Azure Service Bus, returns subscriptions.
   * For RabbitMQ, returns queue bindings to the exchange.
   * @param topicName - The topic/exchange name
   * @returns Observable array of subscription/binding information
   */
  getSubscriptions(topicName: string): Observable<SubscriptionInfo[]> {
    return this.api.get<SubscriptionInfo[]>(`topics/${topicName}/subscriptions`);
  }

  /**
   * Gets details for a specific subscription/binding.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name
   * @returns Observable with subscription/binding information
   */
  getSubscription(topicName: string, subscriptionName: string): Observable<SubscriptionInfo> {
    return this.api.get<SubscriptionInfo>(`topics/${topicName}/subscriptions/${subscriptionName}`);
  }

  /**
   * Creates a new subscription/binding.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The name for the new subscription/binding
   * @returns Observable that completes when the subscription/binding is created
   */
  createSubscription(topicName: string, subscriptionName: string): Observable<void> {
    return this.api.post<void>(`topics/${topicName}/subscriptions`, { name: subscriptionName });
  }

  /**
   * Deletes a subscription/binding.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name to delete
   * @returns Observable that completes when the subscription/binding is deleted
   */
  deleteSubscription(topicName: string, subscriptionName: string): Observable<void> {
    return this.api.delete<void>(`topics/${topicName}/subscriptions/${subscriptionName}`);
  }

  // =========================================================================
  // Subscription Messages
  // =========================================================================

  /**
   * Peeks messages from a subscription without removing them.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name
   * @param count - Maximum number of messages to peek (default: 10)
   * @returns Observable array of messages
   */
  peekMessages(topicName: string, subscriptionName: string, count: number = 10): Observable<MessageInfo[]> {
    return this.api.get<MessageInfo[]>(`topics/${topicName}/subscriptions/${subscriptionName}/messages?count=${count}`);
  }

  /**
   * Peeks dead letter messages from a subscription.
   * For Azure Service Bus, this accesses the built-in dead letter queue.
   * For RabbitMQ, this accesses the configured dead letter exchange (DLX) queue.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name
   * @param count - Maximum number of messages to peek (default: 10)
   * @returns Observable array of dead letter messages
   */
  peekDeadLetterMessages(topicName: string, subscriptionName: string, count: number = 10): Observable<MessageInfo[]> {
    return this.api.get<MessageInfo[]>(`topics/${topicName}/subscriptions/${subscriptionName}/deadletter?count=${count}`);
  }

  /**
   * Receives and removes messages from a subscription.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name
   * @param count - Maximum number of messages to receive (default: 10)
   * @returns Observable array of received messages
   */
  receiveMessages(topicName: string, subscriptionName: string, count: number = 10): Observable<MessageInfo[]> {
    return this.api.post<MessageInfo[]>(`topics/${topicName}/subscriptions/${subscriptionName}/messages/receive?count=${count}`, {});
  }

  /**
   * Resubmits a dead letter message back to the subscription.
   * Note: This operation requires sequence number support. Azure Service Bus supports this.
   * For providers that don't support sequence numbers (e.g., RabbitMQ), this may fail.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name
   * @param sequenceNumber - The sequence number of the dead letter message
   * @returns Observable with success status
   */
  resubmitDeadLetterMessage(topicName: string, subscriptionName: string, sequenceNumber: number): Observable<{ success: boolean }> {
    const url = `topics/${topicName}/subscriptions/${subscriptionName}/deadletter/${sequenceNumber}/resubmit`;
    return this.api.post<{ success: boolean }>(url, {});
  }

  /**
   * Resubmits multiple dead letter messages back to the subscription.
   * Note: This operation requires sequence number support. Azure Service Bus supports this.
   * For providers that don't support sequence numbers (e.g., RabbitMQ), this may fail.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name
   * @param sequenceNumbers - Array of sequence numbers to resubmit
   * @returns Observable with batch operation result containing success/failure counts and details
   */
  resubmitDeadLetterMessages(topicName: string, subscriptionName: string, sequenceNumbers: number[]): Observable<BatchOperationResult> {
    const request: ResubmitBatchRequest = { sequenceNumbers };
    return this.api.post<BatchOperationResult>(`topics/${topicName}/subscriptions/${subscriptionName}/deadletter/resubmit-batch`, request);
  }

  /**
   * Deletes multiple messages from a subscription by sequence number.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name
   * @param sequenceNumbers - Array of sequence numbers to delete
   * @param isDeadLetter - Whether to delete from dead letter queue (default: false)
   * @param all - When true, the backend drains the whole tab server-side and ignores sequenceNumbers (default: false)
   * @returns Observable with batch operation result containing success/failure counts and details
   */
  deleteMessages(topicName: string, subscriptionName: string, sequenceNumbers: number[], isDeadLetter: boolean = false, all: boolean = false): Observable<BatchOperationResult> {
    const request: DeleteBatchRequest = { sequenceNumbers, all };
    const path = isDeadLetter ? 'deadletter' : 'messages';
    return this.api.post<BatchOperationResult>(`topics/${topicName}/subscriptions/${subscriptionName}/${path}/delete-batch`, request);
  }

  /**
   * Purges messages from a subscription.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name
   * @param type - The type of messages to purge: 'active', 'deadletter', or 'all'
   * @returns Observable with success status
   */
  purgeMessages(topicName: string, subscriptionName: string, type: string = 'active'): Observable<{ success: boolean }> {
    if (type === 'deadletter') {
      return this.api.delete<{ success: boolean }>(`topics/${topicName}/subscriptions/${subscriptionName}/deadletter`);
    } else if (type === 'all') {
      // For 'all', we need to purge both active and dead-letter messages
      // We'll purge active first, then dead-letter
      return this.api.delete<{ success: boolean }>(`topics/${topicName}/subscriptions/${subscriptionName}/messages`).pipe(
        switchMap(() => this.api.delete<{ success: boolean }>(`topics/${topicName}/subscriptions/${subscriptionName}/deadletter`))
      );
    }
    // Default: purge only active messages
    return this.api.delete<{ success: boolean }>(`topics/${topicName}/subscriptions/${subscriptionName}/messages`);
  }

  /**
   * Purges all dead letter messages from a subscription.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name
   * @returns Observable with success status
   */
  purgeDeadLetterMessages(topicName: string, subscriptionName: string): Observable<{ success: boolean }> {
    return this.api.delete<{ success: boolean }>(`topics/${topicName}/subscriptions/${subscriptionName}/deadletter`);
  }
}
