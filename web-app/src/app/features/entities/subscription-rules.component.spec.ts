import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { EntitySelectionService, TopicService } from '../../core/services';
import { ProviderService } from '../../core/services/provider.service';
import { ProviderCapabilities } from '../../core/models/provider.model';
import { SubscriptionRuleInfo } from '../../core/models';
import { SubscriptionRulesComponent } from './subscription-rules.component';
import { RuleFormDialogComponent } from './rule-form-dialog.component';
import { RuleDeleteDialogComponent } from './rule-delete-dialog.component';

const SQL: SubscriptionRuleInfo = {
  name: 'physical-goods', filterType: 'Sql', sqlExpression: "category = 'physical' AND total > 0", correlation: null, sqlAction: "SET priority = 'normal'"
};
const CORRELATION: SubscriptionRuleInfo = {
  name: 'uk-orders',
  filterType: 'Correlation',
  sqlExpression: null,
  correlation: {
    correlationId: null, messageId: null, to: null, replyTo: null, subject: 'order.created', sessionId: null, replyToSessionId: null, contentType: null,
    applicationProperties: [{ name: 'tenant', type: 'String', value: 'contoso-uk' }, { name: 'priority', type: 'Int64', value: '3' }]
  },
  sqlAction: null
};
const TRUE: SubscriptionRuleInfo = { name: '$Default', filterType: 'True', sqlExpression: null, correlation: null, sqlAction: null };
const FALSE: SubscriptionRuleInfo = { name: 'paused', filterType: 'False', sqlExpression: null, correlation: null, sqlAction: 'SET paused = true' };

