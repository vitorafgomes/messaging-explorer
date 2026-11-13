import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { SessionService } from '../../core/services';
import { MessageInfo, SessionDetail, SessionEntity, SessionList } from '../../core/models';
import { EntitySessionsComponent } from './entity-sessions.component';
import { SessionStateDialogComponent } from './session-state-dialog.component';

const LOCK_NOTICE = 'Opening a session locks it for a moment. A consumer of this session waits until it is released.';
const STATE_ONLY_TRUNCATED = 'Sessions further back, or holding only a state, are not shown; open one by its id.';
const STATE_ONLY = 'Sessions holding only a state are not shown; open one by its id.';

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
  enqueuedTime: '2026-11-12T22:00:00Z' as never, timeToLive: '14.00:00:00', applicationProperties: {}, state: 'Active'
};
const DETAIL: SessionDetail = { sessionId: 'order-1001', state: '{"step":3}', stateIsBinary: false, lockedUntil: '2026-11-12T23:10:00+00:00', messages: [MESSAGE] };

describe('EntitySessionsComponent: the sessions of a queue or a subscription', () => {
  let fixture: ComponentFixture<EntitySessionsComponent>;
  let el: HTMLElement;
  let api: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  let open: ReturnType<typeof vi.fn>;
  let dialogResult: unknown;

  function render(entity: SessionEntity, list: () => Observable<SessionList> = () => of(LIST)) {
    dialogResult = undefined;
    open = vi.fn(() => ({ afterClosed: () => of(dialogResult) }));
    api = { list: vi.fn(list), get: vi.fn(() => of(DETAIL)) };
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
  const rows = () => Array.from(el.querySelectorAll('.session')).map(r => `${text(r.querySelector('[matListItemTitle]'))} ${text(r.querySelector('[matListItemLine]'))}`);
  const button = (label: string) => Array.from(el.querySelectorAll('button')).find(b => text(b).endsWith(label)) as HTMLButtonElement | undefined;
  const click = (b: HTMLButtonElement | null | undefined) => {
    b!.click();
    fixture.detectChanges();
  };
  const alert = (scope: string) => text(el.querySelector(`${scope} [role="alert"] .grow`));
  const fail = (status: number, message?: string, code?: string) => () => throwError(() => new HttpErrorResponse({ status, error: message ? { message, ...(code ? { code } : {}) } : null }));
  const typeId = (value: string) => {
    const input = el.querySelector('input[name="sessionId"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  };
  const messageRows = () => Array.from(el.querySelectorAll('tr.message-row')).map(r => Array.from(r.querySelectorAll('td')).map(text));

  describe('the list: passive, read when the tab opens', () => {
    it('reads the list once on open and shows each session id with its message count', () => {
      render(QUEUE);

      expect(api.list.mock.calls).toStrictEqual([[QUEUE]]);
      expect(rows()).toStrictEqual(['order-1001 12 messages', 'order-1002 1 message']);
    });

    it('says that listing and opening lock, in the words of the contract, before any session is opened', () => {
      render(QUEUE);

      expect(text(el.querySelector('.lock-notice > span'))).toBe(LOCK_NOTICE);
      expect(text(el.querySelector('.scan-notice'))).toBe(`Listed from the first 1000 messages. ${STATE_ONLY_TRUNCATED}`);
      expect(api.get, 'no session is accepted to show the list').not.toHaveBeenCalled();
    });

    it('a scan that reached the end of the entity shows only the sentence on sessions holding only a state', () => {
      render(SUBSCRIPTION, () => of({ ...LIST, scannedMessages: 37, truncated: false }));

      expect(text(el.querySelector('.scan-notice'))).toBe(STATE_ONLY);
    });

    it('loading, empty and failed are three different states', () => {
      const pending = new Subject<SessionList>();
      render(QUEUE, () => pending);
      expect(el.querySelector('mat-progress-bar[aria-label="Reading the sessions"]'), 'loading').not.toBeNull();
      expect(el.querySelector('.session')).toBeNull();
      expect(el.querySelector('.list [role="alert"]')).toBeNull();

      pending.next({ sessions: [], scannedMessages: 0, truncated: false });
      fixture.detectChanges();
      expect(text(el.querySelector('.list .empty'))).toBe('No session holds a message in this queue.');
      expect(el.querySelector('mat-progress-bar')).toBeNull();
      expect(el.querySelector('.list [role="alert"]')).toBeNull();
    });

    it('a list that fails with a 500 or no answer shows an error with Retry, never the empty state; Retry reads the list again', () => {
      for (const status of [500, 0]) {
        render(QUEUE, fail(status, 'An internal error occurred.'));

        expect(alert('.list'), `status ${status}`).toBe('Could not read the sessions: the API did not answer.');
        expect(el.querySelector('.list .empty')).toBeNull();

        api.list.mockImplementation(() => of(LIST));
        click(button('Retry'));
        expect(api.list).toHaveBeenCalledTimes(2);
        expect(rows().length).toBe(2);
        TestBed.resetTestingModule();
      }
    });

    it('a 404 and a 400 on the list are shown as the API worded them', () => {
      render(QUEUE, fail(404, 'The queue was not found.'));
      expect(alert('.list')).toBe('The queue was not found.');
      TestBed.resetTestingModule();

      render(QUEUE, fail(400, 'This entity does not use sessions.'));
      expect(alert('.list')).toBe('This entity does not use sessions.');
      click(button('Retry'));
      expect(api.list.mock.calls, 'Retry asks again').toStrictEqual([[QUEUE], [QUEUE]]);
      expect(alert('.list'), 'a refusal stays shown as worded').toBe('This entity does not use sessions.');
    });

    it('Refresh, named for screen readers, reads the list again once and shows the new answer', () => {
      render(QUEUE);
      const refresh = el.querySelector<HTMLButtonElement>('button[aria-label="Refresh the sessions"]');
      expect(refresh, 'a Refresh button named "Refresh the sessions"').not.toBeNull();
      api.list.mockImplementation(() => of({ ...LIST, sessions: [{ sessionId: 'order-1003', messageCount: 4, firstSequenceNumber: 4420 }] }));

      click(refresh);

      expect(api.list.mock.calls).toStrictEqual([[QUEUE], [QUEUE]]);
      expect(rows()).toStrictEqual(['order-1003 4 messages']);
    });

    it('session ids are shown as text: markup is not interpreted', () => {
      render(QUEUE, () => of({ ...LIST, sessions: [{ sessionId: '<img src=x>', messageCount: 1, firstSequenceNumber: 1 }] }));

      expect(rows()).toStrictEqual(['<img src=x> 1 message']);
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
      expect(api.get, 'an id of only spaces is never sent').not.toHaveBeenCalled();

      typeId('x'.repeat(128));
      expect(openButton().disabled, '128 characters').toBe(false);
      expect(el.querySelector('mat-error')).toBeNull();

      typeId('order 1003/a');
      click(openButton());
      expect(api.get.mock.calls).toStrictEqual([[QUEUE, 'order 1003/a', 100]]);
    });

    it('an empty id after typing says the rule too and sends nothing', () => {
      render(QUEUE);
      typeId('a');
      typeId('');

      expect(text(el.querySelector('mat-error'))).toBe('A session id is 1 to 128 characters, not only spaces.');
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      expect(api.get).not.toHaveBeenCalled();
    });
  });

  describe('opening a session: its state, its lock and its messages', () => {
    it('opening a session is one request for its state and its messages, and lists the messages that request returned', () => {
      render(QUEUE);
      const detail = new Subject<SessionDetail>();
      api.get.mockImplementation(() => detail);

      click(el.querySelector<HTMLButtonElement>('.session'));
      expect(api.get.mock.calls, 'one request, asking for 100 messages').toStrictEqual([[QUEUE, 'order-1001', 100]]);
      expect(el.querySelector('mat-progress-bar[aria-label="Opening session order-1001"]')).not.toBeNull();

      detail.next({ ...DETAIL, messages: [MESSAGE, { ...MESSAGE, messageId: 'm-2', sequenceNumber: 4413, body: 'second', state: 'Deferred' }] });
      detail.complete();
      fixture.detectChanges();

      expect(api.get, 'nothing else is requested to show the messages').toHaveBeenCalledTimes(1);
      expect(text(el.querySelector('.detail h3'))).toBe('Session order-1001');
      expect(text(el.querySelector('.state'))).toBe('{"step":3}');
      expect(text(el.querySelector('.locked-until'))).toBe('Nov 12, 2026, 11:10:00 PM UTC');
      expect(messageRows()).toStrictEqual([
        ['4411', 'm-1', 'Nov 12, 2026, 10:00:00 PM', 'Active', '{"total":42}'],
        ['4413', 'm-2', 'Nov 12, 2026, 10:00:00 PM', 'Deferred', 'second']
      ]);
    });

    it('a session with no state says so; a session with no message, empty or null, says so', () => {
      for (const messages of [[], null]) {
        render(QUEUE);
        api.get.mockImplementation(() => of({ ...DETAIL, state: null, messages }));
        click(el.querySelector<HTMLButtonElement>('.session'));

        expect(text(el.querySelector('.state'))).toBe('No state');
        expect(text(el.querySelector('.detail .empty')), JSON.stringify(messages)).toBe('No message in this session.');
        expect(button('Edit state'), 'a missing state can be written').toBeDefined();
        TestBed.resetTestingModule();
      }
    });

    it('a binary state is shown as its byte count and base64 and offers no editor', () => {
      render(QUEUE);
      api.get.mockImplementation(() => of({ ...DETAIL, state: 'AAEC/w==', stateIsBinary: true }));
      click(el.querySelector<HTMLButtonElement>('.session'));

      expect(text(el.querySelector('.binary'))).toBe('binary state, 4 bytes as base64, cannot be edited here');
      expect(text(el.querySelector('.state'))).toBe('AAEC/w==');
      expect(button('Edit state')).toBeUndefined();
    });

    it('a long body is cut to a preview of 100 characters, and markup in a body is shown as text', () => {
      render(QUEUE);
      api.get.mockImplementation(() => of({ ...DETAIL, messages: [{ ...MESSAGE, body: '<b>' + 'x'.repeat(200) }] }));
      click(el.querySelector<HTMLButtonElement>('.session'));

      expect(messageRows()[0][4]).toBe('<b>' + 'x'.repeat(94) + '...');
      expect(el.querySelector('tr.message-row b')).toBeNull();
    });

    it('a 409 "in use" is shown as the server worded it, with Retry, which opens the session again', () => {
      render(QUEUE);
      api.get.mockImplementation(fail(409, 'The session is in use by another receiver. Try again in a moment.', 'SessionInUse'));
      click(el.querySelector<HTMLButtonElement>('.session'));

      expect(alert('.detail')).toBe('The session is in use by another receiver. Try again in a moment.');
      expect(el.querySelector('tr.message-row'), 'no message is shown for a session that was not opened').toBeNull();

      api.get.mockImplementation(() => of(DETAIL));
      click(button('Retry'));
      expect(api.get).toHaveBeenCalledTimes(2);
      expect(text(el.querySelector('.state'))).toBe('{"step":3}');
    });

    it('a 404 and a 400 are shown as worded; a 500 says the API did not answer', () => {
      render(SUBSCRIPTION);
      const cases: [number, string, string][] = [
        [404, 'The subscription was not found.', 'The subscription was not found.'],
        [400, 'sessionId must be at most 128 characters.', 'sessionId must be at most 128 characters.'],
        [500, 'An internal error occurred.', 'Could not open the session: the API did not answer.']
      ];
      for (const [status, body, shown] of cases) {
        api.get.mockImplementation(fail(status, body));
        click(el.querySelector<HTMLButtonElement>('.session'));
        expect(alert('.detail'), `status ${status}`).toBe(shown);
      }
    });
  });

  describe('the state editor', () => {
    it('Edit state opens the editor with the entity, the session and the state exactly as read', () => {
      render(SUBSCRIPTION);
      click(el.querySelector<HTMLButtonElement>('.session'));
      click(button('Edit state'));

      expect(open.mock.calls[0][0]).toBe(SessionStateDialogComponent);
      expect(open.mock.calls[0][1].data).toStrictEqual({ entity: SUBSCRIPTION, sessionId: 'order-1001', state: '{"step":3}' });
    });

    it('after a write the detail shows the state the server returned', () => {
      render(QUEUE);
      click(el.querySelector<HTMLButtonElement>('.session'));
      dialogResult = { ...DETAIL, state: '{"step":4}', messages: null };
      click(button('Edit state'));

      expect(text(el.querySelector('.state'))).toBe('{"step":4}');
      expect(api.get, 'the stored state comes from the write, not a second read').toHaveBeenCalledTimes(1);
      expect(messageRows().map(r => r[1]), 'the write answers no messages; the ones read stay').toStrictEqual(['m-1']);
    });

    it('Reload from the editor opens the session again; a cancelled editor reads nothing', () => {
      render(QUEUE);
      click(el.querySelector<HTMLButtonElement>('.session'));
      dialogResult = undefined;
      click(button('Edit state'));
      expect(api.get).toHaveBeenCalledTimes(1);

      api.get.mockImplementation(() => of({ ...DETAIL, state: '{"step":9}' }));
      dialogResult = 'reload';
      click(button('Edit state'));
      expect(api.get).toHaveBeenCalledTimes(2);
      expect(text(el.querySelector('.state'))).toBe('{"step":9}');
    });

    it('after Reload the focus is back on Edit state, the control that opened the editor', async () => {
      render(QUEUE);
      click(el.querySelector<HTMLButtonElement>('.session'));
      dialogResult = 'reload';
      click(button('Edit state'));
      await fixture.whenStable();

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
      expect(rows()).toStrictEqual(['invoice-7 2 messages']);
    });

    it('a session opened on the previous entity is not shown on the next one', () => {
      render(QUEUE);
      click(el.querySelector<HTMLButtonElement>('.session'));
      expect(text(el.querySelector('.detail h3'))).toBe('Session order-1001');

      fixture.componentRef.setInput('entity', SUBSCRIPTION);
      fixture.detectChanges();

      expect(el.querySelector('.detail h3')).toBeNull();
      expect(el.querySelector('.state')).toBeNull();
    });
  });
});
