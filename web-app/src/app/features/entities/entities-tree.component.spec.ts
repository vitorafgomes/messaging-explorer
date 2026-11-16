import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatTooltip } from '@angular/material/tooltip';
import { signal } from '@angular/core';
import { BehaviorSubject, NEVER, Subject, of, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import {
  ConnectionService, DeadLetterNotificationService, EntityCountsService, EntitySelectionService, LoggerService, ResubmitRun, ResubmitRunService, ResubmitRunTarget, TreeDataBuilderService
} from '../../core/services';

let activeRunOn: string | undefined;
const resubmitRuns = {
  provide: ResubmitRunService,
  useValue: { find: (target: ResubmitRunTarget) => target.entityName === activeRunOn ? { isActive: () => true } as ResubmitRun : undefined }
};
import { DEFAULT_AZURE_CAPABILITIES, DEFAULT_RABBITMQ_CAPABILITIES, ProviderService } from '../../core/services/provider.service';
import { ProviderCapabilities, ProviderType } from '../../core/models/provider.model';
import { TreeNode } from '../../core/models';
import { EntitiesTreeComponent } from './entities-tree.component';
import { EntityFormDialogComponent } from './entity-form-dialog.component';
import { ExportDefinitionsDialogComponent } from './export-definitions-dialog.component';
import { ImportDefinitionsDialogComponent } from './import-definitions-dialog.component';

describe('EntitiesTreeComponent create entry points', () => {
  let open: ReturnType<typeof vi.fn>;
  let select: ReturnType<typeof vi.fn>;

  function tree(withQueues: boolean): TreeNode[] {
    const queues: TreeNode = { id: 'category-queues', name: 'Queues', type: 'category', icon: 'folder', expandable: withQueues, level: 0, children: [] };
    if (withQueues) {
      queues.children = [{ id: 'queue-orders', name: 'orders', type: 'queue', icon: 'inbox', expandable: false, level: 1 }];
    }
    const withSubscription: TreeNode = {
      id: 'topic-events', name: 'events', type: 'topic', icon: 'topic', expandable: true, level: 1, data: { subscriptionCount: 1 } as never,
      children: [{ id: 'subscription-events-audit', name: 'audit', type: 'subscription', icon: 'mail', expandable: false, level: 2 }]
    };
    const empty: TreeNode = { id: 'topic-billing', name: 'billing', type: 'topic', icon: 'topic', expandable: false, level: 1, data: { subscriptionCount: 0 } as never, children: [] };
    const topics: TreeNode = { id: 'category-topics', name: 'Topics', type: 'category', icon: 'folder', expandable: true, level: 0, children: [withSubscription, empty] };
    return [queues, topics];
  }

  function render(capabilities: ProviderCapabilities | null, withQueues = true): HTMLElement {
    open = vi.fn();
    select = vi.fn();
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => of(tree(withQueues)) } },
        { provide: EntitySelectionService, useValue: { selection$: of(null), treeRefresh$: NEVER, select } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } },
        { provide: MatDialog, useValue: { open } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const ENABLED: ProviderCapabilities = { ...DEFAULT_AZURE_CAPABILITIES, supportsEntityUpdate: true };
  const createButtons = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('button[aria-label^="Create"]')) as HTMLButtonElement[];
  const labels = (el: HTMLElement) => createButtons(el).map(b => b.getAttribute('aria-label'));

  it('with the capability: create a queue on Queues, a topic on Topics, and a subscription on each topic', () => {
    const el = render(ENABLED);

    expect(labels(el)).toStrictEqual(['Create queue', 'Create topic', 'Create subscription in events', 'Create subscription in billing']);
  });

  it('an empty Queues category still offers create', () => {
    expect(labels(render(ENABLED, false))).toContain('Create queue');
  });

  it('create on a topic opens the create dialog for a subscription of that topic, without selecting the row', () => {
    const el = render(ENABLED);

    createButtons(el).find(b => b.getAttribute('aria-label') === 'Create subscription in billing')!.click();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(EntityFormDialogComponent);
    expect(open.mock.calls[0][1].data).toStrictEqual({ mode: 'create', kind: 'subscription', topicName: 'billing' });
    expect(select).not.toHaveBeenCalled();
  });

  it('create on Queues opens the create dialog for a queue', () => {
    const el = render(ENABLED);

    createButtons(el)[0].click();

    expect(open.mock.calls[0][1].data).toStrictEqual({ mode: 'create', kind: 'queue', topicName: undefined });
  });

  it('on RabbitMQ, and on an API that does not send the flag, the tree offers no create', () => {
    const { supportsEntityUpdate: _, ...withoutFlag } = DEFAULT_AZURE_CAPABILITIES;
    for (const capabilities of [DEFAULT_RABBITMQ_CAPABILITIES, withoutFlag as ProviderCapabilities, null]) {
      expect(labels(render(capabilities))).toStrictEqual([]);
      TestBed.resetTestingModule();
    }
  });

  describe('Export and Import of definitions in the tree header', () => {
    const definitionButtons = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('.tree-header button[aria-label$="definitions"]')) as HTMLButtonElement[];

    it('with supportsDefinitions exactly true: Export and Import, each named, and each opens its dialog', () => {
      const el = render({ ...DEFAULT_AZURE_CAPABILITIES, supportsDefinitions: true });

      const buttons = definitionButtons(el);
      expect(buttons.map(b => b.getAttribute('aria-label'))).toStrictEqual(['Export definitions', 'Import definitions']);
      buttons[0].click();
      buttons[1].click();
      expect(open.mock.calls.map(c => c[0])).toStrictEqual([ExportDefinitionsDialogComponent, ImportDefinitionsDialogComponent]);
    });

    it('without the explicit true (absent, false, RabbitMQ, or no connection) there is neither', () => {
      expect(definitionButtons(render(DEFAULT_AZURE_CAPABILITIES))).toHaveLength(0);
      TestBed.resetTestingModule();
      expect(definitionButtons(render({ ...DEFAULT_AZURE_CAPABILITIES, supportsDefinitions: false }))).toHaveLength(0);
      TestBed.resetTestingModule();
      expect(definitionButtons(render({ ...DEFAULT_RABBITMQ_CAPABILITIES, supportsDefinitions: false }))).toHaveLength(0);
      TestBed.resetTestingModule();
      expect(definitionButtons(render(null))).toHaveLength(0);
    });
  });
});

