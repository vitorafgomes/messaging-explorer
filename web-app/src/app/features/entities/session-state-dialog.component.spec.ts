import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ConnectionGroupService, ConnectionService, SessionService } from '../../core/services';
import { SessionDetail } from '../../core/models';
import { SessionStateDialogComponent, SessionStateDialogData } from './session-state-dialog.component';

const CHANGED = 'The session state changed since it was read. Reload it and try again.';
const IN_USE = 'The session is in use by another receiver. Try again in a moment.';
const STORED: SessionDetail = { sessionId: 'order-1001', state: '{"step":4}', stateIsBinary: false, lockedUntil: '2026-11-12T23:10:00+00:00' };

describe('SessionStateDialogComponent: edit a session state, with a confirmation', () => {
  let fixture: ComponentFixture<SessionStateDialogComponent>;
  let el: HTMLElement;
  let close: ReturnType<typeof vi.fn>;
  let setState: ReturnType<typeof vi.fn>;

  function open(data: SessionStateDialogData) {
    close = vi.fn();
    setState = vi.fn(() => of(STORED));
    TestBed.configureTestingModule({
      imports: [SessionStateDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
        { provide: SessionService, useValue: { setState } },
        {
          provide: ConnectionService,
          useValue: { currentTarget: 'ns.example.net', currentConnectionId: 'c-1', getConnections: () => of([{ id: 'c-1', name: 'contoso-prod', environmentId: 'g-env' }]) }
        },
        { provide: ConnectionGroupService, useValue: { getGroups: () => of([{ id: 'g-env', name: 'Production', type: 'environment' }]) } }
      ]
    });
    fixture = TestBed.createComponent(SessionStateDialogComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const QUEUE = { queueName: 'orders' };
  const SUBSCRIPTION = { topicName: 'order-events', subscriptionName: 'billing' };
  const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const button = (label: string) => Array.from(el.querySelectorAll('button')).find(b => text(b) === label) as HTMLButtonElement | undefined;
  const click = (label: string) => {
    button(label)!.click();
    fixture.detectChanges();
  };
  const textarea = () => el.querySelector('textarea') as HTMLTextAreaElement;
  const type = (value: string) => {
    textarea().value = value;
    textarea().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const facts = () => Array.from(el.querySelectorAll('.fact')).map(f => `${text(f.querySelector('dt'))}: ${text(f.querySelector('dd'))}`);
  const side = (which: 'old' | 'new') => `${text(el.querySelector(`.${which} h3`))}: ${text(el.querySelector(`.${which} pre, .${which} p`))}`;
  const alert = () => text(el.querySelector('[role="alert"] .grow'));
  const fail = (status: number, message?: string, code?: string) => () => throwError(() => new HttpErrorResponse({ status, error: message ? { message, ...(code ? { code } : {}) } : null }));

  describe('edit', () => {
    it('starts from the state as read; Save is disabled until the text differs from it', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}' });

      expect(textarea().value).toBe('{"step":3}');
      expect(textarea().getAttribute('name')).toBe('sessionState');
      expect(text(el.querySelector('mat-label'))).toBe('State');
      expect(button('Save')!.disabled, 'unchanged').toBe(true);

      type('{"step":4}');
      expect(button('Save')!.disabled, 'changed').toBe(false);

      type('{"step":3}');
      expect(button('Save')!.disabled, 'changed back').toBe(true);
    });

    it('Clear empties the text, which clears the state; with no state as read an empty text is no change', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}' });
      click('Clear');
      expect(textarea().value).toBe('');
      expect(button('Save')!.disabled).toBe(false);
      TestBed.resetTestingModule();

      open({ entity: QUEUE, sessionId: 'order-1001', state: null });
      expect(textarea().value).toBe('');
      expect(button('Save')!.disabled).toBe(true);
    });

    it('an empty state stored as text is no change either: Save stays disabled until the text differs', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '' });
      expect(button('Save')!.disabled, 'as read').toBe(true);

      type('{"step":1}');
      expect(button('Save')!.disabled, 'changed').toBe(false);
    });

    it('a state over 262144 bytes as UTF-8 says the limit and cannot be saved; exactly 262144 can', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: null });

      type('é'.repeat(131072));
      expect(el.querySelector('mat-error')).toBeNull();
      expect(button('Save')!.disabled, '262144 bytes').toBe(false);

      type('é'.repeat(131072) + 'a');
      expect(text(el.querySelector('mat-error'))).toBe('The state is 262145 bytes as UTF-8; the limit is 262144.');
      expect(button('Save')!.disabled, '262145 bytes').toBe(true);
    });
  });

  describe('confirm before writing', () => {
    it('shows the old state beside the new, the sentence of the contract and where it lands; the PUT is sent only after confirming, with expectedState as read', () => {
      open({ entity: SUBSCRIPTION, sessionId: 'order-1001', state: '{"step":3}' });
      type('{"step":4}');
      click('Save');

      expect(text(el.querySelector('h2'))).toBe('warning Write the state of session order-1001?');
      expect(text(el.querySelector('.consequence'))).toBe('The application that consumes this session reads this state next.');
      expect(side('old')).toBe('Current state: {"step":3}');
      expect(side('new')).toBe('New state: {"step":4}');
      expect(facts()).toStrictEqual([
        'Session: order-1001', 'Subscription: billing', 'Topic: order-events', 'Connection: contoso-prod (ns.example.net)', 'Environment: Production'
      ]);
      expect(setState, 'nothing is written before the confirmation').not.toHaveBeenCalled();

      click('Write state');

      expect(setState.mock.calls).toStrictEqual([[SUBSCRIPTION, 'order-1001', { state: '{"step":4}', expectedState: '{"step":3}' }]]);
      expect(close.mock.calls).toStrictEqual([[STORED]]);
    });

    it('a clear shows "No state" as the new state and sends state null', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}' });
      click('Clear');
      click('Save');

      expect(side('new')).toBe('New state: No state (cleared)');
      expect(facts().slice(0, 2)).toStrictEqual(['Session: order-1001', 'Queue: orders']);
      click('Write state');
      expect(setState.mock.calls).toStrictEqual([[QUEUE, 'order-1001', { state: null, expectedState: '{"step":3}' }]]);
    });

    it('a session that had no state sends expectedState null, present in the body', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: null });
      type('{"step":1}');
      click('Save');

      expect(side('old')).toBe('Current state: No state');
      click('Write state');
      expect(JSON.stringify(setState.mock.calls[0][2])).toBe('{"state":"{\\"step\\":1}","expectedState":null}');
    });

    it('Back returns to the editor with the text kept and sends nothing', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}' });
      type('{"step":4}');
      click('Save');
      click('Back');

      expect(textarea().value).toBe('{"step":4}');
      expect(setState).not.toHaveBeenCalled();
    });
  });

  describe('a refused write', () => {
    it('409 changed: says so and offers Reload, and never writes again by itself or by a second click', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}' });
      setState.mockImplementation(fail(409, CHANGED, 'SessionStateChanged'));
      type('{"step":4}');
      click('Save');
      click('Write state');

      expect(alert()).toBe(CHANGED);
      expect(button('Reload'), 'Reload is offered').toBeDefined();
      expect(button('Write state')!.disabled, 'Write state after a 409 changed').toBe(true);
      click('Write state');
      expect(setState).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();

      click('Reload');
      expect(setState).toHaveBeenCalledTimes(1);
      expect(close.mock.calls).toStrictEqual([['reload']]);
    });

    it('after a 409 changed, Back and Save again still show the refusal and Reload, and still never write', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}' });
      setState.mockImplementation(fail(409, CHANGED, 'SessionStateChanged'));
      type('{"step":4}');
      click('Save');
      click('Write state');
      click('Back');
      click('Save');

      expect(alert()).toBe(CHANGED);
      expect(button('Reload'), 'Reload is still offered').toBeDefined();
      expect(button('Write state')!.disabled, 'Write state stays disabled').toBe(true);
      click('Write state');
      expect(setState).toHaveBeenCalledTimes(1);
    });

    it('the code decides, never the text: SessionStateChanged offers Reload whatever its words; SessionInUse with the changed sentence does not', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}' });
      type('{"step":4}');
      click('Save');

      setState.mockImplementation(fail(409, CHANGED, 'SessionInUse'));
      click('Write state');
      expect(button('Reload'), 'SessionInUse').toBeUndefined();
      expect(button('Write state')!.disabled, 'SessionInUse').toBe(false);

      setState.mockImplementation(fail(409, 'Reworded by the API.', 'SessionStateChanged'));
      click('Write state');
      expect(alert()).toBe('Reworded by the API.');
      expect(button('Reload'), 'SessionStateChanged').toBeDefined();
      expect(button('Write state')!.disabled, 'SessionStateChanged').toBe(true);
      expect(setState).toHaveBeenCalledTimes(2);
    });

    it('409 in use, 400 and 404 are shown as worded and a 500 generically; the dialog stays open and a write can be tried again by hand', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}' });
      type('{"step":4}');
      click('Save');
      const cases: [number, string, string, string?][] = [
        [409, IN_USE, IN_USE, 'SessionInUse'],
        [400, 'This session holds a binary state and cannot be edited here.', 'This session holds a binary state and cannot be edited here.'],
        [404, 'The queue was not found.', 'The queue was not found.'],
        [500, 'An internal error occurred.', 'Could not write the state: the API did not confirm it. Try again.']
      ];
      for (const [status, body, shown, code] of cases) {
        setState.mockImplementation(fail(status, body, code));
        click('Write state');
        expect(alert(), `status ${status}`).toBe(shown);
        expect(button('Reload'), `status ${status}`).toBeUndefined();
        expect(button('Write state')!.disabled, `status ${status}`).toBe(false);
      }
      expect(setState).toHaveBeenCalledTimes(4);
      expect(close).not.toHaveBeenCalled();
    });
  });
});
