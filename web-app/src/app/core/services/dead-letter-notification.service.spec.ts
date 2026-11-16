import { TestBed } from '@angular/core/testing';
import { SubscriptionInfo } from '../models/topic.model';
import { DeadLetterNotificationService } from './dead-letter-notification.service';
import { EntityCountsService } from './entity-counts.service';

const subscription = (name: string, deadLetterMessageCount: number) =>
  ({ topicName: 'events', name, activeMessageCount: 0, deadLetterMessageCount }) as SubscriptionInfo;

describe('DeadLetterNotificationService', () => {
  it('alerts for the subscriptions that hold dead-letter messages, the largest first', () => {
    const bell = TestBed.inject(DeadLetterNotificationService);

    bell.updateFromSubscriptions([subscription('audit', 2), subscription('email', 0), subscription('warehouse', 9)]);

    expect(bell.alerts().map(a => [a.subscriptionName, a.deadLetterMessageCount])).toStrictEqual([['warehouse', 9], ['audit', 2]]);
    expect(bell.alertCount()).toBe(2);
  });

  it('follows the counts every other display reads: a subscription emptied elsewhere leaves the bell, and one that starts to hold dead-letter messages enters it', () => {
    const bell = TestBed.inject(DeadLetterNotificationService);
    const counts = TestBed.inject(EntityCountsService);
    bell.updateFromSubscriptions([subscription('audit', 2), subscription('email', 0)]);

    counts.put(EntityCountsService.key('audit', 'events'), { activeMessageCount: 0, deadLetterMessageCount: 0 });
    counts.put(EntityCountsService.key('email', 'events'), { activeMessageCount: 0, deadLetterMessageCount: 4 });

    expect(bell.alerts()).toStrictEqual([{ topicName: 'events', subscriptionName: 'email', deadLetterMessageCount: 4 }]);
    expect(bell.hasAlerts()).toBe(true);

    bell.clear();
    expect(bell.alerts()).toStrictEqual([]);
  });
});
