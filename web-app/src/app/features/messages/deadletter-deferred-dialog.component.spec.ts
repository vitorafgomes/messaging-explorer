import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DeadLetterDeferredDialogComponent, DeadLetterDeferredDialogData } from './deadletter-deferred-dialog.component';
import { ConnectionGroupService, ConnectionService } from '../../core/services';

describe('DeadLetterDeferredDialogComponent', () => {
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  let close: ReturnType<typeof vi.fn>;

  function render(data: DeadLetterDeferredDialogData) {
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [DeadLetterDeferredDialogComponent],
      providers: [
        { provide: ConnectionService, useValue: { currentTarget: 'sample.example.net', currentConnectionId: null } },
        { provide: ConnectionGroupService, useValue: {} },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
        provideNoopAnimations()
      ]
    });
    const fixture = TestBed.createComponent(DeadLetterDeferredDialogComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const type = (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input')); };
  const confirmButton = (el: HTMLElement) => Array.from(el.querySelectorAll('button')).find(b => text(b).startsWith('Dead-letter'))!;

  it('names the subscription and the count, labels both optional fields, and hands back the reason and description typed', () => {
    const el = render({ entityName: 'eu', entityType: 'subscription', sequenceNumbers: [4, 9] });

    expect(text(el.querySelector('.title-text')), 'the title says what happens and to how many').toBe('Dead-letter 2 deferred messages?');
    const facts = Array.from(el.querySelectorAll('.fact')).map(f => [text(f.querySelector('dt')), text(f.querySelector('dd'))]);
    expect(facts, 'the facts name the entity and the count').toEqual(expect.arrayContaining([['Subscription', 'eu'], ['Messages', '2 deferred']]));
    expect(Array.from(el.querySelectorAll('mat-label')).map(text), 'each field has a label').toEqual(['Reason', 'Description']);
    const [reason, description] = Array.from(el.querySelectorAll<HTMLInputElement>('input'));
    type(reason, '  Bad payload ');
    type(description, 'Schema v1');

    confirmButton(el).click();

    expect(close, 'the reason and description, trimmed').toHaveBeenCalledWith({ reason: 'Bad payload', description: 'Schema v1' });
  });

  it('left empty, both are absent so the API writes its own', () => {
    const el = render({ entityName: 'orders', entityType: 'queue', sequenceNumbers: [4] });

    expect(text(confirmButton(el)), 'the button names the action and the count').toBe('Dead-letter 1 deferred message');
    confirmButton(el).click();

    expect(close, 'no reason or description sent').toHaveBeenCalledWith({ reason: undefined, description: undefined });
  });

  it('for one active message, names it active and says what the scan does to the other messages before anything is sent', () => {
    const el = render({ entityName: 'orders', entityType: 'queue', sequenceNumbers: [42], active: true });

    expect(text(el.querySelector('.title-text'))).toBe('Dead-letter 1 active message?');
    const notice = text(el.querySelector('[data-testid="scan-notice"]'));
    expect(notice, 'the scan raises the delivery count of the other messages it receives').toContain('delivery count raised by one');
    expect(notice, 'the dialog says operations are at-least-once').toContain('at-least-once');
    expect(close, 'nothing is confirmed until the user clicks').not.toHaveBeenCalled();
  });
});

