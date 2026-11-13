import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, ReplaySubject, firstValueFrom } from 'rxjs';
import { map, skip, takeUntil } from 'rxjs/operators';
import { BatchOperationResult, MessageInfo } from '../models';
import { QueueService } from './queue.service';
import { TopicService } from './topic.service';
import { ConnectionService } from './connection.service';
import { isNotFoundInScanWindow, isPossibleDuplicate } from './bulk-operations.service';
import { messageCallFailure } from '../../features/messages/message-call-failure';
import { parseDuration } from '../../features/entities/duration';

/** The entity and dead-letter sub-queue a run resubmits from. */
export interface ResubmitRunTarget {
  entityType: 'queue' | 'subscription';
  entityName: string;
  topicName?: string;
  subQueue: 'deadletter' | 'transferdeadletter';
}

/** Set before a run starts; never changed while it runs. */
export interface ResubmitRunOptions {
  /** 1 to 500 messages per cycle. */
  batchSize: number;
  /** End the run at the first failure or possible duplicate instead of continuing past it. */
  stopAtFirstFailure: boolean;
  /** Only messages whose dead-letter reason equals this text. */
  reason?: string;
  /** Only messages whose subject or body contains this text, ignoring case. */
  text?: string;
}

export type ResubmitRunStatus = 'running' | 'paused' | 'completed' | 'stopped' | 'failed';

/** A message the run left in the dead-letter queue, by sequence number. */
export interface LeftBehind {
  sequenceNumber: number;
  deadLetterReason: string;
  error: string;
}

export interface ReasonTotals {
  reason: string;
  read: number;
  resubmitted: number;
  failed: number;
  possibleDuplicates: number;
}

/** Counters of a run; the messages themselves are never kept. */
export interface ResubmitRunProgress {
  status: ResubmitRunStatus;
  /** The dead-letter count read at the start (N), or the number of messages a retry tries again. */
  total: number;
  read: number;
  matched: number;
  resubmitted: number;
  failed: number;
  possibleDuplicates: number;
  /** The next sequence number the run reads from. */
  cursor: number;
  elapsedMs: number;
  /** Messages read per second over the last minute; null before anything was measured. */
  ratePerSecond: number | null;
  /** Time left to read the rest of N at that rate; null when it cannot be estimated. */
  remainingMs: number | null;
  message: string;
}

export interface ResubmitRunReport {
  entityType: ResubmitRunTarget['entityType'];
  topic: string | null;
  entity: string;
  subQueue: ResubmitRunTarget['subQueue'];
  connection: string | null;
  filter: { reason: string | null; text: string | null };
  stopAtFirstFailure: boolean;
  status: ResubmitRunStatus;
  message: string;
  startedAt: string;
  endedAt: string | null;
  total: number;
  read: number;
  matched: number;
  resubmitted: number;
  failed: number;
  possibleDuplicates: number;
  byReason: ReasonTotals[];
  failedMessages: LeftBehind[];
  possibleDuplicateMessages: LeftBehind[];
}

interface RunBroker {
  /** The dead-letter count, and how long to wait for the locks of a batch the server left behind. */
  count(): Observable<{ count: number; lockWaitMs: number }>;
  peek(fromSequenceNumber: number, count: number, includeBody: boolean): Observable<MessageInfo[]>;
  resubmit(sequenceNumbers: number[]): Observable<BatchOperationResult>;
}

const STOPPED = Symbol('stopped');
const NO_REASON = '(none)';
const OTHER_REASONS = '(other reasons)';
const MAX_REASONS = 50;
const RATE_WINDOW_MS = 60_000;
const DEFAULT_LOCK_MS = 60_000;
const MAX_LOCK_WAIT_MS = 300_000;
const SCAN_WALL = 'The server could not find messages of the last batch even after their locks were released: the head of the dead-letter queue holds messages it cannot scan past, so the run stops here. They stay in the queue and are listed as failed.';

