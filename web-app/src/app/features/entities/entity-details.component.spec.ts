import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BehaviorSubject, NEVER, of, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EntityDetailsComponent } from './entity-details.component';
import { ConnectionService, EntitySelectionService, QueueService, ResubmitRun, ResubmitRunService, SessionService, TopicService, TreeDataBuilderService } from '../../core/services';
import { EntitySelection, TreeNode } from '../../core/models';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { DEFAULT_AZURE_CAPABILITIES, DEFAULT_RABBITMQ_CAPABILITIES, ProviderService } from '../../core/services/provider.service';
import { ProviderCapabilities } from '../../core/models/provider.model';
import { ViewMessagesDialogComponent } from '../messages/view-messages-dialog.component';
import { SendMessageDialogComponent } from '../messages/send-message-dialog.component';
import { ContinuousResubmitDialogComponent } from '../messages/continuous-resubmit-dialog.component';
import { EntityFormDialogComponent } from './entity-form-dialog.component';
import { EntityStatusDialogComponent } from './entity-status-dialog.component';
import { DefinitionsService } from '../../core/services/definitions.service';
import { TopicCancelScheduledDialogComponent } from './topic-cancel-scheduled-dialog.component';
import { CancelScheduledDialogComponent } from '../messages/cancel-scheduled-dialog.component';
import { BulkOperationResultsDialogComponent } from '../../shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component';

let resubmitRun: ResubmitRun | undefined;
const resubmitRuns = { provide: ResubmitRunService, useValue: { find: () => resubmitRun } };

describe('EntityDetailsComponent purge confirmation', () => {
  let dialog: { open: ReturnType<typeof vi.fn> };

  function create(selection: EntitySelection) {
    dialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(false) }) };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: EntitySelectionService,
          useValue: { state$: of({ selection, loading: false, error: null }), currentSelection: selection, isLoading: false }
        },
        { provide: ConnectionService, useValue: { currentTarget: 'prod.example.net' } },
        { provide: QueueService, useValue: {} },
        { provide: TopicService, useValue: {} },
        { provide: SessionService, useValue: {} },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: MatDialog, useValue: dialog },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_AZURE_CAPABILITIES) } },
        resubmitRuns
      ]
    });
    return TestBed.runInInjectionContext(() => new EntityDetailsComponent());
  }

  const confirmation = () => {
    expect(dialog.open).toHaveBeenCalledTimes(1);
    const [component, config] = dialog.open.mock.calls[0];
    expect(component).toBe(ConfirmDialogComponent);
    return config.data;
  };

  it('Send on a queue passes its default time to live, formatted as the panel shows it, to the send dialog; a subscription sends to its topic without one', () => {
    const component = create({
      type: 'queue',
      node: { id: 'orders', name: 'orders', type: 'queue', icon: 'inbox', expandable: false, level: 1 },
      entity: { name: 'orders', defaultMessageTimeToLive: '14.00:00:00' } as never
    });
    component.sendMessage();
    expect(dialog.open.mock.calls[0][0]).toBe(SendMessageDialogComponent);
    expect(dialog.open.mock.calls[0][1].data, 'the queue time to live reaches the send dialog').toStrictEqual({ entityType: 'queue', entityName: 'orders', defaultTimeToLive: '14d' });

    TestBed.resetTestingModule();
    const onSubscription = create({
      type: 'subscription',
      node: { id: 'events/billing', name: 'billing', type: 'subscription', icon: 'mail', expandable: false, level: 2, data: { topicName: 'events' } as never },
      entity: { topicName: 'events', name: 'billing', defaultMessageTimeToLive: '1.00:00:00' } as never
    });
    onSubscription.sendMessage();
    expect(dialog.open.mock.calls[0][1].data, 'the subscription time to live is not the topic one').toStrictEqual({ entityType: 'topic', entityName: 'events' });
  });

  describe('the purge confirmation names the entity, its parent, the connection and the live count', () => {
    it('for a queue: the queue, the connection target and the count, confirmed by typing the queue name', () => {
      const component = create({
        type: 'queue',
        node: { id: 'orders', name: 'orders', type: 'queue', icon: 'inbox', expandable: false, level: 1 },
        entity: { name: 'orders', activeMessageCount: 120, deadLetterMessageCount: 7 } as never
      });

      component.purgeMessages('active');

      const data = confirmation();
      expect(data.title).toBe('Purge active messages?');
      expect(data.message).toBe('This deletes every active message in queue "orders" on prod.example.net: 120 when the queue was loaded. It cannot be undone.');
      expect(data.confirmText).toBe('Purge 120 messages');
      expect(data.typedName, 'a purge is confirmed by typing the queue name').toBe('orders');
      expect(data.typedLabel).toBe('Type the queue name to confirm');
      expect(data.context, 'the purge confirmation draws the environment line of orders on the active connection').toStrictEqual({ subject: 'orders' });
    });

    it('for a subscription: the subscription, its topic, the connection target and the live count instead of the snapshot', () => {
      const component = create({
        type: 'subscription',
        node: { id: 'events/billing', name: 'billing', type: 'subscription', icon: 'mail', expandable: false, level: 2, data: { topicName: 'events' } as never },
        entity: { topicName: 'events', name: 'billing', activeMessageCount: 5, deadLetterMessageCount: 2 } as never
      });
      component.liveActiveCount.set(42);
      component.liveDeadLetterCount.set(9);

      component.purgeMessages('deadletter');

      const data = confirmation();
      expect(data.title).toBe('Purge dead-letter messages?');
      expect(data.message).toBe('This deletes every dead-letter message in subscription "billing" of topic "events" on prod.example.net: 9 now. It cannot be undone.');
      expect(data.confirmText).toBe('Purge 9 messages');
      expect(data.typedName, 'a purge is confirmed by typing the subscription name').toBe('billing');
      expect(data.typedLabel).toBe('Type the subscription name to confirm');
    });
  });
});

