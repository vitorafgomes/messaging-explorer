import { Injectable, signal, computed } from '@angular/core';
import { SubscriptionInfo } from '../models/topic.model';

export interface DeadLetterAlert {
  topicName: string;
  subscriptionName: string;
  deadLetterMessageCount: number;
}

@Injectable({
  providedIn: 'root'
})
export class DeadLetterNotificationService {
  private readonly _alerts = signal<DeadLetterAlert[]>([]);

  readonly alerts = this._alerts.asReadonly();
  readonly alertCount = computed(() => this._alerts().length);
  readonly hasAlerts = computed(() => this._alerts().length > 0);

  updateFromSubscriptions(subscriptions: SubscriptionInfo[]): void {
    const filtered = subscriptions
      .filter(s => s.deadLetterMessageCount > 0)
      .map(s => ({
        topicName: s.topicName,
        subscriptionName: s.name,
        deadLetterMessageCount: s.deadLetterMessageCount
      }))
      .sort((a, b) => b.deadLetterMessageCount - a.deadLetterMessageCount);

    this._alerts.set(filtered);
  }

  clear(): void {
    this._alerts.set([]);
  }
}
