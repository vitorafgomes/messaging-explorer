import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BehaviorSubject, NEVER, Subject, of, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import {
  ConnectionService, DeadLetterNotificationService, EntitySelectionService, LoggerService, TreeDataBuilderService
} from '../../core/services';
import { DEFAULT_AZURE_CAPABILITIES, DEFAULT_RABBITMQ_CAPABILITIES, ProviderService } from '../../core/services/provider.service';
import { ProviderCapabilities } from '../../core/models/provider.model';
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
