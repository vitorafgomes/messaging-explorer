import { Injectable, signal, computed, inject } from '@angular/core';
import { EntityCountsService } from './entity-counts.service';
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
  private readonly counts = inject(EntityCountsService);
  private readonly subscriptions = signal<DeadLetterAlert[]>([]);

  /**
   * The subscriptions that hold dead-letter messages, the largest first. Each count is the latest one read for
   * that subscription anywhere in the app, or the one it was listed with.
   */
  readonly alerts = computed(() => this.subscriptions()
    .map(s => ({
      ...s,
      deadLetterMessageCount: this.counts.of(EntityCountsService.key(s.subscriptionName, s.topicName))?.deadLetterMessageCount ?? s.deadLetterMessageCount
    }))
    .filter(s => s.deadLetterMessageCount > 0)
    .sort((a, b) => b.deadLetterMessageCount - a.deadLetterMessageCount));
  readonly alertCount = computed(() => this.alerts().length);
  readonly hasAlerts = computed(() => this.alerts().length > 0);

  updateFromSubscriptions(subscriptions: SubscriptionInfo[]): void {
    this.subscriptions.set(subscriptions.map(s => ({
      topicName: s.topicName,
      subscriptionName: s.name,
      deadLetterMessageCount: s.deadLetterMessageCount
    })));
  }

  clear(): void {
    this.subscriptions.set([]);
  }
}