describe('EntitiesTreeComponent when the entities cannot be loaded', () => {
  it('says the entities could not be loaded, not that there are none', () => {
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => throwError(() => new Error('503 Service Unavailable')) } },
        { provide: EntitySelectionService, useValue: { selection$: of(null), treeRefresh$: NEVER, select: vi.fn() } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_AZURE_CAPABILITIES) } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Could not load entities');
    expect(text).not.toContain('No Entities Found');
  });
});

describe('EntitiesTreeComponent on a switch to another connection', () => {
  it('the dead-letter alerts of the previous connection are not shown when the next connection fails to load', () => {
    const status = new BehaviorSubject({ connected: true, namespace: 'first' });
    let fail = false;
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => (fail ? throwError(() => new Error('503 Service Unavailable')) : of([])) } },
        { provide: EntitySelectionService, useValue: { selection$: of(null), treeRefresh$: NEVER, select: vi.fn() } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: status } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_AZURE_CAPABILITIES) } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const alerts = TestBed.inject(DeadLetterNotificationService);
    TestBed.createComponent(EntitiesTreeComponent).detectChanges();
    alerts.updateFromSubscriptions([{ name: 'audit', topicName: 'events', deadLetterMessageCount: 4 } as never]);
    expect(alerts.alertCount()).toBe(1);

    fail = true;
    status.next({ connected: true, namespace: 'second' });

    expect(alerts.alertCount()).toBe(0);
  });
});

describe('EntitiesTreeComponent runs one tree load at a time', () => {
  const category = (name: string): TreeNode[] =>
    [{ id: 'category-queues', name: 'Queues', type: 'category', icon: 'folder', expandable: true, level: 0,
       children: [{ id: `queue-${name}`, name, type: 'queue', icon: 'inbox', expandable: false, level: 1 }] }];

  function mountWithTwoLoads() {
    const loads: Subject<TreeNode[]>[] = [];
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => { const load = new Subject<TreeNode[]>(); loads.push(load); return load; } } },
        { provide: EntitySelectionService, useValue: { selection$: of(null), treeRefresh$: NEVER, select: vi.fn() } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: new BehaviorSubject({ connected: true }) } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_AZURE_CAPABILITIES) } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    const text = () => { fixture.detectChanges(); return (fixture.nativeElement as HTMLElement).textContent ?? ''; };
    return { loads, text };
  }

  it('an earlier load that fails after a later one succeeded does not show the error panel over the tree', () => {
    const { loads, text } = mountWithTwoLoads();
    expect(loads).toHaveLength(2);

    loads[1].next(category('orders'));
    loads[1].complete();
    loads[0].error(new Error('503 Service Unavailable'));

    expect(text()).toContain('orders');
    expect(text()).not.toContain('Could not load entities');
  });

  it('a second load cancels the first, so only the second tree reaches the screen', () => {
    const { loads, text } = mountWithTwoLoads();

    expect(loads[0].observed).toBe(false);
    loads[1].next(category('orders'));
    loads[1].complete();
    loads[0].next(category('stale'));

    expect(text()).toContain('orders');
    expect(text()).not.toContain('stale');
  });

});

describe('EntitiesTreeComponent: the tree on Material', () => {
  function render(buildTree: () => ReturnType<TreeDataBuilderService['buildTree']>) {
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: vi.fn(buildTree) } },
        { provide: EntitySelectionService, useValue: { selection$: of(null), treeRefresh$: NEVER, select: vi.fn() } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_AZURE_CAPABILITIES) } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    return fixture;
  }
  const topics: TreeNode[] = [{
    id: 'category-topics', name: 'Topics', type: 'category', icon: 'folder', expandable: true, level: 0,
    children: [{
      id: 'topic-events', name: 'events', type: 'topic', icon: 'topic', expandable: true, level: 1, data: { subscriptionCount: 1 } as never,
      children: [{ id: 'subscription-events-audit', name: 'audit', type: 'subscription', icon: 'mail', expandable: false, level: 2 }]
    }]
  }];
  const text = (fixture: { nativeElement: HTMLElement }) => (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ');

  it('a failed load offers Retry, which asks for the entities again and shows them', () => {
    let fail = true;
    const fixture = render(() => (fail ? throwError(() => new Error('503 Service Unavailable')) : of(topics)));
    const retry = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(b => b.textContent?.trim() === 'Retry')!;

    fail = false;
    retry.click();
    fixture.detectChanges();

    expect(TestBed.inject(TreeDataBuilderService).buildTree).toHaveBeenCalledTimes(2);
    expect(text(fixture)).toContain('events');
    expect(text(fixture)).not.toContain('Could not load entities');
  });
});