/** The entity's lock duration, 1 minute when it cannot be read, never more than 5 minutes. */
function lockWait(lockDuration: string | undefined): number {
  const d = parseDuration(lockDuration ?? '');
  const ms = ((((d.days * 24 + d.hours) * 60 + d.minutes) * 60 + d.seconds) * 1000) + d.milliseconds;
  return Math.min(ms > 0 ? ms : DEFAULT_LOCK_MS, MAX_LOCK_WAIT_MS);
}

function keyOf(target: ResubmitRunTarget): string {
  return [target.entityType, target.topicName ?? '', target.entityName, target.subQueue].join('\u0000');
}

/**
 * One automatic resubmit of a dead-letter queue. It reads the dead-letter count N and the start
 * time once, then peeks onward from a cursor that only moves forward, never more than N messages
 * in total, leaves alone every message enqueued at or after the start, and resubmits the matching
 * ones per batch. Failed messages and possible duplicates are recorded by
 * sequence number and left behind; a possible duplicate is never sent again.
 */
export class ResubmitRun {
  readonly startedAt: number;
  readonly failed: LeftBehind[] = [];
  readonly possibleDuplicates: LeftBehind[] = [];
  readonly done: Promise<void>;
  readonly progress = signal<ResubmitRunProgress>({
    status: 'running', total: 0, read: 0, matched: 0, resubmitted: 0, failed: 0, possibleDuplicates: 0,
    cursor: 0, elapsedMs: 0, ratePerSecond: null, remainingMs: null, message: 'Reading the dead-letter count.'
  });

  private status: ResubmitRunStatus = 'running';
  private message = 'Reading the dead-letter count.';
  private total = 0;
  private read = 0;
  private matched = 0;
  private resubmitted = 0;
  private cursor = 0;
  private endedAt: number | null = null;
  private readonly reasons = new Map<string, ReasonTotals>();
  private readonly samples: Array<{ t: number; read: number }> = [];
  private readonly stop$ = new ReplaySubject<void>(1);
  private stopping = false;
  private stopReason = 'Stopped by the user.';
  private pauseRequested = false;
  private wake: (() => void) | null = null;
  private readonly textPattern: RegExp | null;
  private readonly stopped = firstValueFrom(this.stop$);
  private lockWaitMs: number | null = null;