describe('EntityDetailsComponent panels', () => {
  const NO_DEAD_LETTER: ProviderCapabilities = { ...DEFAULT_AZURE_CAPABILITIES, supportsDeadLetterQueue: false };

  function render(selection: EntitySelection, capabilities: ProviderCapabilities | null = DEFAULT_AZURE_CAPABILITIES): HTMLElement {
    TestBed.configureTestingModule({
      imports: [EntityDetailsComponent],
      providers: [
        {
          provide: EntitySelectionService,
          useValue: { state$: of({ selection, loading: false, error: null }), currentSelection: selection, isLoading: false }
        },
        { provide: ConnectionService, useValue: { currentTarget: 'prod.example.net' } },
        { provide: QueueService, useValue: {} },
        { provide: TopicService, useValue: { getSubscription: () => NEVER } },
        { provide: SessionService, useValue: {} },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities), getSelectedProviderDisplayName: () => 'RabbitMQ' } },
        resubmitRuns
      ]
    });
    const fixture = TestBed.createComponent(EntityDetailsComponent);
    fixture.detectChanges();
    const propertiesTab = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]')).find(t => t.textContent?.trim() === 'Properties');
    if (selection.type === 'topic' && propertiesTab) {
      propertiesTab.click();
      fixture.detectChanges();
      fixture.detectChanges();
    }
    return fixture.nativeElement as HTMLElement;
  }

  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const all = (el: HTMLElement, selector: string) => Array.from(el.querySelectorAll(selector)).map(text);
  const property = (el: HTMLElement, label: string) => {
    const row = Array.from(el.querySelectorAll('.property')).find(p => text(p.querySelector('.property-label')) === label);
    return row ? text(row.querySelector('.property-value')) : undefined;
  };
  const section = (el: HTMLElement, header: string) => {
    const box = Array.from(el.querySelectorAll('.form-section')).find(b => text(b.querySelector('.section-header')) === header);
    return box ? text(box.querySelector('.property-value')) : undefined;
  };
  const infoRow = (el: HTMLElement, label: string) => {
    const row = Array.from(el.querySelectorAll('.info-table tr')).find(r => text(r.querySelector('.label-cell')) === label);
    return row ? text(row.querySelector('.value-cell')) : undefined;
  };
  const statCard = (el: HTMLElement, label: string) => {
    const card = Array.from(el.querySelectorAll('.stat-card')).find(c => text(c.querySelector('.stat-label')) === label);
    return card ? text(card.querySelector('.stat-value')) : undefined;
  };

  const queue = (entity: object): EntitySelection => ({
    type: 'queue',
    node: { id: 'orders', name: 'orders', type: 'queue', icon: 'inbox', expandable: false, level: 1 },
    entity: { name: 'orders', activeMessageCount: 120, deadLetterMessageCount: 7, scheduledMessageCount: 2, sizeInBytes: 2048, ...entity } as never
  });
  const topic = (entity: object): EntitySelection => ({
    type: 'topic',
    node: { id: 'events', name: 'events', type: 'topic', icon: 'topic', expandable: true, level: 1 },
    entity: { name: 'events', ...entity } as never
  });
  const subscription = (entity: object): EntitySelection => ({
    type: 'subscription',
    node: { id: 'events/billing', name: 'billing', type: 'subscription', icon: 'mail', expandable: false, level: 2, data: { topicName: 'events' } as never },
    entity: { topicName: 'events', name: 'billing', activeMessageCount: 5, deadLetterMessageCount: 3, rules: [], ...entity } as never
  });

  const fullTopic = {
    status: 'Active',
    maxSizeInMegabytes: 2048,
    defaultMessageTimeToLive: '14.00:00:00',
    autoDeleteOnIdle: '7.00:00:00',
    requiresDuplicateDetection: true,
    duplicateDetectionHistoryTimeWindow: '00:10:00',
    enableBatchedOperations: true,
    enablePartitioning: false,
    supportOrdering: true,
    enableExpress: false,
    userMetadata: 'owned by billing',
    createdAt: '2026-01-02T03:04:05Z'
  };

  it('the topic panel looks editable and saves nothing: the topic properties have no editable control, only the values as text', () => {
    const el = render(topic(fullTopic));

    expect(el.querySelectorAll('input, textarea, select, [contenteditable]').length).toBe(0);
    expect(property(el, 'Status')).toBe('Active');
    expect(property(el, 'Max Size')).toBe('2,048 MB');
    expect(property(el, 'Message Time To Live')).toBe('14d');
    expect(property(el, 'Auto Delete On Idle')).toBe('7d');
    expect(property(el, 'Duplicate Detection')).toBe('Enabled, window 10m');
    expect(property(el, 'Batched Operations')).toBe('Enabled');
    expect(property(el, 'Partitioning')).toBe('Disabled');
    expect(property(el, 'Support Ordering')).toBe('Enabled');
    expect(property(el, 'User Metadata')).toBe('owned by billing');
    expect(property(el, 'Created At (UTC)')).toBe('Jan 2, 2026, 3:04:05 AM');
    expect(text(el)).not.toContain('Express');
    expect(text(el)).not.toContain('Filter Before Publish');
  });

  it('the metrics dashboard draws random numbers: no topic or subscription panel renders a metrics dashboard or a metrics tab', () => {
    for (const selection of [topic(fullTopic), subscription({})]) {
      const el = render(selection);

      expect(el.querySelector('app-metrics-dashboard')).toBeNull();
      expect(el.querySelector('apx-chart')).toBeNull();
      expect(el.querySelector('#topic-metrics-tab')).toBeNull();
      expect(el.querySelector('#subscription-metrics-tab')).toBeNull();
      TestBed.resetTestingModule();
    }
  });

  describe('a feature the broker lacks is hidden, and all three stay visible on Azure', () => {
    it('sessions: a broker without sessions shows the Sessions tab of a session subscription disabled; Azure shows it enabled', () => {
      const el = render(subscription({ requiresSession: true }), DEFAULT_RABBITMQ_CAPABILITIES);
      const tab = Array.from(el.querySelectorAll('button')).find(b => text(b) === 'Sessions');
      expect(tab?.getAttribute('aria-disabled'), 'shown disabled, not hidden').toBe('true');
      TestBed.resetTestingModule();
      expect(all(render(subscription({ requiresSession: true }), DEFAULT_AZURE_CAPABILITIES), 'button')).toContain('Sessions');
    });

    it('scheduled: a broker without scheduled messages hides the Scheduled card of a queue; Azure shows it', () => {
      expect(all(render(queue({}), DEFAULT_RABBITMQ_CAPABILITIES), '.stat-label')).not.toContain('Scheduled');
      TestBed.resetTestingModule();
      expect(all(render(queue({}), DEFAULT_AZURE_CAPABILITIES), '.stat-label')).toContain('Scheduled');
    });

    it('the six cards of a queue on Azure, even when every count is 0: Active, Dead-letter, Scheduled, Transfer, Transfer dead-letter and Size', () => {
      const el = render(queue({ transferMessageCount: 0, transferDeadLetterMessageCount: 0 }), DEFAULT_AZURE_CAPABILITIES);
      expect(all(el, '.stat-label')).toEqual(['Active', 'Dead-letter', 'Scheduled', 'Transfer', 'Transfer dead-letter', 'Size']);
    });

    it('the Transfer card counts the messages on their way to the forward target, with "Waiting to be forwarded"', () => {
      const el = render(queue({ transferMessageCount: 6 }), DEFAULT_AZURE_CAPABILITIES);
      const card = Array.from(el.querySelectorAll('.stat-card')).find(c => text(c.querySelector('.stat-label')) === 'Transfer')!;
      expect(Array.from(card.children).map(text)).toStrictEqual(['Transfer', '6', 'Waiting to be forwarded']);
    });

    it('a subscription on Azure shows Active, Dead-letter, Transfer and Transfer dead-letter', () => {
      const el = render(subscription({}), DEFAULT_AZURE_CAPABILITIES);
      expect(all(el, '.stat-label')).toEqual(['Active', 'Dead-letter', 'Transfer', 'Transfer dead-letter']);
    });

    it('RabbitMQ, which forwards nothing, shows neither Transfer card', () => {
      const el = render(queue({ transferMessageCount: 3, transferDeadLetterMessageCount: 2 }), DEFAULT_RABBITMQ_CAPABILITIES);
      expect(all(el, '.stat-label')).not.toContain('Transfer');
      expect(all(el, '.stat-label')).not.toContain('Transfer dead-letter');
    });

    it('RabbitMQ, which declares no safe delete or move, still offers Auto resubmit on a queue with dead-letter messages', () => {
      const el = render(queue({ deadLetterMessageCount: 2 }), DEFAULT_RABBITMQ_CAPABILITIES);
      expect(el.querySelector('.auto-resubmit')).not.toBeNull();
    });

    it('dead letter: a broker without a dead-letter queue hides the Dead Letter cards and Auto Resubmit of a queue and a subscription; Azure shows them', () => {
      const hiddenQueue = render(queue({ transferDeadLetterMessageCount: 4 }), NO_DEAD_LETTER);
      expect(all(hiddenQueue, '.stat-label')).toEqual(['Active', 'Scheduled', 'Transfer', 'Size']);
      expect(all(hiddenQueue, 'button').some(b => b.startsWith('Auto resubmit'))).toBe(false);
      TestBed.resetTestingModule();
      const hiddenSubscription = render(subscription({}), NO_DEAD_LETTER);
      expect(all(hiddenSubscription, '.stat-label')).not.toContain('Dead-letter');
      expect(all(hiddenSubscription, 'button').some(b => b.startsWith('Auto resubmit'))).toBe(false);
      TestBed.resetTestingModule();

      const shownQueue = render(queue({ transferDeadLetterMessageCount: 4 }), DEFAULT_AZURE_CAPABILITIES);
      expect(all(shownQueue, '.stat-label')).toEqual(['Active', 'Dead-letter', 'Scheduled', 'Transfer', 'Transfer dead-letter', 'Size']);
      expect(all(shownQueue, 'button')).toContain('Auto resubmit');
      TestBed.resetTestingModule();
      const shownSubscription = render(subscription({}), DEFAULT_AZURE_CAPABILITIES);
      expect(all(shownSubscription, '.stat-label')).toContain('Dead-letter');
      expect(all(shownSubscription, 'button')).toContain('Auto resubmit');
    });
  });

  describe('the dead-letter entry shows the run of its entity', () => {
    afterEach(() => (resubmitRun = undefined));

    it('while a run is active on the queue, the Auto Resubmit entry shows how far it got, even once the count reads 0', () => {
      const stop = vi.fn();
      resubmitRun = { isActive: () => true, progress: signal({ status: 'running', read: 480_000, total: 700_000 }), stop } as unknown as ResubmitRun;

      const el = render(queue({ deadLetterMessageCount: 0 }));

      expect(text(el.querySelector('.run-line .run-progress')), 'as the queue panel draws it, with the numbers grouped').toBe('Resubmit running: 480,000 of 700,000');
      expect(el.querySelector('.run-line mat-progress-spinner'), 'a spinner beside it').not.toBeNull();
      expect(all(el, '.run-line button')).toStrictEqual(['Open run', 'Stop']);
      expect(all(el, 'button').some(b => b.startsWith('Auto resubmit'))).toBe(false);
      Array.from(el.querySelectorAll<HTMLButtonElement>('.run-line button')).find(b => text(b) === 'Stop')!.click();
      expect(stop, 'Stop on the queue panel stops the run the way the dialog does').toHaveBeenCalledWith();
    });

    it('a finished run leaves the entry as it was', () => {
      resubmitRun = { isActive: () => false, progress: signal({ status: 'completed', read: 700, total: 700 }) } as unknown as ResubmitRun;

      expect(all(render(queue({})), 'button')).toContain('Auto resubmit');
    });
  });

  describe('create, edit and status are not visible unless the capability is explicitly true', () => {
    const { supportsEntityUpdate: _, ...WITHOUT_FLAG } = DEFAULT_AZURE_CAPABILITIES;
    const ENABLED: ProviderCapabilities = { ...DEFAULT_AZURE_CAPABILITIES, supportsEntityUpdate: true };
    const admin = (el: HTMLElement) => ({
      status: text(el.querySelector('app-entity-admin-actions button.status-chip')),
      buttons: all(el, 'app-entity-admin-actions button:not(.status-chip)')
    });

    it('with the capability, the queue, topic and subscription panels show the status chip, which opens Change status, and Edit', () => {
      expect(admin(render(queue({ status: 'Active' }), ENABLED))).toStrictEqual({ status: 'Active', buttons: ['Edit'] });
      TestBed.resetTestingModule();
      expect(admin(render(topic({ ...fullTopic, status: 'SendDisabled' }), ENABLED))).toStrictEqual({ status: 'Send disabled', buttons: ['Edit'] });
      TestBed.resetTestingModule();
      expect(admin(render(subscription({ status: 'ReceiveDisabled' }), ENABLED))).toStrictEqual({ status: 'Receive disabled', buttons: ['Edit'] });
    });

    it('on RabbitMQ, and on an API that does not send the flag, no panel shows a status chip, Edit or Status', () => {
      for (const capabilities of [DEFAULT_RABBITMQ_CAPABILITIES, WITHOUT_FLAG as ProviderCapabilities, null]) {
        for (const selection of [queue({ status: 'Active' }), topic(fullTopic), subscription({ status: 'Active' })]) {
          const el = render(selection, capabilities);
          expect(el.querySelectorAll('app-entity-admin-actions *').length, 'elements rendered by the administration actions').toBe(0);
          expect(all(el, 'button').filter(b => /Edit|Status/.test(b))).toStrictEqual([]);
          TestBed.resetTestingModule();
        }
      }
    });
  });

  describe('the Rules tab of a subscription shows the rules table, editable only when the API explicitly says supportsSubscriptionRules', () => {
    const rules = [
      { name: 'physical-goods', filterType: 'Sql', sqlExpression: 'total > 0', correlation: null, sqlAction: null },
      { name: '$Default', filterType: 'True', sqlExpression: null, correlation: null, sqlAction: null }
    ];
    const rulesTab = (el: HTMLElement) => el.querySelector('#subscription-rules-tab app-subscription-rules')!;
    const ruleRows = (el: HTMLElement) => Array.from(rulesTab(el).querySelectorAll('tr.rule-row')).map(r => text(r.querySelector('td')));

    it('with the capability: the rules with their filter type, Add rule, and Edit and Delete per rule', () => {
      const el = render(subscription({ rules }), { ...DEFAULT_AZURE_CAPABILITIES, supportsSubscriptionRules: true });

      expect(ruleRows(el)).toStrictEqual(['physical-goods', '$Default']);
      expect(Array.from(rulesTab(el).querySelectorAll('mat-chip')).map(text)).toStrictEqual(['SQL', 'True']);
      expect(Array.from(rulesTab(el).querySelectorAll('button')).map(b => b.getAttribute('aria-label') ?? text(b))).toStrictEqual([
        'addAdd rule', 'Edit rule physical-goods', 'Delete rule physical-goods', 'Edit rule $Default', 'Delete rule $Default'
      ]);
    });

    it('on RabbitMQ, on an API that does not send the flag and with no answer yet: the same rules, read-only, no button', () => {
      const { supportsSubscriptionRules: _, ...withoutFlag } = DEFAULT_AZURE_CAPABILITIES;
      for (const capabilities of [DEFAULT_RABBITMQ_CAPABILITIES, withoutFlag as ProviderCapabilities, null]) {
        const el = render(subscription({ rules }), capabilities);
        expect(ruleRows(el)).toStrictEqual(['physical-goods', '$Default']);
        expect(rulesTab(el).querySelectorAll('button').length, 'buttons in the rules tab').toBe(0);
        TestBed.resetTestingModule();
      }
    });

    it('the old rule cards are gone: the tab renders only the rules table', () => {
      const el = render(subscription({ rules }));

      expect(el.querySelector('#subscription-rules-tab .rule-card')).toBeNull();
      expect(el.querySelector('#subscription-rules-tab')!.children.length).toBe(1);
    });
  });

  describe('the queue panel shows what the API returns', () => {
    it('the queue panel shows status, dates, forward targets, auto delete, duplicate detection and metadata', () => {
      const el = render(queue({
        status: 'Active',
        createdAt: '2026-01-02T03:04:05Z',
        updatedAt: '2026-02-03T04:05:06Z',
        accessedAt: '2026-03-04T05:06:07Z',
        deadLetteringOnMessageExpiration: true,
        autoDeleteOnIdle: '7.00:00:00',
        forwardTo: 'orders-archive',
        forwardDeadLetteredMessagesTo: 'orders-failed',
        requiresDuplicateDetection: true,
        duplicateDetectionHistoryTimeWindow: '00:10:00',
        userMetadata: 'owned by billing',
        transferDeadLetterMessageCount: 4
      }));

      expect(property(el, 'Status')).toBe('Active');
      expect(property(el, 'Created At (UTC)')).toBe('Jan 2, 2026, 3:04:05 AM');
      expect(property(el, 'Updated At (UTC)')).toBe('Feb 3, 2026, 4:05:06 AM');
      expect(property(el, 'Accessed At (UTC)')).toBe('Mar 4, 2026, 5:06:07 AM');
      expect(property(el, 'Dead-lettering On Expiration')).toBe('Enabled');
      expect(property(el, 'Auto Delete On Idle')).toBe('7d');
      expect(property(el, 'Forward To')).toBe('orders-archive');
      expect(property(el, 'Forward Dead-lettered To')).toBe('orders-failed');
      expect(property(el, 'Duplicate Detection')).toBe('Enabled, window 10m');
      expect(property(el, 'User Metadata')).toBe('owned by billing');
      expect(statCard(el, 'Transfer dead-letter')).toBe('4');
    });

    it('a value the API did not send is "Not set", not 0 or false, and a zero transfer dead-letter count still shows its card with 0', () => {
      const el = render(queue({ transferDeadLetterMessageCount: 0 }));

      for (const label of ['Lock Duration', 'Message TTL', 'Status', 'Created At (UTC)', 'Updated At (UTC)', 'Accessed At (UTC)', 'Dead-lettering On Expiration',
        'Auto Delete On Idle', 'Forward To', 'Forward Dead-lettered To', 'Duplicate Detection', 'User Metadata']) {
        expect(property(el, label), label).toBe('Not set');
      }
      expect(statCard(el, 'Transfer dead-letter')).toBe('0');
    });

    it('duplicate detection that is off says Disabled, without a window', () => {
      const el = render(queue({ requiresDuplicateDetection: false, duplicateDetectionHistoryTimeWindow: '00:10:00', deadLetteringOnMessageExpiration: false }));

      expect(property(el, 'Duplicate Detection')).toBe('Disabled');
      expect(property(el, 'Dead-lettering On Expiration')).toBe('Disabled');
    });
  });

  describe('durations are read from the TimeSpan strings the API sends', () => {
    const NEVER = '10675199.02:48:05.4775807';

    it('a queue lock duration, TTL and auto delete sent as d.hh:mm:ss show the right duration; the max TimeSpan shows as Never', () => {
      const el = render(queue({ lockDuration: '00:00:45', defaultMessageTimeToLive: '14.00:00:00', autoDeleteOnIdle: NEVER }));

      expect(property(el, 'Lock Duration')).toBe('45s');
      expect(property(el, 'Message TTL')).toBe('14d');
      expect(property(el, 'Auto Delete On Idle')).toBe('Never');
    });

    it('a subscription lock duration, TTL and auto delete sent as d.hh:mm:ss show the right duration; the max TimeSpan shows as Never', () => {
      const el = render(subscription({ lockDuration: '00:30:00', defaultMessageTimeToLive: '1.02:03:04.5000000', autoDeleteOnIdle: NEVER }));

      expect(section(el, 'Lock Duration')).toBe('30m');
      expect(section(el, 'Default Message Time To Live')).toBe('1d 2h 3m 4.5s');
      expect(section(el, 'Auto Delete On Idle')).toBe('Never');
    });

    it('a subscription that did not send its durations shows Not set, not a made-up minute or Never', () => {
      const el = render(subscription({}));

      expect(section(el, 'Lock Duration')).toBe('Not set');
      expect(section(el, 'Default Message Time To Live')).toBe('Not set');
      expect(section(el, 'Auto Delete On Idle')).toBe('Not set');
    });

    it('the topic rows say Never for the max TimeSpan too, so the three panels agree', () => {
      const el = render(topic({ defaultMessageTimeToLive: NEVER, autoDeleteOnIdle: NEVER }));

      expect(property(el, 'Message Time To Live')).toBe('Never');
      expect(property(el, 'Auto Delete On Idle')).toBe('Never');
    });
  });

  describe('subscription dates are UTC as labelled', () => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    const originalTz = env['TZ'];
    beforeAll(() => { env['TZ'] = 'America/New_York'; });
    afterAll(() => {
      if (originalTz === undefined) delete env['TZ'];
      else env['TZ'] = originalTz;
    });

    it('the subscription info table shows Created, Updated and Accessed in UTC, whatever the local time zone', () => {
      expect(new Date('2026-07-02T03:04:05Z').getHours()).toBe(23);
      const el = render(subscription({
        createdAt: '2026-07-02T03:04:05Z',
        updatedAt: '2026-07-03T04:05:06Z',
        accessedAt: '2026-07-04T05:06:07Z'
      }));

      expect(infoRow(el, 'Created At (UTC)')).toBe('Jul 2, 2026, 3:04:05 AM');
      expect(infoRow(el, 'Updated At (UTC)')).toBe('Jul 3, 2026, 4:05:06 AM');
      expect(infoRow(el, 'Accessed At (UTC)')).toBe('Jul 4, 2026, 5:06:07 AM');
    });

    it('a subscription date the API did not send is Not set', () => {
      expect(infoRow(render(subscription({})), 'Created At (UTC)')).toBe('Not set');
    });
  });
});

