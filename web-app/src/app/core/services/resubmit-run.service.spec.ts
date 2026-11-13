import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { ResubmitRunService, ResubmitRunTarget } from './resubmit-run.service';
import { QueueService } from './queue.service';
import { TopicService } from './topic.service';
import { ConnectionService } from './connection.service';
import { BatchOperationResult, MessageInfo } from '../models';

const START = Date.parse('2026-11-12T09:00:00Z');
const BEFORE = new Date(START - 3_600_000);
const AFTER = new Date(START + 1_000);
const DUPLICATE = 'Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: lock lost';
const NOT_FOUND = 'Not found within scan window';

function msg(sequenceNumber: number, extra: Partial<MessageInfo> = {}): MessageInfo {
  return {
    sequenceNumber,
    enqueuedTime: BEFORE.toISOString() as unknown as Date,
    deadLetterReason: 'MaxDeliveryCountExceeded',
    subject: 'order-created',
    body: `{"orderId":"sample-${sequenceNumber}"}`,
    ...extra
  } as MessageInfo;
}

const range = (from: number, count: number, extra: Partial<MessageInfo> = {}) =>
  Array.from({ length: count }, (_, i) => msg(from + i, extra));

const ok = (count: number): BatchOperationResult => ({ success: true, successCount: count, failureCount: 0, failures: [] });

function result(sent: number, failures: Array<[number, string]>): BatchOperationResult {
  return {
    success: failures.length === 0,
    successCount: sent,
    failureCount: failures.length,
    failures: failures.map(([sequenceNumber, error]) => ({ sequenceNumber, error }))
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve));

const ORDERS: ResubmitRunTarget = { entityType: 'queue', entityName: 'orders', subQueue: 'deadletter' };