  constructor(
    readonly target: ResubmitRunTarget,
    readonly options: ResubmitRunOptions,
    readonly connection: string | null,
    /** The connection the run was started under; a later connection never acts on it. */
    readonly generation: number,
    private readonly broker: RunBroker,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
    retryOf?: LeftBehind[]
  ) {
    this.startedAt = now();
    this.textPattern = options.text ? new RegExp(options.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    this.samples.push({ t: this.startedAt, read: 0 });
    this.done = (retryOf ? this.retryList(retryOf) : this.scan())
      .catch(() => this.end('failed', 'The run stopped on an unexpected error.'));
  }

  isActive(): boolean {
    const status = this.progress().status;
    return status === 'running' || status === 'paused';
  }

  /** Starts nothing new once the request in flight has answered. */
  pause(): void {
    if (this.status === 'running' && !this.stopping) {
      this.pauseRequested = true;
      this.message = 'Pausing once the request in flight has answered.';
      this.publish();
    }
  }

  /** Resumes a paused run only; a stopped, failed or completed run stays as it is. */
  resume(): void {
    if (!this.pauseRequested || this.stopping || this.endedAt !== null) {
      return;
    }
    this.pauseRequested = false;
    this.wake?.();
  }

  /** Cancels the request in flight, which aborts the HTTP call, and ends the run. */
  stop(reason = 'Stopped by the user.'): void {
    if (this.stopping || this.endedAt !== null) {
      return;
    }
    this.stopping = true;
    this.stopReason = reason;
    this.stop$.next();
    this.wake?.();
  }

  byReason(): ReasonTotals[] {
    return [...this.reasons.values()].map(totals => ({ ...totals }));
  }

  report(): ResubmitRunReport {
    const p = this.progress();
    return {
      entityType: this.target.entityType,
      topic: this.target.topicName ?? null,
      entity: this.target.entityName,
      subQueue: this.target.subQueue,
      connection: this.connection,
      filter: { reason: this.options.reason || null, text: this.options.text || null },
      stopAtFirstFailure: this.options.stopAtFirstFailure,
      status: p.status,
      message: p.message,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: this.endedAt === null ? null : new Date(this.endedAt).toISOString(),
      total: p.total,
      read: p.read,
      matched: p.matched,
      resubmitted: p.resubmitted,
      failed: p.failed,
      possibleDuplicates: p.possibleDuplicates,
      byReason: this.byReason(),
      failedMessages: this.failed.map(entry => ({ ...entry })),
      possibleDuplicateMessages: this.possibleDuplicates.map(entry => ({ ...entry }))
    };
  }

  private async scan(): Promise<void> {
    let info: { count: number; lockWaitMs: number } | typeof STOPPED;
    try {
      info = await this.call(this.broker.count());
    } catch {
      return this.end('failed', 'Could not read the dead-letter count.');
    }
    if (info === STOPPED) {
      return this.end('stopped', this.stopReason);
    }
    this.total = Math.max(0, Number(info.count) || 0);
    this.lockWaitMs = info.lockWaitMs;
    this.message = 'Reading the dead-letter queue.';
    this.publish();

    for (;;) {
      if (this.read >= this.total) {
        return this.end('completed', `The ${this.total} messages present at the start were read.`);
      }
      if (!(await this.waitWhilePaused())) {
        return this.end('stopped', this.stopReason);
      }
      const count = Math.min(this.options.batchSize, this.total - this.read);
      let answer: MessageInfo[] | null | typeof STOPPED;
      try {
        answer = await this.call(this.broker.peek(this.cursor, count, this.textPattern !== null));
      } catch (error) {
        return this.end('failed', messageCallFailure(error, 'The dead-letter peek failed'));
      }
      if (answer === STOPPED) {
        return this.end('stopped', this.stopReason);
      }
      const batch = (answer ?? []).slice(0, count);
      if (batch.length === 0) {
        return this.end('completed', 'The dead-letter queue has no more messages to read.');
      }

      const from = this.cursor;
      this.read += batch.length;
      this.cursor = batch.reduce((next, message) => Math.max(next, message.sequenceNumber + 1), from);
      const targets = new Map<number, string>();
      let olderThanStart = 0;
      for (const message of batch) {
        if (message.sequenceNumber < from) {
          continue;
        }
        if (!(new Date(message.enqueuedTime).getTime() < this.startedAt)) {
          continue;
        }
        olderThanStart++;
        const reason = message.deadLetterReason || NO_REASON;
        this.totalsOf(reason).read++;
        if (this.matches(message)) {
          targets.set(message.sequenceNumber, reason);
        }
      }
      this.matched += targets.size;
      this.publish();

      if (targets.size > 0 && !(await this.resubmit(targets))) {
        return;
      }
      if (olderThanStart === 0) {
        return this.end('completed', 'Only messages that arrived after the run started remain.');
      }
    }
  }

  private async retryList(entries: LeftBehind[]): Promise<void> {
    this.total = entries.length;
    this.message = `Trying the ${entries.length} failed messages again.`;
    this.publish();
    for (let i = 0; i < entries.length; i += this.options.batchSize) {
      const chunk = entries.slice(i, i + this.options.batchSize);
      this.read += chunk.length;
      this.matched += chunk.length;
      chunk.forEach(entry => this.totalsOf(entry.deadLetterReason).read++);
      this.publish();
      if (!(await this.resubmit(new Map(chunk.map(entry => [entry.sequenceNumber, entry.deadLetterReason]))))) {
        return;
      }
    }
    this.end('completed', `The ${entries.length} failed messages were tried again.`);
  }

  /**
   * Resubmits one batch and records its outcome; false when the run ended. A message the server did
   * not find is sent once more after the locks of the batch are released; still not found, it ends the run.
   */
  private async resubmit(targets: Map<number, string>, secondTry = false): Promise<boolean> {
    if (!(await this.waitWhilePaused())) {
      this.end('stopped', this.stopReason);
      return false;
    }
    let answer: BatchOperationResult | null | typeof STOPPED;
    try {
      answer = await this.call(this.broker.resubmit([...targets.keys()]));
    } catch (error) {
      this.unknownOutcome(targets, 'The resubmit call failed; this message may have been sent.');
      this.end('failed', `${messageCallFailure(error, 'The resubmit call failed')}. Its ${targets.size} messages may have been sent and are reported as possible duplicates.`);
      return false;
    }
    if (answer === STOPPED) {
      this.unknownOutcome(targets, 'Stopped while the resubmit was in flight; this message may have been sent.');
      this.end('stopped', `${this.stopReason} The ${targets.size} messages in flight may have been sent and are reported as possible duplicates.`);
      return false;
    }
    if (!answer || !Array.isArray(answer.failures) || !answer.failures.every(f => typeof f?.sequenceNumber === 'number' && typeof f?.error === 'string')) {
      this.unknownOutcome(targets, 'The resubmit answer could not be read; this message may have been sent.');
      this.end('failed', `The resubmit answer could not be read. Its ${targets.size} messages are reported as possible duplicates.`);
      return false;
    }

    const failedNow: number[] = [];
    const duplicatesNow: number[] = [];
    const notFound = new Map<number, LeftBehind>();
    for (const failure of answer.failures) {
      const seq = failure.sequenceNumber;
      if (!targets.has(seq) || failedNow.includes(seq) || duplicatesNow.includes(seq) || notFound.has(seq)) {
        continue;
      }
      const reason = targets.get(seq)!;
      const entry = { sequenceNumber: seq, deadLetterReason: reason, error: failure.error };
      if (isPossibleDuplicate(failure)) {
        duplicatesNow.push(seq);
        this.possibleDuplicates.push(entry);
        this.totalsOf(reason).possibleDuplicates++;
      } else if (isNotFoundInScanWindow(failure)) {
        notFound.set(seq, entry);
      } else {
        failedNow.push(seq);
        this.recordFailed(entry);
      }
    }
    for (const [sequenceNumber, reason] of targets) {
      if (!failedNow.includes(sequenceNumber) && !duplicatesNow.includes(sequenceNumber) && !notFound.has(sequenceNumber)) {
        this.resubmitted++;
        this.totalsOf(reason).resubmitted++;
      }
    }
    this.publish();

    if (this.options.stopAtFirstFailure && (failedNow.length > 0 || duplicatesNow.length > 0)) {
      notFound.forEach(entry => this.recordFailed(entry));
      const parts = [
        failedNow.length > 0 ? `failed: ${failedNow.join(', ')}` : '',
        duplicatesNow.length > 0 ? `possible duplicate, do not retry: ${duplicatesNow.join(', ')}` : '',
        notFound.size > 0 ? `not found: ${[...notFound.keys()].join(', ')}` : ''
      ].filter(part => part !== '');
      this.end('failed', `Stopped at the first failure (${parts.join('; ')}).`);
      return false;
    }
    if (notFound.size === 0) {
      return true;
    }
    if (secondTry) {
      notFound.forEach(entry => this.recordFailed(entry));
      this.end('failed', SCAN_WALL);
      return false;
    }
    if (!(await this.waitForLocks())) {
      this.end('stopped', this.stopReason);
      return false;
    }
    return this.resubmit(new Map([...notFound].map(([seq, entry]) => [seq, entry.deadLetterReason])), true);
  }

  private recordFailed(entry: LeftBehind): void {
    this.failed.push(entry);
    this.totalsOf(entry.deadLetterReason).failed++;
  }

  /** Waits the entity's lock duration, at most 5 minutes, one second at a time; false when the run was stopped. */
  private async waitForLocks(): Promise<boolean> {
    if (this.lockWaitMs === null) {
      const info = await this.call(this.broker.count()).catch(() => null);
      this.lockWaitMs = info && info !== STOPPED ? info.lockWaitMs : MAX_LOCK_WAIT_MS;
    }
    const until = this.now() + this.lockWaitMs;
    while (!this.stopping) {
      const left = until - this.now();
      if (left <= 0) {
        this.message = 'Sending the messages of the last batch again.';
        this.publish();
        return true;
      }
      this.message = `Waiting for the broker to release the messages of the last batch: ${Math.ceil(left / 1000)} s left.`;
      this.publish();
      await Promise.race([this.sleep(Math.min(1000, left)), this.stopped]);
    }
    return false;
  }

  private unknownOutcome(targets: Map<number, string>, error: string): void {
    for (const [sequenceNumber, reason] of targets) {
      this.possibleDuplicates.push({ sequenceNumber, deadLetterReason: reason, error });
      this.totalsOf(reason).possibleDuplicates++;
    }
  }

  private matches(message: MessageInfo): boolean {
    if (this.options.reason && message.deadLetterReason !== this.options.reason) {
      return false;
    }
    return !this.textPattern || this.textPattern.test(message.subject ?? '') || this.textPattern.test(message.body ?? '');
  }

  private totalsOf(reason: string): ReasonTotals {
    // ponytail: at most 50 reasons are counted apart, the rest in one bucket; the dead-letter reason is free text a consumer may fill with exception messages.
    const key = this.reasons.has(reason) || this.reasons.size < MAX_REASONS ? reason : OTHER_REASONS;
    let totals = this.reasons.get(key);
    if (!totals) {
      totals = { reason: key, read: 0, resubmitted: 0, failed: 0, possibleDuplicates: 0 };
      this.reasons.set(key, totals);
    }
    return totals;
  }

  private call<T>(source: Observable<T>): Promise<T | typeof STOPPED> {
    return firstValueFrom(source.pipe(takeUntil(this.stop$)), { defaultValue: STOPPED });
  }

  private async waitWhilePaused(): Promise<boolean> {
    if (this.pauseRequested && !this.stopping) {
      this.status = 'paused';
      this.message = 'Paused. Nothing is read or sent until the run is resumed.';
      this.publish();
      await new Promise<void>(resolve => (this.wake = resolve));
      this.wake = null;
      if (!this.stopping) {
        this.status = 'running';
        this.message = 'Reading the dead-letter queue.';
        this.publish();
      }
    }
    return !this.stopping;
  }

  private end(status: ResubmitRunStatus, message: string): void {
    this.status = status;
    this.message = message;
    this.endedAt = this.now();
    this.publish();
  }

  private publish(): void {
    const now = this.endedAt ?? this.now();
    this.samples.push({ t: now, read: this.read });
    while (this.samples.length > 1 && this.samples[1].t <= now - RATE_WINDOW_MS) {
      this.samples.shift();
    }
    const first = this.samples[0];
    const seconds = (now - first.t) / 1000;
    const rate = seconds > 0 ? (this.read - first.read) / seconds : null;
    this.progress.set({
      status: this.status,
      total: this.total,
      read: this.read,
      matched: this.matched,
      resubmitted: this.resubmitted,
      failed: this.failed.length,
      possibleDuplicates: this.possibleDuplicates.length,
      cursor: this.cursor,
      elapsedMs: now - this.startedAt,
      ratePerSecond: rate,
      remainingMs: rate && this.endedAt === null ? Math.round(((this.total - this.read) / rate) * 1000) : null,
      message: this.message
    });
  }
}

/**
 * Keeps every automatic dead-letter resubmit of the app, at most one per entity and sub-queue, so a
 * run goes on when its dialog closes. A change of connection stops every active run.
 */
@Injectable({ providedIn: 'root' })
export class ResubmitRunService {
  private readonly queues = inject(QueueService);
  private readonly topics = inject(TopicService);
  private readonly connections = inject(ConnectionService);
  private readonly runs = signal<ReadonlyMap<string, ResubmitRun>>(new Map());
  private generation = 0;
  /** Set from a connect, disconnect or clear of all data until the API's status arrives; no run starts meanwhile. */
  private switching = false;

