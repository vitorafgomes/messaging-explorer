import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { MonitoringSnapshot, MonitoringStatus } from '../../core/models';
import { ConnectionService, MonitoringService } from '../../core/services';
import { MonitoringComponent } from './monitoring.component';
import { DEAD_LETTER_THRESHOLD_KEY } from './monitoring-counts.component';

const SNAPSHOT: MonitoringSnapshot = {
  timestamp: '2026-11-13T09:00:00Z',
  queues: [{ name: 'orders', activeMessageCount: 5, deadLetterMessageCount: 2, transferMessageCount: 0, scheduledMessageCount: 1, transferDeadLetterMessageCount: 0 }],
  subscriptions: []
};
const EMPTY: MonitoringSnapshot = { timestamp: '2026-11-13T09:00:00Z', queues: [], subscriptions: [] };
const status = (snapshot: MonitoringSnapshot | null, lastPollFailedAt: string | null = null): MonitoringStatus =>
  ({ snapshot, pollIntervalSeconds: 30, lastPollFailedAt });

describe('MonitoringComponent: loading, empty and error are three different states', () => {
  let fixture: ComponentFixture<MonitoringComponent>;
  let el: HTMLElement;
  let monitoring: { getHistory: ReturnType<typeof vi.fn>; getSnapshot: ReturnType<typeof vi.fn> };

  function render(answer: () => Observable<MonitoringStatus>, history: MonitoringSnapshot[] = []) {
    monitoring = { getHistory: vi.fn(() => of(history)), getSnapshot: vi.fn(answer) };
    TestBed.configureTestingModule({
      imports: [MonitoringComponent],
      providers: [
        provideRouter([]),
        { provide: MonitoringService, useValue: monitoring },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: new Subject() } }
      ]
    });
    fixture = TestBed.createComponent(MonitoringComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const text = (e: Element | null | undefined) => {
    const copy = e?.cloneNode(true) as Element | undefined;
    copy?.querySelectorAll('mat-icon').forEach(icon => icon.remove());
    return (copy?.textContent ?? '').replace(/\s+/g, ' ').trim();
  };
  const alert = () => text(el.querySelector('[role="alert"]'));
  const state = () => text(el.querySelector('.monitoring-state'));

  it('says it is loading while the API has not answered', () => {
    render(() => new Subject<MonitoringStatus>());

    expect(state()).toBe('Loading the monitoring data');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('says it waits for the first poll when the API has no snapshot yet and no poll failed, never that the namespace is empty', () => {
    render(() => of(status(null)));

    expect(state()).toBe("Waiting for the API's first poll of the broker");
  });

  it('says the namespace holds nothing only when a snapshot was read and holds no entity', () => {
    render(() => of(status(EMPTY)));

    expect(text(el.querySelector('.monitoring-state h3'))).toBe('Nothing to monitor in this namespace');
    expect(text(el.querySelector('.monitoring-state p'))).toBe('The broker answered and holds no queue and no subscription. Counts appear here once an entity exists.');
  });

  it('says the poll of the broker failed, with Retry, when no snapshot was ever read', () => {
    render(() => of(status(null, '2026-11-13T09:00:30Z')));

    expect(alert()).toContain('Could not read the counts from the broker');
    expect(alert()).toContain('Nothing is shown because nothing was read');
    expect(el.querySelector('table')).toBeNull();
    const retry = Array.from(el.querySelectorAll('[role="alert"] button')).find(b => text(b) === 'Retry') as HTMLButtonElement;
    retry.click();
    expect(monitoring.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('says the API did not answer, with Retry, when the request fails', () => {
    render(() => throwError(() => new HttpErrorResponse({ status: 0 })));

    expect(text(el.querySelector('[role="alert"] h3'))).toBe('Could not load the monitoring data');
    expect(text(el.querySelector('[role="alert"] p'))).toBe('The API did not answer the request for the monitoring data. Nothing is shown because nothing was read, and nothing on the broker was changed.');
    expect(text(el.querySelector('[role="alert"] button'))).toBe('Retry');
  });

  it('keeps the last counts on screen and says they are from before a failed poll', () => {
    render(() => of(status(SNAPSHOT, '2026-11-13T09:00:30Z')));

    expect(alert()).toMatch(/^The API's last poll failed at \d\d:\d\d:\d\d\. These counts are from \d\d:\d\d:\d\d\.$/);
    expect(Array.from(el.querySelectorAll('[role="tab"]')).map(text)).toStrictEqual(['Overview', 'All entities']);
  });

  it('shows the change in active messages of each queue and subscription since the previous snapshot', () => {
    const before: MonitoringSnapshot = {
      timestamp: '2026-11-13T09:00:00Z',
      queues: [SNAPSHOT.queues[0], { ...SNAPSHOT.queues[0], name: 'billing', activeMessageCount: 9 }],
      subscriptions: [{ ...SNAPSHOT.queues[0], topicName: 'events', name: 'audit', activeMessageCount: 4 }]
    };
    const after: MonitoringSnapshot = {
      timestamp: '2026-11-13T09:00:30Z',
      queues: [{ ...SNAPSHOT.queues[0], activeMessageCount: 8 }, { ...SNAPSHOT.queues[0], name: 'billing', activeMessageCount: 2 }, { ...SNAPSHOT.queues[0], name: 'new-queue', activeMessageCount: 1 }],
      subscriptions: [{ ...SNAPSHOT.queues[0], topicName: 'events', name: 'audit', activeMessageCount: 10 }, { ...SNAPSHOT.queues[0], topicName: 'other', name: 'audit', activeMessageCount: 3 }]
    };
    render(() => of(status(after)), [before]);

    const deltas = (section: number) => Array.from(el.querySelectorAll('.table-section')[section].querySelectorAll('tbody tr'))
      .map(r => { const cells = r.querySelectorAll('td'); return `${text(cells[0])} ${text(cells[cells.length - 1])}`; });
    expect(deltas(0)).toStrictEqual(['orders +3', 'billing -7', 'new-queue 0']);
    expect(deltas(1)).toStrictEqual(['events/audit +6', 'other/audit 0']);
  });

  it('the Overview says each total with its change since the last poll and draws the trend of active and dead-letter messages from the first poll to the last', () => {
    const before: MonitoringSnapshot = { ...SNAPSHOT, timestamp: '2026-11-13T09:00:00Z' };
    const after: MonitoringSnapshot = {
      timestamp: '2026-11-13T09:00:30Z',
      queues: [{ ...SNAPSHOT.queues[0], activeMessageCount: 8, deadLetterMessageCount: 4 }],
      subscriptions: [{ ...SNAPSHOT.queues[0], topicName: 'events', name: 'audit', activeMessageCount: 0, deadLetterMessageCount: 0 }]
    };
    render(() => of(status(after)), [before]);

    expect(Array.from(el.querySelectorAll('.summary-card')).map(card => Array.from(card.children).map(text).join(' '))).toStrictEqual([
      'Active 8 +3 since the last poll',
      'Dead-letter 4 +2 since the last poll',
      'Transfer 0 On their way to another entity',
      'Monitored entities 2 1 queue, 1 subscription'
    ]);
    expect(text(el.querySelector('.trend-section h3'))).toBe('Message trend, last 2 polls');
    expect(Array.from(el.querySelectorAll('.trend figcaption')).map(caption => Array.from(caption.children).map(text).join(' '))).toStrictEqual(['Active 5 to 8', 'Dead-letter 2 to 4']);
    expect(Array.from(el.querySelectorAll('.trend svg')).map(svg => svg.getAttribute('aria-label'))).toStrictEqual([
      'Active messages over the last 2 polls, from 5 to 8',
      'Dead-letter messages over the last 2 polls, from 2 to 4'
    ]);
  });

  it('opens the counts of every entity on the All entities tab, and creates them only when that tab is opened', async () => {
    const created = vi.spyOn(Storage.prototype, 'getItem');
    render(() => of(status(SNAPSHOT)));
    expect(created.mock.calls.filter(([key]) => key === DEAD_LETTER_THRESHOLD_KEY)).toStrictEqual([]);

    (Array.from(el.querySelectorAll('[role="tab"]')).find(t => text(t) === 'All entities') as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(created.mock.calls.filter(([key]) => key === DEAD_LETTER_THRESHOLD_KEY)).toStrictEqual([[DEAD_LETTER_THRESHOLD_KEY]]);
    created.mockRestore();
    const row = el.querySelector('app-monitoring-counts tr.count-row');
    expect(Array.from(row!.querySelectorAll('td')).slice(0, 6).map(text)).toStrictEqual(['orders', 'Queue', '5', '2', '1', '0']);
    expect(text(el.querySelector('.last-update'))).toMatch(/^Last update \d\d:\d\d:\d\d\. The API reads the broker every 30 seconds\.$/);
  });
});
