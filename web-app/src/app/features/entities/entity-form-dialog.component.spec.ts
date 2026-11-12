import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import {
  ConnectionGroupService, ConnectionService, EntitySelectionService, QueueService, TopicService, TreeDataBuilderService
} from '../../core/services';
import { EntityFormDialogComponent, EntityFormDialogData } from './entity-form-dialog.component';
import { EntityReviewDialogComponent } from './entity-review-dialog.component';

const NEVER_TIMESPAN = '10675199.02:48:05.4775807';

describe('EntityFormDialogComponent', () => {
  let fixture: ComponentFixture<EntityFormDialogComponent>;
  let el: HTMLElement;
  let close: ReturnType<typeof vi.fn>;
  let openReview: ReturnType<typeof vi.fn>;
  let queues: Record<string, ReturnType<typeof vi.fn>>;
  let topics: Record<string, ReturnType<typeof vi.fn>>;
  let selection: Record<string, ReturnType<typeof vi.fn>>;

  function open(data: EntityFormDialogData) {
    close = vi.fn();
    openReview = vi.fn(() => ({ afterClosed: () => of(true) }));
    queues = { createQueue: vi.fn(() => of(undefined)), updateQueue: vi.fn((name: string) => of({ name, lockDuration: '00:05:00' })) };
    topics = {
      createTopic: vi.fn(() => of(undefined)),
      updateTopic: vi.fn((name: string) => of({ name })),
      createSubscription: vi.fn(() => of(undefined)),
      updateSubscription: vi.fn((topic: string, name: string) => of({ topicName: topic, name }))
    };
    selection = { refreshTree: vi.fn(), select: vi.fn(), showEntity: vi.fn(), clearSelection: vi.fn() };
    TestBed.configureTestingModule({
      imports: [EntityFormDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MatDialog, useValue: { open: openReview } },
        { provide: QueueService, useValue: queues },
        { provide: TopicService, useValue: topics },
        { provide: EntitySelectionService, useValue: selection },
        { provide: TreeDataBuilderService, useValue: { loadedNames: () => ({ queues: ['orders', 'orders-retry'], topics: ['events'] }) } },
        {
          provide: ConnectionService,
          useValue: {
            currentTarget: 'ns.example.net',
            currentConnectionId: 'c-1',
            getConnections: () => of([{ id: 'c-1', name: 'contoso-prod', clientId: 'g-client', environmentId: 'g-env' }])
          }
        },
        {
          provide: ConnectionGroupService,
          useValue: { getGroups: () => of([{ id: 'g-client', name: 'Contoso', type: 'client' }, { id: 'g-env', name: 'Production', type: 'environment' }]) }
        }
      ]
    });
    fixture = TestBed.createComponent(EntityFormDialogComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    return fixture.componentInstance;
  }

  const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const field = (label: string) =>
    Array.from(el.querySelectorAll('mat-form-field')).find(f => text(f.querySelector('mat-label')) === label) as HTMLElement | undefined;
  const type = (label: string, value: string) => {
    const input = field(label)!.querySelector('input, textarea') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  };
  const set = (path: string, value: unknown) => {
    const control = fixture.componentInstance.form.get(path)!;
    control.setValue(value);
    control.markAsDirty();
    fixture.detectChanges();
  };
  const fieldError = (label: string) => text(field(label)?.querySelector('mat-error'));
  const button = (label: string) =>
    Array.from(el.querySelectorAll('button')).find(b => text(b).startsWith(label)) as HTMLButtonElement | undefined;
  const alert = () => text(el.querySelector('[role="alert"] .grow'));
  const facts = (root: Element) => Array.from(root.querySelectorAll('.fact')).map(f => `${text(f.querySelector('dt'))} ${text(f.querySelector('dd'))}`);
  const click = (label: string) => {
    button(label)!.click();
    fixture.detectChanges();
  };
  const fail = (status: number, body: unknown = null) => () => throwError(() => new HttpErrorResponse({ status, error: body }));

  describe('create a queue, a topic and a subscription', () => {
    it('create a queue: posts the name and only the options the user set; the tree refreshes and the new queue is selected', () => {
      open({ mode: 'create', kind: 'queue' });
      type('Queue name', 'orders-archive');
      type('Lock duration', '30');
      set('lockDuration.unit', 'seconds');
      set('enableBatchedOperations', false);

      click('Create queue');

      expect(queues['createQueue'].mock.calls).toStrictEqual([
        ['orders-archive', { lockDuration: '00:00:30', enableBatchedOperations: false }]
      ]);
      expect(selection['refreshTree']).toHaveBeenCalledTimes(1);
      expect(selection['select'].mock.calls[0][0]).toMatchObject({ id: 'queue-orders-archive', name: 'orders-archive', type: 'queue' });
      expect(close).toHaveBeenCalledWith('orders-archive');
    });

    it('a create with nothing but the name sends no options, so the broker applies its defaults', () => {
      open({ mode: 'create', kind: 'queue' });
      type('Queue name', 'orders-archive');
      type('Max delivery count', '5');
      type('Max delivery count', '');

      click('Create queue');

      expect(queues['createQueue'].mock.calls).toStrictEqual([['orders-archive', undefined]]);
    });

    it('create a topic: posts the name and the options set through createTopic', () => {
      open({ mode: 'create', kind: 'topic' });
      type('Topic name', 'order-events');
      set('supportOrdering', true);
      type('Message time to live', '14');
      set('defaultMessageTimeToLive.unit', 'days');

      click('Create topic');

      expect(topics['createTopic'].mock.calls).toStrictEqual([
        ['order-events', { supportOrdering: true, defaultMessageTimeToLive: '14.00:00:00' }]
      ]);
      expect(selection['select'].mock.calls[0][0]).toMatchObject({ id: 'topic-order-events', type: 'topic' });
    });

    it('create a subscription: posts to its topic, names the topic, and selects the new subscription under it', () => {
      open({ mode: 'create', kind: 'subscription', topicName: 'events' });
      expect(facts(el)).toStrictEqual(['Topic events']);
      type('Subscription name', 'audit');
      type('Max delivery count', '5');

      click('Create subscription');

      expect(topics['createSubscription'].mock.calls).toStrictEqual([['events', 'audit', { maxDeliveryCount: 5 }]]);
      expect(selection['select'].mock.calls[0][0]).toMatchObject({
        id: 'subscription-events-audit', name: 'audit', type: 'subscription', data: { topicName: 'events' }
      });
    });

    it('the dialog says where the entity will be created: the connection and its environment', () => {
      open({ mode: 'create', kind: 'queue' });

      expect(text(el.querySelector('.context mat-chip'))).toBe('Contoso / Production');
      expect(text(el.querySelector('.context > span'))).toBe('contoso-prod (ns.example.net)');
    });

    it('a name the API would refuse shows the rule beside the field and Create stays disabled', () => {
      open({ mode: 'create', kind: 'queue' });
      type('Queue name', 'orders/');

      expect(fieldError('Queue name')).toBe('Use 1 to 260 letters, digits, ".", "-", "_" or "/", not starting or ending with "/".');
      expect(button('Create queue')!.disabled).toBe(true);
    });
  });

  describe('a refused or failed create keeps the dialog open with the input', () => {
    it('409: the name field says the queue already exists; nothing is selected', () => {
      open({ mode: 'create', kind: 'queue' });
      queues['createQueue'].mockImplementation(fail(409, { message: 'exists' }));
      type('Queue name', 'orders');

      click('Create queue');

      expect(fieldError('Queue name')).toBe('A queue named orders already exists in this namespace.');
      expect(close).not.toHaveBeenCalled();
      expect(selection['select']).not.toHaveBeenCalled();
    });

    it('400: the API message shows inside the dialog, the input stays, no spinner is left running', () => {
      open({ mode: 'create', kind: 'queue' });
      queues['createQueue'].mockImplementation(fail(400, { message: 'lockDuration must be between 5 seconds and 5 minutes.' }));
      type('Queue name', 'orders-archive');
      type('Lock duration', '30');
      set('lockDuration.unit', 'seconds');

      click('Create queue');

      expect(alert()).toBe('lockDuration must be between 5 seconds and 5 minutes.');
      expect(close).not.toHaveBeenCalled();
      expect((field('Queue name')!.querySelector('input') as HTMLInputElement).value).toBe('orders-archive');
      expect(fixture.componentInstance.form.get('lockDuration')!.value).toStrictEqual({ amount: 30, unit: 'seconds' });
      expect(el.querySelector('mat-progress-bar')).toBeNull();
      expect(button('Create queue')!.disabled).toBe(false);
    });

    it('500: a generic failure, the dialog open, nothing refreshed or selected as if created', () => {
      open({ mode: 'create', kind: 'queue' });
      queues['createQueue'].mockImplementation(fail(500, { message: 'An internal error occurred.' }));
      type('Queue name', 'orders-archive');

      click('Create queue');

      expect(alert()).toBe('Could not create the queue: the API did not confirm it. Try again.');
      expect(close).not.toHaveBeenCalled();
      expect(selection['refreshTree']).not.toHaveBeenCalled();
      expect(selection['select']).not.toHaveBeenCalled();
      expect(el.querySelector('mat-progress-bar')).toBeNull();
    });

    it('404 on a queue create, which the contract does not answer, is a generic failure and names no topic', () => {
      open({ mode: 'create', kind: 'queue' });
      queues['createQueue'].mockImplementation(fail(404));
      type('Queue name', 'orders-archive');

      click('Create queue');

      expect(alert()).toBe('Could not create the queue: the API did not confirm it. Try again.');
      expect(button('Refresh')).toBeUndefined();
    });

    it('404 on a subscription: the topic no longer exists, and Refresh reloads the tree and closes', () => {
      open({ mode: 'create', kind: 'subscription', topicName: 'events' });
      topics['createSubscription'].mockImplementation(fail(404, { message: 'Topic not found.' }));
      type('Subscription name', 'audit');

      click('Create subscription');

      expect(alert()).toBe('The topic events no longer exists. Refresh to see the entities as they are now.');
      expect(button('Refresh'), 'a Refresh action is offered').toBeDefined();
      click('Refresh');
      expect(selection['refreshTree']).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe('edit an existing entity', () => {
    const queue = {
      name: 'orders',
      lockDuration: '00:02:00',
      maxDeliveryCount: 7,
      defaultMessageTimeToLive: '14.00:00:00',
      autoDeleteOnIdle: NEVER_TIMESPAN,
      maxSizeInMegabytes: 1024,
      duplicateDetectionHistoryTimeWindow: '00:10:00',
      forwardTo: 'orders-retry',
      forwardDeadLetteredMessagesTo: null,
      userMetadata: 'owned by billing',
      deadLetteringOnMessageExpiration: true,
      enableBatchedOperations: true,
      requiresSession: true,
      enablePartitioning: false,
      requiresDuplicateDetection: false,
      status: 'Active'
    };
    const editQueue = () => open({ mode: 'edit', kind: 'queue', entity: queue as never });

    it('the form is prefilled from the entity as read; Save is disabled until something differs', () => {
      const component = editQueue();

      expect(component.form.get('lockDuration')!.value).toStrictEqual({ amount: 2, unit: 'minutes' });
      expect(component.form.get('maxDeliveryCount')!.value).toBe(7);
      expect(component.form.get('defaultMessageTimeToLive')!.value).toStrictEqual({ amount: 14, unit: 'days' });
      expect(component.form.get('forwardTo')!.value).toBe('orders-retry');
      expect(button('Save')!.disabled).toBe(true);
    });

    it('a duration of never is prefilled empty, says it is never, and is not a change', () => {
      const component = editQueue();

      expect(component.form.get('autoDeleteOnIdle')!.value).toStrictEqual({ amount: null, unit: 'minutes' });
      expect(text(field('Auto delete on idle')!.querySelector('mat-hint'))).toBe('Now: never. Leave empty to keep it.');
      expect(component.changes()).toStrictEqual([]);
    });

    it('the PATCH body holds only the changed fields, and the review lists exactly those with the current and the new value', () => {
      editQueue();
      type('Lock duration', '5');
      type('Max delivery count', '10');

      expect(text(button('Save'))).toBe('Save 2 changes');
      click('Save');

      expect(openReview).toHaveBeenCalledTimes(1);
      const [component, config] = openReview.mock.calls[0];
      expect(component).toBe(EntityReviewDialogComponent);
      expect(config.data.entityName).toBe('orders');
      expect(config.data.context()).toStrictEqual({ connection: 'contoso-prod (ns.example.net)', environment: 'Contoso / Production' });
      expect(config.data.changes).toStrictEqual([
        { label: 'Lock duration', from: '2 minutes', to: '5 minutes' },
        { label: 'Max delivery count', from: '7', to: '10' }
      ]);
      expect(queues['updateQueue'].mock.calls).toStrictEqual([['orders', { lockDuration: '00:05:00', maxDeliveryCount: 10 }]]);
      expect(selection['showEntity']).toHaveBeenCalledWith({ name: 'orders', lockDuration: '00:05:00' });
      expect(close).toHaveBeenCalledWith({ name: 'orders', lockDuration: '00:05:00' });
    });

    it('a field changed and changed back is not a change', () => {
      editQueue();
      type('Lock duration', '5');
      type('Lock duration', '2');

      expect(button('Save')!.disabled).toBe(true);
    });

    it('going Back from the review sends nothing and keeps the dialog open', () => {
      editQueue();
      openReview.mockReturnValue({ afterClosed: () => of(false) });
      type('Max delivery count', '10');

      click('Save');

      expect(queues['updateQueue']).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    });

    it('the fields fixed at creation cannot be edited: they are text with a note, and have no control', () => {
      const component = editQueue();

      for (const key of ['requiresSession', 'enablePartitioning', 'requiresDuplicateDetection']) {
        expect(component.form.get(key), key).toBeNull();
      }
      const fixed = el.querySelector('.fixed')!;
      expect(text(fixed.querySelector('h3'))).toBe('Fixed at creation');
      expect(text(fixed.querySelector('p'))).toBe('These cannot change after the queue is created.');
      expect(facts(fixed)).toStrictEqual(['Requires session Yes', 'Partitioning No', 'Duplicate detection No']);
      expect(fixed.querySelectorAll('input, mat-select, textarea').length).toBe(0);
    });

    it('a cleared forward target is sent as an empty string', () => {
      editQueue();
      set('forwardTo', '');

      click('Save');

      expect(queues['updateQueue'].mock.calls).toStrictEqual([['orders', { forwardTo: '' }]]);
    });

    it('a forward target can only be an existing queue or topic other than the entity', () => {
      const component = editQueue();

      expect(component.targets).toStrictEqual(['orders-retry', 'events']);
      set('forwardDeadLetteredMessagesTo', 'typed-by-hand');
      expect(component.form.get('forwardDeadLetteredMessagesTo')!.errors).toStrictEqual({ message: 'Choose a queue or topic other than this one.' });
      expect(button('Save')!.disabled).toBe(true);
      set('forwardDeadLetteredMessagesTo', 'orders');
      expect(button('Save')!.disabled).toBe(true);
      set('forwardDeadLetteredMessagesTo', 'events');
      expect(button('Save')!.disabled).toBe(false);
    });

    it('a value out of range shows the allowed range beside the field and Save stays disabled', () => {
      editQueue();
      type('Lock duration', '10');

      expect(fieldError('Lock duration')).toBe('Lock duration must be between 5 seconds and 5 minutes.');
      expect(button('Save')!.disabled).toBe(true);

      type('Lock duration', '2');
      type('Max delivery count', '0');
      expect(fieldError('Max delivery count')).toBe('Max delivery count must be between 1 and 2000.');
      expect(button('Save')!.disabled).toBe(true);
    });

    it('a duration that had a value cannot be emptied: an empty field cannot be sent', () => {
      editQueue();
      type('Lock duration', '');

      expect(fieldError('Lock duration')).toBe('Enter a value; an empty field cannot be saved.');
      expect(button('Save')!.disabled).toBe(true);
    });

    it('a topic: updateTopic with the changed field only', () => {
      open({ mode: 'edit', kind: 'topic', entity: { name: 'events', supportOrdering: false, maxSizeInMegabytes: 1024, enablePartitioning: true } as never });
      set('supportOrdering', true);

      click('Save');

      expect(topics['updateTopic'].mock.calls).toStrictEqual([['events', { supportOrdering: true }]]);
    });

    it('a subscription: updateSubscription under its topic, and requiresSession is fixed', () => {
      const component = open({
        mode: 'edit', kind: 'subscription', topicName: 'events',
        entity: { topicName: 'events', name: 'billing', maxDeliveryCount: 10, requiresSession: false } as never
      });
      expect(component.form.get('requiresSession')).toBeNull();
      type('Max delivery count', '3');

      click('Save');

      expect(topics['updateSubscription'].mock.calls).toStrictEqual([['events', 'billing', { maxDeliveryCount: 3 }]]);
    });
  });

  describe('a refused or failed update keeps the dialog open with the input', () => {
    const queue = { name: 'orders', maxDeliveryCount: 7 };

    function editAndSave(response: () => Observable<never>) {
      open({ mode: 'edit', kind: 'queue', entity: queue as never });
      queues['updateQueue'].mockImplementation(response);
      type('Max delivery count', '10');
      click('Save');
    }

    it('400: the API message shows, the dialog stays open with the new value, nothing shown as saved', () => {
      editAndSave(fail(400, { message: 'The broker refused this configuration.' }));

      expect(alert()).toBe('The broker refused this configuration.');
      expect(close).not.toHaveBeenCalled();
      expect(selection['showEntity']).not.toHaveBeenCalled();
      expect(fixture.componentInstance.form.get('maxDeliveryCount')!.value).toBe(10);
      expect(el.querySelector('mat-progress-bar')).toBeNull();
    });

    it('404: says the queue no longer exists and offers Refresh, which reloads the tree and clears the panel', () => {
      editAndSave(fail(404, { message: 'Not found.' }));

      expect(alert()).toBe('This queue no longer exists. Refresh to see the entities as they are now.');
      expect(button('Refresh'), 'a Refresh action is offered').toBeDefined();
      click('Refresh');
      expect(selection['refreshTree']).toHaveBeenCalledTimes(1);
      expect(selection['clearSelection']).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('500 or no answer: a generic failure, the dialog open, nothing shown as saved', () => {
      editAndSave(fail(0));

      expect(alert()).toBe('Could not save the changes: the API did not confirm them. Try again.');
      expect(close).not.toHaveBeenCalled();
      expect(selection['showEntity']).not.toHaveBeenCalled();
      expect(el.querySelector('mat-progress-bar')).toBeNull();
    });
  });
});