  now = () => Date.now();
  sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  /** Runs that are running or paused. */
  readonly activeRuns = computed(() => [...this.runs().values()].filter(run => run.isActive()));

  constructor() {
    this.connections.onBeforeSwitch(() => {
      this.switching = true;
      return this.stopAll('The connection is changing, so the run was stopped.');
    });
    this.connections.connectionStatus$
      .pipe(skip(1))
      .subscribe(() => {
        this.switching = false;
        void this.stopAll('The connection changed, so the run was stopped.');
      });
  }

  /** Stops every active run and resolves once each has ended; a run from before never acts again. */
  private stopAll(reason: string): Promise<void> {
    this.generation++;
    const active = this.activeRuns();
    active.forEach(run => run.stop(reason));
    return Promise.allSettled(active.map(run => run.done)).then(() => undefined);
  }

  /**
   * Starts a run, or returns the one already active on that entity and sub-queue. While the
   * connection is changing it starts nothing and answers undefined.
   */
  start(target: ResubmitRunTarget, options: ResubmitRunOptions): ResubmitRun | undefined {
    if (this.switching) {
      return undefined;
    }
    const active = this.find(target);
    if (active?.isActive()) {
      return active;
    }
    return this.keep(new ResubmitRun(target, options, this.connections.currentTarget ?? null, this.generation, this.brokerFor(target), this.now, this.sleep));
  }

