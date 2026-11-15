import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, of } from 'rxjs';
import { MonitoringEntity, MonitoringSnapshot, MonitoringSubscription, ProviderCapabilities, SubscriptionNodeData } from '../../core/models';
import { ConnectionService, EntitySelectionService, QueueService, TopicService } from '../../core/services';
import { ProviderService } from '../../core/services/provider.service';
import { ContinuousResubmitDialogComponent } from '../messages/continuous-resubmit-dialog.component';
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
  function render(snapshot: MonitoringSnapshot = SNAPSHOT, capabilities: Partial<ProviderCapabilities> | null = { supportsDeadLetterQueue: true }) {
    TestBed.configureTestingModule({
      imports: [MonitoringCountsComponent],
      providers: [
        provideRouter([{ path: 'entities', component: EntitiesStubComponent }]),
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } },
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

  describe('the words of the screen', () => {
    it('names the filter, the threshold and every column as drawn', () => {
      render();
      const field = (name: string) => el.querySelector(`[name="${name}"]`)!.closest('mat-form-field')!;

      expect(text(field('filter').querySelector('mat-label'))).toBe('Filter by name');
      expect(el.querySelector('input[name="filter"]')!.getAttribute('placeholder')).toBe('Part of a name');
      expect(field('filter').querySelector('mat-icon')?.textContent?.trim(), 'the filter carries the search icon').toBe('search');
      expect(text(field('threshold').querySelector('mat-label'))).toBe('Dead-letter threshold');
      expect(text(field('threshold').querySelector('mat-hint'))).toBe('A row above it is marked.');
      expect(Array.from(el.querySelectorAll('th')).map(text)).toStrictEqual(['Name', 'Kind', 'Active', 'Dead-letter', 'Scheduled', 'Transfer dead-letter', 'Actions']);
    });
  });

  describe('the period the screen refreshes at', () => {
    it('offers Refresh every 30 seconds, 1 minute or 5 minutes, says 30 seconds is the floor, and hands the choice to the screen', () => {
      render();
      const select = el.querySelector('select[name="refreshEvery"]') as HTMLSelectElement;

      expect(text(select.closest('mat-form-field')!.querySelector('mat-label'))).toBe('Refresh every');
      expect(Array.from(select.options).map(o => o.textContent?.trim()), 'the three periods, none below 30 seconds').toStrictEqual(['30 seconds', '1 minute', '5 minutes']);
      expect(select.value, 'the screen starts at the floor').toBe('30');
      expect(text(select.closest('mat-form-field')!.querySelector('mat-hint'))).toBe('30 seconds is the floor.');

      select.value = '300';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(fixture.componentInstance.refreshSeconds(), 'the period chosen reaches the screen that polls').toBe(300);
    });

    it('a period that is not offered changes nothing', () => {
      render();
      fixture.componentInstance.onRefreshEvery('5');
      expect(fixture.componentInstance.refreshSeconds()).toBe(30);
    });
  });

  describe('auto resubmit from a row', () => {
    it('offers Auto resubmit only on a row whose dead-letter count is above zero, named with the count and the entity', () => {
      render();

      const offered = Array.from(el.querySelectorAll('tr.count-row')).map(r => {
        const link = r.querySelector('td.actions button');
        return [text(r.querySelector('td')), link?.getAttribute('aria-label') ?? null, link ? text(link) : null];
      });
      expect(offered).toStrictEqual([
        ['orders', 'Auto resubmit the 700,000 dead-letter messages of orders', 'Auto resubmit'],
        ['email in order-events', 'Auto resubmit the 4 dead-letter messages of email', 'Auto resubmit'],
        ['billing/invoices', null, null],
        ['notifications', null, null],
        ['orders-archive', null, null],
        ['warehouse in order-events', null, null]
      ]);
      expect(el.querySelector('td.actions button mat-icon')?.textContent?.trim(), 'the link carries the arrow').toBe('arrow_forward');
    });

    it('offers no Auto resubmit where the provider says it has no dead-letter queue, as the entity panel does', () => {
      render(SNAPSHOT, { supportsDeadLetterQueue: false });

      expect(el.querySelectorAll('td.actions button').length, 'a provider without a dead-letter queue gets no Auto resubmit').toBe(0);
    });

    it('offers Auto resubmit on RabbitMQ too, which declares no safe delete or move but resubmits safely', () => {
      render(SNAPSHOT, { supportsDeadLetterQueue: true, supportsBulkMessageOperations: false });

      expect(el.querySelectorAll('td.actions button').length, 'one per row with dead-letter messages').toBe(2);
    });

    it('opens the auto resubmit of that queue, or of that subscription of its topic, with its dead-letter count', async () => {
      render();
      const dialog = TestBed.inject(MatDialog) as unknown as { open: ReturnType<typeof vi.fn> };

      button('Auto resubmit the 700,000 dead-letter messages of orders').click();
      button('Auto resubmit the 4 dead-letter messages of email').click();
      await vi.waitFor(() => expect(dialog.open).toHaveBeenCalledTimes(2));

      expect(dialog.open.mock.calls.map(([component]) => component), 'the auto resubmit dialog is what opens').toStrictEqual([ContinuousResubmitDialogComponent, ContinuousResubmitDialogComponent]);
      expect(dialog.open.mock.calls.map(([, config]) => config.data)).toStrictEqual([
        { entityType: 'queue', entityName: 'orders', topicName: undefined, deadLetterMessageCount: 700000 },
        { entityType: 'subscription', entityName: 'email', topicName: 'order-events', deadLetterMessageCount: 4 }
      ]);
    });

    it('says under the table what a name and Auto resubmit do and that a subscription has no scheduled count', () => {
      render();

      expect(text(el.querySelector('.footnote'))).toBe('A name opens the entity. Auto resubmit is offered where dead-letter messages wait. A subscription has no scheduled count.');
    });
  });
});