describe('EntityDetailsComponent opens the messages dialog on the transfer dead-letter queue and on the scheduled messages', () => {
  let open: ReturnType<typeof vi.fn>;
  const selection: EntitySelection = {
    type: 'queue',
    node: { id: 'orders', name: 'orders', type: 'queue', icon: 'inbox', expandable: false, level: 1 },
    entity: { name: 'orders', activeMessageCount: 120, deadLetterMessageCount: 7, scheduledMessageCount: 2, transferDeadLetterMessageCount: 4, sizeInBytes: 2048 } as never
  };

  function render(capabilities: ProviderCapabilities) {
    TestBed.configureTestingModule({
      imports: [EntityDetailsComponent],
      providers: [
        { provide: EntitySelectionService, useValue: { state$: of({ selection, loading: false, error: null }), currentSelection: selection, isLoading: false } },
        { provide: ConnectionService, useValue: { currentTarget: 'prod.example.net' } },
        { provide: QueueService, useValue: {} },
        { provide: TopicService, useValue: {} },
        { provide: SessionService, useValue: {} },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } },
        resubmitRuns
      ]
    });
    const fixture = TestBed.createComponent(EntityDetailsComponent);
    open = vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open').mockReturnValue({ afterClosed: () => NEVER } as never) as unknown as ReturnType<typeof vi.fn>;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const card = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll<HTMLElement>('.stat-card')).find(c => c.querySelector('.stat-label')?.textContent?.trim() === label)!;
  const openedWith = () => {
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(ViewMessagesDialogComponent);
    return open.mock.calls[0][1].data;
  };

  it('with the API saying supportsTransferDeadLetter, the Transfer Dead Letter card is a button that opens the dialog on that tab, by click or by Enter', () => {
    const el = render({ ...DEFAULT_AZURE_CAPABILITIES, supportsTransferDeadLetter: true });
    const transfer = card(el, 'Transfer dead-letter');
    expect(transfer.getAttribute('role')).toBe('button');
    expect(transfer.getAttribute('tabindex')).toBe('0');
    expect(transfer.getAttribute('aria-label')).toBe('View the 4 transfer dead-letter messages');

    transfer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    const data = openedWith();
    expect(data.initialTab).toBe(2);
    expect(data.transferDeadLetterMessageCount).toBe(4);
    expect(data.entityName).toBe('orders');
  });

  it('without the flag, the Transfer Dead Letter card shows its count and opens nothing', () => {
    const el = render(DEFAULT_AZURE_CAPABILITIES);
    const transfer = card(el, 'Transfer dead-letter');
    expect(transfer.getAttribute('role')).toBeNull();

    transfer.click();

    expect(open).not.toHaveBeenCalled();
  });

  it('the Scheduled card opens the dialog on the Active tab filtered to the scheduled messages', () => {
    const el = render(DEFAULT_AZURE_CAPABILITIES);
    const scheduledCard = card(el, 'Scheduled');
    expect(scheduledCard.getAttribute('aria-label')).toBe('View the 2 scheduled messages');

    scheduledCard.click();

    const data = openedWith();
    expect(data.initialTab).toBe(0);
    expect(data.initialStateFilter).toBe('Scheduled');
  });
});

