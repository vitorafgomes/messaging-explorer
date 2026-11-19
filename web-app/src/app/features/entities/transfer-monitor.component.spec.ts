import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TransferMonitorComponent } from './transfer-monitor.component';
import { QueueService, TopicService } from '../../core/services';
import { SubscriptionInfo } from '../../core/models';

// Helper to build a mock SubscriptionInfo with a given activeMessageCount
function createMockSubscription(activeMessageCount: number): SubscriptionInfo {
  return {
    topicName: 'test-topic',
    name: 'test-sub',
    activeMessageCount,
    deadLetterMessageCount: 0,
    transferMessageCount: 0,
    scheduledMessageCount: 0,
    transferDeadLetterMessageCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    accessedAt: new Date(),
    defaultMessageTimeToLive: 'P14D',
    autoDeleteOnIdle: 'P10675199DT2H48M5.4775807S',
    lockDuration: 'PT1M',
    maxDeliveryCount: 10,
    requiresSession: false,
    deadLetteringOnMessageExpiration: false,
    deadLetteringOnFilterEvaluationExceptions: false,
    enableBatchedOperations: true,
    status: 'Active',
    rules: [],
  };
}

describe('TransferMonitorComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function monitor(topicName: string | null, entityName: string, services: { getSubscription?: unknown; getQueue?: unknown }) {
    TestBed.configureTestingModule({
      imports: [TransferMonitorComponent],
      providers: [
        { provide: TopicService, useValue: { getSubscription: services.getSubscription } },
        { provide: QueueService, useValue: { getQueue: services.getQueue } }
      ],
    });
    const fixture = TestBed.createComponent(TransferMonitorComponent);
    fixture.componentRef.setInput('topicName', topicName);
    fixture.componentRef.setInput('entityName', entityName);
    const emitted: number[] = [];
    fixture.componentInstance.countsRead.subscribe(counts => emitted.push(counts.activeMessageCount));
    fixture.detectChanges();
    TestBed.tick();
    return { fixture, emitted };
  }

  it('reads the subscription every 3 seconds and emits each read; a failed read is skipped and the next one still comes', () => {
    vi.useFakeTimers();
    let calls = 0;
    const getSubscription = vi.fn(() => (++calls === 2 ? throwError(() => new Error('timeout')) : of(createMockSubscription(calls * 10))));
    const { fixture, emitted } = monitor('test-topic', 'test-sub', { getSubscription });

    vi.advanceTimersByTime(6000);

    expect(getSubscription, 'the subscription of its inputs').toHaveBeenCalledWith('test-topic', 'test-sub');
    expect(emitted, 'the first read at once, the failed second skipped, the third emitted').toStrictEqual([10, 30]);
    expect((fixture.nativeElement as HTMLElement).textContent?.trim(), 'it draws nothing: the panel draws the Active card').toBe('');
  });

  it('a read that throws at once is skipped like a failed read, and the next one still comes', () => {
    vi.useFakeTimers();
    let calls = 0;
    const getQueue = vi.fn(() => {
      if (++calls === 1) throw new TypeError('no such method');
      return of({ activeMessageCount: 7, deadLetterMessageCount: 0 });
    });
    const { emitted } = monitor(null, 'orders', { getQueue });

    vi.advanceTimersByTime(3000);

    expect(emitted).toStrictEqual([7]);
  });

  it('reads a queue the same way when no topic is given', () => {
    vi.useFakeTimers();
    let calls = 0;
    const getQueue = vi.fn(() => of({ activeMessageCount: ++calls, deadLetterMessageCount: 0 }));
    const { emitted } = monitor(null, 'orders', { getQueue });

    vi.advanceTimersByTime(3000);

    expect(getQueue).toHaveBeenCalledWith('orders');
    expect(emitted).toStrictEqual([1, 2]);
  });

  it('reads at once when another entity is shown, and no longer reads the one before', () => {
    vi.useFakeTimers();
    const getQueue = vi.fn((name: string) => of({ activeMessageCount: name === 'orders' ? 1 : 2, deadLetterMessageCount: 0 }));
    const { fixture, emitted } = monitor(null, 'orders', { getQueue });
    vi.advanceTimersByTime(0);

    fixture.componentRef.setInput('entityName', 'invoices');
    fixture.detectChanges();
    TestBed.tick();
    vi.advanceTimersByTime(3000);

    expect(emitted, 'orders once, then invoices at once and again after 3 seconds').toStrictEqual([1, 2, 2]);
    expect(getQueue.mock.calls.map(c => c[0])).toStrictEqual(['orders', 'invoices', 'invoices']);
  });

  it('does not read while the window is hidden, and reads again once it is shown', () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const getQueue = vi.fn(() => of({ activeMessageCount: 5, deadLetterMessageCount: 0 }));
    const { emitted } = monitor(null, 'orders', { getQueue });

    vi.advanceTimersByTime(6000);
    expect(getQueue, 'while hidden').not.toHaveBeenCalled();

    hidden.mockReturnValue(false);
    vi.advanceTimersByTime(3000);
    expect(emitted, 'shown again').toStrictEqual([5]);
  });
});
