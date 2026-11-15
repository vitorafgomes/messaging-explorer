import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { ResubmitRun, ResubmitRunService, ResubmitRunTarget } from './resubmit-run.service';
import { QueueService } from './queue.service';
import { TopicService } from './topic.service';
import { ConnectionService } from './connection.service';
import { ApiService } from './api.service';
import { BatchOperationResult, MessageInfo } from '../models';

const START = Date.parse('2026-11-12T09:00:00Z');
const BEFORE = new Date(START - 3_600_000);
const AFTER = new Date(START + 1_000);
const DUPLICATE = 'Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: lock lost';
const NOT_FOUND = 'Not found within scan window';
const REFUSED = 'The entity is disabled for this operation.';
const SCAN_WALL = 'The server could not find messages of the last batch even after their locks were released: the head of the dead-letter queue holds messages it cannot scan past, so the run stops here. They stay in the queue and are listed as failed.';

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
        { provide: ConnectionService, useValue: { connectionStatus$: status.asObservable(), get currentTarget() { return status.value.namespace; }, onBeforeSwitch: vi.fn() } }
      ]
    });
    service = TestBed.inject(ResubmitRunService);
    service.now = () => START;
    deadLetterCount(1000);
  });

  const resubmitted = () => queue.resubmitDeadLetterMessages.mock.calls.map(call => call[1]);
  const peekedFrom = () => queue.peekDeadLetterMessages.mock.calls.map(call => call[2]);

  describe('a target that detects duplicates', () => {
    it('a run started with "Send with a new message ID" asks for it on every batch, and a retry of a refused run can ask for it', async () => {
      queue.peekDeadLetterMessages
        .mockReturnValueOnce(of(range(1, 3)))
        .mockReturnValueOnce(of(range(4, 2)))
        .mockReturnValue(of([]));

      const optedIn = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false, newMessageIdOnDuplicateDetection: true })!;
      await optedIn.done;

      expect(queue.resubmitDeadLetterMessages.mock.calls.map(call => call[2]), 'every batch of an opted-in run carries the new message id flag').toEqual([true, true]);
    });

    it('a run without the option never asks for new ids, and Retry after a duplicate refusal sends the failed ones with it', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 2))).mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(0, [[1, 'The target detects duplicates; a copy with the same message id would be dropped. Nothing was sent or removed.'], [2, 'The target detects duplicates; a copy with the same message id would be dropped. Nothing was sent or removed.']])));

      const refused = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
      await refused.done;
      const retried = service.retry(refused, true);
      await retried.done;

      expect(queue.resubmitDeadLetterMessages.mock.calls.map(call => [call[1], call[2]]), 'unticked sends false; the retry the user ticked sends true').toEqual([[[1, 2], false], [[1, 2], true]]);
    });
  });

  describe('continue past a failure', () => {
    it('a failed batch member is recorded with its reason and left in the queue, and the next cycle reads past it', async () => {
      queue.peekDeadLetterMessages
        .mockReturnValueOnce(of(range(1, 3)))
        .mockReturnValueOnce(of(range(4, 2)))
        .mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(2, [[2, REFUSED]])));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
      await run.done;

      expect(peekedFrom()).toEqual([0, 4, 6]);
      expect(resubmitted()).toEqual([[1, 2, 3], [4, 5]]);
      expect(run.failed).toEqual([{ sequenceNumber: 2, deadLetterReason: 'MaxDeliveryCountExceeded', error: REFUSED, batch: 1 }]);
      expect(run.progress()).toMatchObject({ status: 'completed', read: 5, matched: 5, resubmitted: 4, failed: 1, possibleDuplicates: 0 });
    });

    it('with "Stop at the first failure" the run ends failed after that batch and reads nothing more', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 3))).mockReturnValue(of(range(4, 3)));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(2, [[3, REFUSED]])));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: true })!;
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

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
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

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
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

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
      await run.done;

      expect(queue.peekDeadLetterMessages.mock.calls.map(call => call[1])).toEqual([3, 2]);
      expect(resubmitted()).toEqual([[1, 2, 3], [4, 5]]);
      expect(run.progress()).toMatchObject({ status: 'completed', total: 5, read: 5 });
    });

    it('an API that ignores the position and answers the head again ends the run instead of resending it', async () => {
      queue.peekDeadLetterMessages.mockReturnValue(of(range(1, 3)));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
      await run.done;

      expect(resubmitted()).toEqual([[1, 2, 3]]);
      expect(queue.peekDeadLetterMessages).toHaveBeenCalledTimes(2);
      expect(run.progress().status).toBe('completed');
    });

    it('an empty dead-letter queue at the start ends the run without a peek', async () => {
      deadLetterCount(0);

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
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

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
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

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
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

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
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

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
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
      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
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
      const first = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
      const second = service.start(ORDERS, { batchSize: 50, stopAtFirstFailure: true })!;
      const transfer = service.start({ ...ORDERS, subQueue: 'transferdeadletter' }, { batchSize: 2, stopAtFirstFailure: false })!;
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

      const run = service.start({ entityType: 'subscription', topicName: 'sales', entityName: 'eu', subQueue: 'deadletter' }, { batchSize: 5, stopAtFirstFailure: false })!;
      await run.done;

      expect(topic.peekDeadLetterMessages.mock.calls[0]).toEqual(['sales', 'eu', 2, 0, false]);
      expect(topic.resubmitDeadLetterMessages.mock.calls[0]).toEqual(['sales', 'eu', [1, 2], false]);
      expect(run.progress()).toMatchObject({ status: 'completed', resubmitted: 2 });
    });
  });

  describe('progress', () => {
    it('reports read, matched, resubmitted, elapsed, the rate over the last 5 minutes and the time left from N', async () => {
      deadLetterCount(1000);
      let clock = START;
      service.now = () => clock;
      const answers = [new Subject<BatchOperationResult>(), new Subject<BatchOperationResult>()];
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 100))).mockReturnValueOnce(of(range(101, 100))).mockReturnValue(new Observable());
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(answers[0]).mockReturnValueOnce(answers[1]);

      const run = service.start(ORDERS, { batchSize: 100, stopAtFirstFailure: false })!;
      await flush();
      clock = START + 10_000;
      answers[0].next(ok(100));
      answers[0].complete();
      await flush();

      expect(run.progress()).toMatchObject({ total: 1000, read: 200, matched: 200, resubmitted: 100, elapsedMs: 10_000 });

      clock = START + 400_000;
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

      const run = service.start(ORDERS, { batchSize: 100, stopAtFirstFailure: false })!;
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

      const run = service.start(ORDERS, { batchSize: 4, stopAtFirstFailure: false, reason: 'MaxDeliveryCountExceeded', text: 'order-created' })!;
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
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(1, [[2, REFUSED], [3, DUPLICATE]])));
      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
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
      expect(report.failedMessages).toEqual([{ sequenceNumber: 2, deadLetterReason: 'TTLExpiredException', error: REFUSED, batch: 1 }]);
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

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
      await run.done;

      expect(queue.peekDeadLetterMessages).not.toHaveBeenCalled();
      expect(run.progress()).toMatchObject({ status: 'failed', message: 'Could not read the dead-letter count.' });
    });

    it('a peek that fails ends the run as failed with the API words and resubmits nothing', async () => {
      queue.peekDeadLetterMessages.mockReturnValue(throwError(() => ({ status: 400, error: { message: 'This provider cannot read the dead-letter queue from a position.' } })));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
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

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
      await run.done;

      expect(run.progress().status).toBe('failed');
      expect(run.possibleDuplicates.map(entry => entry.sequenceNumber)).toEqual([1, 2]);
      expect(run.failed).toEqual([]);
    });

    it('a resubmit answer that cannot be read ends the run as failed, never as completed', async () => {
      queue.peekDeadLetterMessages.mockReturnValue(of(range(1, 2)));
      queue.resubmitDeadLetterMessages.mockReturnValue(of(null));

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
      await run.done;

      expect(run.progress().status).toBe('failed');
      expect(run.possibleDuplicates.map(entry => entry.sequenceNumber)).toEqual([1, 2]);
    });
  });

  describe('a run never acts under another connection', () => {
    it('"Retry the N failed" of a run from before a change of connection resubmits nothing', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 2))).mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(1, [[2, REFUSED]])));
      const first = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
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

      const run = service.start(ORDERS, { batchSize: 60, stopAtFirstFailure: false })!;
      await run.done;

      const byReason = run.byReason();
      expect(byReason).toHaveLength(51);
      expect(byReason[49]).toEqual({ reason: 'Reason 50', read: 1, resubmitted: 1, failed: 0, possibleDuplicates: 0 });
      expect(byReason[50]).toEqual({ reason: '(other reasons)', read: 10, resubmitted: 10, failed: 0, possibleDuplicates: 0 });
    });
  });

  describe('a connect or disconnect stops every run before the API switches its broker', () => {
    let api: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
    let order: string[];
    let connections: ConnectionService;

    beforeEach(() => {
      order = [];
      api = { get: vi.fn().mockReturnValue(of({ connected: true, namespace: 'sample.example.net' })), post: vi.fn() };
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: ApiService, useValue: api },
          { provide: QueueService, useValue: queue },
          { provide: TopicService, useValue: topic }
        ]
      });
      connections = TestBed.inject(ConnectionService);
      service = TestBed.inject(ResubmitRunService);
      service.now = () => START;
      queue.peekDeadLetterMessages.mockImplementation(() => { order.push('peek'); return of(range(1, 2)); });
    });

    it('a connect that fails after the server switched leaves no run able to send another request', async () => {
      let aborted = false;
      queue.resubmitDeadLetterMessages.mockImplementation(() => {
        order.push('resubmit');
        return new Observable<BatchOperationResult>(() => () => { aborted = true; });
      });
      const connectAnswer = new Subject<never>();
      api.post.mockImplementation((url: string) => { order.push(url); return connectAnswer; });
      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
      await flush();

      let failed = false;
      connections.connect('other').subscribe({ error: () => (failed = true) });
      expect(aborted).toBe(true);
      await flush();
      connectAnswer.error({ status: 500 });
      run.resume();
      await flush();

      expect(failed).toBe(true);
      expect(order).toEqual(['peek', 'resubmit', 'connections/other/connect']);
      expect(run.progress().status).toBe('stopped');
      expect(run.possibleDuplicates.map(entry => entry.sequenceNumber)).toEqual([1, 2]);
      expect(service.canRetry(run)).toBe(false);
      expect(service.activeRuns()).toEqual([]);
    });

    it('the connect request is posted only once the request in flight of every run has ended', async () => {
      const answer = new Subject<BatchOperationResult>();
      queue.resubmitDeadLetterMessages.mockImplementation(() => { order.push('resubmit'); return answer; });
      let run: ResubmitRun | undefined;
      api.post.mockImplementation((url: string) => { order.push(`${url} while the run is ${run!.progress().status}`); return of({ connected: false }); });
      run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
      await flush();

      connections.disconnect().subscribe();
      await flush();

      expect(order).toEqual(['peek', 'resubmit', 'connections/disconnect while the run is stopped']);
      expect(run.progress()).toMatchObject({ status: 'stopped', message: expect.stringContaining('The connection is changing') });
    });
    it('the failed messages of a finished run are not retried after a connect that failed once the server had switched', async () => {
      queue.peekDeadLetterMessages.mockImplementationOnce(() => of(range(1, 2))).mockImplementation(() => of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(1, [[2, REFUSED]])));
      api.post.mockReturnValue(throwError(() => ({ status: 500 })));
      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
      await run.done;

      connections.connect('other').subscribe({ error: () => undefined });
      await flush();
      queue.resubmitDeadLetterMessages.mockClear();
      service.retry(run);
      await flush();

      expect(run.failed.map(entry => entry.sequenceNumber)).toEqual([2]);
      expect(service.canRetry(run)).toBe(false);
      expect(queue.resubmitDeadLetterMessages).not.toHaveBeenCalled();
    });
    it('after a connect that failed no run starts until the status read again from the API has arrived', async () => {
      api.post.mockReturnValue(throwError(() => ({ status: 500 })));
      const refreshed = new Subject<{ connected: boolean; namespace: string }>();
      api.get.mockReturnValue(refreshed);
      connections.connect('other').subscribe({ error: () => undefined });
      await flush();

      const refused = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false });
      await flush();
      expect(refused).toBeUndefined();
      expect(queue.getQueue).not.toHaveBeenCalled();

      refreshed.next({ connected: true, namespace: 'other.example.net' });
      deadLetterCount(2);
      const started = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false });
      await started!.done;

      expect(queue.getQueue).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['peek']);
      expect(started!.progress()).toMatchObject({ status: 'completed', resubmitted: 2 });
    });

    it('a run that fails on something unexpected ends failed, and the next connect is still posted', async () => {
      queue.peekDeadLetterMessages.mockImplementation(() => { order.push('peek'); return of({} as unknown as MessageInfo[]); });
      api.post.mockImplementation((url: string) => { order.push(url); return of({ connected: true, namespace: 'other.example.net' }); });
      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
      await flush();

      connections.connect('other').subscribe();
      await flush();

      expect(run.progress()).toMatchObject({ status: 'failed', message: 'The run stopped on an unexpected error.' });
      expect(order).toEqual(['peek', 'connections/other/connect']);
    });
  });

  describe('a batch whose messages all came back not found is retried once after the lock, then ends the run', () => {
    let clock: number;
    let sleeps: number[];
    let duringWait: string[];

    beforeEach(() => {
      clock = START;
      sleeps = [];
      duringWait = [];
      service.now = () => clock;
      service.sleep = (ms: number) => {
        duringWait.push(service.find(ORDERS)!.progress().message);
        sleeps.push(ms);
        clock += ms;
        return Promise.resolve();
      };
      queue.getQueue.mockReturnValue(of({ name: 'orders', deadLetterMessageCount: 1000, lockDuration: '00:00:30' }));
    });

    it('waits the lock duration of the entity, saying so with the time left, then sends the same batch again', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 2))).mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(0, [[1, NOT_FOUND], [2, NOT_FOUND]])));

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
      await run.done;

      expect(resubmitted()).toEqual([[1, 2], [1, 2]]);
      expect(sleeps.reduce((a, b) => a + b, 0)).toBe(30_000);
      expect(duringWait[0]).toBe('Waiting for the broker to release the messages of the last batch: 30 s left.');
      expect(run.progress()).toMatchObject({ status: 'completed', resubmitted: 2, failed: 0 });
    });

    it('a second batch in a row all not found ends the run as failed and leaves them in the queue, listed as failed', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 2))).mockReturnValue(of(range(3, 2)));
      queue.resubmitDeadLetterMessages.mockReturnValue(of(result(0, [[1, NOT_FOUND], [2, NOT_FOUND]])));

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
      await run.done;

      expect(resubmitted()).toEqual([[1, 2], [1, 2]]);
      expect(queue.peekDeadLetterMessages).toHaveBeenCalledTimes(1);
      expect(run.failed.map(entry => entry.sequenceNumber)).toEqual([1, 2]);
      expect(run.progress()).toMatchObject({ status: 'failed', message: SCAN_WALL });
    });

    it('never waits longer than 5 minutes, whatever the lock duration', async () => {
      queue.getQueue.mockReturnValue(of({ name: 'orders', deadLetterMessageCount: 1000, lockDuration: '00:10:00' }));
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 2))).mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(0, [[1, NOT_FOUND], [2, NOT_FOUND]])));

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
      await run.done;

      expect(sleeps.reduce((a, b) => a + b, 0)).toBe(300_000);
    });

    it('Stop during the wait ends the run at once and sends nothing more', async () => {
      service.sleep = () => new Promise<void>(() => undefined);
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 2))).mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(0, [[1, NOT_FOUND], [2, NOT_FOUND]])));
      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
      await flush();

      run.stop();
      await flush();

      expect(run.progress().status).toBe('stopped');
      expect(queue.resubmitDeadLetterMessages).toHaveBeenCalledTimes(1);
    });

    it('Pause during the wait holds the second try until Resume', async () => {
      service.sleep = (ms: number) => { service.find(ORDERS)!.pause(); clock += ms; return Promise.resolve(); };
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 2))).mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(0, [[1, NOT_FOUND], [2, NOT_FOUND]])));
      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
      await flush();

      expect(run.progress().status).toBe('paused');
      expect(queue.resubmitDeadLetterMessages).toHaveBeenCalledTimes(1);

      run.resume();
      await run.done;
      expect(resubmitted()).toEqual([[1, 2], [1, 2]]);
    });

    it('a batch partly not found sends the rest, retries only the ones not found after the wait, and goes on', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 3))).mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(2, [[2, NOT_FOUND]])));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
      await run.done;

      expect(resubmitted()).toEqual([[1, 2, 3], [2]]);
      expect(run.progress()).toMatchObject({ status: 'completed', resubmitted: 3, failed: 0 });
    });

    it('a message still not found after the wait ends the run, even with "continue past a failure": the run never moves past it', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 3))).mockReturnValue(of(range(4, 3)));
      queue.resubmitDeadLetterMessages.mockReturnValue(of(result(0, [[2, NOT_FOUND]])));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
      await run.done;

      expect(resubmitted()).toEqual([[1, 2, 3], [2]]);
      expect(queue.peekDeadLetterMessages).toHaveBeenCalledTimes(1);
      expect(run.failed.map(entry => entry.sequenceNumber)).toEqual([2]);
      expect(run.progress()).toMatchObject({ status: 'failed', resubmitted: 2, message: SCAN_WALL });
    });
  });

  describe('the cursor and the bodies', () => {
    it('the cursor moves past the highest sequence number of a batch, whatever its order', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of([msg(3), msg(7), msg(5)])).mockReturnValue(of([]));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
      await run.done;

      expect(peekedFrom()).toEqual([0, 8]);
    });

    it('without a text filter the peek asks for no bodies; with one it asks for them and matches the text as written, ignoring case', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of([msg(1), msg(2, { body: 'price (USD) is 1.5' }), msg(3, { body: 'price (usd) is 105' })])).mockReturnValue(of([]));
      const withText = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false, text: '(usd) IS 1.5' })!;
      await withText.done;
      service.clear(ORDERS);
      queue.peekDeadLetterMessages.mockReturnValue(of([]));
      const withoutText = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false, reason: 'MaxDeliveryCountExceeded' })!;
      await withoutText.done;

      expect(queue.peekDeadLetterMessages.mock.calls.map(call => call[3])).toEqual([true, true, false]);
      expect(resubmitted()).toEqual([[2]]);
    });
  });

  describe('what the run cannot read it leaves alone', () => {
    it('a message without a readable enqueued time counts as newer than the start and is not resubmitted', async () => {
      queue.peekDeadLetterMessages
        .mockReturnValueOnce(of([msg(1, { enqueuedTime: undefined as unknown as Date }), msg(2, { enqueuedTime: 'not a date' as unknown as Date }), msg(3)]))
        .mockReturnValue(of([]));

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
      await run.done;

      expect(resubmitted()).toEqual([[3]]);
      expect(run.progress()).toMatchObject({ read: 3, matched: 1 });
    });

    it('a resubmit answer with a failure entry it cannot read ends the run failed and reports the batch as possible duplicates', async () => {
      queue.peekDeadLetterMessages.mockReturnValue(of(range(1, 2)));
      queue.resubmitDeadLetterMessages.mockReturnValue(of({ success: false, successCount: 1, failureCount: 1, failures: [null] } as unknown as BatchOperationResult));

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false })!;
      await run.done;

      expect(run.progress().status).toBe('failed');
      expect(run.possibleDuplicates.map(entry => entry.sequenceNumber)).toEqual([1, 2]);
      expect(run.failed).toEqual([]);
    });
  });

  describe('a possible duplicate is never sent again by any path of the run', () => {
    it('neither the second try after a message not found nor "Retry the N failed" sends a possible duplicate again', async () => {
      let clock = START;
      service.now = () => clock;
      service.sleep = (ms: number) => { clock += ms; return Promise.resolve(); };
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 4))).mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages
        .mockReturnValueOnce(of(result(1, [[1, DUPLICATE], [2, REFUSED], [3, NOT_FOUND]])))
        .mockReturnValueOnce(of(ok(1)))
        .mockReturnValueOnce(of(ok(1)));

      const run = service.start(ORDERS, { batchSize: 4, stopAtFirstFailure: false })!;
      await run.done;
      const retry = service.retry(run);
      await retry.done;

      expect(resubmitted()).toEqual([[1, 2, 3, 4], [3], [2]]);
      expect(run.possibleDuplicates.map(entry => entry.sequenceNumber)).toEqual([1]);
      expect(run.failed.map(entry => entry.sequenceNumber)).toEqual([2]);
      expect(retry.progress()).toMatchObject({ status: 'completed', total: 1, resubmitted: 1 });
    });
  });
  describe('the enqueued-time filter of the proposed panels', () => {
    it('resubmits only the messages enqueued from the first to the last moment given, both included, and leaves the others in dead-letter, counted as left by the filter', async () => {
      const from = START - 7_200_000;
      const to = START - 3_600_000;
      queue.peekDeadLetterMessages
        .mockReturnValueOnce(of([
          msg(1, { enqueuedTime: new Date(from - 1).toISOString() as never }),
          msg(2, { enqueuedTime: new Date(from).toISOString() as never }),
          msg(3, { enqueuedTime: new Date(to).toISOString() as never }),
          msg(4, { enqueuedTime: new Date(to + 1).toISOString() as never })
        ]))
        .mockReturnValue(of([]));

      const run = service.start(ORDERS, { batchSize: 4, stopAtFirstFailure: false, enqueuedFrom: from, enqueuedTo: to })!;
      await run.done;

      expect(resubmitted(), 'only the messages enqueued inside the range, its two ends included, are resubmitted').toEqual([[2, 3]]);
      expect(run.progress(), 'a message the filter excludes stays in dead-letter and is counted as left by the filter').toMatchObject({ read: 4, matched: 2, resubmitted: 2, leftByFilter: 2 });
      expect(run.report(), 'the report says how many the filter left and which range it applied').toMatchObject({
        leftByFilter: 2,
        filter: { reason: null, text: null, enqueuedFrom: new Date(from).toISOString(), enqueuedTo: new Date(to).toISOString() }
      });
    });

    it('a bound that is not a number is no bound', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 2))).mockReturnValue(of([]));

      const run = service.start(ORDERS, { batchSize: 2, stopAtFirstFailure: false, enqueuedFrom: Number.NaN, enqueuedTo: Number.NaN })!;
      await run.done;

      expect(resubmitted(), 'an unreadable bound never excludes a message').toEqual([[1, 2]]);
      expect(run.progress().leftByFilter).toBe(0);
    });
  });

  describe('batch number and cycles of the proposed panels', () => {
    it('says "Batch N of M: resubmitting K." while a batch is in flight, keeps the batch of each message left behind, and the report counts the cycles', async () => {
      deadLetterCount(6);
      const answer = new Subject<BatchOperationResult>();
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 3))).mockReturnValueOnce(of(range(4, 3))).mockReturnValue(of([]));
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(of(result(2, [[2, REFUSED]]))).mockReturnValueOnce(answer);

      const run = service.start(ORDERS, { batchSize: 3, stopAtFirstFailure: false })!;
      await flush();

      expect(run.progress(), 'the second of two batches is in flight').toMatchObject({ batch: 2, batches: 2 });
      expect(run.progress().message).toBe('Batch 2 of 2: resubmitting 3. Reading onward from sequence number 7; the 1 left behind are not read again by this run.');
      answer.next(ok(3));
      answer.complete();
      await run.done;

      expect(run.failed, 'a message left behind names the batch it was read in').toEqual([{ sequenceNumber: 2, deadLetterReason: 'MaxDeliveryCountExceeded', error: REFUSED, batch: 1 }]);
      expect(run.report().cycles, 'the report counts the cycles the run took').toBe(2);
    });
  });

  describe('the rate over the last 5 minutes', () => {
    it('a batch read 4 minutes ago still counts in the rate, one read 6 minutes ago no longer does', async () => {
      deadLetterCount(1000);
      let clock = START;
      service.now = () => clock;
      const answers = [new Subject<BatchOperationResult>(), new Subject<BatchOperationResult>()];
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 100))).mockReturnValueOnce(of(range(101, 100))).mockReturnValue(new Observable());
      queue.resubmitDeadLetterMessages.mockReturnValueOnce(answers[0]).mockReturnValueOnce(answers[1]);

      const run = service.start(ORDERS, { batchSize: 100, stopAtFirstFailure: false })!;
      await flush();
      clock = START + 240_000;
      answers[0].next(ok(100));
      answers[0].complete();
      await flush();

      expect(run.progress().ratePerSecond, '200 read in the 4 minutes since the start').toBeCloseTo(200 / 240, 5);

      clock = START + 600_000;
      answers[1].next(ok(100));
      answers[1].complete();
      await flush();

      expect(run.progress().ratePerSecond, 'nothing read in the last 5 minutes').toBeCloseTo(0, 5);
      run.stop();
      await run.done;
    });
  });

  describe('the count of the matching messages before a run', () => {
    const counts: unknown[] = [];
    const count = (filter: object, cap?: number) => new Promise<{ read: number; matched: number; peeks: number; capped: boolean; done: boolean }>((resolve, reject) => {
      service.countMatching(ORDERS, filter, cap).subscribe({ next: c => counts.push(c), complete: () => resolve(counts[counts.length - 1] as never), error: reject });
    });
    beforeEach(() => (counts.length = 0));

    it('peeks the dead-letter queue onward from the start, 500 at a time and without bodies, counts what the filter of a run would match, and never resubmits', async () => {
      queue.peekDeadLetterMessages
        .mockReturnValueOnce(of([msg(1), msg(2, { deadLetterReason: 'TTLExpiredException' }), msg(3)]))
        .mockReturnValueOnce(of([msg(7, { enqueuedTime: new Date(START - 10 * 3_600_000).toISOString() as never })]))
        .mockReturnValue(of([]));

      const result = await count({ reason: 'MaxDeliveryCountExceeded', enqueuedFrom: START - 5 * 3_600_000 });

      expect(queue.peekDeadLetterMessages.mock.calls, 'pages of 500, onward from past the highest sequence number, no bodies').toEqual([
        ['orders', 500, 0, false], ['orders', 500, 4, false], ['orders', 500, 8, false]
      ]);
      expect(result, 'the same filter a run applies: reason and enqueued time').toEqual({ read: 4, matched: 2, peeks: 3, capped: false, done: true });
      expect(queue.resubmitDeadLetterMessages, 'a count changes nothing').not.toHaveBeenCalled();
    });

    it('stops at its cap and says so', async () => {
      queue.peekDeadLetterMessages.mockImplementation((_: string, n: number, from: number) => of(range(from + 1, n)));

      const result = await count({}, 1200);

      expect(queue.peekDeadLetterMessages.mock.calls.map(call => call[1]), 'never reads past the cap').toEqual([500, 500, 200]);
      expect(result, 'a count that reached its cap says it was capped').toEqual({ read: 1200, matched: 1200, peeks: 3, capped: true, done: true });
    });

    it('asks for the bodies only with a text filter', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of([msg(1), msg(2, { body: 'other' , subject: 'x' })])).mockReturnValue(of([]));

      const result = await count({ text: 'SAMPLE-1' });

      expect(queue.peekDeadLetterMessages.mock.calls[0][3], 'the text is matched in the body, so the body is read').toBe(true);
      expect(result.matched).toBe(1);
    });

    it('is cancelled by an unsubscribe, which aborts the peek in flight', () => {
      let aborted = false;
      queue.peekDeadLetterMessages.mockReturnValue(new Observable<MessageInfo[]>(() => () => { aborted = true; }));

      service.countMatching(ORDERS, {}).subscribe().unsubscribe();

      expect(aborted, 'cancelling the count aborts its request').toBe(true);
    });

    it('a peek that fails ends the count with the error, never with a number', async () => {
      queue.peekDeadLetterMessages.mockReturnValueOnce(of(range(1, 2))).mockReturnValueOnce(throwError(() => new Error('timeout')));

      await expect(count({}), 'a failed peek is an error, not a count of what was read before it').rejects.toThrow('timeout');
      expect(counts.every(c => !(c as { done: boolean }).done), 'no finished count was published').toBe(true);
    });
  });
});