describe('EntityDetailsComponent: the subscription panel has a Transfer Dead Letter card like the queue panel', () => {
  let open: ReturnType<typeof vi.fn>;
  const subscription = (transferDeadLetterMessageCount: number): EntitySelection => ({
    type: 'subscription',
    node: { id: 'events/billing', name: 'billing', type: 'subscription', icon: 'mail', expandable: false, level: 2, data: { topicName: 'events' } as never },
    entity: { topicName: 'events', name: 'billing', activeMessageCount: 5, deadLetterMessageCount: 3, transferDeadLetterMessageCount, rules: [] } as never
  });

  function render(selection: EntitySelection, capabilities: ProviderCapabilities) {
    TestBed.configureTestingModule({
      imports: [EntityDetailsComponent],
      providers: [
        { provide: EntitySelectionService, useValue: { state$: of({ selection, loading: false, error: null }), currentSelection: selection, isLoading: false } },
        { provide: ConnectionService, useValue: { currentTarget: 'prod.example.net' } },
        { provide: QueueService, useValue: {} },
        { provide: TopicService, useValue: { getSubscription: () => NEVER } },
        { provide: SessionService, useValue: {} },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } },
        resubmitRuns
      ]
    });
    const fixture = TestBed.createComponent(EntityDetailsComponent);
    open = vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open').mockReturnValue({ afterClosed: () => NEVER } as never) as unknown as ReturnType<typeof vi.fn>;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const card = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('.metric-card'))
    .find(c => c.querySelector('.stat-label')?.textContent?.trim() === 'Transfer dead-letter');

  it('with the API saying supportsTransferDeadLetter, the card shows the count and opens the dialog on the transfer tab, by click or by Enter', () => {
    const el = render(subscription(4), { ...DEFAULT_AZURE_CAPABILITIES, supportsTransferDeadLetter: true });
    const transfer = card(el)!;
    expect(transfer.querySelector('.metric-value')?.textContent?.trim()).toBe('4');
    expect(transfer.getAttribute('role')).toBe('button');
    expect(transfer.getAttribute('tabindex')).toBe('0');
    expect(transfer.getAttribute('aria-label')).toBe('View the 4 transfer dead-letter messages');

    transfer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(ViewMessagesDialogComponent);
    const data = open.mock.calls[0][1].data;
    expect(data.initialTab).toBe(2);
    expect(data.transferDeadLetterMessageCount).toBe(4);
    expect(data.entityType).toBe('subscription');
    expect(data.topicName).toBe('events');
  });

  it('without the flag, the card shows its count and opens nothing', () => {
    const el = render(subscription(4), DEFAULT_AZURE_CAPABILITIES);
    const transfer = card(el)!;
    expect(transfer.querySelector('.metric-value')?.textContent?.trim()).toBe('4');
    expect(transfer.getAttribute('role')).toBeNull();

    transfer.click();

    expect(open).not.toHaveBeenCalled();
  });

  it('a zero count still shows the card with 0, as Main.dc.html draws every count card', () => {
    const el = render(subscription(0), { ...DEFAULT_AZURE_CAPABILITIES, supportsTransferDeadLetter: true });

    expect(card(el)?.querySelector('.metric-value')?.textContent?.trim()).toBe('0');
  });
});

describe('EntityDetailsComponent: the Sessions tab on the queue panel and the subscription panel', () => {
  let state$: BehaviorSubject<{ selection: EntitySelection; loading: boolean; error: null }>;
  let list: ReturnType<typeof vi.fn>;

  const queue = (name: string, requiresSession: boolean): EntitySelection => ({
    type: 'queue',
    node: { id: name, name, type: 'queue', icon: 'inbox', expandable: false, level: 1 },
    entity: { name, activeMessageCount: 3, deadLetterMessageCount: 0, scheduledMessageCount: 0, sizeInBytes: 0, requiresSession } as never
  });
  const subscription = (name: string): EntitySelection => ({
    type: 'subscription',
    node: { id: `order-events/${name}`, name, type: 'subscription', icon: 'mail', expandable: false, level: 2, data: { topicName: 'order-events' } as never },
    entity: { topicName: 'order-events', name, activeMessageCount: 3, deadLetterMessageCount: 0, requiresSession: true, rules: [] } as never
  });

  function render(selection: EntitySelection, capabilities: ProviderCapabilities = DEFAULT_AZURE_CAPABILITIES) {
    state$ = new BehaviorSubject<{ selection: EntitySelection; loading: boolean; error: null }>({ selection, loading: false, error: null });
    list = vi.fn(() => of({ sessions: [{ sessionId: 'order-1001', messageCount: 12, firstSequenceNumber: 4411 }], scannedMessages: 12, truncated: false }));
    TestBed.configureTestingModule({
      imports: [EntityDetailsComponent],
      providers: [
        { provide: EntitySelectionService, useValue: { state$, get currentSelection() { return state$.value.selection; }, isLoading: false } },
        { provide: ConnectionService, useValue: { currentTarget: 'prod.example.net' } },
        { provide: QueueService, useValue: {} },
        { provide: TopicService, useValue: { getSubscription: () => NEVER } },
        { provide: SessionService, useValue: { list } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities), getSelectedProviderDisplayName: () => 'RabbitMQ' } },
        resubmitRuns
      ]
    });
    const fixture = TestBed.createComponent(EntityDetailsComponent);
    fixture.detectChanges();
    return fixture;
  }

  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const tabs = (el: HTMLElement) => Array.from(el.querySelectorAll('[role="tab"]')).map(text);
  const select = async (fixture: ReturnType<typeof render>, label: string) => {
    const tab = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"], button'))
      .find(t => text(t).endsWith(label))!;
    tab.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const sessions = (fixture: ReturnType<typeof render>) => (fixture.nativeElement as HTMLElement).querySelector('app-entity-sessions');

  it('the queue panel shows the Sessions tab for a session queue and not for a plain one', () => {
    expect(tabs(render(queue('orders', true)).nativeElement)).toStrictEqual(['Properties', 'Sessions']);
    TestBed.resetTestingModule();
    expect(tabs(render(queue('invoices', false)).nativeElement)).toStrictEqual(['Properties']);
  });

  it('a broker that declares no sessions shows the Sessions tab of a session queue or subscription disabled, with the reason in the words of the provider, and reads nothing', async () => {
    for (const selection of [queue('orders', true), subscription('audit')]) {
      const fixture = render(selection, DEFAULT_RABBITMQ_CAPABILITIES);
      const el = fixture.nativeElement as HTMLElement;
      const tab = Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]')).find(t => text(t) === 'Sessions');

      expect(tab?.getAttribute('aria-disabled'), 'the Sessions tab is shown disabled, never hidden').toBe('true');
      expect(el.querySelector('.sessions-off')?.getAttribute('title'), 'its tooltip, as the Components sheet draws it').toBe('RabbitMQ does not offer sessions');
      await select(fixture, 'Sessions');
      expect(list, 'a disabled tab reads no sessions').not.toHaveBeenCalled();
      expect(sessions(fixture)).toBeNull();
      TestBed.resetTestingModule();
    }
    expect(tabs(render(queue('invoices', false), DEFAULT_RABBITMQ_CAPABILITIES).nativeElement), 'a queue without sessions has no Sessions tab').toStrictEqual(['Properties']);
  });

  it('the queue sessions are read only when the tab is opened, for that queue', async () => {
    const fixture = render(queue('orders', true));
    expect(sessions(fixture), 'before the tab is opened').toBeNull();
    expect(list).not.toHaveBeenCalled();

    await select(fixture, 'Sessions');

    expect(sessions(fixture)).not.toBeNull();
    expect(list.mock.calls).toStrictEqual([[{ queueName: 'orders' }]]);
  });

  it('switching to another queue goes back to Properties and shows nothing of the previous queue sessions', async () => {
    const fixture = render(queue('orders', true));
    await select(fixture, 'Sessions');
    expect(sessions(fixture)).not.toBeNull();

    state$.next({ selection: queue('payments', true), loading: false, error: null });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(sessions(fixture)).toBeNull();
    expect(text((fixture.nativeElement as HTMLElement).querySelector('[role="tab"][aria-selected="true"]'))).toBe('Properties');
  });

  it('coming back to the queue Sessions tab keeps the list: no second scan while the same queue stays selected', async () => {
    const fixture = render(queue('orders', true));
    await select(fixture, 'Sessions');
    const first = sessions(fixture);

    await select(fixture, 'Properties');
    await select(fixture, 'Sessions');

    expect(list.mock.calls, 'one scan').toStrictEqual([[{ queueName: 'orders' }]]);
    expect(sessions(fixture), 'the same component, not a new one').toBe(first);
  });

  it('a reload of the same subscription (after a purge, say) drops the kept list and scans nothing until the tab opens; an update shown without a reload keeps it', async () => {
    const fixture = render(subscription('billing'));
    await select(fixture, 'Sessions');
    const shown = subscription('billing');

    state$.next({ selection: shown, loading: false, error: null });
    fixture.detectChanges();
    expect(sessions(fixture), 'kept, hidden, after an update shown without a reload').not.toBeNull();

    state$.next({ selection: shown, loading: true, error: null });
    fixture.detectChanges();
    state$.next({ selection: shown, loading: false, error: null });
    fixture.detectChanges();
    expect(sessions(fixture), 'nothing mounted after the reload until the tab opens').toBeNull();
    expect(list, 'no scan without opening the tab').toHaveBeenCalledTimes(1);

    await select(fixture, 'Sessions');
    expect(list, 'reopened after the reload: a new scan').toHaveBeenCalledTimes(2);
  });

  it('coming back to the subscription Sessions tab keeps the list, hidden in between, and another subscription still starts afresh', async () => {
    const fixture = render(subscription('billing'));
    await select(fixture, 'Sessions');
    const first = sessions(fixture);

    await select(fixture, 'Properties');
    expect(sessions(fixture), 'kept while another tab shows').toBe(first);
    expect(sessions(fixture)!.closest('[hidden]'), 'hidden while another tab shows').not.toBeNull();
    await select(fixture, 'Sessions');

    expect(list.mock.calls, 'one scan').toStrictEqual([[{ topicName: 'order-events', subscriptionName: 'billing' }]]);
    expect(sessions(fixture)).toBe(first);
    expect(sessions(fixture)!.closest('[hidden]'), 'shown again').toBeNull();

    state$.next({ selection: subscription('shipping'), loading: false, error: null });
    fixture.detectChanges();
    expect(sessions(fixture), 'another subscription: nothing mounted until its tab opens').toBeNull();
    await select(fixture, 'Sessions');
    expect(list.mock.calls.at(-1)).toStrictEqual([{ topicName: 'order-events', subscriptionName: 'shipping' }]);
  });

  it('the subscription Sessions tab mounts the same component for that subscription, read when opened, and goes on a switch', async () => {
    const fixture = render(subscription('billing'));
    expect(sessions(fixture)).toBeNull();

    await select(fixture, 'Sessions');
    expect(sessions(fixture)).not.toBeNull();
    expect(list.mock.calls).toStrictEqual([[{ topicName: 'order-events', subscriptionName: 'billing' }]]);

    state$.next({ selection: subscription('shipping'), loading: false, error: null });
    fixture.detectChanges();
    expect(sessions(fixture)).toBeNull();
  });
});

