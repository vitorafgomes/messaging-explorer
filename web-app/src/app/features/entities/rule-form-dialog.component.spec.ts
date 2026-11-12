import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ConnectionGroupService, ConnectionService, TopicService } from '../../core/services';
import { SubscriptionRuleInfo } from '../../core/models';
import { RuleFormDialogComponent, RuleFormDialogData } from './rule-form-dialog.component';

const NO_FIELDS = { correlationId: null, messageId: null, to: null, replyTo: null, subject: null, sessionId: null, replyToSessionId: null, contentType: null };

const SQL: SubscriptionRuleInfo = {
  name: 'physical-goods', filterType: 'Sql', sqlExpression: "category = 'physical' AND total > 0", correlation: null, sqlAction: "SET priority = 'normal'"
};
const CORRELATION: SubscriptionRuleInfo = {
  name: 'uk-orders',
  filterType: 'Correlation',
  sqlExpression: null,
  correlation: {
    ...NO_FIELDS, subject: 'order.created',
    applicationProperties: [{ name: 'tenant', type: 'String', value: 'contoso-uk' }, { name: 'priority', type: 'Int64', value: '3' }]
  },
  sqlAction: null
};

describe('RuleFormDialogComponent: add and edit a subscription rule', () => {
  let fixture: ComponentFixture<RuleFormDialogComponent>;
  let el: HTMLElement;
  let close: ReturnType<typeof vi.fn>;
  let createRule: ReturnType<typeof vi.fn>;
  let replaceRule: ReturnType<typeof vi.fn>;

  function open(data: Partial<RuleFormDialogData> & Pick<RuleFormDialogData, 'mode'>) {
    close = vi.fn();
    createRule = vi.fn((topic: string, sub: string, rule: object) => of(rule));
    replaceRule = vi.fn((topic: string, sub: string, name: string, rule: object) => of(rule));
    TestBed.configureTestingModule({
      imports: [RuleFormDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { topicName: 'order-events', subscriptionName: 'warehouse', ...data } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: TopicService, useValue: { createRule, replaceRule } },
        {
          provide: ConnectionService,
          useValue: { currentTarget: 'ns.example.net', currentConnectionId: 'c-1', getConnections: () => of([{ id: 'c-1', name: 'contoso-prod', environmentId: 'g-env' }]) }
        },
        { provide: ConnectionGroupService, useValue: { getGroups: () => of([{ id: 'g-env', name: 'Production', type: 'environment' }]) } }
      ]
    });
    fixture = TestBed.createComponent(RuleFormDialogComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    return fixture.componentInstance;
  }

  const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const field = (label: string, root: ParentNode = el) =>
    Array.from(root.querySelectorAll('mat-form-field')).find(f => text(f.querySelector('mat-label')) === label) as HTMLElement | undefined;
  const type = (label: string, value: string, root: ParentNode = el) => {
    const input = field(label, root)!.querySelector('input, textarea') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  };
  const errorOf = (label: string, root: ParentNode = el) => text(field(label, root)?.querySelector('mat-error'));
  const button = (label: string) => Array.from(el.querySelectorAll('button')).find(b => text(b).endsWith(label) || b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
  const click = (label: string) => {
    button(label)!.click();
    fixture.detectChanges();
  };
  const kind = (label: string) => {
    const toggle = Array.from(el.querySelectorAll('mat-button-toggle')).find(t => text(t) === label)!;
    (toggle.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
  };
  const row = (i: number) => el.querySelectorAll('.property')[i] as HTMLElement;
  const setType = (i: number, value: string) => {
    fixture.componentInstance.form.controls.properties.at(i).controls.type.setValue(value as never);
    fixture.detectChanges();
  };
  const addProperty = (name: string, propertyType: string, value: string) => {
    click('Add property');
    const i = el.querySelectorAll('.property').length - 1;
    type('Property name', name, row(i));
    setType(i, propertyType);
    type('Value', value, row(i));
  };
  const alert = () => text(el.querySelector('[role="alert"] .grow'));
  const fail = (status: number, body: unknown = null) => () => throwError(() => new HttpErrorResponse({ status, error: body }));

  describe('add a rule: the POST body is exactly the contract rule, null for what is not set', () => {
    it('a SQL rule with an action', () => {
      open({ mode: 'create' });
      type('Rule name', 'physical-goods');
      type('SQL filter', "category = 'physical' AND total > 0");
      type('Action (optional)', "SET priority = 'normal'");

      click('Add rule');

      expect(createRule.mock.calls).toStrictEqual([['order-events', 'warehouse', {
        name: 'physical-goods', filterType: 'Sql', sqlExpression: "category = 'physical' AND total > 0", correlation: null, sqlAction: "SET priority = 'normal'"
      }]]);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('a correlation rule: the fields left empty are null, each property carries its type and its value as a string', () => {
      open({ mode: 'create' });
      type('Rule name', 'uk-orders');
      kind('Correlation filter');
      type('Subject', 'order.created');
      addProperty('tenant', 'String', 'contoso-uk');
      addProperty('priority', 'Int64', '3');
      addProperty('ratio', 'Double', '2.5');
      addProperty('express', 'Boolean', 'true');

      click('Add rule');

      expect(createRule.mock.calls[0][2]).toStrictEqual({
        name: 'uk-orders',
        filterType: 'Correlation',
        sqlExpression: null,
        correlation: {
          ...NO_FIELDS, subject: 'order.created',
          applicationProperties: [
            { name: 'tenant', type: 'String', value: 'contoso-uk' },
            { name: 'priority', type: 'Int64', value: '3' },
            { name: 'ratio', type: 'Double', value: '2.5' },
            { name: 'express', type: 'Boolean', value: 'true' }
          ]
        },
        sqlAction: null
      });
    });

    it('True and False send no expression and no correlation, even after one was typed for another kind', () => {
      open({ mode: 'create' });
      type('Rule name', 'all');
      type('SQL filter', 'total > 0');
      kind('True (every message)');
      click('Add rule');

      kind('False (no message)');
      type('Action (optional)', 'SET paused = true');
      click('Add rule');

      expect(createRule.mock.calls.map(c => c[2])).toStrictEqual([
        { name: 'all', filterType: 'True', sqlExpression: null, correlation: null, sqlAction: null },
        { name: 'all', filterType: 'False', sqlExpression: null, correlation: null, sqlAction: 'SET paused = true' }
      ]);
    });

    it('a removed property is not sent', () => {
      open({ mode: 'create' });
      type('Rule name', 'uk-orders');
      kind('Correlation filter');
      addProperty('tenant', 'String', 'contoso-uk');
      addProperty('region', 'String', 'uk');
      click('Remove property tenant');
      click('Add rule');

      expect(createRule.mock.calls[0][2].correlation.applicationProperties).toStrictEqual([{ name: 'region', type: 'String', value: 'uk' }]);
    });
  });

  describe('a rule outside the contract shows the limit inline and Save stays disabled', () => {
    it('name: required, then the character rule; the SQL expression past 1024 characters', () => {
      open({ mode: 'create' });
      expect(button('Add rule')!.disabled, 'Add rule with nothing typed').toBe(true);

      type('Rule name', '');
      expect(errorOf('Rule name')).toBe('A name is required.');
      type('Rule name', 'uk orders');
      expect(errorOf('Rule name')).toBe('Use 1 to 50 letters, digits, ".", "-" or "_"; $Default is the only name with "$".');
      type('Rule name', 'uk-orders');
      expect(errorOf('Rule name')).toBe('');

      type('SQL filter', 'x'.repeat(1025));
      expect(errorOf('SQL filter')).toBe('The SQL filter must be at most 1024 characters.');
      expect(button('Add rule')!.disabled).toBe(true);
      type('SQL filter', 'total > 0');
      expect(button('Add rule')!.disabled).toBe(false);
    });

    it('an error is tied to its field: the input is aria-invalid and described by the error', () => {
      open({ mode: 'create' });
      type('Rule name', 'a/b');

      const input = field('Rule name')!.querySelector('input')!;
      const error = field('Rule name')!.querySelector('mat-error')!;
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
    });

    it('a correlation filter with no field and no property: Save disabled and the dialog says it needs at least one', () => {
      open({ mode: 'create' });
      type('Rule name', 'uk-orders');
      kind('Correlation filter');

      expect(text(el.querySelector('#correlation-needs-one'))).toBe('A correlation filter needs at least one field or property.');
      expect(button('Add rule')!.disabled).toBe(true);

      type('To', 'billing');
      expect(el.querySelector('#correlation-needs-one')).toBeNull();
      expect(button('Add rule')!.disabled).toBe(false);
    });

    it('a system field past 128 characters names the field', () => {
      open({ mode: 'create' });
      type('Rule name', 'uk-orders');
      kind('Correlation filter');
      type('Reply to session id', 'x'.repeat(129));

      expect(errorOf('Reply to session id')).toBe('Reply to session id must be at most 128 characters.');
      expect(button('Add rule')!.disabled).toBe(true);
    });

    it('a value that does not parse as its type, and a duplicate property name, are inline errors', () => {
      open({ mode: 'create' });
      type('Rule name', 'uk-orders');
      kind('Correlation filter');
      addProperty('priority', 'Int64', 'high');
      expect(errorOf('Value', row(0))).toBe('An Int64 is a whole number from -9223372036854775808 to 9223372036854775807.');
      expect(button('Add rule')!.disabled).toBe(true);

      type('Value', '3', row(0));
      expect(errorOf('Value', row(0))).toBe('');
      expect(button('Add rule')!.disabled).toBe(false);

      addProperty('priority', 'String', 'x');
      expect(errorOf('Property name', row(0))).toBe('Another property has this name.');
      expect(errorOf('Property name', row(1))).toBe('Another property has this name.');
      expect(button('Add rule')!.disabled).toBe(true);
    });
  });

  describe('edit a rule: the name cannot change and the PUT carries the whole rule to that rule\'s route', () => {
    it('prefilled; the name is read-only text with the note; Save is disabled until something differs', () => {
      open({ mode: 'edit', rule: SQL });

      expect(field('Rule name'), 'an input for the name').toBeUndefined();
      expect(text(el.querySelector('.name-fact dd'))).toBe('physical-goods');
      expect(text(el.querySelector('.name-note'))).toBe('A rule cannot be renamed. Saving replaces it under the same name.');
      expect((field('SQL filter')!.querySelector('textarea') as HTMLTextAreaElement).value).toBe("category = 'physical' AND total > 0");
      expect((field('Action (optional)')!.querySelector('textarea') as HTMLTextAreaElement).value).toBe("SET priority = 'normal'");
      expect(button('Save rule')!.disabled, 'Save before any change').toBe(true);

      type('SQL filter', 'total > 10');
      expect(button('Save rule')!.disabled, 'Save after a change').toBe(false);
      type('SQL filter', "category = 'physical' AND total > 0");
      expect(button('Save rule')!.disabled, 'Save after the change is undone').toBe(true);

      type('Action (optional)', '');
      click('Save rule');

      expect(replaceRule.mock.calls).toStrictEqual([['order-events', 'warehouse', 'physical-goods', {
        name: 'physical-goods', filterType: 'Sql', sqlExpression: "category = 'physical' AND total > 0", correlation: null, sqlAction: null
      }]]);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('a correlation rule opens with its fields and properties; changing one value sends every field and property', () => {
      open({ mode: 'edit', rule: CORRELATION });

      expect((field('Subject')!.querySelector('input') as HTMLInputElement).value).toBe('order.created');
      expect(Array.from(el.querySelectorAll('.property')).map(r => (field('Property name', r)!.querySelector('input') as HTMLInputElement).value))
        .toStrictEqual(['tenant', 'priority']);

      type('Value', '4', row(1));
      click('Save rule');

      expect(replaceRule.mock.calls).toStrictEqual([['order-events', 'warehouse', 'uk-orders', {
        name: 'uk-orders',
        filterType: 'Correlation',
        sqlExpression: null,
        correlation: {
          ...NO_FIELDS, subject: 'order.created',
          applicationProperties: [{ name: 'tenant', type: 'String', value: 'contoso-uk' }, { name: 'priority', type: 'Int64', value: '4' }]
        },
        sqlAction: null
      }]]);
    });

    it('changing the filter kind of a rule replaces it whole under the same name', () => {
      open({ mode: 'edit', rule: SQL });
      kind('True (every message)');
      click('Save rule');

      expect(replaceRule.mock.calls).toStrictEqual([['order-events', 'warehouse', 'physical-goods', {
        name: 'physical-goods', filterType: 'True', sqlExpression: null, correlation: null, sqlAction: "SET priority = 'normal'"
      }]]);
    });

    it('a rule holding a property of type Other opens read-only with a note and offers no Save', () => {
      const rule: SubscriptionRuleInfo = {
        ...CORRELATION,
        correlation: { ...CORRELATION.correlation!, applicationProperties: [{ name: 'createdAt', type: 'Other', value: '2026-01-02T03:04:05Z' }] }
      };
      open({ mode: 'edit', rule });

      expect(el.querySelectorAll('input, textarea, mat-select, mat-button-toggle').length, 'editable controls').toBe(0);
      expect(text(el.querySelector('.read-only-note span'))).toBe('This rule holds a property of a value type this app cannot edit, so it is shown read-only. Nothing here can be saved.');
      expect(text(el.querySelector('.facts'))).toContain('createdAt = 2026-01-02T03:04:05Z (Other)');
      expect(Array.from(el.querySelectorAll('button')).map(text)).toStrictEqual(['Close']);
    });
  });

  describe('a refused or failed call keeps the dialog and the input, and says what happened', () => {
    function sqlRule() {
      open({ mode: 'create' });
      type('Rule name', 'physical-goods');
      type('SQL filter', 'total >');
    }

    it('409: the name field says a rule with this name exists; changing the name clears it', () => {
      sqlRule();
      createRule.mockImplementation(fail(409, { message: 'A rule with this name already exists.' }));
      click('Add rule');

      expect(errorOf('Rule name')).toBe('A rule with this name already exists in this subscription.');
      expect(button('Add rule')!.disabled).toBe(true);
      expect(close).not.toHaveBeenCalled();

      type('Rule name', 'physical-goods-2');
      expect(errorOf('Rule name')).toBe('');
    });

    it('400: the API message is shown, the dialog stays open with the expression as typed, no spinner left', () => {
      sqlRule();
      createRule.mockImplementation(fail(400, { message: 'The broker refused this rule. Check the expression.' }));
      click('Add rule');

      expect(alert()).toBe('The broker refused this rule. Check the expression.');
      expect(close).not.toHaveBeenCalled();
      expect((field('SQL filter')!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('total >');
      expect(el.querySelector('mat-progress-bar')).toBeNull();
      expect(button('Add rule')!.disabled, 'Add rule can be tried again').toBe(false);
    });

    it('404 on edit: says the rule or subscription no longer exists and Refresh closes so the list is read again', () => {
      open({ mode: 'edit', rule: SQL });
      replaceRule.mockImplementation(fail(404, { message: 'The rule was not found.' }));
      type('SQL filter', 'total > 1');
      click('Save rule');

      expect(alert()).toBe('The rule was not found. Refresh to see the rules as they are now.');
      expect(close).not.toHaveBeenCalled();
      expect(button('Refresh'), 'a Refresh action is offered').toBeDefined();
      click('Refresh');
      expect(close.mock.calls).toStrictEqual([['refresh']]);
    });

    it('a 500 and no answer at all show a generic message; nothing is shown as saved', () => {
      sqlRule();
      createRule.mockImplementation(fail(500));
      click('Add rule');
      expect(alert()).toBe('Could not add the rule: the API did not confirm it. Try again.');

      createRule.mockImplementation(fail(0));
      click('Add rule');
      expect(alert()).toBe('Could not add the rule: the API did not confirm it. Try again.');
      expect(close).not.toHaveBeenCalled();
    });

    it('404 on add: the subscription no longer exists; Refresh closes so the list is read again', () => {
      sqlRule();
      createRule.mockImplementation(fail(404, { message: 'The subscription was not found.' }));
      click('Add rule');

      expect(alert()).toBe('The subscription was not found. Refresh to see the rules as they are now.');
      expect(close).not.toHaveBeenCalled();
      expect(button('Refresh'), 'a Refresh action is offered').toBeDefined();
      click('Refresh');
      expect(close.mock.calls).toStrictEqual([['refresh']]);
    });

    it('a 500 and no answer on edit show a generic message; the edited expression stays', () => {
      open({ mode: 'edit', rule: SQL });
      type('SQL filter', 'total > 1');
      for (const status of [500, 0]) {
        replaceRule.mockImplementation(fail(status));
        click('Save rule');
        expect(alert(), `status ${status}`).toBe('Could not save the rule: the API did not confirm it. Try again.');
      }
      expect(close).not.toHaveBeenCalled();
      expect((field('SQL filter')!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('total > 1');
    });

    it('a 400 on edit keeps the dialog open with the API message', () => {
      open({ mode: 'edit', rule: SQL });
      replaceRule.mockImplementation(fail(400, { message: 'sqlExpression must be at most 1024 characters.' }));
      type('SQL filter', 'total > 1');
      click('Save rule');

      expect(alert()).toBe('sqlExpression must be at most 1024 characters.');
      expect(close).not.toHaveBeenCalled();
    });
  });

  it('the header names the subscription, its topic, the connection and the environment', () => {
    open({ mode: 'create' });

    expect(text(el.querySelector('h2'))).toBe('Add rule');
    expect(text(el.querySelector('.context mat-chip'))).toBe('Production');
    expect(text(el.querySelector('.context > span'))).toBe('Subscription warehouse in topic order-events on contoso-prod (ns.example.net)');
  });
});
