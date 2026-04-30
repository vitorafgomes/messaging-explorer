import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
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
  let activeCount: number;
  let topicServiceMock: { getSubscription: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    activeCount = 10;
    topicServiceMock = {
      getSubscription: vi.fn().mockImplementation(() => of(createMockSubscription(activeCount))),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createComponent() {
    TestBed.configureTestingModule({
      imports: [TransferMonitorComponent],
      providers: [
        { provide: TopicService, useValue: topicServiceMock },
      ],
    });
    const fixture = TestBed.createComponent(TransferMonitorComponent);
    fixture.componentRef.setInput('topicName', 'test-topic');
    fixture.componentRef.setInput('subscriptionName', 'test-sub');
    fixture.detectChanges(); // triggers ngOnInit -> startPolling -> startWith(0) -> immediate first poll
    return { fixture, component: fixture.componentInstance };
  }

  it('should be created', () => {
    const { component } = createComponent();
    expect(component).toBeTruthy();
  });

  it('should start with zero values', () => {
    TestBed.configureTestingModule({
      imports: [TransferMonitorComponent],
      providers: [
        { provide: TopicService, useValue: topicServiceMock },
      ],
    });
    const fixture = TestBed.createComponent(TransferMonitorComponent);
    const component = fixture.componentInstance;
    // Before detectChanges (ngOnInit), check signal defaults
    expect(component.currentCount()).toBe(0);
    expect(component.delta()).toBe(0);
    expect(component.peak()).toBe(0);
    expect(component.totalProcessed()).toBe(0);
    expect(component.processingRate()).toBe('0');
  });

  it('should update currentCount from polling', () => {
    activeCount = 42;
    topicServiceMock.getSubscription.mockImplementation(() => of(createMockSubscription(42)));

    const { component } = createComponent();
    // startWith(0) + of() => first poll fires synchronously
    expect(component.currentCount()).toBe(42);
  });

  it('should calculate positive delta when count increases', () => {
    let count = 10;
    topicServiceMock.getSubscription.mockImplementation(() => of(createMockSubscription(count)));

    const { component } = createComponent();
    // First poll: count = 10, no previous => delta = 0
    expect(component.delta()).toBe(0);

    count = 15;
    vi.advanceTimersByTime(3000); // Second poll: count = 15, prev = 10 => delta = +5
    expect(component.delta()).toBe(5);
  });

  it('should calculate negative delta when count decreases', () => {
    let count = 20;
    topicServiceMock.getSubscription.mockImplementation(() => of(createMockSubscription(count)));

    const { component } = createComponent();
    expect(component.currentCount()).toBe(20);

    count = 12;
    vi.advanceTimersByTime(3000); // Second poll: delta = -8
    expect(component.delta()).toBe(-8);
  });

  it('should track peak value', () => {
    let count = 5;
    topicServiceMock.getSubscription.mockImplementation(() => of(createMockSubscription(count)));

    const { component } = createComponent();
    expect(component.peak()).toBe(5);

    count = 50;
    vi.advanceTimersByTime(3000);
    expect(component.peak()).toBe(50);

    count = 30;
    vi.advanceTimersByTime(3000);
    expect(component.peak()).toBe(50); // Peak remains at 50
  });

  it('should accumulate totalProcessed from negative deltas', () => {
    let count = 100;
    topicServiceMock.getSubscription.mockImplementation(() => of(createMockSubscription(count)));

    const { component } = createComponent();
    expect(component.totalProcessed()).toBe(0);

    count = 90;
    vi.advanceTimersByTime(3000); // delta = -10 => totalProcessed = 10
    expect(component.totalProcessed()).toBe(10);

    count = 80;
    vi.advanceTimersByTime(3000); // delta = -10 => totalProcessed = 20
    expect(component.totalProcessed()).toBe(20);

    count = 85;
    vi.advanceTimersByTime(3000); // delta = +5 => totalProcessed stays 20
    expect(component.totalProcessed()).toBe(20);
  });

  it('should calculate processingRate', () => {
    let count = 100;
    topicServiceMock.getSubscription.mockImplementation(() => of(createMockSubscription(count)));

    const { component } = createComponent();
    expect(component.processingRate()).toBe('0'); // No previous

    count = 91;
    vi.advanceTimersByTime(3000); // delta = -9, rate = 9 / 3 = 3
    expect(component.processingRate()).toBe('3');
  });

  it('should emit subscriptionUpdated on each poll', () => {
    const emitted: SubscriptionInfo[] = [];

    const { component } = createComponent();
    component.subscriptionUpdated.subscribe((sub: SubscriptionInfo) => {
      emitted.push(sub);
    });

    // First poll already fired via startWith(0), but subscriptionUpdated.subscribe
    // was added after detectChanges, so we miss the first emission.
    // Advance to trigger another poll:
    vi.advanceTimersByTime(3000);
    expect(emitted.length).toBe(1);
    expect(emitted[0].activeMessageCount).toBe(10);

    vi.advanceTimersByTime(3000);
    expect(emitted.length).toBe(2);
  });

  it('should generate sparklinePath with 2+ data points', () => {
    let count = 10;
    topicServiceMock.getSubscription.mockImplementation(() => of(createMockSubscription(count)));

    const { component } = createComponent();
    // 1 data point after first poll => empty
    expect(component.sparklinePath()).toBe('');

    count = 20;
    vi.advanceTimersByTime(3000); // 2 data points => has path
    const path = component.sparklinePath();
    expect(path).toBeTruthy();
    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain('L');
  });

  it('should return empty sparklinePath with less than 2 points', () => {
    const { component } = createComponent();
    // Only 1 data point from first poll
    expect(component.sparklinePath()).toBe('');
  });
});