  /** A finished run can be retried only under the connection it ran on. */
  canRetry(run: ResubmitRun): boolean {
    return !this.switching && !run.isActive() && run.generation === this.generation && run.failed.length > 0;
  }

  /**
   * Starts a run on exactly the failed messages of a finished run; possible duplicates are never included.
   * A run from an earlier connection is returned as it is, so its sequence numbers never reach another broker.
   */
  retry(run: ResubmitRun): ResubmitRun {
    const active = this.find(run.target);
    if (active?.isActive()) {
      return active;
    }
    if (!this.canRetry(run)) {
      return run;
    }
    const failed = run.failed.map(entry => ({ ...entry }));
    return this.keep(new ResubmitRun(run.target, run.options, this.connections.currentTarget ?? null, this.generation, this.brokerFor(run.target), this.now, this.sleep, failed));
  }

  find(target: ResubmitRunTarget): ResubmitRun | undefined {
    return this.runs().get(keyOf(target));
  }

  /** Forgets a finished run; an active one is kept. */
  clear(target: ResubmitRunTarget): void {
    if (this.find(target)?.isActive()) {
      return;
    }
    const next = new Map(this.runs());
    next.delete(keyOf(target));
    this.runs.set(next);
  }

  private keep(run: ResubmitRun): ResubmitRun {
    this.runs.set(new Map(this.runs()).set(keyOf(run.target), run));
    return run;
  }

