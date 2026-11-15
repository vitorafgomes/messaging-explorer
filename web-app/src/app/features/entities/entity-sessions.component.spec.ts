import { TestBed, ComponentFixture } from '@angular/core/testing';
import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { SessionService } from '../../core/services';
import { MessageInfo, SessionDetail, SessionEntity, SessionList } from '../../core/models';
import { EntitySessionsComponent } from './entity-sessions.component';
import { SessionStateDialogComponent } from './session-state-dialog.component';

const LOCK_NOTICE = 'Listing sessions locks each one briefly. The broker cannot list sessions without accepting them: each one is locked, read and released at once, '
  + 'and a consumer that wants it waits for that moment. The listing stops after 10 seconds and shows only the sessions it could lock.';
const STATE_ONLY_TRUNCATED = 'Sessions further back, or holding only a state, are not shown; open one by its id.';
const STATE_ONLY = 'Sessions holding only a state are not shown; open one by its id.';
const FOOTNOTE = 'Peeked, not received: nothing leaves the queue, and the session lock taken to read is released at once.';
const HINT = 'The consuming application reads this the next time it accepts the session.';
const SAME = 'The new state is the same as the current one';

const LIST: SessionList = {
  sessions: [
    { sessionId: 'order-1001', messageCount: 12, firstSequenceNumber: 4411 },
    { sessionId: 'order-1002', messageCount: 1, firstSequenceNumber: 4415 }
  ],
  scannedMessages: 1000,
  truncated: true
};
const MESSAGE: MessageInfo = {
  messageId: 'm-1', sessionId: 'order-1001', body: '{"total":42}', bodyType: 'String', sequenceNumber: 4411, deliveryCount: 0,
  enqueuedTime: '2026-11-12T22:00:00Z' as never, timeToLive: '14.00:00:00', applicationProperties: {}, state: 'Active', sizeInBytes: 412
};
const DETAIL: SessionDetail = { sessionId: 'order-1001', state: '{"step":3}', stateIsBinary: false, lockedUntil: '2026-11-12T23:10:00+00:00', messages: [MESSAGE] };

type Get = (entity: SessionEntity, id: string, count: number) => Observable<SessionDetail>;

