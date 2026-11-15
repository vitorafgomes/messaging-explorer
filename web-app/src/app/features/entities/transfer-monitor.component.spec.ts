import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TransferMonitorComponent } from './transfer-monitor.component';
import { TopicService } from '../../core/services';
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
  afterEach(() => vi.useRealTimers());

  it('reads the subscription every 3 seconds and emits each read; a failed read is skipped and the next one still comes', () => {
    vi.useFakeTimers();
    let calls = 0;
    const getSubscription = vi.fn(() => (++calls === 2 ? throwError(() => new Error('timeout')) : of(createMockSubscription(calls * 10))));
    TestBed.configureTestingModule({
      imports: [TransferMonitorComponent],
      providers: [{ provide: TopicService, useValue: { getSubscription } }],
    });
    const fixture = TestBed.createComponent(TransferMonitorComponent);
    fixture.componentRef.setInput('topicName', 'test-topic');
    fixture.componentRef.setInput('subscriptionName', 'test-sub');
    const emitted: number[] = [];
    fixture.componentInstance.subscriptionUpdated.subscribe(sub => emitted.push(sub.activeMessageCount));
    fixture.detectChanges();

    vi.advanceTimersByTime(6000);

    expect(getSubscription, 'the subscription of its inputs').toHaveBeenCalledWith('test-topic', 'test-sub');
    expect(emitted, 'the first read at once, the failed second skipped, the third emitted').toStrictEqual([10, 30]);
    expect((fixture.nativeElement as HTMLElement).textContent?.trim(), 'it draws nothing: the panel draws the Active card').toBe('');
  });
});