describe('ResubmitRunService', () => {
  let queue: {
    getQueue: ReturnType<typeof vi.fn>;
    peekDeadLetterMessages: ReturnType<typeof vi.fn>;
    peekTransferDeadLetterMessages: ReturnType<typeof vi.fn>;
    resubmitDeadLetterMessages: ReturnType<typeof vi.fn>;
    resubmitTransferDeadLetterMessages: ReturnType<typeof vi.fn>;
  };
  let topic: {
    getSubscription: ReturnType<typeof vi.fn>;
    peekDeadLetterMessages: ReturnType<typeof vi.fn>;
    resubmitDeadLetterMessages: ReturnType<typeof vi.fn>;
  };
  let status: BehaviorSubject<{ connected: boolean; namespace?: string }>;
  let service: ResubmitRunService;

  function deadLetterCount(n: number) {
    queue.getQueue.mockReturnValue(of({ name: 'orders', deadLetterMessageCount: n, transferDeadLetterMessageCount: n }));
  }

  beforeEach(() => {
    queue = {
      getQueue: vi.fn(),
      peekDeadLetterMessages: vi.fn().mockReturnValue(of([])),
      peekTransferDeadLetterMessages: vi.fn().mockReturnValue(of([])),
      resubmitDeadLetterMessages: vi.fn((_: string, numbers: number[]) => of(ok(numbers.length))),
      resubmitTransferDeadLetterMessages: vi.fn((_: string, numbers: number[]) => of(ok(numbers.length)))
    };
    topic = {
      getSubscription: vi.fn(),
      peekDeadLetterMessages: vi.fn().mockReturnValue(of([])),
      resubmitDeadLetterMessages: vi.fn((_t: string, _s: string, numbers: number[]) => of(ok(numbers.length)))
    };
    status = new BehaviorSubject<{ connected: boolean; namespace?: string }>({ connected: true, namespace: 'sample.example.net' });
    TestBed.configureTestingModule({
      providers: [
        { provide: QueueService, useValue: queue },
        { provide: TopicService, useValue: topic },
        { provide: ConnectionService, useValue: { connectionStatus$: status.asObservable(), get currentTarget() { return status.value.namespace; } } }
      ]
    });
    service = TestBed.inject(ResubmitRunService);
    service.now = () => START;
    deadLetterCount(1000);
  });

  const resubmitted = () => queue.resubmitDeadLetterMessages.mock.calls.map(call => call[1]);
  const peekedFrom = () => queue.peekDeadLetterMessages.mock.calls.map(call => call[2]);

  describe('continue past a failure', () => {
    it('a failed batch member is recorded with its reason and left in the queue, and the next cycle reads past it', async () => {
      queue.peekDeadLetterMessages
        .mockReturnValueOnce(of(range(1, 3)))
        .mockReturnValueOnce(of(range(4, 2)))
        .mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(2, [[2, NOT_FOUND]])));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false });
      await run.done;

      expect(peekedFrom()).toEqual([0, 4, 6]);
      expect(resubmitted()).toEqual([[1, 2, 3], [4, 5]]);
      expect(run.failed).toEqual([{ sequenceNumber: 2, deadLetterReason: 'MaxDeliveryCountExceeded', error: NOT_FOUND }]);
      expect(run.progress()).toMatchObject({ status: 'completed', read: 5, matched: 5, resubmitted: 4, failed: 1, possibleDuplicates: 0 });
    });

    it('with "Stop at the first failure" the run ends failed after that batch and reads nothing more', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 3))).mockReturnValue(of(range(4, 3)));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(2, [[3, NOT_FOUND]])));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: true });
      await run.done;

      expect(queue.peekDeadLetterMessages).toHaveBeenCalledTimes(1);
      expect(run.progress().status).toBe('failed');
      expect(run.progress().message).toBe('Stopped at the first failure (failed: 3).');
    });
  });

  describe('never resend a possible duplicate', () => {
    it('a possible duplicate is recorded apart from the failures, never sent again by the run and never offered for retry', async () => {
      queue.peekDeadLetterMessages
        .mockReturnValueOnce(of(range(1, 3)))
        .mockReturnValueOnce(of([msg(2), ...range(4, 2)]))
        .mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(2, [[2, DUPLICATE]])));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false });
      await run.done;

      expect(resubmitted()).toEqual([[1, 2, 3], [4, 5]]);
      expect(run.possibleDuplicates.map(entry => entry.sequenceNumber)).toEqual([2]);
      expect(run.failed).toEqual([]);
      expect(run.progress()).toMatchObject({ possibleDuplicates: 1, failed: 0 });
    });
  });

  describe('a resubmitted message that comes back is not resubmitted again by the same run', () => {
    it('a message enqueued at or after the start is left alone, a sequence number already handled is skipped, and only newer messages left ends the run', async () => {
      queue.peekDeadLetterMessages
        .mockReturnValueOnce(of(range(1, 2)))
        .mockReturnValueOnce(of([msg(3, { enqueuedTime: new Date(START).toISOString() as unknown as Date }), msg(4)]))
        .mockReturnValueOnce(of([msg(5, { enqueuedTime: AFTER.toISOString() as unknown as Date })]))
        .mockReturnValue(of(range(6, 2)));

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false });
      await run.done;

      expect(resubmitted()).toEqual([[1, 2], [4]]);
      expect(queue.peekDeadLetterMessages).toHaveBeenCalledTimes(3);
      expect(run.progress()).toMatchObject({ status: 'completed', read: 5, matched: 3 });
    });
  });

  describe('bounded: never more than the N present at start', () => {
    it('reads at most the dead-letter count read at the start, even when the queue keeps growing', async () => {
      deadLetterCount(5);
      let next = 1;
      queue.peekDeadLetterMessages.mockImplementation((_: string, count: number) => {
        const batch = range(next, count);
        next += count;
        return of(batch);
      });

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false });
      await run.done;

      expect(queue.peekDeadLetterMessages.mock.calls.map(call => call[1])).toEqual([3, 2]);
      expect(resubmitted()).toEqual([[1, 2, 3], [4, 5]]);
      expect(run.progress()).toMatchObject({ status: 'completed', total: 5, read: 5 });
    });

    it('an API that ignores the position and answers the head again ends the run instead of resending it', async () => {
      queue.peekDeadLetterMessages.mockReturnValue(of(range(1, 3)));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false });
      await run.done;

      expect(resubmitted()).toEqual([[1, 2, 3]]);
      expect(queue.peekDeadLetterMessages).toHaveBeenCalledTimes(2);
      expect(run.progress().status).toBe('completed');
    });

    it('an empty dead-letter queue at the start ends the run without a peek', async () => {
      deadLetterCount(0);

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false });
      await run.done;

      expect(queue.peekDeadLetterMessages).not.toHaveBeenCalled();
      expect(run.progress()).toMatchObject({ status: 'completed', total: 0, read: 0 });
    });
  });

  describe('pause and stop', () => {
    it('pause starts nothing new after the request in flight answers, and resume carries on', async () => {
      const answer = new Subject<BatchOperationResult>();
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 2))).mockReturnValueOnce(of(range(3, 1))).mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(answer);

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false });
      await flush();
      run.pause();
      answer.next(ok(2));
      answer.complete();
      await flush();

      expect(queue.peekDeadLetterMessages).toHaveBeenCalledTimes(1);
      expect(run.progress()).toMatchObject({ status: 'paused', resubmitted: 2 });

      run.resume();
      await run.done;

      expect(resubmitted()).toEqual([[1, 2], [3]]);
      expect(run.progress().status).toBe('completed');
    });

    it('stop aborts the in-flight resubmit, reports its messages as possible duplicates, and the run is never resumed', async () => {
      let aborted = false;
      queue.peekDeadLetterMessages.mockReturnValue(of(range(1, 2)));
      queue.resubmitDeadLetterMessages.mockReturnValue(new Observable<BatchOperationResult>(() => () => { aborted = true; }));

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false });
      await flush();
      run.stop();
      await flush();
      expect(aborted).toBe(true);
      expect(run.progress().status).toBe('stopped');
      run.resume();
      await flush();

      expect(run.possibleDuplicates.map(entry => entry.sequenceNumber)).toEqual([1, 2]);
      expect(queue.peekDeadLetterMessages).toHaveBeenCalledTimes(1);
      expect(queue.resubmitDeadLetterMessages).toHaveBeenCalledTimes(1);
    });

    it('stop during a peek aborts it and resubmits nothing', async () => {
      let aborted = false;
      queue.peekDeadLetterMessages.mockReturnValue(new Observable<MessageInfo[]>(() => () => { aborted = true; }));

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false });
      await flush();
      run.stop();
      await flush();

      expect(aborted).toBe(true);
      expect(queue.resubmitDeadLetterMessages).not.toHaveBeenCalled();
      expect(run.progress().status).toBe('stopped');
    });

    it('a stop while paused ends the run without another call', async () => {
      const answer = new Subject<BatchOperationResult>();
      queue.peekDeadLetterMessages.mockReturnValue(of(range(1, 2)));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(answer);

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false });
      await flush();
      run.pause();
      answer.next(ok(2));
      answer.complete();
      await flush();
      run.stop();
      await run.done;

      expect(queue.peekDeadLetterMessages).toHaveBeenCalledTimes(1);
      expect(run.progress().status).toBe('stopped');
      expect(run.possibleDuplicates).toEqual([]);
    });

    it('a change of connection stops every active run, so a run never goes on against another broker', async () => {
      let aborted = false;
      queue.peekDeadLetterMessages.mockReturnValue(new Observable<MessageInfo[]>(() => () => { aborted = true; }));
      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false });
      await flush();

      status.next({ connected: true, namespace: 'other.example.net' });
      await flush();

      expect(aborted).toBe(true);
      expect(run.progress().status).toBe('stopped');
      expect(run.progress().message).toBe('The connection changed, so the run was stopped.');
      expect(run.connection).toBe('sample.example.net');
    });
  });

  describe('runs belong to the app: at most one per entity and sub-queue', () => {
    it('starting again while a run is active returns that run and reads the count once', async () => {
      queue.peekDeadLetterMessages.mockReturnValue(new Observable<MessageInfo[]>());
      queue.peekTransferDeadLetterMessages.mockReturnValue(new Observable<MessageInfo[]>());
      const first = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false });
      const second = service.start(ORDERS, { batchSize: 50, stopAtFirstFailure: true });
      const transfer = service.start({ ...ORDERS, subQueue: 'transferdeadletter' }, { batchSize: 2, stopAtFirstFailure: false });
      await flush();

      expect(second).toBe(first);
      expect(transfer).not.toBe(first);
      expect(service.find(ORDERS)).toBe(first);
      expect(service.activeRuns()).toEqual([first, transfer]);
      first.stop();
      transfer.stop();
      await Promise.all([first.done, transfer.done]);
      expect(service.activeRuns()).toEqual([]);
    });

    it('a subscription run counts, peeks and resubmits on that subscription', async () => {
      topic.getSubscription.mockReturnValue(of({ name: 'eu', topicName: 'sales', deadLetterMessageCount: 2 }));
      topic.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 2))).mockReturnValue(of([]));

      const run = service.start({ entityType: 'subscription', topicName: 'sales', entityName: 'eu', subQueue: 'deadletter' }, { batchSize: 5, stopAtFirstFailure: false });
      await run.done;

      expect(topic.peekDeadLetterMessages.mock.calls[0]).toEqual(['sales', 'eu', 2, 0]);
      expect(topic.resubmitDeadLetterMessages.mock.calls[0]).toEqual(['sales', 'eu', [1, 2]]);
      expect(run.progress()).toMatchObject({ status: 'completed', resubmitted: 2 });
    });
  });

  describe('progress', () => {
    it('reports read, matched, resubmitted, elapsed, the rate over the last minute and the time left from N', async () => {
      deadLetterCount(1000);
      let clock = START;
      service.now = () => clock;
      const answers = [new Subject<BatchOperationResult>(), new Subject<BatchOperationResult>()];
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 100))).mockReturnValueOnce(of(range(101, 100))).mockReturnValue(new Observable());
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(answers[0]).mockReturnValueOnce(answers[1]);

      const run = service.start(ORDERS, { batchSize: 100, stopAtFirstFailure: false });
      await flush();
      clock = START + 10_000;
      answers[0].next(ok(100));
      answers[0].complete();
      await flush();

      expect(run.progress()).toMatchObject({ total: 1000, read: 200, matched: 200, resubmitted: 100, elapsedMs: 10_000 });

      clock = START + 90_000;
      answers[1].next(ok(100));
      answers[1].complete();
      await flush();

      expect(run.progress().ratePerSecond).toBeCloseTo(0, 5);
      expect(run.progress().remainingMs).toBeNull();
      run.stop();
      await run.done;
    });

    it('the time left is the messages not yet read divided by the measured rate', async () => {
      deadLetterCount(1000);
      let clock = START;
      service.now = () => clock;
      const answer = new Subject<BatchOperationResult>();
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 100))).mockReturnValue(new Observable());
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(answer);

      const run = service.start(ORDERS, { batchSize: 100, stopAtFirstFailure: false });
      await flush();
      clock = START + 20_000;
      answer.next(ok(100));
      answer.complete();
      await flush();

      expect(run.progress().ratePerSecond).toBe(5);
      expect(run.progress().remainingMs).toBe(180_000);
      run.stop();
      await run.done;
    });
  });

  describe('filter applied per batch, matched so far', () => {
    it('resubmits only the messages whose reason equals and whose subject or body holds the text, and counts them as matched so far', async () => {
      const second = new Subject<MessageInfo[]>();
      queue.peekDeadLetterMessages
        .mockReturnValueOnce(of([
          msg(1),
          msg(2, { deadLetterReason: 'TTLExpiredException' }),
          msg(3, { subject: 'invoice-paid', body: 'nothing' }),
          msg(4, { subject: 'invoice-paid', body: '{"note":"ORDER-created later"}' })
        ]))
        .mockReturnValueOnce(second)
        .mockReturnValue(of([]));

      const run = service.start(ORDERS, { batchSize: 4, stopAtFirstFailure: false, reason: 'MaxDeliveryCountExceeded', text: 'order-created' });
      await flush();

      expect(resubmitted()).toEqual([[1, 4]]);
      expect(run.progress()).toMatchObject({ status: 'running', read: 4, matched: 2 });

      second.next([msg(5, { deadLetterReason: 'TTLExpiredException' })]);
      second.complete();
      await run.done;

      expect(queue.resubmitDeadLetterMessages).toHaveBeenCalledTimes(1);
      expect(run.progress()).toMatchObject({ read: 5, matched: 2, resubmitted: 2 });
    });
  });

  describe('final report, retry the failed without the duplicates', () => {
    async function runWithOneFailedAndOneDuplicate() {
      queue.peekDeadLetterMessages
        .mockReturnValueOnce(of([msg(1), msg(2, { deadLetterReason: 'TTLExpiredException' }), msg(3)]))
        .mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(1, [[2, NOT_FOUND], [3, DUPLICATE]])));
      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false });
      await run.done;
      return run;
    }

    it('the report holds the totals, the counts per reason and the failed and possible-duplicate sequence numbers, never a message body', async () => {
      const run = await runWithOneFailedAndOneDuplicate();

      const report = run.report();

      expect(report).toMatchObject({
        entity: 'orders', subQueue: 'deadletter', connection: 'sample.example.net', status: 'completed',
        total: 1000, read: 3, matched: 3, resubmitted: 1, failed: 1, possibleDuplicates: 1
      });
      expect(report.byReason).toEqual([
        { reason: 'MaxDeliveryCountExceeded', read: 2, resubmitted: 1, failed: 0, possibleDuplicates: 1 },
        { reason: 'TTLExpiredException', read: 1, resubmitted: 0, failed: 1, possibleDuplicates: 0 }
      ]);
      expect(report.failedMessages).toEqual([{ sequenceNumber: 2, deadLetterReason: 'TTLExpiredException', error: NOT_FOUND }]);
      expect(report.possibleDuplicateMessages.map(entry => entry.sequenceNumber)).toEqual([3]);
      expect(JSON.stringify(report)).not.toContain('sample-1');
    });

    it('"Retry the N failed" starts a run on exactly the failed sequence numbers, possible duplicates excluded', async () => {
      const first = await runWithOneFailedAndOneDuplicate();
      queue.resubmitDeadLetterMessages.mockClear();
      queue.peekDeadLetterMessages.mockClear();

      const retry = service.retry(first);
      await retry.done;

      expect(resubmitted()).toEqual([[2]]);
      expect(queue.peekDeadLetterMessages).not.toHaveBeenCalled();
      expect(service.find(ORDERS)).toBe(retry);
      expect(retry.progress()).toMatchObject({ status: 'completed', total: 1, read: 1, resubmitted: 1 });
    });
  });

  describe('a failing call ends the run and says so', () => {
    it('a dead-letter count that cannot be read fails the run before any peek', async () => {
      queue.getQueue.mockReturnValue(throwError(() => ({ status: 500 })));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false });
      await run.done;

      expect(queue.peekDeadLetterMessages).not.toHaveBeenCalled();
      expect(run.progress()).toMatchObject({ status: 'failed', message: 'Could not read the dead-letter count.' });
    });

    it('a peek that fails ends the run as failed with the API words and resubmits nothing', async () => {
      queue.peekDeadLetterMessages.mockReturnValue(throwError(() => ({ status: 400, error: { message: 'This provider cannot read the dead-letter queue from a position.' } })));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false });
      await run.done;

      expect(queue.resubmitDeadLetterMessages).not.toHaveBeenCalled();
      expect(run.progress()).toMatchObject({
        status: 'failed',
        message: 'The dead-letter peek failed: This provider cannot read the dead-letter queue from a position.'
      });
    });

    it('a resubmit call that fails ends the run and reports its messages as possible duplicates, kept out of the retry', async () => {
      queue.peekDeadLetterMessages.mockReturnValue(of(range(1, 2)));
      queue.resubmitDeadLetterMessages.mockReturnValue(throwError(() => ({ status: 503 })));

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false });
      await run.done;

      expect(run.progress().status).toBe('failed');
      expect(run.possibleDuplicates.map(entry => entry.sequenceNumber)).toEqual([1, 2]);
      expect(run.failed).toEqual([]);
    });

    it('a resubmit answer that cannot be read ends the run as failed, never as completed', async () => {
      queue.peekDeadLetterMessages.mockReturnValue(of(range(1, 2)));
      queue.resubmitDeadLetterMessages.mockReturnValue(of(null));

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false });
      await run.done;

      expect(run.progress().status).toBe('failed');
      expect(run.possibleDuplicates.map(entry => entry.sequenceNumber)).toEqual([1, 2]);
    });
  });

  describe('a run never acts under another connection', () => {
    it('"Retry the N failed" of a run from before a change of connection resubmits nothing', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 2))).mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(1, [[2, NOT_FOUND]])));
      const first = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false });
      await first.done;
      status.next({ connected: true, namespace: 'other.example.net' });
      queue.resubmitDeadLetterMessages.mockClear();

      const retry = service.retry(first);
      await flush();

      expect(service.canRetry(first)).toBe(false);
      expect(retry).toBe(first);
      expect(queue.resubmitDeadLetterMessages).not.toHaveBeenCalled();
    });
  });

  describe('per-reason totals stay bounded', () => {
    it('past 50 distinct dead-letter reasons the rest are counted together as other reasons', async () => {
      deadLetterCount(60);
      queue.peekDeadLetterMessages
        .mockReturnValueOnce(of(Array.from({ length: 60 }, (_, i) => msg(i + 1, { deadLetterReason: `Reason ${i + 1}` }))))
        .mockReturnValue(of([]));

      const run = service.start(ORDERS, { batchSize: 60, stopAtFirstFailure: false });
      await run.done;

      const byReason = run.byReason();
      expect(byReason).toHaveLength(51);
      expect(byReason[49]).toEqual({ reason: 'Reason 50', read: 1, resubmitted: 1, failed: 0, possibleDuplicates: 0 });
      expect(byReason[50]).toEqual({ reason: '(other reasons)', read: 10, resubmitted: 10, failed: 0, possibleDuplicates: 0 });
    });
  });
});