describe('EntitiesTreeComponent as Main.dc.html draws the tree', () => {
  const orders: TreeNode = { id: 'queue-orders', name: 'orders', type: 'queue', icon: 'inbox', expandable: false, level: 1, data: { activeMessageCount: 1204, deadLetterMessageCount: 37 } as never };
  const invoices: TreeNode = { id: 'queue-billing/invoices', name: 'billing/invoices', type: 'queue', icon: 'inbox', expandable: false, level: 1, data: { activeMessageCount: 0, deadLetterMessageCount: 0 } as never };
  const warehouse: TreeNode = { id: 'subscription-order-events-warehouse', name: 'warehouse', type: 'subscription', icon: 'mail', expandable: false, level: 2, data: { topicName: 'order-events', activeMessageCount: 12, deadLetterMessageCount: 0 } as never };
  const email: TreeNode = { id: 'subscription-order-events-email', name: 'email', type: 'subscription', icon: 'mail', expandable: false, level: 2, data: { topicName: 'order-events', activeMessageCount: 0, deadLetterMessageCount: 4 } as never };
  const orderEvents: TreeNode = {
    id: 'topic-order-events', name: 'order-events', type: 'topic', icon: 'topic', expandable: true, level: 1,
    data: { subscriptionCount: 2, patternDisplay: 'Fan-out' } as never, children: [warehouse, email]
  };
  const tree = (): TreeNode[] => [
    { id: 'category-queues', name: 'Queues', type: 'category', icon: 'folder', expandable: true, level: 0, children: [orders, invoices] },
    { id: 'category-topics', name: 'Topics', type: 'category', icon: 'folder', expandable: true, level: 0, children: [orderEvents] }
  ];

  function render(selected: TreeNode | null = null) {
    const select = vi.fn();
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => of(tree()) } },
        { provide: EntitySelectionService, useValue: { selection$: of(selected ? { node: selected } : null), treeRefresh$: NEVER, select } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal({ ...DEFAULT_AZURE_CAPABILITIES, supportsEntityUpdate: true }) } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, select };
  }
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const rows = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('.entity-tree button.tree-node'));
  const rowNames = (el: HTMLElement) => rows(el).map(r => text(r.querySelector('.node-name')));
  const typeFilter = (fixture: ReturnType<typeof render>['fixture'], value: string) => {
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[aria-label="Filter entities by name"]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  it('a topic starts closed; a click opens its subscriptions and selects it, and a second click hides them all again', () => {
    const { fixture, el, select } = render();
    const topic = () => rows(el).find(r => text(r.querySelector('.node-name')) === 'order-events')!;

    expect(rowNames(el), 'closed: no subscription under the topic').toStrictEqual(['orders', 'billing/invoices', 'order-events']);
    expect(topic().getAttribute('aria-expanded')).toBe('false');

    topic().click();
    fixture.detectChanges();
    expect(rowNames(el), 'open: its subscriptions under it').toStrictEqual(['orders', 'billing/invoices', 'order-events', 'warehouse', 'email']);
    expect(topic().getAttribute('aria-expanded')).toBe('true');
    expect(select, 'the click also selects the topic').toHaveBeenCalledWith(orderEvents);

    topic().click();
    fixture.detectChanges();
    expect(rowNames(el), 'a second click hides every subscription').toStrictEqual(['orders', 'billing/invoices', 'order-events']);
    expect(topic().getAttribute('aria-expanded')).toBe('false');
  });

  it('a subscription that is selected keeps its topic open, so the selected row is never hidden', () => {
    const { el } = render(email);

    expect(rowNames(el)).toContain('email');
  });

  it('has no "Entities" title over the tree: the head of the pane is the filter and Refresh entities', () => {
    const { el } = render();

    expect(el.querySelector('.tree-header h2'), 'an Entities heading in the tree header').toBeNull();
    expect(text(el.querySelector('.tree-header')), 'the words of the tree header').not.toContain('Entities');
    expect(el.querySelector('.tree-header button[aria-label="Refresh entities"]')).not.toBeNull();
  });

  it('the filter "Filter by name", labelled "Filter entities by name", keeps the rows whose name holds the text and says "N of M entities hidden by the filter"', () => {
    const { fixture, el } = render();
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Filter entities by name"]');
    expect(input, 'the filter field named "Filter entities by name"').not.toBeNull();
    expect(input!.placeholder).toBe('Filter by name');
    expect(el.querySelector('[aria-live="polite"].hidden-note'), 'no notice with nothing hidden').toBeNull();

    typeFilter(fixture, 'ORD');

    expect(rowNames(el), 'a topic that matches keeps all its subscriptions').toStrictEqual(['orders', 'order-events', 'warehouse', 'email']);
    expect(text(el.querySelector('[aria-live="polite"].hidden-note'))).toBe('1 of 5 entities hidden by the filter');

    typeFilter(fixture, 'mail');

    expect(rowNames(el), 'a subscription that matches brings its topic').toStrictEqual(['order-events', 'email']);
    expect(text(el.querySelector('[aria-live="polite"].hidden-note'))).toBe('3 of 5 entities hidden by the filter');
  });

  it('the sections are h2 heads "Queues 2" and "Topics 1" with their create button; only a topic opens and closes', () => {
    const { el } = render();

    expect(Array.from(el.querySelectorAll('.entity-tree h2.section-head')).map(text)).toStrictEqual(['Queues 2', 'Topics 1']);
    expect(Array.from(el.querySelectorAll('.entity-tree [aria-expanded]')).map(e => text(e.querySelector('.node-name'))), 'the only toggle is the topic row').toStrictEqual(['order-events']);
    expect(Array.from(el.querySelectorAll('.section .create-btn')).map(b => b.getAttribute('aria-label'))).toStrictEqual(['Create queue', 'Create topic']);
  });

  it('each entity row is one button, and the selected row says aria-current="true"', () => {
    const { el, select } = render(email);

    expect(rowNames(el)).toStrictEqual(['orders', 'billing/invoices', 'order-events', 'warehouse', 'email']);
    expect(rows(el).map(r => r.getAttribute('aria-current'))).toStrictEqual(['false', 'false', 'false', 'false', 'true']);
    rows(el)[2].click();
    expect(select).toHaveBeenCalledWith(orderEvents);
  });

  it('the badges say their count to assistive technology: ", 1,204 active messages" and ", 37 dead-letter messages"; a zero count shows no badge', () => {
    const { el } = render();
    const [ordersRow, invoicesRow] = rows(el);

    expect(Array.from(ordersRow.querySelectorAll('.count-chip .visually-hidden')).map(text)).toStrictEqual([', 1,204 active messages', ', 37 dead-letter messages']);
    expect(Array.from(ordersRow.querySelectorAll('.count-chip .count')).map(text)).toStrictEqual(['1,204', '37']);
    expect(ordersRow.querySelector('.count-chip.dead-letter mat-icon')?.getAttribute('fontIcon')).toBe('warning');
    expect(invoicesRow.querySelectorAll('.count-chip').length, 'badges on a queue with no messages').toBe(0);
  });

  it('the badge of a row follows the counts read for its entity with no click and no reload, for a queue and for a subscription', async () => {
    const { fixture, el } = render(warehouse);
    const counts = TestBed.inject(EntityCountsService);
    const badges = (name: string) => Array.from(rows(el).find(r => text(r.querySelector('.node-name')) === name)!.querySelectorAll('.count-chip .count')).map(text);
    expect([badges('orders'), badges('warehouse')], 'as loaded').toStrictEqual([['1,204', '37'], ['12']]);

    counts.put(EntityCountsService.key('orders'), { activeMessageCount: 1100, deadLetterMessageCount: 40 });
    counts.put(EntityCountsService.key('warehouse', 'order-events'), { activeMessageCount: 7, deadLetterMessageCount: 2 });
    await fixture.whenStable();

    expect([badges('orders'), badges('warehouse')], 'the counts just read').toStrictEqual([['1,100', '40'], ['7', '2']]);
  });

  it('reading the entities again forgets the counts read before, so a row never shows a number older than its load', async () => {
    const { fixture, el } = render();
    const counts = TestBed.inject(EntityCountsService);
    counts.put(EntityCountsService.key('orders'), { activeMessageCount: 1, deadLetterMessageCount: 1 });
    await fixture.whenStable();

    fixture.componentInstance.loadTree();
    await fixture.whenStable();

    expect(Array.from(rows(el)[0].querySelectorAll('.count-chip .count')).map(text)).toStrictEqual(['1,204', '37']);
  });

  it('an opened topic shows its subscriptions under it, and its row carries no count, only the chip of its pattern', () => {
    const { fixture, el } = render();
    const topicRow = rows(el)[2];
    topicRow.click();
    fixture.detectChanges();

    expect(Array.from(el.querySelectorAll('.tree-children button.tree-node .node-name')).map(text)).toStrictEqual(['warehouse', 'email']);
    expect(topicRow.querySelectorAll('.count-chip, .node-count').length, 'counts or chips on the topic row').toBe(0);
    expect(text(topicRow.querySelector('.node-name'))).toBe('order-events');
    expect(text(topicRow.querySelector('.pattern-chip')), 'the pattern the builder gave this topic').toBe('Fan-out');
  });
});

