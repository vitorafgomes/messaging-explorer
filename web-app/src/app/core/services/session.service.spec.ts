import { TestBed } from '@angular/core/testing';
import { of, firstValueFrom } from 'rxjs';
import { SessionService } from './session.service';
import { ApiService } from './api.service';
import { SessionDetail, SessionList } from '../models';

describe('SessionService: the eight session routes, through ApiService only', () => {
  let service: SessionService;
  let api: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

  const LIST: SessionList = { sessions: [{ sessionId: 'order-1001', messageCount: 12, firstSequenceNumber: 4411 }], scannedMessages: 1000, truncated: true };
  const DETAIL: SessionDetail = { sessionId: 'order-1001', state: '{"step":3}', stateIsBinary: false, lockedUntil: '2026-11-12T23:10:00+00:00' };

  const QUEUE = { queueName: 'orders' };
  const SUBSCRIPTION = { topicName: 'order-events', subscriptionName: 'billing' };

  beforeEach(() => {
    api = { get: vi.fn(() => of(LIST)), put: vi.fn(() => of(DETAIL)) };
    TestBed.configureTestingModule({ providers: [SessionService, { provide: ApiService, useValue: api }] });
    service = TestBed.inject(SessionService);
  });

  it('a queue: list, detail with its messages, and state write under api/queues/{name}/sessions', () => {
    service.list(QUEUE).subscribe();
    service.list(QUEUE, 250).subscribe();
    service.get(QUEUE, 'order-1001').subscribe();
    service.setState(QUEUE, 'order-1001', { state: '{"step":4}', expectedState: '{"step":3}' }).subscribe();

    expect(api.get.mock.calls.map(c => c[0])).toStrictEqual([
      'queues/orders/sessions?maxMessages=1000',
      'queues/orders/sessions?maxMessages=250',
      'queues/orders/sessions/order-1001?messageCount=100'
    ]);
    expect(api.put.mock.calls).toStrictEqual([
      ['queues/orders/sessions/order-1001/state', { state: '{"step":4}', expectedState: '{"step":3}' }]
    ]);
  });

  it('a subscription: the same three routes under api/topics/{topic}/subscriptions/{subscription}/sessions', () => {
    service.list(SUBSCRIPTION).subscribe();
    service.get(SUBSCRIPTION, 'order-1001', 20).subscribe();
    service.setState(SUBSCRIPTION, 'order-1001', { state: null, expectedState: null }).subscribe();

    expect(api.get.mock.calls.map(c => c[0])).toStrictEqual([
      'topics/order-events/subscriptions/billing/sessions?maxMessages=1000',
      'topics/order-events/subscriptions/billing/sessions/order-1001?messageCount=20'
    ]);
    expect(api.put.mock.calls).toStrictEqual([
      ['topics/order-events/subscriptions/billing/sessions/order-1001/state', { state: null, expectedState: null }]
    ]);
  });

  it('a clear sends expectedState null as a present property, never dropped from the JSON', () => {
    service.setState(QUEUE, 'order-1001', { state: null, expectedState: null }).subscribe();

    expect(JSON.stringify(api.put.mock.calls[0][1])).toBe('{"state":null,"expectedState":null}');
  });

  it('names and session ids with / and a space stay one segment each', () => {
    service.list({ queueName: 'q/1' }).subscribe();
    service.get({ topicName: 't/1', subscriptionName: 's 2' }, 'id/with space').subscribe();
    service.setState({ topicName: 't/1', subscriptionName: 's 2' }, 'id/with space', { state: 'x', expectedState: null }).subscribe();

    expect(api.get.mock.calls.map(c => c[0])).toStrictEqual([
      'queues/q%2F1/sessions?maxMessages=1000',
      'topics/t%2F1/subscriptions/s%202/sessions/id%2Fwith%20space?messageCount=100'
    ]);
    expect(api.put.mock.calls[0][0]).toBe('topics/t%2F1/subscriptions/s%202/sessions/id%2Fwith%20space/state');
  });

  it('returns what the API answered', async () => {
    expect(await firstValueFrom(service.list(QUEUE))).toStrictEqual(LIST);
    expect(await firstValueFrom(service.setState(QUEUE, 'order-1001', { state: 'x', expectedState: null }))).toStrictEqual(DETAIL);
  });
});
