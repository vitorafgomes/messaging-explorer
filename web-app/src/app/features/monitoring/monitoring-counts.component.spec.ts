import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { MonitoringEntity, MonitoringSnapshot, MonitoringSubscription, SubscriptionNodeData } from '../../core/models';
import { ConnectionService, EntitySelectionService, MonitoringService, QueueService, TopicService } from '../../core/services';
import { DEAD_LETTER_THRESHOLD_KEY, MonitoringCountsComponent } from './monitoring-counts.component';

@Component({ standalone: true, template: '' })
class EntitiesStubComponent {}

const queue = (name: string, active: number, deadLetter: number, scheduled: number | null, transferDeadLetter: number | null): MonitoringEntity => ({
  name, activeMessageCount: active, deadLetterMessageCount: deadLetter, transferMessageCount: 0,
  scheduledMessageCount: scheduled, transferDeadLetterMessageCount: transferDeadLetter
});
const subscription = (topicName: string, name: string, active: number, deadLetter: number): MonitoringSubscription => ({
  ...queue(name, active, deadLetter, null, 0), topicName
});

const SNAPSHOT: MonitoringSnapshot = {
  timestamp: '2026-11-13T09:00:00Z',
  queues: [
    queue('orders', 1204, 700000, 3, 2),
    queue('billing/invoices', 18, 0, 0, 0),
    queue('notifications', 0, 0, 0, 0),
    queue('orders-archive', 52310, 0, 0, 0)
  ],
  subscriptions: [
    subscription('order-events', 'warehouse', 12, 0),
    subscription('order-events', 'email', 0, 4)
  ]
};