describe('SubscriptionRulesComponent: the rules of a subscription', () => {
  let fixture: ComponentFixture<SubscriptionRulesComponent>;
  let el: HTMLElement;
  let open: ReturnType<typeof vi.fn>;
  let dialogResult: unknown;
  let getRules: ReturnType<typeof vi.fn>;
  let selection: Record<string, ReturnType<typeof vi.fn>>;

  function render(rules: SubscriptionRuleInfo[] | undefined, capabilities: Partial<ProviderCapabilities> | null, list: () => Observable<SubscriptionRuleInfo[]> = () => of([])) {
    dialogResult = undefined;
    open = vi.fn(() => ({ afterClosed: () => of(dialogResult) }));
    getRules = vi.fn(list);
    selection = { refreshTree: vi.fn(), clearSelection: vi.fn() };
    TestBed.configureTestingModule({
      imports: [SubscriptionRulesComponent],
      providers: [
        { provide: MatDialog, useValue: { open } },
        { provide: TopicService, useValue: { getRules } },
        { provide: EntitySelectionService, useValue: selection },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } }
      ]
    });
    fixture = TestBed.createComponent(SubscriptionRulesComponent);
    fixture.componentRef.setInput('subscription', { topicName: 'order-events', name: 'warehouse', rules });
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const rows = () => Array.from(el.querySelectorAll('tr.rule-row')).map(r => Array.from(r.querySelectorAll('td')).slice(0, 4).map(text));
  const buttons = () => Array.from(el.querySelectorAll('button'));
  const named = (label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const byText = (label: string) => buttons().find(b => text(b).endsWith(label));
  const click = (b: HTMLButtonElement | null | undefined) => {
    b!.click();
    fixture.detectChanges();
  };
  const ENABLED = { supportsSubscriptionRules: true };

  describe('see the rules with their filter type', () => {
    it('each kind shows its filter as a chip with text and a readable expression; no action reads None', () => {
      render([SQL, CORRELATION, TRUE, FALSE], ENABLED);

      expect(text(el.querySelector('.lead'))).toBe('A message is delivered when at least one rule matches.');
      expect(rows()).toStrictEqual([
        ['physical-goods', 'SQL', "category = 'physical' AND total > 0", "SET priority = 'normal'"],
        ['uk-orders', 'Correlation', 'Subject = order.created, tenant = contoso-uk, priority = 3', 'None'],
        ['$Default', 'True', 'Matches every message', 'None'],
        ['paused', 'False', 'Matches no message', 'SET paused = true']
      ]);
      expect(Array.from(el.querySelectorAll('tr.rule-row td:nth-child(2) mat-chip')).map(text)).toStrictEqual(['SQL', 'Correlation', 'True', 'False']);
    });

    it('a correlation filter names every system field that is set, in the form order', () => {
      const rule = { ...CORRELATION, correlation: { ...CORRELATION.correlation!, correlationId: 'c-1', contentType: 'application/json', applicationProperties: [] } };
      render([rule], null);

      expect(rows()[0][2]).toBe('Subject = order.created, Correlation id = c-1, Content type = application/json');
    });

    it('a filter type outside the four (assuming the API sends its text in sqlExpression) shows its own name and that text', () => {
      render([{ name: 'RoutingKey', filterType: 'RoutingKey', sqlExpression: 'orders.*' }], null);

      expect(rows()).toStrictEqual([['RoutingKey', 'RoutingKey', 'orders.*', 'None']]);
    });

    it('rule text is shown as text: markup in a name, an expression or an action is not interpreted', () => {
      render([{ ...SQL, name: '<img src=x>', sqlExpression: "a = '<b>bold</b>'", sqlAction: '<script>x</script>' }], ENABLED);

      expect(rows()[0]).toStrictEqual(['<img src=x>', 'SQL', "a = '<b>bold</b>'", '<script>x</script>']);
      expect(el.querySelector('table img, table b, table script')).toBeNull();
    });

    it('no rule and failed to load are different states: an empty list says the subscription receives no message', () => {
      render([], ENABLED);

      expect(text(el.querySelector('.empty'))).toBe('No rule: this subscription receives no message');
      expect(el.querySelector('table')).toBeNull();
      expect(el.querySelector('[role="alert"]')).toBeNull();
      expect(byText('Add rule'), 'Add rule is offered on an empty list with the capability').toBeDefined();
    });

    it('a list call that fails with a 500 shows an error with Retry, not the empty state; Retry reads the list again', () => {
      render([SQL], ENABLED, () => throwError(() => new HttpErrorResponse({ status: 500 })));
      dialogResult = true;
      click(byText('Add rule'));

      expect(text(el.querySelector('[role="alert"] .grow'))).toBe('Could not read the rules: the API did not answer. Nothing was changed by reading.');
      expect(el.querySelector('.empty'), 'the empty state').toBeNull();
      expect(el.querySelector('table'), 'the table').toBeNull();

      getRules.mockImplementation(() => of([SQL, TRUE]));
      click(byText('Retry'));
      expect(rows().map(r => r[0])).toStrictEqual(['physical-goods', '$Default']);
      expect(el.querySelector('[role="alert"]')).toBeNull();
    });

    it('a list call that fails with no answer (status 0) shows the same error state', () => {
      render([SQL], ENABLED, () => throwError(() => new HttpErrorResponse({ status: 0 })));
      dialogResult = true;
      click(byText('Add rule'));

      expect(text(el.querySelector('[role="alert"] .grow'))).toBe('Could not read the rules: the API did not answer. Nothing was changed by reading.');
      expect(byText('Retry')).toBeDefined();
    });

    it('a list call answered 404 says the subscription no longer exists and Refresh reloads the tree and clears the selection', () => {
      render([SQL], ENABLED, () => throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'The subscription was not found.' } })));
      dialogResult = true;
      click(byText('Add rule'));

      expect(text(el.querySelector('[role="alert"] .grow'))).toBe('This subscription no longer exists. Refresh to see the entities as they are now.');
      click(byText('Refresh'));
      expect(selection['refreshTree']).toHaveBeenCalledTimes(1);
      expect(selection['clearSelection']).toHaveBeenCalledTimes(1);
    });
  });

  describe('the editor is offered only with the capability', () => {
    it('with it: Add rule, and per row Edit and Delete icon buttons whose names include the rule name', () => {
      render([SQL, CORRELATION], ENABLED);

      expect(byText('Add rule')).toBeDefined();
      const tooltips = fixture.debugElement.queryAll(By.directive(MatTooltip))
        .map(d => [d.nativeElement.getAttribute('aria-label'), d.injector.get(MatTooltip).message]);
      expect(tooltips).toStrictEqual([
        ['Edit rule physical-goods', 'Edit rule physical-goods'],
        ['Delete rule physical-goods', 'Delete rule physical-goods'],
        ['Edit rule uk-orders', 'Edit rule uk-orders'],
        ['Delete rule uk-orders', 'Delete rule uk-orders']
      ]);
    });

    it('without it (RabbitMQ, an older API, no answer yet): the same rows, read-only, with no button at all', () => {
      for (const capabilities of [{ supportsSubscriptionRules: false }, {}, null]) {
        render([SQL, CORRELATION], capabilities);
        expect(rows().map(r => r[0]), JSON.stringify(capabilities)).toStrictEqual(['physical-goods', 'uk-orders']);
        expect(buttons().length, `buttons with ${JSON.stringify(capabilities)}`).toBe(0);
        TestBed.resetTestingModule();
      }
    });

    it('without it an empty list says the same and offers no Add', () => {
      render([], { supportsSubscriptionRules: false });

      expect(text(el.querySelector('.empty'))).toBe('No rule: this subscription receives no message');
      expect(buttons().length).toBe(0);
    });
  });

  describe('add, edit and delete open their dialogs and refresh the list from the API afterwards', () => {
    it('Add rule opens the form in add mode for this subscription; after a save the list is read again with getRules', () => {
      render([SQL], ENABLED, () => of([SQL, CORRELATION]));
      dialogResult = CORRELATION;

      click(byText('Add rule'));

      expect(open.mock.calls[0][0]).toBe(RuleFormDialogComponent);
      expect(open.mock.calls[0][1].data).toStrictEqual({ mode: 'create', topicName: 'order-events', subscriptionName: 'warehouse' });
      expect(getRules.mock.calls).toStrictEqual([['order-events', 'warehouse']]);
      expect(rows().map(r => r[0])).toStrictEqual(['physical-goods', 'uk-orders']);
    });

    it('a dialog closed without a change does not read the list again', () => {
      render([SQL], ENABLED);
      dialogResult = undefined;

      click(byText('Add rule'));

      expect(getRules).not.toHaveBeenCalled();
    });

    it('Edit opens the form in edit mode with the rule as read', () => {
      render([SQL, CORRELATION], ENABLED);

      click(named('Edit rule uk-orders'));

      expect(open.mock.calls[0][0]).toBe(RuleFormDialogComponent);
      expect(open.mock.calls[0][1].data).toStrictEqual({ mode: 'edit', topicName: 'order-events', subscriptionName: 'warehouse', rule: CORRELATION });
    });

    it('Delete opens the confirmation, saying whether the rule is the last one; after a delete the list is read again', () => {
      render([SQL, CORRELATION], ENABLED, () => of([CORRELATION]));
      dialogResult = true;
      click(named('Delete rule physical-goods'));

      expect(open.mock.calls[0][0]).toBe(RuleDeleteDialogComponent);
      expect(open.mock.calls[0][1].data).toStrictEqual({ topicName: 'order-events', subscriptionName: 'warehouse', ruleName: 'physical-goods', isLast: false });
      expect(rows().map(r => r[0])).toStrictEqual(['uk-orders']);

      dialogResult = undefined;
      click(named('Delete rule uk-orders'));
      expect(open.mock.calls[1][1].data).toStrictEqual({ topicName: 'order-events', subscriptionName: 'warehouse', ruleName: 'uk-orders', isLast: true });
    });
  });
});