describe('EntitiesTreeComponent: a resubmit running on an entity', () => {
  afterEach(() => (activeRunOn = undefined));

  it('the row of a queue with an active run shows a spinner beside its dead-letter count; the other rows do not', () => {
    activeRunOn = 'orders';
    const orders: TreeNode = { id: 'queue-orders', name: 'orders', type: 'queue', icon: 'inbox', expandable: false, level: 1, data: { deadLetterMessageCount: 220012 } as never };
    const invoices: TreeNode = { id: 'queue-invoices', name: 'invoices', type: 'queue', icon: 'inbox', expandable: false, level: 1, data: { deadLetterMessageCount: 18 } as never };
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => of([{ id: 'category-queues', name: 'Queues', type: 'category', icon: 'folder', expandable: true, level: 0, children: [orders, invoices] }]) } },
        { provide: EntitySelectionService, useValue: { selection$: of(null), treeRefresh$: NEVER, select: vi.fn() } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_AZURE_CAPABILITIES) } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    const row = (name: string) => Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.tree-node')).find(r => r.querySelector('.node-name')?.textContent?.trim() === name)!;

    const chip = row('orders').querySelector('.count-chip.dead-letter')!;
    expect(chip.nextElementSibling?.matches('mat-progress-spinner.resubmit-spinner'), 'the spinner sits beside the dead-letter count').toBe(true);
    expect(row('orders').textContent, 'and is named for a screen reader').toContain(', resubmit running');
    expect(row('invoices').querySelector('.resubmit-spinner'), 'no run, no spinner').toBeNull();
  });
});

