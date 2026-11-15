import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ConnectionService } from '../../core/services';
import { MetricsService } from '../../core/services/metrics.service';
import { MetricsData, MetricsTimeRange } from '../../core/models';
import { METRICS_FAILURES, MonitoringMetricsComponent } from './monitoring-metrics.component';

describe('MonitoringMetricsComponent: the Azure Monitor metrics of the namespace', () => {
  let calls: { id: string; range: MetricsTimeRange }[];

  function render(answer: () => Observable<MetricsData>) {
    calls = [];
    TestBed.configureTestingModule({
      imports: [MonitoringMetricsComponent],
      providers: [
        { provide: ConnectionService, useValue: { currentConnectionId: 'c1', currentTarget: 'contoso-test.servicebus.windows.net' } },
        { provide: MetricsService, useValue: { getNamespaceMetrics: (id: string, range: MetricsTimeRange) => { calls.push({ id, range }); return answer(); } } }
      ]
    });
    const fixture = TestBed.createComponent(MonitoringMetricsComponent);
    fixture.detectChanges();
    return fixture;
  }

  const text = (host: HTMLElement) => host.textContent?.replace(/\s+/g, ' ') ?? '';
  const refused = (code: string, status = 409) => () => throwError(() => new HttpErrorResponse({ status, error: { code, message: 'API TEXT NEVER SHOWN' } }));
  const t0 = new Date('2026-11-14T10:00:00Z');
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
  const data: MetricsData = {
    startTime: t0,
    endTime: at(60),
    series: [
      { name: 'IncomingMessages', data: [{ timestamp: at(0), value: 10 }, { timestamp: at(1), value: 20 }, { timestamp: at(5), value: 5 }] },
      { name: 'ActiveMessages', data: [{ timestamp: at(0), value: 7 }, { timestamp: at(1), value: 9 }] },
      { name: 'ServerErrors', data: [] }
    ]
  };

  it('reads the connected namespace over the last hour and says it is reading while the answer is pending', () => {
    const fixture = render(() => new Subject<MetricsData>());
    const host = fixture.nativeElement as HTMLElement;

    expect(calls).toEqual([{ id: 'c1', range: MetricsTimeRange.OneHour }]);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Reading the Azure Monitor metrics of contoso-test.servicebus.windows.net');
    expect(host.querySelectorAll('.metric-card').length).toBe(0);
  });

  it('draws a card per metric: a count as its total, a gauge as its last value, a missing grain as a break in the line, and no data as "No data"', () => {
    const fixture = render(() => of(data));
    const host = fixture.nativeElement as HTMLElement;
    const cards = Array.from(host.querySelectorAll('.metric-card')).map(card => ({
      label: card.querySelector('.metric-label')?.textContent?.trim(),
      value: card.querySelector('.metric-value')?.textContent?.trim(),
      lines: card.querySelectorAll('polyline').length
    }));

    expect(cards).toEqual([
      { label: 'Incoming messages', value: '35', lines: 2 },
      { label: 'Outgoing messages', value: 'No data', lines: 0 },
      { label: 'Active messages', value: '9', lines: 1 },
      { label: 'Dead-lettered messages', value: 'No data', lines: 0 },
      { label: 'Server errors', value: 'No data', lines: 0 },
      { label: 'Throttled requests', value: 'No data', lines: 0 }
    ]);
  });

  it('Last day reads the day, and cancels the read still in flight', () => {
    const pending = new Subject<MetricsData>();
    let answers = 0;
    const fixture = render(() => (answers++ === 0 ? pending : of(data)));
    const host = fixture.nativeElement as HTMLElement;

    (Array.from(host.querySelectorAll('mat-button-toggle button')).find(b => b.textContent?.includes('Last day')) as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(calls.map(c => c.range)).toEqual([MetricsTimeRange.OneHour, MetricsTimeRange.TwentyFourHours]);
    expect(pending.observed).toBe(false);
    expect(host.querySelectorAll('.metric-card').length).toBe(6);
  });

  it('a connection string connection says metrics need a sign-in with Entra ID and the resource ID', () => {
    const host = render(refused('connection-string')).nativeElement as HTMLElement;

    expect(text(host)).toContain('Metrics need a sign-in with Entra ID');
    expect(text(host)).toContain('give it the Azure resource ID of the namespace');
    expect(host.querySelectorAll('.metric-card').length).toBe(0);
  });

  it('a connection without the resource ID says how to add it', () => {
    const host = render(refused('no-resource-id')).nativeElement as HTMLElement;

    expect(text(host)).toContain('Metrics need the Azure resource ID of the namespace');
    expect(host.querySelectorAll('.metric-card').length).toBe(0);
  });

  it('a refused read names the Monitoring Reader role and offers Retry, which reads again', () => {
    const fixture = render(refused('forbidden', 502));
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('needs the Monitoring Reader role on the namespace');
    (Array.from(host.querySelectorAll('[role="alert"] button')).find(b => b.textContent?.includes('Retry')) as HTMLButtonElement).click();
    expect(calls.length).toBe(2);
  });

  it.each([
    ['failed', 502, METRICS_FAILURES.failed],
    ['sign-in', 502, METRICS_FAILURES['sign-in']],
    [undefined, 500, METRICS_FAILURES.failed],
    [undefined, 0, METRICS_FAILURES.failed]
  ])('a failed read (%s, %s) says why with a fixed text and never draws made-up or empty series', (code, status, expected) => {
    const host = render(() => throwError(() => new HttpErrorResponse({ status, error: code ? { code, message: 'API TEXT NEVER SHOWN' } : null }))).nativeElement as HTMLElement;

    expect(host.querySelector('[role="alert"]')?.textContent, 'A failure is an error with its fixed text').toContain(expected);
    expect(text(host)).not.toContain('API TEXT NEVER SHOWN');
    expect(host.querySelectorAll('.metric-card').length, 'Nothing is drawn when nothing was read').toBe(0);
  });
});