describe('MonitoringCountsComponent: the counts of every entity on one screen', () => {
  let fixture: ComponentFixture<MonitoringCountsComponent>;
  let el: HTMLElement;
  let monitoring: { getQueueCounts: ReturnType<typeof vi.fn>; getSubscriptionCounts: ReturnType<typeof vi.fn> };

  function render(snapshot: MonitoringSnapshot = SNAPSHOT) {
    monitoring = { getQueueCounts: vi.fn(), getSubscriptionCounts: vi.fn() };
    TestBed.configureTestingModule({
      imports: [MonitoringCountsComponent],
      providers: [
        provideRouter([{ path: 'entities', component: EntitiesStubComponent }]),
        { provide: MonitoringService, useValue: monitoring },
        { provide: QueueService, useValue: { getQueue: vi.fn((name: string) => of({ name })) } },
        { provide: TopicService, useValue: { getSubscription: vi.fn((topicName: string, name: string) => of({ topicName, name })) } },
        { provide: ConnectionService, useValue: { connectionStatus$: new BehaviorSubject({ connected: true }) } }
      ]
    });
    fixture = TestBed.createComponent(MonitoringCountsComponent);
    fixture.componentRef.setInput('snapshot', snapshot);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => localStorage.removeItem(DEAD_LETTER_THRESHOLD_KEY));

  const text = (e: Element | null | undefined) => {
    const copy = e?.cloneNode(true) as Element | undefined;
    copy?.querySelectorAll('mat-icon').forEach(icon => icon.remove());
    return (copy?.textContent ?? '').replace(/\s+/g, ' ').trim();
  };
  const rows = () => Array.from(el.querySelectorAll('tr.count-row')).map(r => Array.from(r.querySelectorAll('td')).slice(0, 6).map(text));
  const names = () => rows().map(r => r[0]);
  const marked = () => Array.from(el.querySelectorAll('tr.count-row.over-threshold')).map(r => text(r.querySelector('td')));
  const summary = () => text(el.querySelector('.summary'));
  const sortBy = (label: string) => {
    (Array.from(el.querySelectorAll('th')).find(th => text(th) === label) as HTMLElement).click();
    fixture.detectChanges();
  };
  const type = (name: string, value: string) => {
    const input = el.querySelector(`input[name="${name}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const button = (label: string) => el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

  describe('counts of every entity on one screen, sortable and filterable', () => {
    it('lists every queue and subscription with its counts, the most dead-lettered first, and a subscription scheduled count as not counted', () => {
      render();

      expect(rows()).toStrictEqual([
        ['orders', 'Queue', '1,204', '700,000 over threshold', '3', '2'],
        ['email in order-events', 'Subscription', '0', '4', 'Not counted', '0'],
        ['billing/invoices', 'Queue', '18', '0', '0', '0'],
        ['notifications', 'Queue', '0', '0', '0', '0'],
        ['orders-archive', 'Queue', '52,310', '0', '0', '0'],
        ['warehouse in order-events', 'Subscription', '12', '0', 'Not counted', '0']
      ]);
    });

    it('sorts a text column ascending on the first click and descending on the second, and a count column largest first', () => {
      render();

      sortBy('Name');
      expect(names()).toStrictEqual(['billing/invoices', 'email in order-events', 'notifications', 'orders', 'orders-archive', 'warehouse in order-events']);
      sortBy('Name');
      expect(names()).toStrictEqual(['warehouse in order-events', 'orders-archive', 'orders', 'notifications', 'email in order-events', 'billing/invoices']);
      sortBy('Active');
      expect(names().slice(0, 3)).toStrictEqual(['orders-archive', 'orders', 'billing/invoices']);
      sortBy('Scheduled');
      expect(names()[0]).toBe('orders');
      expect(rows().slice(-2).map(r => r[4])).toStrictEqual(['Not counted', 'Not counted']);
    });

    it('filters by part of a name or of the topic, ignoring case, and says how many match', () => {
      render();

      type('filter', 'ORDER');
      expect(names()).toStrictEqual(['orders', 'email in order-events', 'orders-archive', 'warehouse in order-events']);
      expect(summary()).toBe('4 of 6 entities match the filter. 1 over the dead-letter threshold of 100.');

      type('filter', 'invoices');
      expect(names()).toStrictEqual(['billing/invoices']);

      type('filter', 'nothing-like-this');
      expect(names()).toStrictEqual([]);
      expect(text(el.querySelector('tr.no-match'))).toBe('No entity matches the filter.');
    });
  });

  describe('the work done on each snapshot', () => {
    it('keeps the row elements of the same entities when a new snapshot arrives and shows its counts in them', () => {
      render();
      const before = Array.from(el.querySelectorAll('tr.count-row'));

      fixture.componentRef.setInput('snapshot', {
        timestamp: '2026-11-13T09:00:30Z',
        queues: SNAPSHOT.queues.map(q => ({ ...q })),
        subscriptions: SNAPSHOT.subscriptions.map(x => x.name === 'warehouse' ? { ...x, activeMessageCount: 13 } : { ...x })
      });
      fixture.detectChanges();

      const after = Array.from(el.querySelectorAll('tr.count-row'));
      expect(after.length).toBe(before.length);
      expect(after.every((row, i) => row === before[i])).toBe(true);
      expect(rows()).toContainEqual(['warehouse in order-events', 'Subscription', '13', '0', 'Not counted', '0']);
    });

    it('is not rendered again when its parent is checked and nothing it shows has changed', () => {
      render();
      const formatting = vi.spyOn(fixture.componentInstance, 'count');

      fixture.detectChanges();

      expect(formatting).not.toHaveBeenCalled();
    });
  });

  describe('the dead-letter threshold the user sets', () => {
    it('marks the rows whose dead-letter count is above 100 until the user sets another threshold', () => {
      render();

      expect(marked()).toStrictEqual(['orders']);
      expect(summary()).toBe('6 entities. 1 over the dead-letter threshold of 100.');
    });

    it('re-marks the rows above the threshold the user types and keeps it in this browser for the next visit', () => {
      render();

      type('threshold', '3');
      expect(marked()).toStrictEqual(['orders', 'email in order-events']);
      expect(summary()).toBe('6 entities. 2 over the dead-letter threshold of 3.');
      expect(localStorage.getItem(DEAD_LETTER_THRESHOLD_KEY)).toBe('3');

      TestBed.resetTestingModule();
      render();
      expect((el.querySelector('input[name="threshold"]') as HTMLInputElement).value).toBe('3');
      expect(marked()).toStrictEqual(['orders', 'email in order-events']);
    });

    it('marks nothing and asks for a whole number when the threshold is not one', () => {
      render();

      type('threshold', 'ten');

      expect(marked()).toStrictEqual([]);
      expect(summary()).toBe('6 entities. Enter a whole number as the threshold to mark rows.');
    });
  });

  describe('a click from a row to the entity', () => {
    it('opens a queue in the Entities screen with that queue selected', async () => {
      render();
      const selection = TestBed.inject(EntitySelectionService);
      const router = TestBed.inject(Router);

      button('Open orders in Entities').click();
      await fixture.whenStable();

      expect(router.url).toBe('/entities');
      expect(selection.currentSelection?.type).toBe('queue');
      expect(selection.currentSelection?.node.name).toBe('orders');
      expect(selection.currentSelection?.entity).toStrictEqual({ name: 'orders' });
    });

    it('opens a subscription in the Entities screen with that subscription of its topic selected', async () => {
      render();
      const selection = TestBed.inject(EntitySelectionService);
      const router = TestBed.inject(Router);

      button('Open email in Entities').click();
      await fixture.whenStable();

      expect(router.url).toBe('/entities');
      expect(selection.currentSelection?.type).toBe('subscription');
      expect(selection.currentSelection?.node.name).toBe('email');
      expect((selection.currentSelection?.node.data as SubscriptionNodeData).topicName).toBe('order-events');
      expect(selection.currentSelection?.entity).toStrictEqual({ topicName: 'order-events', name: 'email' });
    });
  });

  describe('on-demand refresh of one entity', () => {
    it('reads one queue or one subscription now and shows its new counts in its row', () => {
      render();
      monitoring.getQueueCounts.mockReturnValue(of(queue('notifications', 7, 250, 1, 0)));
      monitoring.getSubscriptionCounts.mockReturnValue(of(subscription('order-events', 'warehouse', 3, 0)));

      button('Refresh the counts of notifications').click();
      button('Refresh the counts of warehouse').click();
      fixture.detectChanges();

      expect(monitoring.getQueueCounts.mock.calls).toStrictEqual([['notifications']]);
      expect(monitoring.getSubscriptionCounts.mock.calls).toStrictEqual([['order-events', 'warehouse']]);
      expect(rows()).toContainEqual(['notifications', 'Queue', '7', '250 over threshold', '1', '0']);
      expect(rows()).toContainEqual(['warehouse in order-events', 'Subscription', '3', '0', 'Not counted', '0']);
    });

    it('keeps a refreshed row until the API takes a new snapshot, not when the same snapshot is read again', () => {
      render();
      monitoring.getQueueCounts.mockReturnValue(of(queue('notifications', 7, 250, 1, 0)));
      button('Refresh the counts of notifications').click();
      fixture.detectChanges();

      fixture.componentRef.setInput('snapshot', { ...SNAPSHOT, queues: [...SNAPSHOT.queues] });
      fixture.detectChanges();
      expect(rows()).toContainEqual(['notifications', 'Queue', '7', '250 over threshold', '1', '0']);

      fixture.componentRef.setInput('snapshot', { ...SNAPSHOT, timestamp: '2026-11-13T09:00:30Z' });
      fixture.detectChanges();
      expect(rows()).toContainEqual(['notifications', 'Queue', '0', '0', '0', '0']);
    });

    it('keeps the counts of the last poll and says why when the read fails', () => {
      render();
      monitoring.getQueueCounts.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'The queue was not found.' } })) as Observable<never>);

      button('Refresh the counts of notifications').click();
      fixture.detectChanges();

      expect(text(el.querySelector('[role="alert"]'))).toBe('Could not refresh notifications: The queue was not found. The counts shown are from the last poll.');
      expect(rows()).toContainEqual(['notifications', 'Queue', '0', '0', '0', '0']);
    });
  });
});