describe('EntityDetailsComponent: one panel shape for a queue and a subscription', () => {
  let open: ReturnType<typeof vi.fn>;
  let refreshCurrentSelection: ReturnType<typeof vi.fn>;

  const queue: EntitySelection = {
    type: 'queue',
    node: { id: 'orders', name: 'orders', type: 'queue', icon: 'inbox', expandable: false, level: 1 },
    entity: { name: 'orders', activeMessageCount: 120, deadLetterMessageCount: 7, scheduledMessageCount: 2, sizeInBytes: 2048 } as never
  };
  const subscription: EntitySelection = {
    type: 'subscription',
    node: { id: 'events/billing', name: 'billing', type: 'subscription', icon: 'mail', expandable: false, level: 2, data: { topicName: 'events' } as never },
    entity: { topicName: 'events', name: 'billing', activeMessageCount: 5, deadLetterMessageCount: 3, rules: [] } as never
  };
  const failed = (selection: EntitySelection) => ({ selection: { type: selection.type, node: selection.node }, loading: false, error: 'Http failure response for queues/orders: 504 Gateway Timeout' });

  function render(state: { selection: EntitySelection; loading: boolean; error: string | null }) {
    refreshCurrentSelection = vi.fn();
    TestBed.configureTestingModule({
      imports: [EntityDetailsComponent],
      providers: [
        { provide: EntitySelectionService, useValue: { state$: of(state), currentSelection: state.selection, isLoading: false, refreshCurrentSelection, refreshTree: vi.fn() } },
        { provide: ConnectionService, useValue: { currentTarget: 'prod.example.net' } },
        { provide: QueueService, useValue: {} },
        { provide: TopicService, useValue: { getSubscription: () => NEVER } },
        { provide: SessionService, useValue: {} },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_AZURE_CAPABILITIES) } },
        resubmitRuns
      ]
    });
    const fixture = TestBed.createComponent(EntityDetailsComponent);
    open = vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open')
      .mockReturnValue({ afterClosed: () => of(false) } as never) as unknown as ReturnType<typeof vi.fn>;
    fixture.detectChanges();
    return fixture;
  }

  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const buttons = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
  const button = (root: ParentNode, label: string) => buttons(root).find(b => text(b) === label || b.getAttribute('aria-label') === label);
  const openMenu = async (fixture: ReturnType<typeof render>) => {
    button(fixture.nativeElement, 'More actions')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    return Array.from(document.querySelectorAll<HTMLButtonElement>('.mat-mdc-menu-panel [mat-menu-item]'));
  };

  it('a queue that failed to load says what failed and offers Retry, which reads it again; it is not a blank panel', () => {
    const el = render(failed(queue)).nativeElement as HTMLElement;

    const alert = el.querySelector('[role="alert"]');
    expect(text(alert)).toContain('Could not load the queue orders');
    expect(text(alert)).toContain('504 Gateway Timeout');
    expect(text(alert), 'a re-read can follow a purge or a send, so the panel claims nothing about the broker').not.toContain('nothing on the broker was changed');
    button(el, 'Retry')!.click();
    expect(refreshCurrentSelection).toHaveBeenCalledTimes(1);
  });

  it('a subscription that failed to load says so, instead of "Loading subscription details..." that never ends', () => {
    const el = render(failed(subscription)).nativeElement as HTMLElement;

    expect(text(el.querySelector('[role="alert"]'))).toContain('Could not load the subscription billing');
    expect(text(el)).not.toContain('Loading subscription details');
  });

  it('Purge is never beside View Messages: the queue row holds View Messages and Send Message, and Purge sits in More actions with the same confirmation', async () => {
    const fixture = render({ selection: queue, loading: false, error: null });
    const el = fixture.nativeElement as HTMLElement;
    expect(buttons(el).map(text).filter(t => /purge/i.test(t)), 'purge in the panel before the menu opens').toStrictEqual([]);
    expect(button(el, 'View messages')).toBeDefined();
    expect(button(el, 'Send')).toBeDefined();

    const items = await openMenu(fixture);

    expect(items.map(text)).toStrictEqual(['Import messages', 'Resubmit dead-letter 7', 'Purge active messages 120', 'Purge dead-letter 7', 'Delete queue']);
    expect(items[2].classList.contains('danger'), 'purge in the error colour').toBe(true);
    items[2].click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(ConfirmDialogComponent);
    expect(open.mock.calls[0][1].data.message).toBe('This deletes every active message in queue "orders" on prod.example.net: 120 when the queue was loaded. It cannot be undone.');
  });

  it('the subscription panel has View Messages like the queue panel, and its three purges sit in More actions', async () => {
    const fixture = render({ selection: subscription, loading: false, error: null });

    button(fixture.nativeElement, 'View messages')!.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(ViewMessagesDialogComponent);
    expect(open.mock.calls[0][1].data).toMatchObject({ entityType: 'subscription', entityName: 'billing', topicName: 'events' });

    const items = await openMenu(fixture);
    expect(items.map(text)).toStrictEqual(['Resubmit dead-letter 3', 'Purge active messages 5', 'Purge dead-letter 3', 'Delete subscription']);
  });

  it('the Active and Dead Letter cards are buttons named with their count that open the messages on their tab, by Enter', () => {
    const el = render({ selection: queue, loading: false, error: null }).nativeElement as HTMLElement;
    const card = (label: string) => Array.from(el.querySelectorAll<HTMLElement>('.stat-card')).find(c => text(c.querySelector('.stat-label')) === label)!;

    expect(card('Active').getAttribute('role')).toBe('button');
    expect(card('Active').getAttribute('aria-label')).toBe('View the 120 active messages');
    expect(card('Dead-letter').getAttribute('aria-label')).toBe('View the 7 dead-letter messages');
    card('Active').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    card('Dead-letter').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(open.mock.calls.map(c => c[1].data.initialTab)).toStrictEqual([0, 1]);
  });
});

