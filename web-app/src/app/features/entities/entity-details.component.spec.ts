import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NEVER, of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EntityDetailsComponent } from './entity-details.component';
import { ConnectionService, EntitySelectionService, QueueService, SessionService, TopicService } from '../../core/services';
import { EntitySelection } from '../../core/models';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { DEFAULT_AZURE_CAPABILITIES, DEFAULT_RABBITMQ_CAPABILITIES, ProviderService } from '../../core/services/provider.service';
import { ProviderCapabilities } from '../../core/models/provider.model';

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
        { provide: ProviderService, useValue: { capabilities: signal(DEFAULT_AZURE_CAPABILITIES) } }
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
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } }
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
      expect(all(hiddenSubscription, '.card-header')).not.toContain('Dead Letter');
      expect(all(hiddenSubscription, 'button').some(b => b.startsWith('Auto Resubmit'))).toBe(false);
      TestBed.resetTestingModule();

      const shownQueue = render(queue({ transferDeadLetterMessageCount: 4 }), DEFAULT_AZURE_CAPABILITIES);
      expect(all(shownQueue, '.stat-label')).toEqual(['Active Messages', 'Dead Letter', 'Transfer Dead Letter', 'Scheduled', 'Size']);
      expect(all(shownQueue, 'button')).toContain('Auto Resubmit (7)');
      TestBed.resetTestingModule();
      const shownSubscription = render(subscription({}), DEFAULT_AZURE_CAPABILITIES);
      expect(all(shownSubscription, '.card-header')).toContain('Dead Letter');
      expect(all(shownSubscription, 'button')).toContain('Auto Resubmit (3)');
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
