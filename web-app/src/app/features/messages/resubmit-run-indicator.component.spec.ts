import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { ResubmitRunIndicatorComponent } from './resubmit-run-indicator.component';
import { ContinuousResubmitDialogComponent } from './continuous-resubmit-dialog.component';
import { ResubmitRun, ResubmitRunService } from '../../core/services';

function fakeRun(entityName: string, read: number, total: number, topicName?: string): ResubmitRun {
  return {
    target: { entityType: topicName ? 'subscription' : 'queue', entityName, topicName, subQueue: 'deadletter' },
    connection: 'sample.example.net',
    progress: signal({ status: 'running', read, total, failed: 9, possibleDuplicates: 3, remainingMs: 4_380_000 })
  } as unknown as ResubmitRun;
}

const flush = () => new Promise(resolve => setTimeout(resolve));
const text = (e: Element | null | undefined) => {
  const copy = e?.cloneNode(true) as Element | undefined;
  copy?.querySelectorAll('mat-icon').forEach(icon => icon.remove());
  return (copy?.textContent ?? '').replace(/\s+/g, ' ').trim();
};

describe('ResubmitRunIndicatorComponent', () => {
  let activeRuns: ReturnType<typeof signal<ResubmitRun[]>>;
  let dialog: { open: ReturnType<typeof vi.fn> };

  function render(environment?: string | null) {
    TestBed.configureTestingModule({
      imports: [ResubmitRunIndicatorComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ResubmitRunService, useValue: { activeRuns } },
        { provide: MatDialog, useValue: dialog }
      ]
    });
    const fixture = TestBed.createComponent(ResubmitRunIndicatorComponent);
    fixture.componentRef.setInput('environment', environment);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    activeRuns = signal<ResubmitRun[]>([]);
    dialog = { open: vi.fn() };
  });

  it('draws nothing while no run is active', () => {
    expect((render('Production').nativeElement as HTMLElement).querySelector('.run-card')).toBeNull();
  });

  it('the card of a run, as the bell opens it: the run, where it reads and sends on the environment and the connection, its bar, the time left and what was left behind, with Open, Pause and Stop', () => {
    activeRuns.set([fakeRun('orders', 480_000, 700_000)]);
    const card = (render('Production').nativeElement as HTMLElement).querySelector('.run-card')!;

    expect(text(card?.querySelector('strong'))).toBe('Resubmit running: 480,000 of 700,000');
    expect(text(card?.querySelector('.where')), 'the environment and the connection, as drawn').toBe('Dead-letter of orders, back to the queue. Production, sample.example.net.');
    expect(card?.querySelector('mat-progress-bar')?.getAttribute('aria-valuenow'), 'the bar').toBe('69');
    expect(text(card?.querySelector('.left'))).toBe('About 1 h 13 min left. 12 left behind, 3 of them possible duplicates.');
    expect(Array.from(card?.querySelectorAll('button') ?? []).map(text)).toStrictEqual(['Open', 'Pause', 'Stop']);
  });

  it('with no environment the card names the connection alone', () => {
    activeRuns.set([fakeRun('eu', 2, 5, 'sales')]);
    const card = (render(null).nativeElement as HTMLElement).querySelector('.run-card');

    expect(text(card?.querySelector('.where'))).toBe('Dead-letter of eu, back to the topic sales. sample.example.net.');
  });

  it('Stop on the card stops the run the way the dialog does: the request in flight is aborted and its messages are reported as possible duplicates', async () => {
    let aborted = false;
    const old = { enqueuedTime: '2020-01-01T00:00:00Z', deadLetterReason: 'MaxDeliveryCountExceeded' };
    const broker = {
      count: () => of({ count: 2, lockWaitMs: 0 }),
      peek: () => of([{ sequenceNumber: 1, ...old }, { sequenceNumber: 2, ...old }]),
      resubmit: () => new Observable(() => () => { aborted = true; })
    };
    const run = new ResubmitRun({ entityType: 'queue', entityName: 'orders', subQueue: 'deadletter' }, { batchSize: 2, stopAtFirstFailure: false },
      'sample.example.net', 0, broker as never, () => Date.now(), () => Promise.resolve());
    await flush();
    activeRuns.set([run]);
    const fixture = render();
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.run-card button')).find(b => text(b) === 'Stop')!.click();
    await flush();

    expect(aborted, 'the resubmit in flight is aborted').toBe(true);
    expect(run.progress().status, 'the run is stopped').toBe('stopped');
    expect(run.possibleDuplicates.map(entry => entry.sequenceNumber), 'its messages may have been sent and are reported as possible duplicates').toEqual([1, 2]);
  });

  it('opening a run from its card opens the resubmit dialog of that entity, which shows the run', async () => {
    const run = fakeRun('eu', 2, 5, 'sales');
    activeRuns.set([fakeRun('orders', 480_000, 700_000), run]);
    const component = render().componentInstance;

    await component.open(run);

    expect(dialog.open).toHaveBeenCalledWith(ContinuousResubmitDialogComponent, expect.objectContaining({
      data: { entityType: 'subscription', entityName: 'eu', topicName: 'sales' }
    }));
  });
});
