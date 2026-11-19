import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EntityCountsService } from './entity-counts.service';

describe('EntityCountsService', () => {
  it('a queue and a subscription of the same name have different keys, and a subscription is keyed with its topic', () => {
    expect(EntityCountsService.key('orders')).toBe('queue:orders');
    expect(EntityCountsService.key('orders', 'events')).toBe('subscription:events/orders');
    expect(EntityCountsService.key('orders', 'billing')).not.toBe(EntityCountsService.key('orders', 'events'));
  });

  it('a reader follows the counts written for its entity and no other, and clear forgets them all', () => {
    const counts = TestBed.inject(EntityCountsService);
    const orders = computed(() => counts.of('queue:orders'));
    expect(orders(), 'nothing written yet').toBeUndefined();

    counts.put('queue:orders', { activeMessageCount: 12, deadLetterMessageCount: 3 });
    counts.put('queue:invoices', { activeMessageCount: 1, deadLetterMessageCount: 0 });
    expect(orders()).toStrictEqual({ activeMessageCount: 12, deadLetterMessageCount: 3 });

    counts.clear();
    expect(orders()).toBeUndefined();
  });

  it('writing the same counts again does not notify the readers', () => {
    const counts = TestBed.inject(EntityCountsService);
    let reads = 0;
    const orders = computed(() => { reads++; return counts.of('queue:orders'); });
    counts.put('queue:orders', { activeMessageCount: 12, deadLetterMessageCount: 3 });
    orders();

    counts.put('queue:orders', { activeMessageCount: 12, deadLetterMessageCount: 3 });
    orders();

    expect(reads).toBe(1);
  });
});
