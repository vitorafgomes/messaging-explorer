import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProviderService } from '../../core/services/provider.service';
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
const HOST = 'sample.servicebus.example';
const status = (snapshot: MonitoringSnapshot | null, lastPollFailedAt: string | null = null): MonitoringStatus =>
  ({ snapshot, pollIntervalSeconds: 30, lastPollFailedAt });

describe('MonitoringComponent: loading, empty and error are three different states', () => {
  let fixture: ComponentFixture<MonitoringComponent>;
  let el: HTMLElement;
  let monitoring: { getHistory: ReturnType<typeof vi.fn>; getSnapshot: ReturnType<typeof vi.fn> };

  function render(answer: () => Observable<MonitoringStatus>, history: MonitoringSnapshot[] = [], capabilities: Record<string, boolean> = { supportsDeadLetterQueue: true }) {
    monitoring = { getHistory: vi.fn(() => of(history)), getSnapshot: vi.fn(answer) };
    TestBed.configureTestingModule({
      imports: [MonitoringComponent],
      providers: [
        provideRouter([]),
        { provide: MonitoringService, useValue: monitoring },
        { provide: ConnectionService, useValue: { isConnected: true, currentTarget: HOST, connectionStatus$: new Subject() } },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } }
      ]
    });
    fixture = TestBed.createComponent(MonitoringComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  afterEach(() => vi.useRealTimers());

  const text = (e: Element | null | undefined) => {
    const copy = e?.cloneNode(true) as Element | undefined;
    copy?.querySelectorAll('mat-icon').forEach(icon => icon.remove());
    return (copy?.textContent ?? '').replace(/\s+/g, ' ').trim();
  };
  const alert = () => text(el.querySelector('[role="alert"]'));
  const state = () => text(el.querySelector('.monitoring-state'));
  const icons = (e: Element | null) => Array.from(e?.querySelectorAll('mat-icon') ?? []).map(i => i.textContent?.trim());
  const headerButtons = () => Array.from(el.querySelectorAll('.monitoring-header button')).map(text);
  const tab = (label: string) => (Array.from(el.querySelectorAll('[role="tab"]')).find(t => text(t) === label) as HTMLElement).click();

  it('says it is loading from the connected namespace, draws four card blocks and three lines in place of the data, and offers no Refresh', () => {
    render(() => new Subject<MonitoringStatus>());

    expect(text(el.querySelector('.monitoring-loading p')), 'the loading line names the namespace being read').toBe(`Loading the monitoring data from ${HOST}`);
    expect(el.querySelectorAll('.skeleton-cards > div').length, 'four card blocks stand in for the four cards').toBe(4);
    expect(el.querySelectorAll('.skeleton-lines > div').length, 'three lines stand in for the tables').toBe(3);
    expect(headerButtons(), 'Refresh shows only with data').toStrictEqual([]);
    expect(el.querySelector('.last-update'), 'the last-update note shows only with data').toBeNull();
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('on a broker that reports no message counts it says the numbers are not counts of messages, and on one that reports them it says nothing', () => {
    render(() => of(status(SNAPSHOT)), [], { supportsDeadLetterQueue: true, supportsMessageCounts: false });
    expect(text(el.querySelector('[data-testid="no-counts-note"]'))).toBe('This broker does not report message counts: the numbers below are what it answers, not how many messages it holds.');

    TestBed.resetTestingModule();
    render(() => of(status(SNAPSHOT)));
    expect(el.querySelector('[data-testid="no-counts-note"]')).toBeNull();
  });

  it('says it waits for the first poll when the API has no snapshot yet and no poll failed, never that the namespace is empty', () => {
    render(() => of(status(null)));

    expect(state()).toBe("Waiting for the API's first poll of the broker");
  });

  it('says the namespace holds nothing only when a snapshot was read and holds no entity, with a chart icon and a way to Entities', () => {
    render(() => of(status(EMPTY)));

    expect(icons(el.querySelector('.monitoring-state')), 'a chart icon above the heading, a plus on the button').toStrictEqual(['show_chart', 'add']);
    expect(text(el.querySelector('.monitoring-state h2'))).toBe('Nothing to monitor in this namespace');
    expect(text(el.querySelector('.monitoring-state p')), 'the empty sentence names the namespace that answered').toBe(`${HOST} answered and holds no queue and no subscription. Counts appear here once an entity exists.`);
    const create = el.querySelector('.monitoring-state a') as HTMLAnchorElement;
    expect(text(create)).toBe('Create one in Entities');
    expect(create.getAttribute('href'), 'Create one in Entities leads to the Entities screen').toBe('/entities');
    expect(create.getAttribute('matbutton'), 'Create one in Entities is the tonal button').toBe('tonal');
    expect(headerButtons(), 'no Refresh without data').toStrictEqual([]);
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

  it('says the request to the namespace timed out after 30 seconds, with a warning icon and Retry, when the API does not answer in time', async () => {
    vi.useFakeTimers();
    render(() => new Subject<MonitoringStatus>());

    await vi.advanceTimersByTimeAsync(30_000);
    fixture.detectChanges();

    expect(icons(el.querySelector('[role="alert"]')), 'a warning icon, and Retry with the refresh icon').toStrictEqual(['warning', 'refresh']);
    expect(text(el.querySelector('[role="alert"] h2'))).toBe('Could not load the monitoring data');
    expect(text(el.querySelector('[role="alert"] p')), 'a request unanswered for 30 seconds is said to have timed out').toBe(`The request to ${HOST} timed out after 30 seconds. Nothing is shown because nothing was read, and nothing on the broker was changed.`);
    expect(headerButtons(), 'no header Refresh in the error state; Retry is in the error').toStrictEqual([]);
  });

  it('says why the request failed, never that it timed out, when the API answers an error or does not answer at all', () => {
    render(() => throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'The broker refused the request.' } })));
    expect(text(el.querySelector('[role="alert"] p')), 'an answered error is said as the API says it').toBe(`The request to ${HOST} failed: The broker refused the request. Nothing is shown because nothing was read, and nothing on the broker was changed.`);

    TestBed.resetTestingModule();
    render(() => throwError(() => new HttpErrorResponse({ status: 0 })));
    expect(text(el.querySelector('[role="alert"] p')), 'no answer at all is said as no answer').toBe(`The request to ${HOST} got no answer from the API. Nothing is shown because nothing was read, and nothing on the broker was changed.`);
    (el.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    expect(monitoring.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('keeps the last counts on screen and says they are from before a failed poll', () => {
    render(() => of(status(SNAPSHOT, '2026-11-13T09:00:30Z')));

    expect(alert()).toMatch(/^The API's last poll failed at \d\d:\d\d:\d\d\. These counts are from \d\d:\d\d:\d\d\.$/);
    expect(Array.from(el.querySelectorAll('[role="tab"]')).map(text)).toStrictEqual(['Overview', 'All entities']);
  });

  it('names the connected namespace above the title "Monitoring", which carries no icon', () => {
    render(() => of(status(SNAPSHOT)));

    expect(text(el.querySelector('.header-left .host')), 'the connection line sits above the title').toBe(HOST);
    expect(text(el.querySelector('.header-left h1'))).toBe('Monitoring');
    expect(el.querySelector('.header-left mat-icon'), 'the title has no icon').toBeNull();
  });

  it('says when the data was read and how often the screen refreshes on the Overview, and only when it was read on All entities', async () => {
    render(() => of(status(SNAPSHOT)));

    expect(text(el.querySelector('.last-update'))).toMatch(/^Last update \d\d:\d\d:\d\d\. Refreshes every 30 seconds\.$/);
    expect(headerButtons()).toStrictEqual(['Refresh']);
    expect(icons(el.querySelector('.monitoring-header button'))).toStrictEqual(['refresh']);

    tab('All entities');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(el.querySelector('.last-update')), 'the All entities note has no interval sentence').toMatch(/^Last update \d\d:\d\d:\d\d\.$/);
  });

  it('never reads faster than every 30 seconds, whatever period it is handed', async () => {
    vi.useFakeTimers();
    render(() => of(status(SNAPSHOT)));
    await vi.advanceTimersByTimeAsync(0);
    fixture.componentInstance.refreshSeconds.set(5);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    monitoring.getSnapshot.mockClear();

    await vi.advanceTimersByTimeAsync(29_000);
    expect(monitoring.getSnapshot, 'a 5-second period is held at the floor').not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(monitoring.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('reads the snapshot again at the period chosen in Refresh every, never faster than every 30 seconds', async () => {
    vi.useFakeTimers();
    render(() => of(status(SNAPSHOT)));
    tab('All entities');
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    const select = el.querySelector('select[name="refreshEvery"]') as HTMLSelectElement;
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    monitoring.getSnapshot.mockClear();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(monitoring.getSnapshot, 'at 1 minute nothing is read at 30 seconds').not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(monitoring.getSnapshot, 'at 1 minute the snapshot is read once a minute').toHaveBeenCalledTimes(1);

    tab('Overview');
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    expect(text(el.querySelector('.last-update')), 'the Overview says the period chosen').toMatch(/Refreshes every 1 minute\.$/);
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
    expect(deltas(1)).toStrictEqual(['events / audit +6', 'other / audit 0']);
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
      'Active messages over the last 2 polls, rising from 5 to 8',
      'Dead-letter messages over the last 2 polls, rising from 2 to 4'
    ]);
  });

  it('each sparkline says in its name whether the count is rising, falling or steady', () => {
    const before: MonitoringSnapshot = { ...SNAPSHOT, timestamp: '2026-11-13T09:00:00Z' };
    const after: MonitoringSnapshot = {
      ...SNAPSHOT,
      timestamp: '2026-11-13T09:00:30Z',
      queues: [{ ...SNAPSHOT.queues[0], activeMessageCount: 1, deadLetterMessageCount: 2 }]
    };
    render(() => of(status(after)), [before]);

    expect(Array.from(el.querySelectorAll('.trend svg')).map(svg => svg.getAttribute('aria-label')),
      'a count that went down is falling, one that did not move is steady').toStrictEqual([
      'Active messages over the last 2 polls, falling from 5 to 1',
      'Dead-letter messages over the last 2 polls, steady at 2'
    ]);
  });

  it('the Overview tables name their columns as drawn, a subscription under its topic, and the footnote says what Change is', () => {
    const snapshot: MonitoringSnapshot = { ...SNAPSHOT, subscriptions: [{ ...SNAPSHOT.queues[0], topicName: 'events', name: 'audit' }] };
    render(() => of(status(snapshot)));

    expect(Array.from(el.querySelectorAll('.table-section h3')).map(text)).toStrictEqual(['Queues (1)', 'Subscriptions (1)']);
    expect(Array.from(el.querySelectorAll('.table-section')).map(s => Array.from(s.querySelectorAll('th')).map(text))).toStrictEqual([
      ['Name', 'Active', 'Dead-letter', 'Transfer', 'Scheduled', 'Change'],
      ['Topic / Subscription', 'Active', 'Dead-letter', 'Transfer', 'Change']
    ]);
    expect(text(el.querySelectorAll('.table-section')[1].querySelector('td .topic-name')), 'the topic is set apart before the subscription').toBe('events');
    expect(text(el.querySelectorAll('.table-section')[1].querySelector('td')), 'a subscription reads "topic / subscription"').toBe('events / audit');
    expect(text(el.querySelector('.overview .footnote'))).toBe('Change is the difference in active messages since the last poll.');
  });

  it('groups the thousands of every count, total and change of the Overview', () => {
    const big = (active: number, deadLetter: number) => ({ ...SNAPSHOT.queues[0], activeMessageCount: active, deadLetterMessageCount: deadLetter, scheduledMessageCount: 1500 });
    const before: MonitoringSnapshot = { timestamp: '2026-11-13T09:00:00Z', queues: [big(52_000, 1_200)], subscriptions: [] };
    const after: MonitoringSnapshot = { timestamp: '2026-11-13T09:00:30Z', queues: [big(53_544, 2_041)], subscriptions: [] };
    render(() => of(status(after)), [before]);

    expect(Array.from(el.querySelectorAll('.summary-card .card-value')).slice(0, 2).map(text), 'the totals are grouped').toStrictEqual(['53,544', '2,041']);
    expect(text(el.querySelector('.summary-card .card-note')), 'the change is grouped').toBe('+1,544 since the last poll');
    expect(Array.from(el.querySelectorAll('.trend-range')).map(text), 'the trend ranges are grouped').toStrictEqual(['52,000 to 53,544', '1,200 to 2,041']);
    expect(Array.from(el.querySelector('.table-section tbody tr')!.querySelectorAll('td')).map(text), 'the queue row is grouped').toStrictEqual(['orders', '53,544', '2,041', '0', '1,500', '+1,544']);
  });

  it('marks a dead-letter count above zero with the warning icon, in the Overview card and in the queue table', () => {
    render(() => of(status(SNAPSHOT)));

    expect(icons(el.querySelector('.summary-card.attention .card-label')), 'the dead-letter card carries the warning icon').toStrictEqual(['warning']);
    expect(icons(el.querySelector('.table-section .dead-letter')), 'the dead-letter pill carries the warning icon').toStrictEqual(['warning']);
  });

  it('opens the counts of every entity on the All entities tab, and creates them only when that tab is opened', async () => {
    const created = vi.spyOn(Storage.prototype, 'getItem');
    render(() => of(status(SNAPSHOT)));
    expect(created.mock.calls.filter(([key]) => key === DEAD_LETTER_THRESHOLD_KEY)).toStrictEqual([]);

    tab('All entities');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(created.mock.calls.filter(([key]) => key === DEAD_LETTER_THRESHOLD_KEY)).toStrictEqual([[DEAD_LETTER_THRESHOLD_KEY]]);
    created.mockRestore();
    const row = el.querySelector('app-monitoring-counts tr.count-row');
    expect(Array.from(row!.querySelectorAll('td')).slice(0, 6).map(text)).toStrictEqual(['orders', 'Queue', '5', '2', '1', '0']);
  });
});