describe('EntitySessionsComponent: the sessions of a queue or a subscription', () => {
  let fixture: ComponentFixture<EntitySessionsComponent>;
  let el: HTMLElement;
  let api: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn<Get>> };
  let open: ReturnType<typeof vi.fn>;
  let dialogResult: unknown;

  const passRead: Get = (_e, id) => of({ ...DETAIL, sessionId: id, messages: null });
  const detailOr = (pass: Get): Get => (e, id, count) => count === 0 ? pass(e, id, count) : of(DETAIL);

  function render(entity: SessionEntity, list: () => Observable<SessionList> = () => of(LIST), get: Get = detailOr(passRead)) {
    dialogResult = undefined;
    open = vi.fn(() => ({ afterClosed: () => of(dialogResult) }));
    api = { list: vi.fn(list), get: vi.fn<Get>(get) };
    TestBed.configureTestingModule({
      imports: [EntitySessionsComponent],
      providers: [
        { provide: SessionService, useValue: api },
        { provide: MatDialog, useValue: { open } }
      ]
    });
    fixture = TestBed.createComponent(EntitySessionsComponent);
    fixture.componentRef.setInput('entity', entity);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const QUEUE = { queueName: 'orders' };
  const SUBSCRIPTION = { topicName: 'order-events', subscriptionName: 'billing' };
  const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const rows = () => Array.from(el.querySelectorAll('tr.session-row')).map(r => Array.from(r.querySelectorAll('td')).map(text));
  const ids = () => rows().map(r => r[0]);
  const button = (label: string) => Array.from(el.querySelectorAll('button')).find(b => text(b).endsWith(label)) as HTMLButtonElement | undefined;
  const click = (b: HTMLButtonElement | null | undefined) => {
    b!.click();
    fixture.detectChanges();
  };
  const alert = (scope: string) => text(el.querySelector(`${scope} [role="alert"] .grow`));
  const fail = (status: number, message?: string, code?: string) => throwError(() => new HttpErrorResponse({ status, error: message ? { message, ...(code ? { code } : {}) } : null }));
  const failing = (status: number, message?: string, code?: string) => () => fail(status, message, code);
  const typeId = (value: string) => {
    const input = el.querySelector('input[name="sessionId"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  };
  const textarea = () => el.querySelector('textarea[name="sessionState"]') as HTMLTextAreaElement | null;
  const typeState = (value: string) => {
    textarea()!.value = value;
    textarea()!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const facts = () => Array.from(el.querySelectorAll('.detail .fact')).map(f => `${text(f.querySelector('dt'))}: ${text(f.querySelector('dd'))}`);
  const messageRows = () => Array.from(el.querySelectorAll('tr.message-row')).map(r => Array.from(r.querySelectorAll('td')).map(text));
  /** The reads that open one session with its messages, apart from the listing's state-only accepts. */
  const opens = () => api.get.mock.calls.filter(c => c[2] === 100);
  const accepts = () => api.get.mock.calls.filter(c => c[2] === 0).map(c => c[1]);
  const review = () => button('Review change')!;

  describe('the list: a passive scan, then one accept per listed session', () => {
    it('lists each session in a table with its Session ID, Lock Status and State, from one state-only accept per session', () => {
      render(QUEUE, () => of(LIST), detailOr((_e, id) => of({ ...DETAIL, sessionId: id, state: id === 'order-1001' ? '{"step":3}' : null, messages: null })));

      expect(api.list.mock.calls).toStrictEqual([[QUEUE]]);
      expect(api.get.mock.calls, 'each listed session is accepted once, asking for no messages').toStrictEqual([[QUEUE, 'order-1001', 0], [QUEUE, 'order-1002', 0]]);
      expect(Array.from(el.querySelectorAll('table.sessions th')).map(text)).toStrictEqual(['Session ID', 'Lock Status', 'State']);
      expect(rows()).toStrictEqual([['order-1001', 'Unlocked', 'Has state'], ['order-1002', 'Unlocked', 'No state']]);
      expect(el.querySelector('tr.session-row td button.session'), 'the Session ID is a button').not.toBeNull();
    });

    it('the notice is on screen, in the words of the artboard, before the first session is accepted', () => {
      const pending = new Subject<SessionList>();
      render(QUEUE, () => pending);

      expect(text(el.querySelector('.lock-notice > span'))).toBe(LOCK_NOTICE);
      expect(text(el.querySelector('.lock-notice strong'))).toBe('Listing sessions locks each one briefly.');
      expect(api.get, 'no session is accepted before the list answers').not.toHaveBeenCalled();

      pending.next(LIST);
      fixture.detectChanges();
      expect(accepts()).toStrictEqual(['order-1001', 'order-1002']);
      expect(text(el.querySelector('.lock-notice > span')), 'the notice stays while the sessions are accepted').toBe(LOCK_NOTICE);
    });

    it('says how many sessions were listed and at what time, as "N sessions listed at HH:MM:SS"', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const now = new Date(2026, 10, 12, 14, 2, 30);
        vi.setSystemTime(now);
        render(QUEUE);
        expect(text(el.querySelector('.listed'))).toBe(`2 sessions listed at ${formatDate(now, 'HH:mm:ss', 'en-US')}`);
        TestBed.resetTestingModule();

        render(QUEUE, () => of({ ...LIST, sessions: [LIST.sessions[0]] }));
        expect(text(el.querySelector('.listed')), 'one session').toBe(`1 session listed at ${formatDate(now, 'HH:mm:ss', 'en-US')}`);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a truncated scan says from how many messages it listed; a complete one says only that sessions holding only a state are not shown', () => {
      render(QUEUE);
      expect(text(el.querySelector('.scan-notice'))).toBe(`Listed from the first 1000 messages. ${STATE_ONLY_TRUNCATED}`);
      TestBed.resetTestingModule();

      render(SUBSCRIPTION, () => of({ ...LIST, scannedMessages: 37, truncated: false }));
      expect(text(el.querySelector('.scan-notice'))).toBe(STATE_ONLY);
    });

    it('a session another receiver holds (409 SessionInUse) is Locked; a 409 without that code is a failure, never Locked', () => {
      render(QUEUE, () => of(LIST), detailOr((_e, id) => id === 'order-1001'
        ? fail(409, 'The session is in use by another receiver. Try again in a moment.', 'SessionInUse')
        : fail(409, 'The entity is disabled for this operation.')));

      expect(rows()[0], 'a 409 with code SessionInUse maps to Locked').toStrictEqual(['order-1001', 'Locked', 'Not read: another receiver holds it']);
      expect(rows()[1], 'a 409 without the SessionInUse code is a failure, not Locked').toStrictEqual(['order-1002', 'Not read', 'The entity is disabled for this operation.']);
    });

    it('opening a session the listing is still reading is refused by our own accept: it says so, never Locked, and the row stays Reading', () => {
      const listing = new Subject<SessionDetail>();
      render(QUEUE, () => of(LIST), (_e, id, count) => count === 0
        ? (id === 'order-1001' ? listing : passRead(_e, id, 0))
        : fail(409, 'The session is in use by another receiver. Try again in a moment.', 'SessionInUse'));

      click(el.querySelector<HTMLButtonElement>('button.session'));

      expect(text(el.querySelector('.detail')), 'the open says the listing holds it, with Retry').toContain('The listing is reading this session right now. Try again in a moment.');
      expect(facts().some(f => f.includes('Locked')), 'our own listing is not another receiver').toBe(false);
      expect(rows()[0], 'the row is not marked Locked by the open').toStrictEqual(['order-1001', 'Reading...', 'Reading...']);
      listing.next({ ...DETAIL, messages: null });
      listing.complete();
      fixture.detectChanges();
      expect(rows()[0]).toStrictEqual(['order-1001', 'Unlocked', 'Has state']);
    });

    it('a listing answer that lands after the session was opened does not overwrite what the open read', () => {
      const listing = new Subject<SessionDetail>();
      render(QUEUE, () => of(LIST), (_e, id, count) => count === 0
        ? (id === 'order-1001' ? listing : passRead(_e, id, 0))
        : of(DETAIL));

      click(el.querySelector<HTMLButtonElement>('button.session'));
      expect(rows()[0], 'the open read it').toStrictEqual(['order-1001', 'Unlocked', 'Has state']);
      listing.error(new HttpErrorResponse({ status: 409, error: { code: 'SessionInUse', message: 'The session is in use by another receiver. Try again in a moment.' } }));
      fixture.detectChanges();

      expect(rows()[0], 'the open is the fresher answer: the listing, refused by the open itself, does not turn the row Locked').toStrictEqual(['order-1001', 'Unlocked', 'Has state']);
    });

    it('a session whose read fails with a 5xx or no answer shows that failure in its row, never Unlocked or No state, and the other rows still fill', () => {
      const three = { ...LIST, sessions: [...LIST.sessions, { sessionId: 'order-1003', messageCount: 2, firstSequenceNumber: 4416 }] };
      render(QUEUE, () => of(three), detailOr((e, id) => id === 'order-1001' ? fail(500, 'An internal error occurred.')
        : id === 'order-1002' ? fail(0) : passRead(e, id, 0)));

      expect(rows(), 'the failed rows show their failure and the third row fills').toStrictEqual([
        ['order-1001', 'Not read', 'The API did not answer.'],
        ['order-1002', 'Not read', 'The API did not answer.'],
        ['order-1003', 'Unlocked', 'Has state']
      ]);
    });

    it('accepts at most 4 sessions at once: the 5th is asked only when one of the first 4 answers', () => {
      const six = { ...LIST, sessions: [1, 2, 3, 4, 5, 6].map(n => ({ sessionId: `s-${n}`, messageCount: 1, firstSequenceNumber: n })) };
      const answers = new Map<string, Subject<SessionDetail>>();
      render(QUEUE, () => of(six), detailOr((_e, id) => { const s = new Subject<SessionDetail>(); answers.set(id, s); return s; }));

      expect(accepts(), 'four accepts before any answer').toStrictEqual(['s-1', 's-2', 's-3', 's-4']);
      expect(rows().map(r => r[1])).toStrictEqual(Array(6).fill('Reading...'));

      answers.get('s-2')!.next({ ...DETAIL, sessionId: 's-2', messages: null });
      answers.get('s-2')!.complete();
      fixture.detectChanges();

      expect(accepts(), 'the 5th after one answered').toStrictEqual(['s-1', 's-2', 's-3', 's-4', 's-5']);
      expect(rows()[1]).toStrictEqual(['s-2', 'Unlocked', 'Has state']);
    });

    it('stops accepting after 10 seconds: sessions not read by then say so, and their accepts are cancelled', () => {
      vi.useFakeTimers();
      try {
        const answers = new Map<string, Subject<SessionDetail>>();
        render(QUEUE, () => of(LIST), detailOr((e, id) => {
          if (id === 'order-1001') return passRead(e, id, 0);
          const s = new Subject<SessionDetail>(); answers.set(id, s); return s;
        }));

        vi.advanceTimersByTime(9_999);
        fixture.detectChanges();
        expect(rows()[1], 'still reading before 10 seconds').toStrictEqual(['order-1002', 'Reading...', 'Reading...']);

        vi.advanceTimersByTime(1);
        fixture.detectChanges();
        expect(rows(), 'the session read in time keeps its row; the other says it was not read').toStrictEqual([
          ['order-1001', 'Unlocked', 'Has state'],
          ['order-1002', 'Not read', 'Not read: the listing stopped after 10 seconds']
        ]);
        expect(answers.get('order-1002')!.observed, 'the accept still in flight is cancelled').toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('List again cancels the accepts still in flight, reads the list again and accepts the new sessions', () => {
      const pending = new Subject<SessionDetail>();
      render(QUEUE, () => of(LIST), detailOr(() => pending));
      expect(pending.observed).toBe(true);
      api.list.mockImplementation(() => of({ ...LIST, sessions: [{ sessionId: 'order-1003', messageCount: 4, firstSequenceNumber: 4420 }] }));
      api.get.mockImplementation(detailOr(passRead));

      click(button('List again'));

      expect(pending.observed, 'the previous accepts are cancelled').toBe(false);
      expect(api.list.mock.calls).toStrictEqual([[QUEUE], [QUEUE]]);
      expect(accepts()).toStrictEqual(['order-1001', 'order-1002', 'order-1003']);
      expect(rows()).toStrictEqual([['order-1003', 'Unlocked', 'Has state']]);
    });

    it('loading, empty and failed are three different states', () => {
      const pending = new Subject<SessionList>();
      render(QUEUE, () => pending);
      expect(el.querySelector('mat-progress-bar[aria-label="Reading the sessions"]'), 'loading').not.toBeNull();
      expect(el.querySelector('tr.session-row')).toBeNull();
      expect(el.querySelector('.list [role="alert"]')).toBeNull();

      pending.next({ sessions: [], scannedMessages: 0, truncated: false });
      fixture.detectChanges();
      expect(text(el.querySelector('.list .empty'))).toBe('No session holds a message in this queue.');
      expect(el.querySelector('mat-progress-bar')).toBeNull();
      expect(el.querySelector('.list [role="alert"]')).toBeNull();
      expect(api.get, 'nothing to accept').not.toHaveBeenCalled();
    });

    it('a list that fails with a 500 or no answer shows an error with Retry, never the empty state; Retry reads the list again', () => {
      for (const status of [500, 0]) {
        render(QUEUE, failing(status, 'An internal error occurred.'));

        expect(alert('.list'), `status ${status}`).toBe('Could not read the sessions: the API did not answer.');
        expect(el.querySelector('.list .empty')).toBeNull();
        expect(api.get, 'nothing is accepted without a list').not.toHaveBeenCalled();

        api.list.mockImplementation(() => of(LIST));
        click(button('Retry'));
        expect(api.list).toHaveBeenCalledTimes(2);
        expect(rows().length).toBe(2);
        TestBed.resetTestingModule();
      }
    });

    it('a 404 and a 400 on the list are shown as the API worded them', () => {
      render(QUEUE, failing(404, 'The queue was not found.'));
      expect(alert('.list')).toBe('The queue was not found.');
      TestBed.resetTestingModule();

      render(QUEUE, failing(400, 'This entity does not use sessions.'));
      expect(alert('.list')).toBe('This entity does not use sessions.');
      click(button('Retry'));
      expect(api.list.mock.calls, 'Retry asks again').toStrictEqual([[QUEUE], [QUEUE]]);
      expect(alert('.list'), 'a refusal stays shown as worded').toBe('This entity does not use sessions.');
    });

    it('session ids are shown as text: markup is not interpreted', () => {
      render(QUEUE, () => of({ ...LIST, sessions: [{ sessionId: '<img src=x>', messageCount: 1, firstSequenceNumber: 1 }] }));

      expect(ids()).toStrictEqual(['<img src=x>']);
      expect(el.querySelector('.list img')).toBeNull();
    });
  });

  describe('open a session by its id', () => {
    it('Open is disabled for an empty id, an id of only spaces and more than 128 characters, which says the rule; 128 and an id with spaces inside open as typed', () => {
      render(QUEUE);
      const openButton = () => button('Open session')!;

      expect(openButton().disabled, 'empty').toBe(true);

      typeId('x'.repeat(129));
      expect(openButton().disabled, '129 characters').toBe(true);
      expect(text(el.querySelector('mat-error'))).toBe('A session id is 1 to 128 characters, not only spaces.');

      typeId('   ');
      expect(openButton().disabled, 'only spaces').toBe(true);
      expect(text(el.querySelector('mat-error'))).toBe('A session id is 1 to 128 characters, not only spaces.');
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      expect(opens(), 'an id of only spaces is never sent').toStrictEqual([]);

      typeId('x'.repeat(128));
      expect(openButton().disabled, '128 characters').toBe(false);
      expect(el.querySelector('mat-error')).toBeNull();

      typeId('order 1003/a');
      click(openButton());
      expect(opens()).toStrictEqual([[QUEUE, 'order 1003/a', 100]]);
    });

    it('an empty id after typing says the rule too and sends nothing', () => {
      render(QUEUE);
      typeId('a');
      typeId('');

      expect(text(el.querySelector('mat-error'))).toBe('A session id is 1 to 128 characters, not only spaces.');
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      expect(opens()).toStrictEqual([]);
    });
  });

  describe('the selected session: its facts, its state and its messages', () => {
    it('opening a session is one request; it shows Session ID and Lock Status, the Session State, and its messages with Sequence, Message ID, Enqueued (UTC) and Size', () => {
      render(QUEUE);
      const detail = new Subject<SessionDetail>();
      api.get.mockImplementation(() => detail);

      click(el.querySelector<HTMLButtonElement>('button.session'));
      expect(opens(), 'one request, asking for 100 messages').toStrictEqual([[QUEUE, 'order-1001', 100]]);
      expect(el.querySelector('mat-progress-bar[aria-label="Opening session order-1001"]')).not.toBeNull();
      expect(el.querySelector('button.session')!.getAttribute('aria-current'), 'the selected row is marked').toBe('true');

      detail.next({ ...DETAIL, messages: [MESSAGE, { ...MESSAGE, messageId: 'm-2', sequenceNumber: 4413, sizeInBytes: 2048 }] });
      detail.complete();
      fixture.detectChanges();

      expect(opens(), 'nothing else is requested to show the messages').toHaveLength(1);
      expect(facts()).toStrictEqual(['Session ID: order-1001', 'Lock Status: Unlocked']);
      expect(Array.from(el.querySelectorAll('.detail h3')).map(text)).toStrictEqual(['Session State', 'Messages of this session']);
      expect(text(el.querySelector('.state'))).toBe('{"step":3}');
      expect(Array.from(el.querySelectorAll('.messages th')).map(text)).toStrictEqual(['Sequence', 'Message ID', 'Enqueued (UTC)', 'Size']);
      expect(messageRows()).toStrictEqual([
        ['4411', 'm-1', 'Nov 12, 2026, 10:00:00 PM', '412 B'],
        ['4413', 'm-2', 'Nov 12, 2026, 10:00:00 PM', '2,048 B']
      ]);
      expect(text(el.querySelector('.footnote'))).toBe(FOOTNOTE);
    });

    it('a session with no state says "No state data"; a session with no message, empty or null, says so', () => {
      for (const messages of [[], null]) {
        render(QUEUE);
        api.get.mockImplementation(() => of({ ...DETAIL, state: null, messages }));
        click(el.querySelector<HTMLButtonElement>('button.session'));

        expect(text(el.querySelector('.state'))).toBe('No state data');
        expect(text(el.querySelector('.detail .empty')), JSON.stringify(messages)).toBe('No message in this session.');
        expect(button('Edit state'), 'a missing state can be written').toBeDefined();
        TestBed.resetTestingModule();
      }
    });

    it('a binary state is shown as its byte count and base64 and offers no editor', () => {
      render(QUEUE);
      api.get.mockImplementation(() => of({ ...DETAIL, state: 'AAEC/w==', stateIsBinary: true }));
      click(el.querySelector<HTMLButtonElement>('button.session'));

      expect(text(el.querySelector('.binary'))).toBe('binary state, 4 bytes as base64, cannot be edited here');
      expect(text(el.querySelector('.state'))).toBe('AAEC/w==');
      expect(button('Edit state')).toBeUndefined();
    });

    it('a session held by another receiver shows Lock Status Locked and the server words, with Retry, which opens it again', () => {
      render(QUEUE);
      api.get.mockImplementation(failing(409, 'The session is in use by another receiver. Try again in a moment.', 'SessionInUse'));
      click(el.querySelector<HTMLButtonElement>('button.session'));

      expect(facts()).toStrictEqual(['Session ID: order-1001', 'Lock Status: Locked']);
      expect(alert('.detail')).toBe('The session is in use by another receiver. Try again in a moment.');
      expect(rows()[0], 'the row says Locked too').toStrictEqual(['order-1001', 'Locked', 'Not read: another receiver holds it']);
      expect(el.querySelector('tr.message-row'), 'no message is shown for a session that was not opened').toBeNull();

      api.get.mockImplementation(() => of(DETAIL));
      click(button('Retry'));
      expect(opens()).toHaveLength(2);
      expect(text(el.querySelector('.state'))).toBe('{"step":3}');
    });

    it('a 404 and a 400 are shown as worded; a 500 says the API did not answer; none of them claims a Lock Status', () => {
      render(SUBSCRIPTION);
      const cases: [number, string, string][] = [
        [404, 'The subscription was not found.', 'The subscription was not found.'],
        [400, 'sessionId must be at most 128 characters.', 'sessionId must be at most 128 characters.'],
        [500, 'An internal error occurred.', 'Could not open the session: the API did not answer.']
      ];
      for (const [status, body, shown] of cases) {
        api.get.mockImplementation(failing(status, body));
        click(el.querySelector<HTMLButtonElement>('button.session'));
        expect(alert('.detail'), `status ${status}`).toBe(shown);
        expect(facts(), `status ${status}`).toStrictEqual(['Session ID: order-1001']);
      }
    });
  });

  describe('the inline state editor', () => {
    function openFirst(entity: SessionEntity = QUEUE, detail: SessionDetail = DETAIL) {
      render(entity, () => of(LIST), (_e, id, count) => of(count === 0 ? { ...DETAIL, sessionId: id, state: 'as seen by the listing', messages: null } : detail));
      click(el.querySelector<HTMLButtonElement>('button.session'));
    }

    it('Edit state opens the New state editor with the state as read, its hint, Cancel and Review change, disabled with the drawn title until the text differs', () => {
      openFirst();
      click(button('Edit state'));

      expect(textarea()!.value).toBe('{"step":3}');
      expect(text(el.querySelector('.editor mat-label'))).toBe('New state');
      expect(text(el.querySelector('.editor mat-hint'))).toBe(HINT);
      expect(button('Cancel')).toBeDefined();
      expect(button('Edit state'), 'Edit state is replaced by the editor').toBeUndefined();
      expect(review().disabled, 'unchanged').toBe(true);
      expect(review().getAttribute('title'), 'the drawn title on an unchanged state').toBe(SAME);

      typeState('{"step":4}');
      expect(review().disabled, 'changed').toBe(false);
      expect(review().getAttribute('title')).toBeNull();

      typeState('{"step":3}');
      expect(review().disabled, 'changed back').toBe(true);
      expect(open, 'nothing opens while the text is unchanged').not.toHaveBeenCalled();
    });

    it('with no state as read an empty text is no change; an empty state stored as text is no change either', () => {
      openFirst(QUEUE, { ...DETAIL, state: null });
      click(button('Edit state'));
      expect(textarea()!.value).toBe('');
      expect(review().disabled).toBe(true);
      TestBed.resetTestingModule();

      openFirst(QUEUE, { ...DETAIL, state: '' });
      click(button('Edit state'));
      expect(review().disabled, 'as read').toBe(true);
      typeState('{"step":1}');
      expect(review().disabled, 'changed').toBe(false);
    });

    it('a state over 262144 bytes as UTF-8 says the limit and cannot be reviewed; exactly 262144 can', () => {
      openFirst(QUEUE, { ...DETAIL, state: null });
      click(button('Edit state'));

      typeState('é'.repeat(131072));
      expect(el.querySelector('.editor mat-error')).toBeNull();
      expect(review().disabled, '262144 bytes').toBe(false);

      typeState('é'.repeat(131072) + 'a');
      expect(text(el.querySelector('.editor mat-error'))).toBe('The state is 262145 bytes as UTF-8; the limit is 262144.');
      expect(review().disabled, '262145 bytes').toBe(true);
    });

    it('Review change opens the confirmation with the state of the detail read as the expected state, never the listing one, and writes nothing itself', () => {
      openFirst(SUBSCRIPTION);
      click(button('Edit state'));
      typeState('{"step":4}');
      click(review());

      expect(open.mock.calls[0][0]).toBe(SessionStateDialogComponent);
      expect(open.mock.calls[0][1].data, 'the state as read on opening is the expected state').toStrictEqual(
        { entity: SUBSCRIPTION, sessionId: 'order-1001', state: '{"step":3}', newState: '{"step":4}' });
    });

    it('an empty text asks the confirmation to clear the state', () => {
      openFirst();
      click(button('Edit state'));
      typeState('');
      click(review());

      expect(open.mock.calls[0][1].data.newState, 'an empty text clears').toBeNull();
    });

    it('Cancel closes the editor and opens nothing', () => {
      openFirst();
      click(button('Edit state'));
      click(button('Cancel'));

      expect(textarea()).toBeNull();
      expect(button('Edit state')).toBeDefined();
      expect(open).not.toHaveBeenCalled();
    });

    it('Back from the confirmation keeps the editor open with the text', () => {
      openFirst();
      click(button('Edit state'));
      typeState('{"step":4}');
      dialogResult = undefined;
      click(review());

      expect(textarea()!.value).toBe('{"step":4}');
      expect(review().disabled).toBe(false);
    });

    it('after a write the detail shows the state the server returned, the editor closes and the row State follows', () => {
      openFirst();
      click(button('Edit state'));
      typeState('');
      dialogResult = { ...DETAIL, state: null, messages: null };
      click(review());

      expect(text(el.querySelector('.state'))).toBe('No state data');
      expect(textarea(), 'the editor closes after the write').toBeNull();
      expect(opens(), 'the stored state comes from the write, not a second read').toHaveLength(1);
      expect(messageRows().map(r => r[1]), 'the write answers no messages; the ones read stay').toStrictEqual(['m-1']);
      expect(rows()[0]).toStrictEqual(['order-1001', 'Unlocked', 'No state']);
    });

    it('a state changed by someone else (Back after the refusal) disables Review change and offers Reload, which reads the session again', () => {
      openFirst();
      click(button('Edit state'));
      typeState('{"step":4}');
      dialogResult = 'stale';
      click(review());

      expect(alert('.editor')).toBe('The state changed since it was read. Reload the session before writing.');
      expect(review().disabled, 'no second write with a stale expected state').toBe(true);
      click(review());
      expect(open).toHaveBeenCalledTimes(1);

      api.get.mockImplementation(() => of({ ...DETAIL, state: '{"step":9}' }));
      click(button('Reload'));
      expect(opens()).toHaveLength(2);
      expect(text(el.querySelector('.state'))).toBe('{"step":9}');
      expect(textarea(), 'the reload closes the editor').toBeNull();
    });

    it('Reload from the confirmation opens the session again and puts the focus on Edit state', async () => {
      openFirst();
      click(button('Edit state'));
      typeState('{"step":4}');
      dialogResult = 'reload';
      click(review());
      await fixture.whenStable();

      expect(opens()).toHaveLength(2);
      expect(document.activeElement).toBe(button('Edit state'));
    });
  });

  describe('switching entity', () => {
    it('resets: the open session goes, the list is read for the new entity, and a late answer for the previous one is ignored', () => {
      const first = new Subject<SessionList>();
      render(QUEUE, () => first);
      api.list.mockImplementation(() => of({ ...LIST, sessions: [{ sessionId: 'invoice-7', messageCount: 2, firstSequenceNumber: 1 }] }));

      fixture.componentRef.setInput('entity', SUBSCRIPTION);
      fixture.detectChanges();
      first.next(LIST);
      fixture.detectChanges();

      expect(api.list.mock.calls).toStrictEqual([[QUEUE], [SUBSCRIPTION]]);
      expect(first.observed, 'the request of the previous entity was cancelled').toBe(false);
      expect(ids()).toStrictEqual(['invoice-7']);
    });

    it('the accepts still in flight for the previous entity are cancelled', () => {
      const pending = new Subject<SessionDetail>();
      render(QUEUE, () => of(LIST), detailOr(() => pending));
      expect(pending.observed).toBe(true);
      api.get.mockImplementation(detailOr(passRead));

      fixture.componentRef.setInput('entity', SUBSCRIPTION);
      fixture.detectChanges();

      expect(accepts().slice(2), 'the new entity is accepted afresh').toStrictEqual(['order-1001', 'order-1002']);
      expect(api.get.mock.calls.slice(2).every(c => c[0] === SUBSCRIPTION)).toBe(true);
      expect(pending.observed, 'no accept of the previous entity is still waited on').toBe(false);
    });

    it('destroying the tab cancels the accepts still in flight and asks for no more', () => {
      const pending = new Subject<SessionDetail>();
      render(QUEUE, () => of(LIST), detailOr(() => pending));
      expect(pending.observed).toBe(true);
      const asked = api.get.mock.calls.length;

      fixture.destroy();

      expect(pending.observed, 'no accept is still waited on once the tab is gone').toBe(false);
      expect(api.get.mock.calls.length, 'no accept is asked after the tab is gone').toBe(asked);
    });

    it('a session opened on the previous entity is not shown on the next one', () => {
      render(QUEUE);
      click(el.querySelector<HTMLButtonElement>('button.session'));
      expect(facts()[0]).toBe('Session ID: order-1001');

      fixture.componentRef.setInput('entity', SUBSCRIPTION);
      fixture.detectChanges();

      expect(el.querySelector('.detail .fact')).toBeNull();
      expect(el.querySelector('.state')).toBeNull();
    });
  });
});
