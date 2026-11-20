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

const FOOTER = 'The assistant waits for your answer. With no answer in 2 minutes it is told the request was denied.';

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

  for (const [state, request] of [['askedToSend', SEND], ['askedToRead', READ]] as const) {
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
      expect(Array.from(dialog()?.querySelectorAll('mat-dialog-actions button') ?? []).map(words), 'Deny, then the allow button').toStrictEqual(['Deny', request.allowLabel]);
      expect(words(dialog()?.querySelector('.footer')), 'the footer says what happens with no answer').toBe(FOOTER);
      expect(answer, 'opening the dialog answers nothing').not.toHaveBeenCalled();
    });
  }

  it('Deny answers allow false, once, and closes the dialog as answered', async () => {
    await open(SEND);
    button('Deny')!.click();
    await settle();

    expect(answer.mock.calls, 'Deny is POST answer with allow false').toStrictEqual([['r-send', false]]);
    expect(closed, 'the dialog closes once the API took the answer').toStrictEqual(['answered']);
  });

  it('the allow button answers allow true, once, and closes the dialog as answered', async () => {
    await open(SEND);
    button('Send 3 messages')!.click();
    await settle();

    expect(answer.mock.calls, 'only a click on the allow button answers allow true').toStrictEqual([['r-send', true]]);
    expect(closed).toStrictEqual(['answered']);
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
    expect(closed).toStrictEqual(['answered']);
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
    await open({ ...SEND, kind: 'delete', allowLabel: 'Delete 12 messages' });

    expect(Array.from(dialog()?.querySelectorAll('mat-dialog-actions button') ?? []).map(words), 'only Deny').toStrictEqual(['Deny']);
    expect(words(dialog()?.querySelector('.unknown'))).toBe('This version of the app cannot allow this kind of request.');
  });
});
