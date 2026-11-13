import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ApiService } from './api.service';
import { apiPath } from './api-path';
import {
  TopicInfo, SubscriptionInfo, MessageInfo, SendMessageRequest, BatchOperationResult, DeleteBatchRequest, ResubmitBatchRequest,
  TopicCreateOptions, TopicUpdate, SubscriptionCreateOptions, SubscriptionUpdate, SubscriptionRuleInfo, SubscriptionRuleWrite
} from '../models';

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
    return this.api.get<TopicInfo>(apiPath`topics/${name}`);
  }

  /**
   * Creates a new topic/exchange.
   * @param name - The name for the new topic/exchange
   * @param options - Only the options the user set; omitted, the broker applies its defaults
   * @returns Observable that completes when the topic/exchange is created
   */
  createTopic(name: string, options?: TopicCreateOptions): Observable<void> {
    return this.api.post<void>('topics', options ? { name, options } : { name });
  }

  /**
   * Changes the given properties of a topic; a property not in `changes` is left as it is.
   * @returns Observable with the topic as the API reads it after the change
   */
  updateTopic(name: string, changes: TopicUpdate): Observable<TopicInfo> {
    return this.api.patch<TopicInfo>(apiPath`topics/${name}`, changes);
  }

  /**
   * Deletes a topic/exchange.
   * @param name - The name of the topic/exchange to delete
   * @returns Observable that completes when the topic/exchange is deleted
   */
  deleteTopic(name: string): Observable<void> {
    return this.api.delete<void>(apiPath`topics/${name}`);
  }

  /**
   * Sends a message to a topic/exchange.
   * @param topicName - The topic/exchange name
   * @param message - The message to send
   * @returns Observable with success status
   */
  sendMessage(topicName: string, message: SendMessageRequest): Observable<{ success: boolean }> {
    return this.api.post<{ success: boolean }>(apiPath`topics/${topicName}/messages`, message);
  }

  /**
   * Sends multiple messages to a topic/exchange in a batch.
   * @param topicName - The topic/exchange name
   * @param messages - Array of messages to send
   * @returns Observable with success status and count of sent messages
   */
  sendMessages(topicName: string, messages: SendMessageRequest[]): Observable<{ success: boolean; count: number }> {
    return this.api.post<{ success: boolean; count: number }>(apiPath`topics/${topicName}/messages/batch`, messages);
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
    return this.api.get<SubscriptionInfo[]>(apiPath`topics/${topicName}/subscriptions`);
  }

  /**
   * Gets details for a specific subscription/binding.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name
   * @returns Observable with subscription/binding information
   */
  getSubscription(topicName: string, subscriptionName: string): Observable<SubscriptionInfo> {
    return this.api.get<SubscriptionInfo>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}`);
  }

  /**
   * Creates a new subscription/binding.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The name for the new subscription/binding
   * @param options - Only the options the user set; omitted, the broker applies its defaults
   * @returns Observable that completes when the subscription/binding is created
   */
  createSubscription(topicName: string, subscriptionName: string, options?: SubscriptionCreateOptions): Observable<void> {
    const body = options ? { name: subscriptionName, options } : { name: subscriptionName };
    return this.api.post<void>(apiPath`topics/${topicName}/subscriptions`, body);
  }

  /**
   * Changes the given properties of a subscription; a property not in `changes` is left as it is.
   * @returns Observable with the subscription as the API reads it after the change
   */
  updateSubscription(topicName: string, subscriptionName: string, changes: SubscriptionUpdate): Observable<SubscriptionInfo> {
    return this.api.patch<SubscriptionInfo>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}`, changes);
  }

  /**
   * Deletes a subscription/binding.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name to delete
   * @returns Observable that completes when the subscription/binding is deleted
   */
  deleteSubscription(topicName: string, subscriptionName: string): Observable<void> {
    return this.api.delete<void>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}`);
  }

  // =========================================================================
  // Subscription Rules
  // =========================================================================

  /** Reads the rules of a subscription. */
  getRules(topicName: string, subscriptionName: string): Observable<SubscriptionRuleInfo[]> {
    return this.api.get<SubscriptionRuleInfo[]>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/rules`);
  }

  /** Adds a rule; answers the rule as stored. */
  createRule(topicName: string, subscriptionName: string, rule: SubscriptionRuleWrite): Observable<SubscriptionRuleInfo> {
    return this.api.post<SubscriptionRuleInfo>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/rules`, rule);
  }

  /** Replaces the whole rule (filter and action) under the same name; a rule cannot be renamed. */
  replaceRule(topicName: string, subscriptionName: string, ruleName: string, rule: SubscriptionRuleWrite): Observable<SubscriptionRuleInfo> {
    return this.api.put<SubscriptionRuleInfo>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/rules/${ruleName}`, rule);
  }

  /** Deletes a rule. */
  deleteRule(topicName: string, subscriptionName: string, ruleName: string): Observable<void> {
    return this.api.delete<void>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/rules/${ruleName}`);
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
    return this.api.get<MessageInfo[]>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/messages?count=${count}`);
  }

  /**
   * Peeks dead letter messages from a subscription.
   * For Azure Service Bus, this accesses the built-in dead letter queue.
   * For RabbitMQ, this accesses the configured dead letter exchange (DLX) queue.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name
   * @param count - Maximum number of messages to peek (default: 10)
   * @param fromSequenceNumber - First sequence number to read; absent reads from the head
   * @param includeBody - False asks the API to leave the message bodies out
   * @returns Observable array of dead letter messages
   */
  peekDeadLetterMessages(topicName: string, subscriptionName: string, count: number = 10, fromSequenceNumber?: number, includeBody = true): Observable<MessageInfo[]> {
    const from = fromSequenceNumber === undefined ? '' : apiPath`&fromSequenceNumber=${fromSequenceNumber}`;
    const body = includeBody ? '' : '&includeBody=false';
    return this.api.get<MessageInfo[]>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/deadletter?count=${count}` + from + body);
  }

  /**
   * Receives and removes messages from a subscription.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name
   * @param count - Maximum number of messages to receive (default: 10)
   * @returns Observable array of received messages
   */
  receiveMessages(topicName: string, subscriptionName: string, count: number = 10): Observable<MessageInfo[]> {
    return this.api.post<MessageInfo[]>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/messages/receive?count=${count}`, {});
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
    const url = apiPath`topics/${topicName}/subscriptions/${subscriptionName}/deadletter/${sequenceNumber}/resubmit`;
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
    return this.api.post<BatchOperationResult>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/deadletter/resubmit-batch`, request);
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
    return this.api.post<BatchOperationResult>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/${path}/delete-batch`, request);
  }

  /** Peeks the transfer dead-letter queue of a subscription: messages it could not forward to another entity. */
  peekTransferDeadLetterMessages(topicName: string, subscriptionName: string, count: number = 10, fromSequenceNumber?: number, includeBody = true): Observable<MessageInfo[]> {
    const from = fromSequenceNumber === undefined ? '' : apiPath`&fromSequenceNumber=${fromSequenceNumber}`;
    const body = includeBody ? '' : '&includeBody=false';
    return this.api.get<MessageInfo[]>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/transferdeadletter?count=${count}` + from + body);
  }

  /** Deletes the given transfer dead-letter messages of a subscription; never the whole queue, which has no purge. */
  deleteTransferDeadLetterMessages(topicName: string, subscriptionName: string, sequenceNumbers: number[]): Observable<BatchOperationResult> {
    const request: DeleteBatchRequest = { sequenceNumbers, all: false };
    return this.api.post<BatchOperationResult>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/transferdeadletter/delete-batch`, request);
  }

  /** Resubmits the given transfer dead-letter messages of a subscription to its topic. */
  resubmitTransferDeadLetterMessages(topicName: string, subscriptionName: string, sequenceNumbers: number[]): Observable<BatchOperationResult> {
    const request: ResubmitBatchRequest = { sequenceNumbers };
    return this.api.post<BatchOperationResult>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/transferdeadletter/resubmit-batch`, request);
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
      return this.api.delete<{ success: boolean }>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/deadletter`);
    } else if (type === 'all') {
      // For 'all', we need to purge both active and dead-letter messages
      // We'll purge active first, then dead-letter
      return this.api.delete<{ success: boolean }>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/messages`).pipe(
        switchMap(() => this.api.delete<{ success: boolean }>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/deadletter`))
      );
    }
    // Default: purge only active messages
    return this.api.delete<{ success: boolean }>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/messages`);
  }

  /**
   * Purges all dead letter messages from a subscription.
   * @param topicName - The topic/exchange name
   * @param subscriptionName - The subscription/binding name
   * @returns Observable with success status
   */
  purgeDeadLetterMessages(topicName: string, subscriptionName: string): Observable<{ success: boolean }> {
    return this.api.delete<{ success: boolean }>(apiPath`topics/${topicName}/subscriptions/${subscriptionName}/deadletter`);
  }
}