describe('EntityDetailsComponent as Main.dc.html draws the panel', () => {
  const ADMIN: ProviderCapabilities = { ...DEFAULT_AZURE_CAPABILITIES, supportsEntityUpdate: true };
  const treeData = { loadedCounts: vi.fn(() => ({ queues: 3, topics: 1, subscriptions: 2 })) };
  const NO_ADMIN: ProviderCapabilities = { ...DEFAULT_AZURE_CAPABILITIES, supportsEntityUpdate: false };
  const queue = (entity: object = {}): EntitySelection => ({
    type: 'queue',
    node: { id: 'queue-orders', name: 'orders', type: 'queue', icon: 'inbox', expandable: false, level: 1 },
    entity: { name: 'orders', status: 'Active', activeMessageCount: 120, deadLetterMessageCount: 7, scheduledMessageCount: 2, transferDeadLetterMessageCount: 2, sizeInBytes: 2048, maxSizeInMegabytes: 1024, ...entity } as never
  });
  const subscription = (entity: object = {}): EntitySelection => ({
    type: 'subscription',
    node: { id: 'subscription-events-billing', name: 'billing', type: 'subscription', icon: 'mail', expandable: false, level: 2, data: { topicName: 'events' } as never },
    entity: { topicName: 'events', name: 'billing', status: 'Active', activeMessageCount: 5, deadLetterMessageCount: 3, rules: [], ...entity } as never
  });
  const topic = (entity: object = {}): EntitySelection => ({
    type: 'topic',
    node: { id: 'topic-events', name: 'events', type: 'topic', icon: 'topic', expandable: true, level: 1 },
    entity: {
      name: 'events', status: 'Active', maxSizeInMegabytes: 1024, subscriptionCount: 2,
      subscriptions: [
        { topicName: 'events', name: 'warehouse', activeMessageCount: 12, deadLetterMessageCount: 0, status: 'Active', ruleCount: 2 },
        { topicName: 'events', name: 'email', activeMessageCount: 0, deadLetterMessageCount: 4, status: 'ReceiveDisabled', ruleCount: null }
      ], ...entity
    } as never
  });

  let open: ReturnType<typeof vi.fn>;
  let closed: unknown;
  let selectionService: Record<string, ReturnType<typeof vi.fn> | unknown>;
  let queueService: Record<string, ReturnType<typeof vi.fn>>;
  let topicService: Record<string, ReturnType<typeof vi.fn>>;
  let snackBar: { open: ReturnType<typeof vi.fn> };

  function render(state: { selection: EntitySelection | null; loading?: boolean; error?: string | null; loadingNode?: TreeNode | null }, capabilities: ProviderCapabilities = ADMIN) {
    closed = false;
    selectionService = {
      state$: of({ loading: false, error: null, ...state }), currentSelection: state.selection, isLoading: false,
      select: vi.fn(), clearSelection: vi.fn(), refreshTree: vi.fn(), refreshCurrentSelection: vi.fn()
    };
    queueService = { purgeMessages: vi.fn(() => of({ success: true })), deleteQueue: vi.fn(() => of(undefined)) };
    topicService = {
      getSubscription: vi.fn(() => NEVER), purgeMessages: vi.fn(() => of({ success: true })),
      deleteTopic: vi.fn(() => of(undefined)), deleteSubscription: vi.fn(() => of(undefined))
    };
    snackBar = { open: vi.fn() };
    TestBed.configureTestingModule({
      imports: [EntityDetailsComponent],
      providers: [
        { provide: EntitySelectionService, useValue: selectionService },
        { provide: ConnectionService, useValue: { currentTarget: 'prod.example.net' } },
        { provide: TreeDataBuilderService, useValue: treeData },
        { provide: QueueService, useValue: queueService },
        { provide: TopicService, useValue: topicService },
        { provide: SessionService, useValue: {} },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } },
        resubmitRuns
      ]
    });
    const fixture = TestBed.createComponent(EntityDetailsComponent);
    open = vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open')
      .mockImplementation(() => ({ afterClosed: () => of(closed) }) as never) as unknown as ReturnType<typeof vi.fn>;
    snackBar = { open: vi.spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open').mockReturnValue({} as never) as unknown as ReturnType<typeof vi.fn> };
    fixture.detectChanges();
    return fixture;
  }

  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const named = (b: Element) => b.getAttribute('aria-label') ?? text(b);
  const actions = (el: HTMLElement) => Array.from(el.querySelectorAll('.entity-actions button')).map(named);
  const button = (root: ParentNode, label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b => named(b) === label)!;
  const openMenu = async (fixture: ReturnType<typeof render>) => {
    button(fixture.nativeElement, 'More actions').click();
    fixture.detectChanges();
    await fixture.whenStable();
    return Array.from(document.querySelectorAll<HTMLButtonElement>('.mat-mdc-menu-panel [mat-menu-item]'));
  };
  const labels = (el: HTMLElement) => Array.from(el.querySelectorAll('.stat-card .stat-label')).map(text);
  const note = (el: HTMLElement, label: string) => text(Array.from(el.querySelectorAll('.stat-card')).find(c => text(c.querySelector('.stat-label')) === label)!.querySelector('.stat-note'));

  it('when the messages dialog closes, the panel and the tree read their counts again: what was resubmitted, moved or deleted in it changed them', () => {
    const fixture = render({ selection: subscription(), loading: false, error: null });
    const el = fixture.nativeElement as HTMLElement;

    Array.from(el.querySelectorAll<HTMLElement>('.stat-card')).find(c => text(c.querySelector('.stat-label')) === 'Active')!.click();

    expect(open.mock.calls[0][0]).toBe(ViewMessagesDialogComponent);
    expect(selectionService['refreshCurrentSelection']).toHaveBeenCalledTimes(1);
    expect(selectionService['refreshTree']).toHaveBeenCalledTimes(1);
  });

  it(`a subscription's Active card reads "Active", the count and "Open the active messages", like the queue card, with the live count and no Live badge or sparkline`, () => {
    const fixture = render({ selection: subscription(), loading: false, error: null });
    const el = fixture.nativeElement as HTMLElement;
    const active = () => Array.from(el.querySelectorAll<HTMLElement>('.stat-card')).find(c => text(c.querySelector('.stat-label')) === 'Active');

    expect(active() && Array.from(active()!.children).map(text), 'the label, the count and the note, as drawn')
      .toStrictEqual(['Active', '5', 'Open the active messages']);
    expect(active()!.getAttribute('role')).toBe('button');
    expect(active()!.getAttribute('aria-label')).toBe('View the 5 active messages');
    expect(el.querySelector('.live-badge, .sparkline'), 'the artboard draws no Live badge and no sparkline').toBeNull();

    fixture.componentInstance.onSubscriptionUpdated({ activeMessageCount: 9, deadLetterMessageCount: 3 } as never);
    fixture.detectChanges();
    expect(text(active()!.querySelector('.stat-value')), 'the count read every 3 seconds').toBe('9');
    expect(active()!.getAttribute('aria-label')).toBe('View the 9 active messages');

    active()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(open.mock.calls.map(c => c[1].data.initialTab), 'opens the active messages').toStrictEqual([0]);
  });

  it('a subscription says "Subscription in topic events", and the topic name is a button that selects the topic as the tree knows it', () => {
    const fixture = render({ selection: subscription() });
    const el = fixture.nativeElement as HTMLElement;

    expect(text(el.querySelector('.entity-kind'))).toBe('Subscription in topic events');
    button(el.querySelector('.entity-kind')!, 'events').click();

    expect(selectionService['select']).toHaveBeenCalledWith(expect.objectContaining({ id: 'topic-events', name: 'events', type: 'topic' }));
  });

  it('the status is a chip beside the name, "Status: Active. Change status", that opens the status dialog; there is no separate Status button', () => {
    const el = render({ selection: queue() }).nativeElement as HTMLElement;
    const chip = el.querySelector<HTMLButtonElement>('.name-row button.status-chip');

    expect(chip, 'a status chip in the row of the name').not.toBeNull();
    expect(chip!.getAttribute('aria-label')).toBe('Status: Active. Change status');
    expect(text(chip)).toBe('Active');
    expect(Array.from(el.querySelectorAll('button')).map(named), 'a Status button').not.toContain('Status');
    chip!.click();
    expect(open.mock.calls[0][0]).toBe(EntityStatusDialogComponent);
  });

  it('the actions in order: a queue has View messages, Send, Edit, More actions; a subscription Send to topic; a topic Send, Create subscription, Edit, More actions', () => {
    expect(actions(render({ selection: queue() }).nativeElement)).toStrictEqual(['View messages', 'Send', 'Edit', 'More actions']);
    TestBed.resetTestingModule();
    expect(actions(render({ selection: subscription() }).nativeElement)).toStrictEqual(['View messages', 'Send to topic', 'Edit', 'More actions']);
    TestBed.resetTestingModule();
    expect(actions(render({ selection: topic() }).nativeElement)).toStrictEqual(['Send', 'Create subscription', 'Edit', 'More actions']);
  });

  it('Send to topic sends to the topic of the subscription, never to a topic named after the subscription', () => {
    const el = render({ selection: subscription() }).nativeElement as HTMLElement;

    button(el, 'Send to topic').click();

    expect(open.mock.calls[0][0]).toBe(SendMessageDialogComponent);
    expect(open.mock.calls[0][1].data).toStrictEqual({ entityType: 'topic', entityName: 'events' });
  });

  it('the topic panel sends to the topic and creates a subscription in it', () => {
    const el = render({ selection: topic() }).nativeElement as HTMLElement;

    button(el, 'Send').click();
    button(el, 'Create subscription').click();

    expect(open.mock.calls[0][0]).toBe(SendMessageDialogComponent);
    expect(open.mock.calls[0][1].data).toStrictEqual({ entityType: 'topic', entityName: 'events' });
    expect(open.mock.calls[1][0]).toBe(EntityFormDialogComponent);
    expect(open.mock.calls[1][1].data).toStrictEqual({ mode: 'create', kind: 'subscription', topicName: 'events' });
  });

  it('the queue menu: Import messages, Resubmit dead-letter 7, then under "Cannot be undone" Purge active messages 120, Purge dead-letter 7 and Delete queue, each with the trash icon', async () => {
    const items = await openMenu(render({ selection: queue() }));

    expect(items.map(text)).toStrictEqual(['Import messages', 'Resubmit dead-letter 7', 'Purge active messages 120', 'Purge dead-letter 7', 'Delete queue']);
    expect(items.map(i => i.classList.contains('danger'))).toStrictEqual([false, false, true, true, true]);
    expect(items.slice(2).map(i => i.querySelector('mat-icon')?.getAttribute('fontIcon')), 'the trash icon on each destructive item').toStrictEqual(['delete', 'delete', 'delete']);
    expect(text(document.querySelector('.mat-mdc-menu-panel .menu-caption'))).toBe('Cannot be undone');
  });

  it('the subscription menu: Resubmit dead-letter 3, Purge active messages 5, Purge dead-letter 3, Delete subscription; no Purge all', async () => {
    const items = await openMenu(render({ selection: subscription() }));

    expect(items.map(text)).toStrictEqual(['Resubmit dead-letter 3', 'Purge active messages 5', 'Purge dead-letter 3', 'Delete subscription']);
  });

  it('the topic has a More actions menu that holds Cancel scheduled messages and Delete topic, both in the error colour', async () => {
    const items = await openMenu(render({ selection: topic() }));

    expect(items.map(text)).toStrictEqual(['Cancel scheduled messages', 'Delete topic']);
    expect(items.map(i => i.classList.contains('danger')), 'neither sits at the weight of a routine action').toStrictEqual([true, true]);
  });

  it('Resubmit dead-letter is disabled at 0 and otherwise only opens the auto resubmit dialog', async () => {
    let items = await openMenu(render({ selection: queue({ deadLetterMessageCount: 0 }) }));
    expect(items[1].disabled, 'Resubmit dead-letter with nothing in the dead-letter queue').toBe(true);
    TestBed.resetTestingModule();

    items = await openMenu(render({ selection: queue() }));
    items[1].click();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(ContinuousResubmitDialogComponent);
    expect(queueService['purgeMessages']).not.toHaveBeenCalled();
  });

  it('Purge dead-letter of a queue asks the same typed-name confirmation as the other purges, and purges only once confirmed', async () => {
    let fixture = render({ selection: queue() });
    (await openMenu(fixture))[3].click();

    const data = open.mock.calls[0][1].data;
    expect(open.mock.calls[0][0]).toBe(ConfirmDialogComponent);
    expect(data.title).toBe('Purge dead-letter messages?');
    expect(data.message).toBe('This deletes every dead-letter message in queue "orders" on prod.example.net: 7 when the queue was loaded. It cannot be undone.');
    expect(data.confirmText).toBe('Purge 7 messages');
    expect(data.typedName, 'the purge is confirmed by typing the queue name').toBe('orders');
    expect(data.typedLabel).toBe('Type the queue name to confirm');
    expect(queueService['purgeMessages'], 'a purge before the confirmation is accepted').not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    fixture = render({ selection: queue() });
    closed = true;
    (await openMenu(fixture))[3].click();
    expect(queueService['purgeMessages']).toHaveBeenCalledWith('orders', 'deadletter');
  });

  it('Delete subscription names the subscription, its topic, the connection and what it holds, asks for its name to be typed, and deletes only once confirmed', async () => {
    let fixture = render({ selection: subscription() });
    (await openMenu(fixture))[3].click();

    const data = open.mock.calls[0][1].data;
    expect(open.mock.calls[0][0]).toBe(ConfirmDialogComponent);
    expect(data.title).toBe('Delete subscription billing?');
    expect(data.message).toBe('This deletes subscription "billing" of topic "events" on prod.example.net with its 8 messages when the subscription was loaded. It cannot be undone.');
    expect(data.confirmText).toBe('Delete subscription');
    expect(data.typedName, 'the delete is confirmed by typing the subscription name').toBe('billing');
    expect(data.typedLabel).toBe('Type the subscription name to confirm');
    expect(topicService['deleteSubscription'], 'a delete on cancel').not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    fixture = render({ selection: subscription() });
    closed = true;
    (await openMenu(fixture))[3].click();
    expect(topicService['deleteSubscription']).toHaveBeenCalledWith('events', 'billing');
    expect(selectionService['clearSelection']).toHaveBeenCalledTimes(1);
    expect(selectionService['refreshTree']).toHaveBeenCalledTimes(1);
  });

  it('Delete topic and Delete queue name what goes with them and call their own delete', async () => {
    let fixture = render({ selection: topic() });
    closed = true;
    (await openMenu(fixture))[1].click();
    expect(open.mock.calls[0][1].data.message).toBe('This deletes topic "events" on prod.example.net with its 2 subscriptions and their messages. It cannot be undone.');
    expect(open.mock.calls[0][1].data.context, 'the delete confirmation draws the environment line of events on the active connection').toStrictEqual({ subject: 'events' });
    expect(topicService['deleteTopic']).toHaveBeenCalledWith('events');
    TestBed.resetTestingModule();

    fixture = render({ selection: queue() });
    closed = true;
    (await openMenu(fixture))[4].click();
    expect(open.mock.calls[0][1].data.message).toBe('This deletes queue "orders" on prod.example.net with its 127 messages when the queue was loaded. It cannot be undone.');
    expect(queueService['deleteQueue']).toHaveBeenCalledWith('orders');
  });

  it('a delete the API refuses keeps the entity selected and says what failed', async () => {
    const fixture = render({ selection: queue() });
    queueService['deleteQueue'].mockReturnValue(throwError(() => ({ status: 409, error: { message: 'The queue is in use.' } })));
    closed = true;
    (await openMenu(fixture))[4].click();

    expect(selectionService['clearSelection'], 'the selection after a failed delete').not.toHaveBeenCalled();
    expect(selectionService['refreshTree']).not.toHaveBeenCalled();
    expect(snackBar.open.mock.calls[0][0]).toBe('Could not delete the queue orders: The queue is in use.');
  });

  it('no Delete without the explicit administration capability', async () => {
    const items = await openMenu(render({ selection: queue() }, NO_ADMIN));

    expect(items.map(text)).not.toContain('Delete queue');
  });

  it('the queue cards in order: Active, Dead-letter, Scheduled, Transfer, Transfer dead-letter, Size, with their notes; Auto resubmit in the dead-letter card', () => {
    const el = render({ selection: queue() }).nativeElement as HTMLElement;

    expect(labels(el)).toStrictEqual(['Active', 'Dead-letter', 'Scheduled', 'Transfer', 'Transfer dead-letter', 'Size']);
    expect(note(el, 'Transfer')).toBe('Waiting to be forwarded');
    expect(note(el, 'Active')).toBe('Open the active messages');
    expect(note(el, 'Dead-letter')).toBe('Open to resubmit or delete');
    expect(note(el, 'Transfer dead-letter')).toBe('Could not be forwarded');
    expect(note(el, 'Size')).toBe('Max Size 1,024 MB');
    expect(text(el.querySelector('.dead-letter-card button.auto-resubmit'))).toBe('Auto resubmit');
  });

  it('the subscription panel carries no standing resubmit warning: it is said where a resubmit is chosen', () => {
    const el = render({ selection: subscription() }).nativeElement as HTMLElement;

    expect(el.querySelector('.resubmit-notice'), 'no warning beside the cards').toBeNull();
  });

  it('the subscription tabs are Properties, Sessions when it holds sessions, and Rules with the count of the rules read', () => {
    const rules = [{ name: 'a', filterType: 'True' }, { name: 'b', filterType: 'False' }];
    const tabs = (el: HTMLElement) => Array.from(el.querySelectorAll('[mat-tab-link]')).map(text);

    expect(tabs(render({ selection: subscription({ rules }) }).nativeElement)).toStrictEqual(['Properties', 'Rules (2)']);
    TestBed.resetTestingModule();
    expect(tabs(render({ selection: subscription({ requiresSession: true }) }).nativeElement)).toStrictEqual(['Properties', 'Sessions', 'Rules (0)']);
    TestBed.resetTestingModule();
    expect(tabs(render({ selection: subscription({ rules: undefined }) }).nativeElement), 'rules that were not read have no count').toStrictEqual(['Properties', 'Rules']);
  });

  it('the topic opens on "Subscriptions (2)", then Properties; the table lists each subscription, its counts, a dead-letter warning, and selects it', () => {
    const el = render({ selection: topic() }).nativeElement as HTMLElement;

    expect(Array.from(el.querySelectorAll('[role="tab"]')).map(text)).toStrictEqual(['Subscriptions (2)', 'Properties']);
    expect(text(el.querySelector('[role="tab"][aria-selected="true"]'))).toBe('Subscriptions (2)');
    const table = el.querySelector('table.subscriptions')!;
    const rules = !!ADMIN.supportsSubscriptionRules;
    expect(Array.from(table.querySelectorAll('th')).map(text)).toStrictEqual(['Subscription', 'Active', 'Dead-letter', ...(rules ? ['Rules'] : []), 'Status']);
    expect(Array.from(table.querySelectorAll('tbody tr')).map(r => Array.from(r.querySelectorAll('td')).map(text))).toStrictEqual([
      ['warehouse', '12', '0', ...(rules ? ['2'] : []), 'Active'],
      ['email', '0', '4', ...(rules ? ['Not counted'] : []), 'ReceiveDisabled'],
    ]);
    expect(table.querySelectorAll('tbody tr')[1].querySelector('.count-chip.dead-letter mat-icon')?.getAttribute('fontIcon')).toBe('warning');
    expect(table.querySelectorAll('tbody tr')[0].querySelector('.count-chip'), 'a badge at zero').toBeNull();

    button(table, 'email').click();
    expect(selectionService['select']).toHaveBeenCalledWith(expect.objectContaining({ id: 'subscription-events-email', name: 'email', type: 'subscription', data: { topicName: 'events' } }));
  });

  it('Max Size is written with thousands grouped: "1,024 MB" for a queue and a topic', async () => {
    const value = (el: HTMLElement) => text(Array.from(el.querySelectorAll('.property')).find(p => text(p.querySelector('.property-label')) === 'Max Size')!.querySelector('.property-value'));

    expect(value(render({ selection: queue() }).nativeElement)).toBe('1,024 MB');
    TestBed.resetTestingModule();
    const fixture = render({ selection: topic() });
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]')).find(t => text(t) === 'Properties')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(value(fixture.nativeElement)).toBe('1,024 MB');
  });

  it('the Subscriptions table has a Rules column only where the provider has rules, and always a Status column', () => {
    const el = render({ selection: topic() }, { ...ADMIN, supportsSubscriptionRules: false }).nativeElement as HTMLElement;
    expect(Array.from(el.querySelectorAll('table.subscriptions th')).map(text)).toStrictEqual(['Subscription', 'Active', 'Dead-letter', 'Status']);
    TestBed.resetTestingModule();
    const withRules = render({ selection: topic() }, { ...ADMIN, supportsSubscriptionRules: true }).nativeElement as HTMLElement;
    expect(Array.from(withRules.querySelectorAll('table.subscriptions th')).map(text)).toStrictEqual(['Subscription', 'Active', 'Dead-letter', 'Rules', 'Status']);
    expect(Array.from(withRules.querySelectorAll('table.subscriptions tbody tr')).map(r => text(r.querySelectorAll('td')[3])), 'a count the API did not make says so').toStrictEqual(['2', 'Not counted']);
  });

  it('with nothing selected the panel says what the connection holds, as the artboard words it', () => {
    const el = render({ selection: null }).nativeElement as HTMLElement;
    expect(text(el.querySelector('[data-testid="namespace-counts"]'))).toBe('prod.example.net holds 3 queues and 1 topic with 2 subscriptions.');
  });

  it('with nothing selected and a provider that reads namespace properties, the facts of the namespace follow what the connection holds', () => {
    const properties = vi.fn(() => of({ name: 'contoso-test', tier: 'Standard', messagingUnits: null, alias: null, createdTime: '2024-03-01T09:30:00+00:00', modifiedTime: '2024-03-01T09:30:00+00:00', maxMessageSizeInBytes: 262144 }));
    TestBed.configureTestingModule({ providers: [{ provide: DefinitionsService, useValue: { properties } }] });
    const el = render({ selection: null }, { ...ADMIN, supportsNamespaceProperties: true }).nativeElement as HTMLElement;

    expect(properties).toHaveBeenCalledTimes(1);
    const facts = el.querySelector('.details-state app-namespace-properties dl.facts');
    expect(facts?.previousElementSibling ?? facts?.parentElement?.previousElementSibling, 'the facts sit under the counts line').toBe(el.querySelector('[data-testid="namespace-counts"]'));
    expect(Array.from(facts!.querySelectorAll('dt')).map(text)).toStrictEqual(['Tier', 'Created', 'Max message size']);
  });

  it('with nothing selected and a provider without namespace properties, the panel says so instead of staying silent, and reads nothing', () => {
    const properties = vi.fn(() => NEVER);
    TestBed.configureTestingModule({ providers: [{ provide: DefinitionsService, useValue: { properties } }] });
    const el = render({ selection: null }, { ...DEFAULT_RABBITMQ_CAPABILITIES, supportsNamespaceProperties: false }).nativeElement as HTMLElement;

    expect(text(el.querySelector('[data-testid="namespace-properties-none"]')), 'the provider declares it has no namespace properties').toBe('No namespace properties: RabbitMQ does not declare them.');
    expect(el.querySelector('app-namespace-properties')).toBeNull();
    expect(properties).not.toHaveBeenCalled();
  });

  it('with nothing selected: "Create queue" (tonal) and "Create topic" (text) open the create form', () => {
    const el = render({ selection: null }).nativeElement as HTMLElement;
    const create = Array.from(el.querySelectorAll<HTMLButtonElement>('.details-state button'));

    expect(create.map(text)).toStrictEqual(['Create queue', 'Create topic']);
    expect(create[0].getAttribute('matButton')).toBe('tonal');
    expect(create[1].hasAttribute('mat-button')).toBe(true);
    create[0].click();
    create[1].click();
    expect(open.mock.calls.map(c => [c[0], c[1].data])).toStrictEqual([
      [EntityFormDialogComponent, { mode: 'create', kind: 'queue', topicName: undefined }],
      [EntityFormDialogComponent, { mode: 'create', kind: 'topic', topicName: undefined }]
    ]);
    TestBed.resetTestingModule();
    expect(render({ selection: null }, NO_ADMIN).nativeElement.querySelectorAll('.details-state button').length, 'create without the capability').toBe(0);
  });

  it('while loading: four card placeholders and three text lines, hidden from assistive technology', () => {
    const el = render({ selection: queue(), loading: true }).nativeElement as HTMLElement;

    expect(el.querySelectorAll('.placeholder-cards[aria-hidden="true"] > div').length).toBe(4);
    expect(el.querySelectorAll('.placeholder-lines[aria-hidden="true"] > div').length).toBe(3);
  });

  it('as Main.dc.html draws it: while an entity loads, its kind and name sit above "Loading the {kind} from {connection}"', () => {
    const el = render({ selection: queue(), loading: true, loadingNode: { id: 'q:invoices', name: 'invoices', type: 'queue' } as TreeNode }).nativeElement as HTMLElement;

    expect(el.querySelector('.entity-kind')?.textContent?.trim(), 'the kind of the entity being read').toBe('Queue');
    expect(el.querySelector('.entity-header h2')?.textContent?.trim(), 'the name of the entity being read, not the one shown before').toBe('invoices');
    expect(el.querySelector('.details-state[role="status"] p')?.textContent?.trim()).toBe('Loading the queue from prod.example.net');
  });
});