describe('EntitiesTreeComponent: status and forwarding markers', () => {
  function queue(name: string, status: string, forwardTo?: string | null): TreeNode {
    return { id: `queue-${name}`, name, type: 'queue', icon: 'inbox', expandable: false, level: 1, data: { activeMessageCount: 0, deadLetterMessageCount: 0, sizeInBytes: 0, status, forwardTo } };
  }

  function render() {
    const queues: TreeNode = {
      id: 'category-queues', name: 'Queues', type: 'category', icon: 'folder', expandable: true, level: 0,
      children: [
        queue('off', 'Disabled'), queue('no-send', 'SendDisabled'), queue('no-receive', 'ReceiveDisabled'),
        queue('relay', 'Active', 'orders-archive'), queue('plain', 'Active', ''), queue('runtime-only', ''), queue('rabbit', 'running')
      ]
    };
    const topics: TreeNode = {
      id: 'category-topics', name: 'Topics', type: 'category', icon: 'folder', expandable: true, level: 0,
      children: [{ id: 'topic-events', name: 'events', type: 'topic', icon: 'topic', expandable: false, level: 1, data: { subscriptionCount: 0, sizeInBytes: 0, status: 'SendDisabled' }, children: [] }]
    };
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => of([queues, topics]) } },
        { provide: EntitySelectionService, useValue: { selection$: of(null), treeRefresh$: NEVER, select: vi.fn() } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_AZURE_CAPABILITIES) } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    return fixture;
  }

  /** Each marker of the row named `name`, as its accessible name and its tooltip text. */
  function markersOf(fixture: ReturnType<typeof render>, name: string): string[] {
    return fixture.debugElement.queryAll(By.css('.tree-node'))
      .filter(row => row.query(By.css('.node-name'))?.nativeElement.textContent.trim() === name)
      .flatMap(row => row.queryAll(By.css('.node-marker')))
      .map(marker => `${marker.nativeElement.getAttribute('aria-label')} | ${marker.injector.get(MatTooltip).message}`);
  }

  it('a disabled, send-disabled or receive-disabled queue or topic and a forwarding queue show a marker named by its tooltip; an active, a runtime-only or a RabbitMQ status shows none', () => {
    const fixture = render();
    const off = 'Disabled: no message can be sent or received';
    const noSend = 'Send disabled: messages can be received, not sent';
    const noReceive = 'Receive disabled: messages can be sent, not received';
    const relay = 'Forwards every message to orders-archive';

    expect({
      off: markersOf(fixture, 'off'), noSend: markersOf(fixture, 'no-send'), noReceive: markersOf(fixture, 'no-receive'), relay: markersOf(fixture, 'relay'),
      plain: markersOf(fixture, 'plain'), runtimeOnly: markersOf(fixture, 'runtime-only'), rabbit: markersOf(fixture, 'rabbit'), topic: markersOf(fixture, 'events')
    }, 'Only the three disabled statuses and a forward target are marked, the forward target named in the tooltip').toEqual({
      off: [`${off} | ${off}`],
      noSend: [`${noSend} | ${noSend}`],
      noReceive: [`${noReceive} | ${noReceive}`],
      relay: [`${relay} | ${relay}`],
      plain: [], runtimeOnly: [], rabbit: [],
      topic: [`${noSend} | ${noSend}`]
    });
  });
});

