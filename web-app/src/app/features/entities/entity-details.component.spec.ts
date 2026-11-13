import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BehaviorSubject, NEVER, of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EntityDetailsComponent } from './entity-details.component';
import { ConnectionService, EntitySelectionService, QueueService, ResubmitRun, ResubmitRunService, SessionService, TopicService } from '../../core/services';
import { EntitySelection } from '../../core/models';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { DEFAULT_AZURE_CAPABILITIES, DEFAULT_RABBITMQ_CAPABILITIES, ProviderService } from '../../core/services/provider.service';
import { ProviderCapabilities } from '../../core/models/provider.model';
import { ViewMessagesDialogComponent } from '../messages/view-messages-dialog.component';

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

  describe('the purge confirmation names the entity, its parent, the connection and the live count', () => {
    it('for a queue: the queue, the connection target and the count, with an acknowledgement naming the queue', () => {
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
      expect(data.requireAcknowledgement).toBe(true);
      expect(data.acknowledgementText).toBe('I understand this deletes every active message in orders');
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
      expect(data.requireAcknowledgement).toBe(true);
      expect(data.acknowledgementText).toBe('I understand this deletes every dead-letter message in billing');
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
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } },
        resubmitRuns
      ]
    });
    const fixture = TestBed.createComponent(EntityDetailsComponent);
    fixture.detectChanges();
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
    expect(property(el, 'Max Size')).toBe('2048 MB');
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
    it('sessions: a broker without sessions hides the Sessions tab of a session subscription; Azure shows it', () => {
      expect(all(render(subscription({ requiresSession: true }), DEFAULT_RABBITMQ_CAPABILITIES), 'button')).not.toContain('Sessions');
      TestBed.resetTestingModule();
      expect(all(render(subscription({ requiresSession: true }), DEFAULT_AZURE_CAPABILITIES), 'button')).toContain('Sessions');
    });

    it('scheduled: a broker without scheduled messages hides the Scheduled card of a queue; Azure shows it', () => {
      expect(all(render(queue({}), DEFAULT_RABBITMQ_CAPABILITIES), '.stat-label')).not.toContain('Scheduled');
      TestBed.resetTestingModule();
      expect(all(render(queue({}), DEFAULT_AZURE_CAPABILITIES), '.stat-label')).toContain('Scheduled');
    });

    it('dead letter: a broker without a dead-letter queue hides the Dead Letter cards and Auto Resubmit of a queue and a subscription; Azure shows them', () => {
      const hiddenQueue = render(queue({ transferDeadLetterMessageCount: 4 }), NO_DEAD_LETTER);
      expect(all(hiddenQueue, '.stat-label')).toEqual(['Active Messages', 'Scheduled', 'Size']);
      expect(all(hiddenQueue, 'button').some(b => b.startsWith('Auto Resubmit'))).toBe(false);
      TestBed.resetTestingModule();
      const hiddenSubscription = render(subscription({}), NO_DEAD_LETTER);
      expect(all(hiddenSubscription, '.stat-label')).not.toContain('Dead Letter');
      expect(all(hiddenSubscription, 'button').some(b => b.startsWith('Auto Resubmit'))).toBe(false);
      TestBed.resetTestingModule();

      const shownQueue = render(queue({ transferDeadLetterMessageCount: 4 }), DEFAULT_AZURE_CAPABILITIES);
      expect(all(shownQueue, '.stat-label')).toEqual(['Active Messages', 'Dead Letter', 'Transfer Dead Letter', 'Scheduled', 'Size']);
      expect(all(shownQueue, 'button')).toContain('Auto Resubmit (7)');
      TestBed.resetTestingModule();
      const shownSubscription = render(subscription({}), DEFAULT_AZURE_CAPABILITIES);
      expect(all(shownSubscription, '.stat-label')).toContain('Dead Letter');
      expect(all(shownSubscription, 'button')).toContain('Auto Resubmit (3)');
    });
  });

  describe('the dead-letter entry shows the run of its entity', () => {
    afterEach(() => (resubmitRun = undefined));

    it('while a run is active on the queue, the Auto Resubmit entry shows how far it got, even once the count reads 0', () => {
      resubmitRun = { isActive: () => true, progress: signal({ status: 'running', read: 480, total: 700 }) } as unknown as ResubmitRun;

      const el = render(queue({ deadLetterMessageCount: 0 }));

      expect(all(el, 'button')).toContain('Resubmit running: 480 of 700');
      expect(all(el, 'button').some(b => b.startsWith('Auto Resubmit'))).toBe(false);
    });

    it('a finished run leaves the entry as it was', () => {
      resubmitRun = { isActive: () => false, progress: signal({ status: 'completed', read: 700, total: 700 }) } as unknown as ResubmitRun;

      expect(all(render(queue({})), 'button')).toContain('Auto Resubmit (7)');
    });
  });

  describe('create, edit and status are not visible unless the capability is explicitly true', () => {
    const { supportsEntityUpdate: _, ...WITHOUT_FLAG } = DEFAULT_AZURE_CAPABILITIES;
    const ENABLED: ProviderCapabilities = { ...DEFAULT_AZURE_CAPABILITIES, supportsEntityUpdate: true };
    const admin = (el: HTMLElement) => ({
      status: text(el.querySelector('app-entity-admin-actions mat-chip .label')),
      buttons: all(el, 'app-entity-admin-actions button').map(b => b.replace(/^(edit|toggle_on)\s*/, ''))
    });

    it('with the capability, the queue, topic and subscription panels show the status chip, Edit and Status', () => {
      expect(admin(render(queue({ status: 'Active' }), ENABLED))).toStrictEqual({ status: 'Active', buttons: ['Edit', 'Status'] });
      TestBed.resetTestingModule();
      expect(admin(render(topic({ ...fullTopic, status: 'SendDisabled' }), ENABLED))).toStrictEqual({ status: 'Send disabled', buttons: ['Edit', 'Status'] });
      TestBed.resetTestingModule();
      expect(admin(render(subscription({ status: 'ReceiveDisabled' }), ENABLED))).toStrictEqual({ status: 'Receive disabled', buttons: ['Edit', 'Status'] });
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
      expect(statCard(el, 'Transfer Dead Letter')).toBe('4');
    });

    it('a value the API did not send is "Not set", not 0 or false, and a zero transfer dead-letter count is not shown', () => {
      const el = render(queue({ transferDeadLetterMessageCount: 0 }));

      for (const label of ['Lock Duration', 'Message TTL', 'Status', 'Created At (UTC)', 'Updated At (UTC)', 'Accessed At (UTC)', 'Dead-lettering On Expiration',
        'Auto Delete On Idle', 'Forward To', 'Forward Dead-lettered To', 'Duplicate Detection', 'User Metadata']) {
        expect(property(el, label), label).toBe('Not set');
      }
      expect(statCard(el, 'Transfer Dead Letter')).toBeUndefined();
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
    open = vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open').mockReturnValue({} as never) as unknown as ReturnType<typeof vi.fn>;
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
    const transfer = card(el, 'Transfer Dead Letter');
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
    const transfer = card(el, 'Transfer Dead Letter');
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
    open = vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open').mockReturnValue({} as never) as unknown as ReturnType<typeof vi.fn>;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const card = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('.metric-card'))
    .find(c => c.querySelector('.stat-label')?.textContent?.trim() === 'Transfer Dead Letter');

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

  it('a zero count shows no card, even with the flag', () => {
    const el = render(subscription(0), { ...DEFAULT_AZURE_CAPABILITIES, supportsTransferDeadLetter: true });

    expect(card(el)).toBeUndefined();
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
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } },
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

  it('a broker that declares no sessions shows no Sessions tab even on a session queue', () => {
    expect(tabs(render(queue('orders', true), DEFAULT_RABBITMQ_CAPABILITIES).nativeElement)).toStrictEqual(['Properties']);
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

    await select(fixture, 'Description');
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
        { provide: EntitySelectionService, useValue: { state$: of(state), currentSelection: state.selection, isLoading: false, refreshCurrentSelection } },
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
    expect(button(el, 'View Messages')).toBeDefined();
    expect(button(el, 'Send Message')).toBeDefined();

    const items = await openMenu(fixture);

    expect(items.map(text)).toStrictEqual(['Import messages', 'Purge active messages 120']);
    expect(items[1].classList.contains('danger'), 'purge in the error colour').toBe(true);
    items[1].click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(ConfirmDialogComponent);
    expect(open.mock.calls[0][1].data.message).toBe('This deletes every active message in queue "orders" on prod.example.net: 120 when the queue was loaded. It cannot be undone.');
  });

  it('the subscription panel has View Messages like the queue panel, and its three purges sit in More actions', async () => {
    const fixture = render({ selection: subscription, loading: false, error: null });

    button(fixture.nativeElement, 'View Messages')!.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(ViewMessagesDialogComponent);
    expect(open.mock.calls[0][1].data).toMatchObject({ entityType: 'subscription', entityName: 'billing', topicName: 'events' });

    const items = await openMenu(fixture);
    expect(items.map(text)).toStrictEqual(['Purge Active Messages 5', 'Purge Dead-letter Messages 3', 'Purge All Messages 8']);
  });

  it('the Active and Dead Letter cards are buttons named with their count that open the messages on their tab, by Enter', () => {
    const el = render({ selection: queue, loading: false, error: null }).nativeElement as HTMLElement;
    const card = (label: string) => Array.from(el.querySelectorAll<HTMLElement>('.stat-card')).find(c => text(c.querySelector('.stat-label')) === label)!;

    expect(card('Active Messages').getAttribute('role')).toBe('button');
    expect(card('Active Messages').getAttribute('aria-label')).toBe('View the 120 active messages');
    expect(card('Dead Letter').getAttribute('aria-label')).toBe('View the 7 dead-letter messages');
    card('Active Messages').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    card('Dead Letter').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(open.mock.calls.map(c => c[1].data.initialTab)).toStrictEqual([0, 1]);
  });
});
