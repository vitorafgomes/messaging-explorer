import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { Observable, of, throwError } from 'rxjs';
import { McpRequestDialogComponent, McpRequestOutcome } from './mcp-request-dialog.component';
import { McpRequest, McpSettingsService } from './mcp-settings.service';

/** The text of an element as a reader hears it: every text node outside aria-hidden, separated by one space. */
function words(node: Element | null | undefined): string {
  if (!node) return '';
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement?.closest('[aria-hidden="true"]')) parts.push(walker.currentNode.textContent ?? '');
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** The request the artboard draws in its state askedToSend. */
const SEND: McpRequest = {
  id: 'r-send',
  time: '2026-11-20T10:43:02Z',
  assistant: 'Claude Code',
  kind: 'send',
  title: 'Claude Code asks to send 3 messages',
  facts: [
    { label: 'To', value: 'orders, a queue' },
    { label: 'On', value: 'contoso-dev (Contoso, Development)' },
    { label: 'Messages', value: '3, application/json, 412 bytes in all' },
    { label: 'It said why', value: 'To reproduce the failure of order 1042' },
  ],
  note: 'Every consumer of this queue receives these messages. A message sent cannot be taken back.',
  allowLabel: 'Send 3 messages',
  expiresAt: '2026-11-20T10:45:02Z',
};

/** The request the artboard draws in its state askedToRead. */
const READ: McpRequest = {
  ...SEND,
  id: 'r-read',
  kind: 'read',
  title: 'Claude Code asks to read 20 messages',
  facts: [
    { label: 'From', value: 'orders, dead-letter queue' },
    { label: 'On', value: 'contoso-prod (Contoso, Production)' },
    { label: 'Messages', value: 'Up to 20, read without removing them' },
    { label: 'It said why', value: 'To see why orders are failing' },
  ],
  note: 'This is a production connection. The bodies of the messages read are sent to the assistant and to the company that runs it.',
  allowLabel: 'Allow this read',
};

/** A request to make an offered connection the active one, as the API writes it. */
const CONNECT: McpRequest = {
  ...SEND,
  id: 'r-connect',
  kind: 'connect',
  title: 'Claude Code asks to connect to contoso-prod',
  facts: [
    { label: 'From', value: 'contoso-dev (Contoso, Development)' },
    { label: 'To', value: 'contoso-prod (Contoso, Production)' },
    { label: 'It said why', value: 'To compare the queues of both' },
  ],
  note: 'This is a production connection. The app disconnects from contoso-dev. Every screen then shows contoso-prod, and anything running on contoso-dev is interrupted.',
  allowLabel: 'Connect to contoso-prod',
};

const FOOTER ='The assistant waits for your answer. With no answer in 2 minutes it is told the request was denied.';