  private brokerFor(target: ResubmitRunTarget): RunBroker {
    const transfer = target.subQueue === 'transferdeadletter';
    const name = target.entityName;
    if (target.entityType === 'queue') {
      return {
        count: () => this.queues.getQueue(name).pipe(
          map(queue => ({
            count: (transfer ? queue.transferDeadLetterMessageCount : queue.deadLetterMessageCount) ?? 0,
            lockWaitMs: lockWait(queue.lockDuration)
          }))
        ),
        peek: (from, count, includeBody) => transfer
          ? this.queues.peekTransferDeadLetterMessages(name, count, from, includeBody)
          : this.queues.peekDeadLetterMessages(name, count, from, includeBody),
        resubmit: numbers => transfer
          ? this.queues.resubmitTransferDeadLetterMessages(name, numbers)
          : this.queues.resubmitDeadLetterMessages(name, numbers)
      };
    }
    const topic = target.topicName ?? '';
    return {
      count: () => this.topics.getSubscription(topic, name).pipe(
        map(subscription => ({
          count: (transfer ? subscription.transferDeadLetterMessageCount : subscription.deadLetterMessageCount) ?? 0,
          lockWaitMs: lockWait(subscription.lockDuration)
        }))
      ),
      peek: (from, count, includeBody) => transfer
        ? this.topics.peekTransferDeadLetterMessages(topic, name, count, from, includeBody)
        : this.topics.peekDeadLetterMessages(topic, name, count, from, includeBody),
      resubmit: numbers => transfer
        ? this.topics.resubmitTransferDeadLetterMessages(topic, name, numbers)
        : this.topics.resubmitDeadLetterMessages(topic, name, numbers)
    };
  }
}