describe('EntityDetailsComponent: cancel scheduled messages of a topic', () => {
  const topicSelection: EntitySelection = {
    type: 'topic',
    node: { id: 'events', name: 'events', type: 'topic', icon: 'topic', expandable: true, level: 1 },
    entity: { name: 'events', subscriptions: [] } as never
  };
  let dialog: { open: ReturnType<typeof vi.fn> };
  let cancel: ReturnType<typeof vi.fn>;
  let snack: ReturnType<typeof vi.fn>;

  function providers(capabilities: ProviderCapabilities) {
    return [
      { provide: EntitySelectionService, useValue: { state$: of({ selection: topicSelection, loading: false, error: null }), currentSelection: topicSelection, isLoading: false } },
      { provide: ConnectionService, useValue: { currentTarget: 'prod.example.net' } },
      { provide: QueueService, useValue: {} },
      { provide: TopicService, useValue: { cancelScheduledMessages: cancel, getSubscription: () => NEVER } },
      { provide: SessionService, useValue: {} },
      { provide: MatSnackBar, useValue: { open: snack } },
      { provide: MatDialog, useValue: dialog },
      { provide: ProviderService, useValue: { capabilities: signal(capabilities), getSelectedProviderDisplayName: () => 'Azure Service Bus' } },
      resubmitRuns
    ];
  }

  function create(answers: unknown[]) {
    let call = 0;
    dialog = { open: vi.fn().mockImplementation(() => ({ afterClosed: () => of(answers[call++]) })) };
    snack = vi.fn();
    TestBed.configureTestingModule({ providers: providers(DEFAULT_AZURE_CAPABILITIES) });
    return TestBed.runInInjectionContext(() => new EntityDetailsComponent());
  }

  const result = { successCount: 1, failureCount: 1, failures: [{ sequenceNumber: 13, error: 'This message is not scheduled any more.' }], success: false };

  it('asks for the sequence numbers, confirms naming the topic and the count, cancels exactly those numbers on the topic and shows the result per number', () => {
    cancel = vi.fn().mockReturnValue(of(result));
    const component = create([[12, 13], true, undefined]);

    component.cancelTopicScheduled();

    const opened = dialog.open.mock.calls.map(([type, config]) => [type, config.data]);
    expect(opened[0], 'first the sequence numbers are asked for').toEqual([TopicCancelScheduledDialogComponent, { topicName: 'events' }]);
    expect(opened[1], 'the confirmation names the topic and the numbers it will cancel').toEqual(
      [CancelScheduledDialogComponent, { queueName: 'events', entityKind: 'topic', sequenceNumbers: [12, 13] }]);
    expect(cancel.mock.calls, 'exactly the typed numbers are cancelled on the topic').toEqual([['events', [12, 13]]]);
    expect(opened[2], 'the result is shown per sequence number').toEqual([BulkOperationResultsDialogComponent,
      { operation: 'cancel-scheduled', result, entityName: 'events', entityType: 'topic', subQueue: 'active', allowRetry: false }]);
  });

  it('cancels nothing when the numbers dialog is closed or the confirmation is declined', () => {
    cancel = vi.fn();
    create([undefined]).cancelTopicScheduled();
    expect(dialog.open).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();

    create([[12], false]).cancelTopicScheduled();
    expect(dialog.open).toHaveBeenCalledTimes(2);
    expect(cancel, 'a declined confirmation never reaches the API').not.toHaveBeenCalled();
  });

  it('a failed cancel is shown as an error with the API text, not as an empty result', () => {
    cancel = vi.fn().mockReturnValue(throwError(() => ({ status: 409, error: { message: 'The entity is disabled for this operation.' } })));
    const component = create([[12], true]);

    component.cancelTopicScheduled();

    expect(dialog.open, 'no results dialog after a failed call').toHaveBeenCalledTimes(2);
    expect(snack.mock.calls[0][0]).toContain('The entity is disabled for this operation.');
  });

  function menuItems(capabilities: ProviderCapabilities): { text: string; danger: boolean }[] {
    cancel = vi.fn();
    snack = vi.fn();
    dialog = { open: vi.fn() };
    TestBed.configureTestingModule({ imports: [EntityDetailsComponent], providers: providers(capabilities) });
    const fixture = TestBed.createComponent(EntityDetailsComponent);
    fixture.detectChanges();
    const trigger = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[aria-label="More actions"]');
    if (!trigger) return [];
    trigger.click();
    fixture.detectChanges();
    return Array.from(document.querySelectorAll<HTMLElement>('.entity-more-menu [mat-menu-item]'))
      .map(b => ({ text: (b.querySelector('.mat-mdc-menu-item-text')?.textContent ?? '').trim(), danger: b.classList.contains('danger') }));
  }

  it('a broker without scheduled messages offers no cancel of them on a topic', () => {
    expect(menuItems(DEFAULT_RABBITMQ_CAPABILITIES).map(i => i.text)).not.toContain('Cancel scheduled messages');
  });
});