describe('McpRequestDialogComponent: the window that asks the user, as Settings.dc.html draws mcp.ask', () => {
  let answer: ReturnType<typeof vi.fn>;
  let ref: MatDialogRef<McpRequestDialogComponent, McpRequestOutcome>;
  let closed: (McpRequestOutcome | undefined)[];

  const settle = async () => {
    TestBed.inject(ApplicationRef).tick();
    await new Promise(r => setTimeout(r));
    TestBed.inject(ApplicationRef).tick();
  };
  const dialog = () => document.querySelector('mat-dialog-container');
  const button = (label: string) => Array.from(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(b => words(b) === label);

  async function open(request: McpRequest) {
    ref = TestBed.inject(MatDialog).open(McpRequestDialogComponent, { ...McpRequestDialogComponent.config, data: request });
    closed = [];
    ref.afterClosed().subscribe(outcome => closed.push(outcome));
    await settle();
  }

  beforeEach(() => {
    answer = vi.fn((): Observable<void> => of(undefined));
    TestBed.configureTestingModule({
      providers: [provideNoopAnimations(), { provide: McpSettingsService, useValue: { answer } }],
    });
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  for (const [state, request] of [['askedToSend', SEND], ['askedToRead', READ], ['askedToConnect', CONNECT]] as const) {
    it(`${state}: the title with the MCP mark, the facts as a description list, the note in the warning container, Deny, the allow button with the API's label, and the footer`, async () => {
      await open(request);
      const title = dialog()?.querySelector('h2');

      expect(words(title), 'the title the API wrote').toBe(request.title);
      expect(title?.querySelectorAll('svg.mcp-mark[aria-hidden="true"] path').length, 'the three strokes of the MCP mark, hidden from a reader').toBe(3);
      expect(dialog()?.getAttribute('aria-labelledby'), 'the dialog is named by its title').toBe(title?.id);
      expect(Array.from(dialog()?.querySelectorAll('dl.facts > dt') ?? []).map(words), 'each fact label is a dt').toStrictEqual(request.facts.map(f => f.label));
      expect(Array.from(dialog()?.querySelectorAll('dl.facts > dd') ?? []).map(words), 'each fact value is a dd').toStrictEqual(request.facts.map(f => f.value));
      expect(words(dialog()?.querySelector('.note')), 'the note the API wrote').toBe(request.note);
      expect(dialog()?.querySelector('.note mat-icon')?.textContent?.trim(), 'the note carries the warning icon').toBe('warning');
      expect(Array.from(dialog()?.querySelectorAll('mat-dialog-actions button') ?? []).map(words), `the kind ${request.kind} can be allowed: Deny, then the allow button`).toStrictEqual(['Deny', request.allowLabel]);
      expect(words(dialog()?.querySelector('.footer')), 'the footer says what happens with no answer').toBe(FOOTER);
      expect(answer, 'opening the dialog answers nothing').not.toHaveBeenCalled();
    });
  }

  it('Deny answers allow false, once, and closes the dialog as denied', async () => {
    await open(SEND);
    button('Deny')!.click();
    await settle();

    expect(answer.mock.calls, 'Deny is POST answer with allow false').toStrictEqual([['r-send', false]]);
    expect(closed, 'the dialog closes once the API took the answer').toStrictEqual(['denied']);
  });

  it('the allow button answers allow true, once, and closes the dialog as allowed', async () => {
    await open(SEND);
    button('Send 3 messages')!.click();
    await settle();

    expect(answer.mock.calls, 'only a click on the allow button answers allow true').toStrictEqual([['r-send', true]]);
    expect(closed).toStrictEqual(['allowed']);
  });

  it('focus starts on Deny; Escape, Enter on the focused Deny and a click on the backdrop never answer allow and never close the dialog', async () => {
    await open(SEND);
    expect(document.activeElement, 'the focus starts on Deny, not on the allow button').toBe(button('Deny'));

    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    (document.querySelector('.cdk-overlay-backdrop') as HTMLElement | null)?.click();
    await settle();

    expect(answer.mock.calls.filter(call => call[1] === true), 'nothing but a click on the allow button answers allow').toStrictEqual([]);
    expect(dialog(), 'the dialog stays until the user answers or the request goes away').not.toBeNull();
    expect(closed, 'Escape and the backdrop do not close it').toStrictEqual([]);
  });

  it('a double click on the allow button sends one answer: a request is answered once', async () => {
    answer.mockImplementation(() => new Observable<void>());
    await open(SEND);
    const allow = button('Send 3 messages')!;
    allow.click();
    allow.click();
    button('Deny')!.click();
    await settle();

    expect(answer.mock.calls, 'one answer, whatever was clicked after it').toStrictEqual([['r-send', true]]);
  });

  it('text from the API is shown as text: markup in the title, a fact or the note is never rendered', async () => {
    const markup = '<img src=x onerror="window.__mcpInjected=1">';
    await open({ ...SEND, title: `Asks ${markup}`, facts: [{ label: `Label ${markup}`, value: `Value ${markup}` }], note: `Note ${markup}`, allowLabel: `Allow ${markup}` });

    expect(dialog()?.querySelector('img'), 'no element is made from the API text').toBeNull();
    expect(words(dialog()?.querySelector('h2')), 'the title shows the markup literally').toBe(`Asks ${markup}`);
    expect(words(dialog()?.querySelector('dl.facts > dt')), 'a fact label shows the markup literally').toBe(`Label ${markup}`);
    expect(words(dialog()?.querySelector('dl.facts > dd')), 'a fact value shows the markup literally').toBe(`Value ${markup}`);
    expect(words(dialog()?.querySelector('.note')), 'the note shows the markup literally').toBe(`Note ${markup}`);
    expect(words(dialog()?.querySelector('button.allow')), 'the allow label shows the markup literally').toBe(`Allow ${markup}`);
    expect((window as unknown as { __mcpInjected?: number }).__mcpInjected, 'no script ran').toBeUndefined();
  });

  it('a failed answer shows an inline error and keeps the dialog open, with both buttons usable again', async () => {
    answer.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'The answer could not be recorded.' } })));
    await open(SEND);
    button('Send 3 messages')!.click();
    await settle();

    expect(words(dialog()?.querySelector('[role="alert"]')), 'the failure is said in the dialog').toBe('Your answer was not sent: The answer could not be recorded.');
    expect(closed, 'the dialog stays open').toStrictEqual([]);
    expect([button('Deny')!.disabled, button('Send 3 messages')!.disabled], 'the user can answer again').toStrictEqual([false, false]);

    button('Deny')!.click();
    await settle();
    expect(answer.mock.calls).toStrictEqual([['r-send', true], ['r-send', false]]);
    expect(closed).toStrictEqual(['denied']);
  });

  it('a 404 on answering closes the dialog as no longer waiting', async () => {
    answer.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    await open(SEND);
    button('Deny')!.click();
    await settle();

    expect(closed, 'the request is no longer waiting').toStrictEqual(['gone']);
    expect(dialog()?.querySelector('[role="alert"]') ?? null, 'a request gone is not an error').toBeNull();
  });

  it('a kind this version does not know shows only Deny and says it cannot allow it', async () => {
    await open({ ...SEND, kind: 'createQueue', allowLabel: 'Create the queue', typed: { label: 'Type the queue name to allow it', word: 'orders' } });

    expect(Array.from(dialog()?.querySelectorAll('mat-dialog-actions button') ?? []).map(words), 'an unknown kind can only be denied').toStrictEqual(['Deny']);
    expect(words(dialog()?.querySelector('.unknown'))).toBe('This version of the app cannot allow this kind of request.');
    expect(dialog()?.querySelector('input') ?? null, 'no typed field for a kind that cannot be allowed').toBeNull();
  });

  describe('phase three: requests that move or remove messages', () => {
    /** The request the artboard draws in its state askedToDelete. */
    const DELETE: McpRequest = {
      ...SEND,
      id: 'r-delete',
      kind: 'delete',
      title: 'Claude Code asks to delete 12 messages',
      facts: [
        { label: 'From', value: 'orders, dead-letter queue' },
        { label: 'On', value: 'contoso-dev (Contoso, Development)' },
        { label: 'Messages', value: '12, sequence numbers 4401 to 4412' },
        { label: 'It said why', value: 'They are copies of orders already processed' },
      ],
      note: 'A deleted message cannot be brought back. The 12 messages are the ones the assistant named by their sequence numbers; nothing else in the queue is touched.',
      allowLabel: 'Delete 12 messages',
      danger: true,
      typed: { label: 'Type the queue name to allow it', word: 'orders' },
    };
    const field = () => dialog()?.querySelector<HTMLInputElement>('input') ?? null;
    const allow = () => button('Delete 12 messages')!;
    async function type(value: string) {
      field()!.value = value;
      field()!.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
    }
    const enter = (target: Element) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));

    for (const kind of ['deadLetter', 'resubmit', 'move', 'delete', 'purge', 'cancelScheduled']) {
      it(`the kind ${kind} can be allowed: Deny, then the allow button with the API's label`, async () => {
        await open({ ...SEND, kind, allowLabel: `Allow the ${kind}` });

        expect(Array.from(dialog()?.querySelectorAll('mat-dialog-actions button') ?? []).map(words), `the kind ${kind} is one this version allows`).toStrictEqual(['Deny', `Allow the ${kind}`]);
        expect(dialog()?.querySelector('.unknown') ?? null, 'no sentence saying it cannot be allowed').toBeNull();
      });
    }

    for (const kind of ['createEntity', 'updateEntity', 'deleteEntity']) {
      it(`phase 3b: the entity kind ${kind} can be allowed: Deny, then the allow button with the API's label`, async () => {
        await open({ ...SEND, kind, allowLabel: `Allow the ${kind}` });

        expect(Array.from(dialog()?.querySelectorAll('mat-dialog-actions button') ?? []).map(words), `an assistant can be allowed to ${kind}: the kind is one this version allows`).toStrictEqual(['Deny', `Allow the ${kind}`]);
        expect(dialog()?.querySelector('.unknown') ?? null, `no sentence saying ${kind} cannot be allowed`).toBeNull();
      });
    }

    it('phase 3b: a deleteEntity request with danger and a typed word keeps the allow button disabled until the name is typed exactly', async () => {
      await open({ ...DELETE, id: 'r-entity', kind: 'deleteEntity', title: 'Claude Code asks to delete the queue orders', allowLabel: 'Delete the queue', typed: { label: 'Type the queue name to allow it', word: 'orders' } });

      expect(words(dialog()?.querySelector('mat-form-field mat-label')), 'the label the API wrote').toBe('Type the queue name to allow it');
      expect(button('Delete the queue')!.disabled, 'a delete of an entity asks for the name typed before it can be allowed').toBe(true);
      await type('orders');
      expect(button('Delete the queue')!.disabled, 'the name typed exactly enables the allow button').toBe(false);
    });

    it('askedToDelete: the typed field with the API\'s label, empty, and the allow button disabled and aria-disabled until the word is typed exactly', async () => {
      await open(DELETE);

      expect(words(dialog()?.querySelector('mat-form-field mat-label')), 'the label the API wrote').toBe('Type the queue name to allow it');
      expect(field()?.value, 'the field starts empty, never filled for the user').toBe('');
      expect(field()?.getAttribute('autocomplete'), 'no autofill').toBe('off');
      expect([allow().disabled, allow().getAttribute('aria-disabled')], 'the allow button cannot be used before the word is typed').toStrictEqual([true, 'true']);

      for (const wrong of ['Orders', 'ORDERS', ' orders', 'orders ', 'order']) {
        await type(wrong);
        expect([allow().disabled, allow().getAttribute('aria-disabled')], `"${wrong}" is not the word typed exactly: case counts and no space is trimmed`).toStrictEqual([true, 'true']);
      }

      await type('orders');
      expect([allow().disabled, allow().getAttribute('aria-disabled')], 'the word typed exactly enables the allow button').toStrictEqual([false, 'false']);
    });

    it('focus starts on Deny; a click on the disabled allow button, Enter in the field, Enter on Deny, Escape and the backdrop never answer allow', async () => {
      await open(DELETE);
      expect(document.activeElement, 'the focus starts on Deny, not on the field or the allow button').toBe(button('Deny'));

      await type('order');
      allow().click();
      enter(allow());
      field()!.focus();
      enter(field()!);
      enter(button('Deny')!);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      (document.querySelector('.cdk-overlay-backdrop') as HTMLElement | null)?.click();
      await type('orders');
      enter(field()!);
      await settle();

      expect(answer.mock.calls, 'no path but a click on the enabled allow button answers: nothing was answered here').toStrictEqual([]);
      expect(closed, 'the dialog stays open').toStrictEqual([]);
    });

    it('the word typed exactly, then a click on the allow button, answers allow true with the typed value, once', async () => {
      answer.mockImplementation(() => new Observable<void>());
      await open(DELETE);
      await type('orders');
      allow().click();
      allow().click();
      button('Deny')!.click();
      await settle();

      expect(answer.mock.calls, 'POST answer with allow true and the word as typed, once: a request is answered once').toStrictEqual([['r-delete', true, 'orders']]);
    });

    it('pasting the word works like typing it', async () => {
      await open(DELETE);
      field()!.dispatchEvent(new Event('paste', { bubbles: true }));
      await type('orders');
      allow().click();
      await settle();

      expect(answer.mock.calls, 'a pasted word is sent like a typed one').toStrictEqual([['r-delete', true, 'orders']]);
      expect(closed).toStrictEqual(['allowed']);
    });

    it('Deny answers allow false without the typed value, whatever the field holds', async () => {
      await open(DELETE);
      await type('orders');
      button('Deny')!.click();
      await settle();

      expect(answer.mock.calls, 'a deny is POST answer with allow false alone').toStrictEqual([['r-delete', false]]);
      expect(closed).toStrictEqual(['denied']);
    });

    it('a wrong word answered 400 shows the API\'s message inline and keeps the dialog open, with the field as it is', async () => {
      answer.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'Type the name exactly as shown to allow this.' } })));
      await open(DELETE);
      await type('orders');
      allow().click();
      await settle();

      expect(words(dialog()?.querySelector('[role="alert"]')), 'the API\'s message, in the dialog').toBe('Type the name exactly as shown to allow this.');
      expect(closed, 'the dialog stays open').toStrictEqual([]);
      expect(field()?.value, 'the field keeps what the user typed').toBe('orders');
      expect([button('Deny')!.disabled, allow().disabled], 'the user can answer again').toStrictEqual([false, false]);
    });

    it('danger draws the note in the error container and the allow button in the error colour', async () => {
      await open(DELETE);

      expect(dialog()?.querySelector('.note')?.classList.contains('danger'), 'the note of a destructive request is drawn as an error').toBe(true);
      expect(allow().classList.contains('danger'), 'the allow button of a destructive request is drawn in the error colour').toBe(true);
      expect(words(dialog()?.querySelector('h2')), 'askedToDelete: the title the API wrote').toBe(DELETE.title);
      expect(Array.from(dialog()?.querySelectorAll('dl.facts > dt') ?? []).map(words), 'each fact label is a dt').toStrictEqual(DELETE.facts.map(f => f.label));
      expect(Array.from(dialog()?.querySelectorAll('dl.facts > dd') ?? []).map(words), 'each fact value is a dd').toStrictEqual(DELETE.facts.map(f => f.value));
      expect(words(dialog()?.querySelector('.note')), 'the note the API wrote').toBe(DELETE.note);
      expect(dialog()?.querySelector('.note mat-icon')?.textContent?.trim(), 'the note keeps the warning icon').toBe('warning');
      expect(Array.from(dialog()?.querySelectorAll('mat-dialog-actions button') ?? []).map(words), 'Deny, then the allow button with the API\'s label').toStrictEqual(['Deny', 'Delete 12 messages']);
      expect(words(dialog()?.querySelector('.footer')), 'the footer says what happens with no answer').toBe(FOOTER);
    });

    it('without danger the note and the allow button are drawn as before', async () => {
      await open({ ...DELETE, danger: false });

      expect(dialog()?.querySelector('.note')?.classList.contains('danger'), 'a request without danger keeps the warning container').toBe(false);
      expect(allow().classList.contains('danger'), 'and the allow button its usual colour').toBe(false);
    });

    it('an older API without danger and typed: no field, the allow button enabled, the warning note, and allow answered with no typed value', async () => {
      const { danger: _danger, typed: _typed, ...older } = DELETE;
      await open(older);

      expect(dialog()?.querySelector('input') ?? null, 'no typed field').toBeNull();
      expect(dialog()?.querySelector('.note')?.classList.contains('danger'), 'the note in the warning container').toBe(false);
      expect(allow().disabled, 'the allow button is enabled').toBe(false);
      allow().click();
      await settle();
      expect(answer.mock.calls, 'POST answer with allow true alone').toStrictEqual([['r-delete', true]]);
    });

    it('typed set to null behaves like no typed word', async () => {
      await open({ ...DELETE, typed: null });

      expect(dialog()?.querySelector('input') ?? null, 'no typed field').toBeNull();
      expect(allow().disabled, 'the allow button is enabled').toBe(false);
    });

    it('the typed label and word from the API are text: markup is never rendered, and the word is shown nowhere in the dialog', async () => {
      const word = '<b id="bait">orders-dlq</b>';
      await open({ ...DELETE, typed: { label: 'Type <i id="label-markup">the name</i>', word } });

      expect(dialog()?.querySelector('#label-markup') ?? null, 'no element made from the label').toBeNull();
      expect(words(dialog()?.querySelector('mat-form-field mat-label')), 'the label shows the markup literally').toBe('Type <i id="label-markup">the name</i>');
      expect(dialog()?.querySelector('#bait') ?? null, 'no element made from the word').toBeNull();
      expect(dialog()?.textContent ?? '', 'the word is not shown as text to copy').not.toContain('orders-dlq');
      expect(field()?.value, 'the field is not filled with it').toBe('');
      expect(field()?.getAttribute('placeholder') ?? '', 'nor offered as a placeholder').toBe('');

      await type(word);
      allow().click();
      await settle();
      expect(answer.mock.calls, 'the word with markup, typed exactly, is sent as typed').toStrictEqual([['r-delete', true, word]]);
    });
  });
});