describe('EntitiesTreeComponent: a topic whose subscriptions were not listed with it', () => {
  const warehouse: TreeNode = { id: 'subscription-order-events-warehouse', name: 'warehouse', type: 'subscription', icon: 'subscriptions', expandable: false, level: 2, data: { topicName: 'order-events', activeMessageCount: 4, deadLetterMessageCount: 2 } as never };
  const email: TreeNode = { id: 'subscription-order-events-email', name: 'email', type: 'subscription', icon: 'subscriptions', expandable: false, level: 2, data: { topicName: 'order-events', activeMessageCount: 6, deadLetterMessageCount: 0 } as never };
  const tree = (): TreeNode[] => [
    { id: 'category-queues', name: 'Queues', type: 'category', icon: 'folder', expandable: true, level: 0, children: [] },
    { id: 'category-topics', name: 'Topics', type: 'category', icon: 'folder', expandable: true, level: 0, children: [
      { id: 'topic-order-events', name: 'order-events', type: 'topic', icon: 'topic', expandable: false, level: 1, data: { subscriptionCount: 0 } as never, children: [] }
    ] }
  ];

  function render(loadSubscriptions: ReturnType<typeof vi.fn>) {
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => of(tree()), loadSubscriptions } },
        { provide: EntitySelectionService, useValue: { selection$: of(null), treeRefresh$: NEVER, select: vi.fn() } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_AZURE_CAPABILITIES) } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const names = () => Array.from(el.querySelectorAll('.entity-tree button.tree-node .node-name')).map(n => n.textContent?.trim());
    const topic = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.entity-tree button.tree-node')).find(b => b.textContent?.includes('order-events'))!;
    return { fixture, el, names, topic };
  }

  it('opening a topic whose count said no subscription, as the emulator answers, reads its subscriptions once and shows them under it', () => {
    const loadSubscriptions = vi.fn(() => of([warehouse, email]));
    const { fixture, names, topic } = render(loadSubscriptions);

    topic().click();
    fixture.detectChanges();
    expect(names()).toStrictEqual(['order-events', 'warehouse', 'email']);
    expect(loadSubscriptions).toHaveBeenCalledTimes(1);

    topic().click();
    fixture.detectChanges();
    topic().click();
    fixture.detectChanges();
    expect(loadSubscriptions, 'closing and opening again reads nothing more').toHaveBeenCalledTimes(1);
  });

  it('a topic left open when the tree is read again, by Refresh, reads its subscriptions again instead of showing none', () => {
    const loadSubscriptions = vi.fn(() => of([warehouse, email]));
    const { fixture, el, names, topic } = render(loadSubscriptions);
    topic().click();
    fixture.detectChanges();

    (el.querySelector('button[aria-label="Refresh entities"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(names()).toStrictEqual(['order-events', 'warehouse', 'email']);
    expect(loadSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('a read of the subscriptions that fails says so under the topic, never an empty topic, and the next opening tries again', () => {
    const loadSubscriptions = vi.fn().mockReturnValueOnce(throwError(() => new Error('503'))).mockReturnValue(of([warehouse]));
    const { fixture, el, names, topic } = render(loadSubscriptions);

    topic().click();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"].subscriptions-error')?.textContent?.trim()).toBe('Could not load the subscriptions of order-events.');

    topic().click();
    fixture.detectChanges();
    topic().click();
    fixture.detectChanges();
    expect(names()).toStrictEqual(['order-events', 'warehouse']);
    expect(el.querySelector('.subscriptions-error')).toBeNull();
  });
});

describe('EntitiesTreeComponent on a RabbitMQ connection names exchanges and bindings as RabbitMQ does', () => {
  const created: TreeNode = { id: 'subscription-orders-orders.created', name: 'orders.created', type: 'subscription', icon: 'subscriptions', expandable: false, level: 2,
    data: { topicName: 'orders', activeMessageCount: 4, deadLetterMessageCount: 0, routingKey: 'order.created' } as never };
  const tree = (): TreeNode[] => [
    { id: 'category-queues', name: 'Queues', type: 'category', icon: 'folder', expandable: true, level: 0, children: [
      { id: 'queue-orders.created', name: 'orders.created', type: 'queue', icon: 'inbox', expandable: false, level: 1, data: { activeMessageCount: 4, deadLetterMessageCount: 0 } as never }
    ] },
    { id: 'category-topics', name: 'Topics', type: 'category', icon: 'folder', expandable: true, level: 0, children: [
      { id: 'topic-orders', name: 'orders', type: 'topic', icon: 'topic', expandable: true, level: 1, data: { subscriptionCount: 1 } as never, children: [created] }
    ] }
  ];

  function render(provider: ProviderType, capabilities: Partial<typeof DEFAULT_AZURE_CAPABILITIES> = {}) {
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => of(tree()) } },
        { provide: EntitySelectionService, useValue: { selection$: of(null), treeRefresh$: NEVER, select: vi.fn() } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal({ ...DEFAULT_AZURE_CAPABILITIES, supportsEntityUpdate: true, ...capabilities }), selectedProvider: provider } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    (Array.from(el.querySelectorAll<HTMLButtonElement>('.entity-tree button.tree-node')).find(b => b.textContent?.includes('orders') && !b.textContent?.includes('created')))!.click();
    fixture.detectChanges();
    return el;
  }
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('a disconnection empties the tree on screen by itself, with nothing else to redraw it', async () => {
    const status$ = new Subject<{ connected: boolean }>();
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => of(tree()) } },
        { provide: EntitySelectionService, useValue: { selection$: NEVER, treeRefresh$: NEVER, select: vi.fn() } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: status$ } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_AZURE_CAPABILITIES), selectedProvider: ProviderType.AzureServiceBus } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.entity-tree button.tree-node').length, 'entities before').toBeGreaterThan(0);

    status$.next({ connected: false });
    await fixture.whenStable();

    expect(el.querySelectorAll('.entity-tree button.tree-node').length, 'no entity is left on screen').toBe(0);
  });

  it('a broker that reports no message counts shows no count beside a row, and one that reports them shows the count', () => {
    expect(render(ProviderType.AzureServiceBus, { supportsMessageCounts: false }).querySelectorAll('.count-chip').length).toBe(0);
    TestBed.resetTestingModule();
    expect(render(ProviderType.AzureServiceBus).querySelectorAll('.count-chip').length).toBeGreaterThan(0);
  });

  it('RabbitMQ: the section is Exchanges, create is "Create exchange" and "Create binding in orders", and a bound queue shows its routing key', () => {
    const el = render(ProviderType.RabbitMQ);

    expect(Array.from(el.querySelectorAll('.entity-tree h2.section-head')).map(text), 'the one queue is bound, so Queues lists none').toStrictEqual(['Queues 0', 'Exchanges 1']);
    expect(Array.from(el.querySelectorAll('.create-btn')).map(b => b.getAttribute('aria-label'))).toStrictEqual(['Create queue', 'Create exchange', 'Create binding in orders']);
    const bound = el.querySelector('.tree-children button.tree-node')!;
    expect(text(bound.querySelector('.node-name')), 'under orders the queue orders.created is shown without the name of its exchange').toBe('created');
    expect(bound.querySelector('.binding-key'), 'the row shows the queue, not a routing-key label').toBeNull();
  });

  it('an exchange and a queue that carry a pattern show it as a chip on their row; a row without one shows none', () => {
    const labelled = (): TreeNode[] => [
      { id: 'category-queues', name: 'Queues', type: 'category', icon: 'folder', expandable: true, level: 0, children: [
        { id: 'queue-tasks', name: 'tasks', type: 'queue', icon: 'inbox', expandable: false, level: 1, data: { activeMessageCount: 0, deadLetterMessageCount: 0, patternDisplay: 'Work queue, 3 consumers' } as never },
        { id: 'queue-plain', name: 'plain', type: 'queue', icon: 'inbox', expandable: false, level: 1, data: { activeMessageCount: 0, deadLetterMessageCount: 0 } as never }
      ] },
      { id: 'category-topics', name: 'Topics', type: 'category', icon: 'folder', expandable: true, level: 0, children: [
        { id: 'topic-orders.dlx', name: 'orders.dlx', type: 'topic', icon: 'topic', expandable: false, level: 1,
          data: { subscriptionCount: 0, patternDisplay: 'Pub/Sub', detectedPattern: { pattern: 'PubSub', confidence: 1, reason: 'Fanout exchange broadcasts to every bound queue' } } as never, children: [] }
      ] }
    ];
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => of(labelled()) } },
        { provide: EntitySelectionService, useValue: { selection$: of(null), treeRefresh$: NEVER, select: vi.fn() } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_RABBITMQ_CAPABILITIES), selectedProvider: ProviderType.RabbitMQ } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    const rows = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.entity-tree button.tree-node'));

    expect(rows.map(r => [text(r.querySelector('.node-name')), text(r.querySelector('.pattern-chip'))]))
      .toStrictEqual([['tasks', 'Work queue, 3 consumers'], ['plain', ''], ['orders.dlx', 'Pub/Sub']]);
  });

  it('RabbitMQ: a queue bound to an exchange is listed once, under the exchange; a queue with no binding is listed under Queues; Azure Service Bus lists a queue and a subscription of one name apart', () => {
    const withUnbound = (): TreeNode[] => {
      const [queues, topics] = tree();
      queues.children!.push({ id: 'queue-hello', name: 'hello', type: 'queue', icon: 'inbox', expandable: false, level: 1, data: { activeMessageCount: 1, deadLetterMessageCount: 0 } as never });
      return [queues, topics];
    };
    const listedUnderQueues = (provider: ProviderType) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [EntitiesTreeComponent],
        providers: [
          { provide: TreeDataBuilderService, useValue: { buildTree: () => of(withUnbound()) } },
          { provide: EntitySelectionService, useValue: { selection$: of(null), treeRefresh$: NEVER, select: vi.fn() } },
          { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
          resubmitRuns,
          { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
          { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
          { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_RABBITMQ_CAPABILITIES), selectedProvider: provider } },
          { provide: MatDialog, useValue: { open: vi.fn() } }
        ]
      });
      const fixture = TestBed.createComponent(EntitiesTreeComponent);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      return {
        queues: Array.from(el.querySelectorAll('.entity-tree > button.node-queue, .entity-tree > .tree-row > button.node-queue')).map(b => text(b.querySelector('.node-name'))),
        heads: Array.from(el.querySelectorAll('.entity-tree h2.section-head')).map(text)
      };
    };

    expect(listedUnderQueues(ProviderType.RabbitMQ)).toStrictEqual({ queues: ['hello'], heads: ['Queues 1', 'Exchanges 1'] });
    expect(listedUnderQueues(ProviderType.AzureServiceBus)).toStrictEqual({ queues: ['orders.created', 'hello'], heads: ['Queues 2', 'Topics 1'] });
  });

  it('RabbitMQ: the filter counts a bound queue once, as its binding', () => {
    const el = render(ProviderType.RabbitMQ);
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Filter entities by name"]')!;
    input.value = 'nothing-has-this-name';
    input.dispatchEvent(new Event('input'));
    TestBed.tick();

    expect(text(el.querySelector('.hidden-note')), 'one exchange and one binding, the queue not counted again').toBe('2 of 2 entities hidden by the filter');
  });

  it('RabbitMQ: a queue bound to one exchange with three routing keys is one row under it, named for the queue, with the keys in its name for assistive technology and in its tooltip', () => {
    const key = (routingKey: string): TreeNode => ({ id: `subscription-direct_logs-all-${routingKey}`, name: 'all', type: 'subscription', icon: 'subscriptions', expandable: false, level: 2,
      data: { topicName: 'direct_logs', activeMessageCount: 3, deadLetterMessageCount: 0, routingKey } as never });
    const errors: TreeNode = { id: 'subscription-direct_logs-errors', name: 'errors', type: 'subscription', icon: 'subscriptions', expandable: false, level: 2,
      data: { topicName: 'direct_logs', activeMessageCount: 1, deadLetterMessageCount: 0, routingKey: 'error' } as never };
    const threeKeys = (): TreeNode[] => {
      const exchange: TreeNode = { id: 'topic-direct_logs', name: 'direct_logs', type: 'topic', icon: 'topic', expandable: true, level: 1, data: { subscriptionCount: 4 } as never,
        children: [key('error'), key('info'), key('warning'), errors] };
      exchange.children!.forEach(child => (child.parent = exchange));
      return [
        { id: 'category-queues', name: 'Queues', type: 'category', icon: 'folder', expandable: true, level: 0, children: [
          { id: 'queue-all', name: 'all', type: 'queue', icon: 'inbox', expandable: false, level: 1, data: { activeMessageCount: 3, deadLetterMessageCount: 0 } as never },
          { id: 'queue-errors', name: 'errors', type: 'queue', icon: 'inbox', expandable: false, level: 1, data: { activeMessageCount: 1, deadLetterMessageCount: 0 } as never }
        ] },
        { id: 'category-topics', name: 'Topics', type: 'category', icon: 'folder', expandable: true, level: 0, children: [exchange] }
      ];
    };
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => of(threeKeys()) } },
        { provide: EntitySelectionService, useValue: { selection$: of(null), treeRefresh$: NEVER, select: vi.fn() } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_RABBITMQ_CAPABILITIES), selectedProvider: ProviderType.RabbitMQ } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    Array.from(el.querySelectorAll<HTMLButtonElement>('.entity-tree button.tree-node')).find(b => b.classList.contains('node-topic'))!.click();
    fixture.detectChanges();
    const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('.tree-children button.tree-node'));

    expect(rows.map(r => text(r.querySelector('.node-name'))), 'one row for each queue, not for each key').toStrictEqual(['all', 'errors']);
    expect(rows.map(r => r.getAttribute('aria-label'))).toStrictEqual([
      'Queue all, bound with the routing keys error, info, warning: open the queue',
      'Queue errors, bound with the routing key error: open the queue'
    ]);
    expect(el.querySelectorAll('.binding-key, .binding-arrow').length, 'no routing-key label on a row').toBe(0);
    expect(rows.map(r => Array.from(r.querySelectorAll('.count-chip .count')).map(text)), 'the counts of the queue, once').toStrictEqual([['3'], ['1']]);
    const tooltips = fixture.debugElement.queryAll(By.directive(MatTooltip)).map(d => d.injector.get(MatTooltip).message).filter(m => m.startsWith('Queue '));
    expect(tooltips).toStrictEqual(['Queue all. Routing keys: error, info, warning', 'Queue errors. Routing key: error']);
    expect(text(el.querySelector('.hidden-note')), 'no filter, nothing hidden').toBe('');
  });

  it('RabbitMQ: under an exchange a row is the queue that exchange is bound to; it shows the counts of its queue, a click opens that queue as a queue, and the row is then the selected one', () => {
    const select = vi.fn();
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => of(tree()) } },
        { provide: EntitySelectionService, useValue: { selection$: of(null), treeRefresh$: NEVER, select } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_RABBITMQ_CAPABILITIES), selectedProvider: ProviderType.RabbitMQ } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    Array.from(el.querySelectorAll<HTMLButtonElement>('.entity-tree button.tree-node')).find(b => b.classList.contains('node-topic'))!.click();
    fixture.detectChanges();
    select.mockClear();

    const binding = el.querySelector<HTMLButtonElement>('.tree-children button.tree-node')!;
    expect(binding.classList.contains('node-binding')).toBe(true);
    expect(text(binding.querySelector('.node-name'))).toBe('created');
    expect(binding.getAttribute('aria-label'), 'the name the broker has is still said').toBe('Queue orders.created, bound with the routing key order.created: open the queue');
    expect(Array.from(binding.querySelectorAll('.count-chip .count')).map(text), 'the counts of the queue, which is listed nowhere else').toStrictEqual(['4']);
    expect(binding.getAttribute('aria-current')).toBe('false');

    binding.click();
    expect(select).toHaveBeenCalledTimes(1);
    expect(select.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 'queue-orders.created', type: 'queue' }));
  });

  it('RabbitMQ: the binding row of the queue that is selected is the current row, and its exchange stays open', () => {
    const queueNode = tree()[0].children![0];
    TestBed.configureTestingModule({
      imports: [EntitiesTreeComponent],
      providers: [
        { provide: TreeDataBuilderService, useValue: { buildTree: () => of(tree()) } },
        { provide: EntitySelectionService, useValue: { selection$: of({ node: queueNode }), treeRefresh$: NEVER, select: vi.fn() } },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        resubmitRuns,
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { clear: () => undefined } },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_RABBITMQ_CAPABILITIES), selectedProvider: ProviderType.RabbitMQ } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(EntitiesTreeComponent);
    fixture.detectChanges();
    const binding = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.tree-children button.node-binding');

    expect(binding, 'the exchange of the selected queue is open').not.toBeNull();
    expect(binding!.getAttribute('aria-current')).toBe('true');
  });

  it('Azure Service Bus keeps Topics and subscriptions', () => {
    const el = render(ProviderType.AzureServiceBus);

    expect(Array.from(el.querySelectorAll('.entity-tree h2.section-head')).map(text)).toStrictEqual(['Queues 1', 'Topics 1']);
    expect(Array.from(el.querySelectorAll('.create-btn')).map(b => b.getAttribute('aria-label'))).toStrictEqual(['Create queue', 'Create topic', 'Create subscription in orders']);
  });
});
