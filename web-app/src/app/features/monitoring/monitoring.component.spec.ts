import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { MonitoringSnapshot, MonitoringStatus } from '../../core/models';
import { ConnectionService, MonitoringService } from '../../core/services';
import { MonitoringComponent } from './monitoring.component';

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

  it('opens the counts of every entity on the All entities tab', async () => {
    render(() => of(status(SNAPSHOT)));

    (Array.from(el.querySelectorAll('[role="tab"]')).find(t => text(t) === 'All entities') as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const row = el.querySelector('app-monitoring-counts tr.count-row');
    expect(Array.from(row!.querySelectorAll('td')).slice(0, 6).map(text)).toStrictEqual(['orders', 'Queue', '5', '2', '1', '0']);
    expect(text(el.querySelector('.last-update'))).toMatch(/^Last update \d\d:\d\d:\d\d\. The API reads the broker every 30 seconds\.$/);
  });
});
