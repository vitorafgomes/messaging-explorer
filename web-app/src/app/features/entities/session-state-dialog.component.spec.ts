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

describe('SessionStateDialogComponent: confirm a session state write', () => {
  let fixture: ComponentFixture<SessionStateDialogComponent>;
  let el: HTMLElement;
  let ref: { close: ReturnType<typeof vi.fn>; disableClose?: boolean };
  let setState: ReturnType<typeof vi.fn>;

  function open(data: SessionStateDialogData) {
    ref = { close: vi.fn() };
    setState = vi.fn(() => of(STORED));
    TestBed.configureTestingModule({
      imports: [SessionStateDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: ref },
        { provide: SessionService, useValue: { setState } },
        {
          provide: ConnectionService,
          useValue: { currentTarget: 'ns.example.net', currentConnectionId: 'c-1', getConnections: () => of([{ id: 'c-1', name: 'contoso-prod', environmentId: 'g-env' }]) }
        },
        { provide: ConnectionGroupService, useValue: { getGroups: () => of([{ id: 'g-env', name: 'Production', type: 'environment', isProduction: true }]) } }
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
  const facts = () => Array.from(el.querySelectorAll('.fact')).map(f => `${text(f.querySelector('dt'))}: ${text(f.querySelector('dd'))}`);
  const side = (which: 'old' | 'new') => `${text(el.querySelector(`.${which} h3`))}: ${text(el.querySelector(`.${which} pre`))}`;
  const alert = () => text(el.querySelector('[role="alert"] .grow'));
  const fail = (status: number, message?: string, code?: string) => () => throwError(() => new HttpErrorResponse({ status, error: message ? { message, ...(code ? { code } : {}) } : null }));

  describe('confirm before writing', () => {
    it('shows the old state beside the new, the consequence as drawn and where it lands; the PUT is sent only on Write state, with expectedState as read', () => {
      open({ entity: SUBSCRIPTION, sessionId: 'order-1001', state: '{"step":3}', newState: '{"step":4}' });

      expect(text(el.querySelector('h2'))).toBe('warning Write the state of session order-1001?');
      expect(text(el.querySelector('.consequence')), 'the consequence sentence of the artboard').toBe(
        'Writing session state changes what the consuming application reads next for this session. The write locks the session for a moment.');
      expect(text(el.querySelector('.environment-line .where')), 'the line names the subscription and the connection').toBe('billing on contoso-prod (ns.example.net)');
      const chip = el.querySelector('.environment-line .environment-chip') as HTMLElement;
      expect(chip.textContent?.replace('warning', '').trim(), 'the session state confirmation opens with the PRODUCTION chip').toBe('PRODUCTION');
      expect(chip.classList.contains('production'), 'a production environment takes the error container').toBe(true);
      expect(side('old')).toBe('Current state: {"step":3}');
      expect(side('new')).toBe('New state: {"step":4}');
      expect(facts(), 'the facts start with "Session ID" as drawn').toStrictEqual([
        'Session ID: order-1001', 'Subscription: billing', 'Topic: order-events', 'Connection: contoso-prod (ns.example.net)', 'Environment: Production'
      ]);
      expect(setState, 'nothing is written before the confirmation').not.toHaveBeenCalled();

      click('Write state');

      expect(setState.mock.calls, 'the write carries the state as read as expectedState').toStrictEqual(
        [[SUBSCRIPTION, 'order-1001', { state: '{"step":4}', expectedState: '{"step":3}' }]]);
      expect(ref.close.mock.calls).toStrictEqual([[STORED]]);
    });

    it('a clear shows "No state data" as the new state and sends state null', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}', newState: null });

      expect(side('new'), 'a cleared state reads "No state data"').toBe('New state: No state data');
      expect(facts().slice(0, 2)).toStrictEqual(['Session ID: order-1001', 'Queue: orders']);
      click('Write state');
      expect(setState.mock.calls, 'a clear sends state null and the state as read as expectedState').toStrictEqual(
        [[QUEUE, 'order-1001', { state: null, expectedState: '{"step":3}' }]]);
    });

    it('a session that had no state shows "No state data" as current and sends expectedState null, present in the body', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: null, newState: '{"step":1}' });

      expect(side('old'), 'no current state reads "No state data"').toBe('Current state: No state data');
      click('Write state');
      expect(JSON.stringify(setState.mock.calls[0][2]), 'no state as read is sent as expectedState null, present in the body').toBe('{"state":"{\\"step\\":1}","expectedState":null}');
    });

    it('Back closes with nothing, so the inline editor keeps the text, and sends nothing', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}', newState: '{"step":4}' });
      click('Back');

      expect(ref.close.mock.calls).toStrictEqual([[undefined]]);
      expect(setState).not.toHaveBeenCalled();
    });
  });

  describe('a refused write', () => {
    it('409 changed: says so and offers Reload, and never writes again by itself or by a second click', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}', newState: '{"step":4}' });
      setState.mockImplementation(fail(409, CHANGED, 'SessionStateChanged'));
      click('Write state');

      expect(alert()).toBe(CHANGED);
      expect(button('Reload'), 'Reload is offered').toBeDefined();
      expect(button('Write state')!.disabled, 'Write state after a 409 changed').toBe(true);
      expect(ref.disableClose, 'Escape cannot close it into a resend').toBe(true);
      click('Write state');
      expect(setState).toHaveBeenCalledTimes(1);
      expect(ref.close).not.toHaveBeenCalled();

      click('Reload');
      expect(setState).toHaveBeenCalledTimes(1);
      expect(ref.close.mock.calls).toStrictEqual([['reload']]);
    });

    it('after a 409 changed, Back closes with "stale" so the inline editor cannot send it again', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}', newState: '{"step":4}' });
      setState.mockImplementation(fail(409, CHANGED, 'SessionStateChanged'));
      click('Write state');
      click('Back');

      expect(ref.close.mock.calls, 'Back after a changed state tells the editor the state is stale').toStrictEqual([['stale']]);
      expect(setState).toHaveBeenCalledTimes(1);
    });

    it('the code decides, never the text: SessionStateChanged offers Reload whatever its words; SessionInUse with the changed sentence does not', () => {
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}', newState: '{"step":4}' });

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
      open({ entity: QUEUE, sessionId: 'order-1001', state: '{"step":3}', newState: '{"step":4}' });
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
      expect(ref.close).not.toHaveBeenCalled();
    });
  });
});
