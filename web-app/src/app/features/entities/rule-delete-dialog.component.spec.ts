import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ConnectionGroupService, ConnectionService, TopicService } from '../../core/services';
import { RuleDeleteDialogComponent, RuleDeleteDialogData } from './rule-delete-dialog.component';

describe('RuleDeleteDialogComponent: delete a rule', () => {
  let fixture: ComponentFixture<RuleDeleteDialogComponent>;
  let el: HTMLElement;
  let close: ReturnType<typeof vi.fn>;
  let deleteRule: ReturnType<typeof vi.fn>;

  function open(ruleName: string, isLast: boolean) {
    close = vi.fn();
    deleteRule = vi.fn(() => of(undefined));
    const data: RuleDeleteDialogData = { topicName: 'order-events', subscriptionName: 'email', ruleName, isLast };
    TestBed.configureTestingModule({
      imports: [RuleDeleteDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
        { provide: TopicService, useValue: { deleteRule } },
        {
          provide: ConnectionService,
          useValue: { currentTarget: 'ns.example.net', currentConnectionId: 'c-1', getConnections: () => of([{ id: 'c-1', name: 'contoso-prod', environmentId: 'g-env' }]) }
        },
        { provide: ConnectionGroupService, useValue: { getGroups: () => of([{ id: 'g-env', name: 'Production', type: 'environment' }]) } }
      ]
    });
    fixture = TestBed.createComponent(RuleDeleteDialogComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const facts = () => Array.from(el.querySelectorAll('.fact')).map(f => `${text(f.querySelector('dt'))}: ${text(f.querySelector('dd'))}`);
  const button = (label: string) => Array.from(el.querySelectorAll('button')).find(b => text(b) === label) as HTMLButtonElement | undefined;
  const click = (label: string) => {
    button(label)!.click();
    fixture.detectChanges();
  };
  const typeName = (value: string) => {
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const alert = () => text(el.querySelector('[role="alert"] .grow'));
  const fail = (status: number, body: unknown = null) => () => throwError(() => new HttpErrorResponse({ status, error: body }));
  const PLACE = ['Subscription: email', 'Topic: order-events', 'Connection: contoso-prod (ns.example.net)', 'Environment: Production'];

  it('a rule that is not the last: a plain confirmation naming rule, subscription, topic, connection and environment', () => {
    open('physical-goods', false);

    expect(text(el.querySelector('h2'))).toBe('Delete rule physical-goods?');
    expect(text(el.querySelector('.consequence'))).toBe('Messages that only this rule matches stop reaching the subscription email. Its other rules keep working.');
    expect(facts()).toStrictEqual(['Rule: physical-goods', ...PLACE]);
    expect(el.querySelector('input'), 'a typed-name field').toBeNull();
    expect(button('Delete rule')!.disabled).toBe(false);

    click('Delete rule');

    expect(deleteRule.mock.calls).toStrictEqual([['order-events', 'email', 'physical-goods']]);
    expect(close.mock.calls).toStrictEqual([[true]]);
  });

  it('the last rule: says the subscription then receives no message and none is kept, and needs the rule name typed exactly', () => {
    open('$Default', true);

    expect(text(el.querySelector('h2'))).toBe('warning Delete the last rule?');
    expect(text(el.querySelector('.consequence')))
      .toBe('With no rule, the subscription email receives no message at all until a rule is added. Messages published meanwhile are not kept for it.');
    expect(facts()).toStrictEqual(['Rule: $Default', ...PLACE]);
    expect(text(el.querySelector('mat-label'))).toBe('Type the rule name to confirm');
    expect(button('Delete rule')!.disabled, 'before the name is typed').toBe(true);

    typeName('$default');
    expect(button('Delete rule')!.disabled, 'a name that differs in case').toBe(true);
    typeName('$Default ');
    expect(button('Delete rule')!.disabled, 'a name with a trailing space').toBe(true);
    click('Delete rule');
    expect(deleteRule, 'no call while the name differs').not.toHaveBeenCalled();

    typeName('$Default');
    expect(button('Delete rule')!.disabled, 'once the name matches').toBe(false);
    click('Delete rule');

    expect(deleteRule.mock.calls).toStrictEqual([['order-events', 'email', '$Default']]);
    expect(close.mock.calls).toStrictEqual([[true]]);
  });

  it('a 404 says the rule no longer exists and Refresh closes so the list is read again', () => {
    open('physical-goods', false);
    deleteRule.mockImplementation(fail(404, { message: 'The rule was not found.' }));
    click('Delete rule');

    expect(alert()).toBe('The rule was not found. Refresh to see the rules as they are now.');
    expect(close).not.toHaveBeenCalled();
    expect(button('Refresh'), 'a Refresh action is offered').toBeDefined();
    click('Refresh');
    expect(close.mock.calls).toStrictEqual([['refresh']]);
  });

  it('a 400 shows the API message; a 500 and no answer show a generic one; the dialog stays open with the typed name and no spinner', () => {
    open('$Default', true);
    typeName('$Default');
    deleteRule.mockImplementation(fail(400, { message: 'This provider does not support subscription rules.' }));
    click('Delete rule');
    expect(alert()).toBe('This provider does not support subscription rules.');
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('$Default');

    for (const status of [500, 0]) {
      deleteRule.mockImplementation(fail(status));
      click('Delete rule');
      expect(alert(), `status ${status}`).toBe('Could not delete the rule: the API did not confirm it. Try again.');
    }
    expect(close).not.toHaveBeenCalled();
    expect(el.querySelector('mat-progress-bar')).toBeNull();
  });
});
