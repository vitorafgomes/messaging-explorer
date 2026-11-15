import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { formatDate } from '@angular/common';
import { Observable, of, Subject } from 'rxjs';
import { throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ViewMessagesDialogComponent, ViewMessagesDialogData } from './view-messages-dialog.component';
import { ConnectionService, QueueService, TopicService } from '../../core/services';
import { BatchOperationResult, MessageInfo } from '../../core/models';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { MoveMessagesDialogComponent } from './move-messages-dialog.component';
import { CancelScheduledDialogComponent } from './cancel-scheduled-dialog.component';
import { DeadLetterDeferredDialogComponent } from './deadletter-deferred-dialog.component';
import { ContinuousResubmitDialogComponent } from './continuous-resubmit-dialog.component';
import { EntityStatusDialogComponent } from '../entities/entity-status-dialog.component';
import { SendMessageDialogComponent } from './send-message-dialog.component';
import { BulkOperationProgressDialogComponent } from '../../shared/components/bulk-operation-progress-dialog/bulk-operation-progress-dialog.component';
import { BulkOperationResultsDialogComponent } from '../../shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component';
import { DEFAULT_AZURE_CAPABILITIES, DEFAULT_RABBITMQ_CAPABILITIES, ProviderService } from '../../core/services/provider.service';
import { ProviderCapabilities } from '../../core/models/provider.model';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FilterLogic, FilterOperator } from '../../core/models/filter.model';

const message = (sequenceNumber: number, body = `body ${sequenceNumber}`): MessageInfo => ({
  messageId: `id-${sequenceNumber}`,
  body,
  bodyType: 'string',
  sequenceNumber,
  deliveryCount: 0,
  enqueuedTime: new Date('2026-11-12T08:00:00Z'),
  timeToLive: '14.00:00:00',
  applicationProperties: {}
});

const messages = (count: number, bodyFor: (n: number) => string = n => `body ${n}`) =>
  Array.from({ length: count }, (_, i) => message(i + 1, bodyFor(i + 1)));

const azureMoveDuplicate = 'Message was moved to the target but could not be removed from the source and may be duplicated: lock lost';
const azureResubmitDuplicate = 'Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: lock lost';

describe('ViewMessagesDialogComponent', () => {
  let queueService: Record<string, ReturnType<typeof vi.fn>>;
  let dialog: { open: ReturnType<typeof vi.fn>; openDialogs: unknown[] };
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let confirmations: Array<{ data: any; closed: Subject<boolean> }>;
  let resultsResponse: unknown;
  let resultsData: any[];
  const selfRef = { close: vi.fn() };

  function configure(data: Partial<ViewMessagesDialogData>, active: MessageInfo[], deadLetter: MessageInfo[] = [],
    capabilities: ProviderCapabilities | null = DEFAULT_AZURE_CAPABILITIES) {
    queueService['peekMessages'].mockReturnValue(of(active));
    queueService['peekDeadLetterMessages'].mockReturnValue(of(deadLetter));
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { entityType: 'queue', entityName: 'orders', ...data } },
        { provide: MatDialogRef, useValue: selfRef },
        { provide: MatDialog, useValue: dialog },
        { provide: QueueService, useValue: queueService },
        { provide: TopicService, useValue: {} },
        { provide: ConnectionService, useValue: { isConnected: true } },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } }
      ]
    });
  }

  function create(data: Partial<ViewMessagesDialogData>, active: MessageInfo[], deadLetter: MessageInfo[] = []) {
    configure(data, active, deadLetter);
    const component = TestBed.runInInjectionContext(() => new ViewMessagesDialogComponent());
    component.ngOnInit();
    return component;
  }

  const keyDown = (key: string) =>
    ({ key, target: document.body, ctrlKey: false, metaKey: false, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

  beforeEach(() => {
    sessionStorage.clear();
    confirmations = [];
    resultsData = [];
    resultsResponse = { retry: false };
    snackBar = { open: vi.fn() };
    queueService = {
      peekMessages: vi.fn(),
      peekDeadLetterMessages: vi.fn(),
      deleteMessages: vi.fn().mockReturnValue(new Subject<BatchOperationResult>()),
      resubmitDeadLetterMessages: vi.fn(),
      moveMessages: vi.fn()
    };
    dialog = {
      openDialogs: [selfRef],
      open: vi.fn((component: unknown, config?: { data?: any }) => {
        if (component === ConfirmDialogComponent) {
          const closed = new Subject<boolean>();
          const ref = { afterClosed: () => closed };
          confirmations.push({ data: config?.data, closed });
          dialog.openDialogs.push(ref);
          return ref;
        }
        if (component === BulkOperationProgressDialogComponent) {
          return { componentInstance: { cancelRequested$: new Subject<void>(), updateProgress: vi.fn() }, close: vi.fn() };
        }
        if (component === BulkOperationResultsDialogComponent) {
          resultsData.push(config?.data);
          return { afterClosed: () => of(resultsResponse) };
        }
        if (component === MoveMessagesDialogComponent) {
          return { afterClosed: () => of({ targetQueueName: 'orders-retry', newMessageIdOnDuplicateDetection: false }) };
        }
        throw new Error('unexpected dialog');
      })
    };
  });

  afterEach(() => vi.useRealTimers());

  describe('selecting the loaded page, or the hits of a search, never deletes the whole entity', () => {
    it('20 loaded of 50,000, select all, delete: the request has all=false and the 20 sequence numbers', () => {
      const component = create({ activeMessageCount: 50000 }, messages(20));

      component.toggleAllActive(true);
      component.onBulkAction({ action: 'delete' });
      confirmations[0].closed.next(true);

      expect(queueService['deleteMessages']).toHaveBeenCalledTimes(1);
      const [, sequenceNumbers, isDeadLetter, all] = queueService['deleteMessages'].mock.calls[0];
      expect(all).toBe(false);
      expect(isDeadLetter).toBe(false);
      expect([...sequenceNumbers].sort((a: number, b: number) => a - b)).toEqual(messages(20).map(m => m.sequenceNumber));
      expect(confirmations[0].data.typedName, 'a delete of the loaded messages asks for no typed name').toBeUndefined();
      expect(confirmations[0].data.context, 'the delete confirmation draws the environment line of orders on the active connection').toStrictEqual({ subject: 'orders' });
    });

    it('search to 3, select all, clear the search: the selection is gone and delete sends nothing', () => {
      const component = create({ activeMessageCount: 20 }, messages(20, n => (n <= 3 ? `match ${n}` : `other ${n}`)));
      component.activeFilterText = 'match';
      component.onFilterChange();
      expect(component.filteredActiveMessages.length).toBe(3);
      component.toggleAllActive(true);
      expect(component.getSelectedCount()).toBe(3);

      component.clearActiveFilter();
      component.onBulkAction({ action: 'delete' });

      expect(component.getSelectedCount()).toBe(0);
      expect(confirmations.length).toBe(0);
      expect(queueService['deleteMessages']).not.toHaveBeenCalled();
    });

    it('every message of the entity selected but a search is active: all=false', () => {
      const component = create({ activeMessageCount: 3 }, messages(3, n => `match ${n}`));
      component.activeFilterText = 'match';
      component.onFilterChange();
      component.toggleAllActive(true);

      component.onBulkAction({ action: 'delete' });
      confirmations[0].closed.next(true);

      const [, sequenceNumbers, , all] = queueService['deleteMessages'].mock.calls[0];
      expect(all).toBe(false);
      expect(sequenceNumbers.length).toBe(3);
    });

    it('every message of the entity selected, no filter: all=true after a confirmation by the typed queue name', () => {
      const component = create({ activeMessageCount: 20 }, messages(20));

      component.toggleAllActive(true);
      component.onBulkAction({ action: 'delete' });
      confirmations[0].closed.next(true);

      const [, sequenceNumbers, , all] = queueService['deleteMessages'].mock.calls[0];
      expect(all).toBe(true);
      expect(sequenceNumbers).toEqual([]);
      expect(confirmations[0].data.typedName, 'draining the queue is confirmed by typing its name').toBe('orders');
      expect(confirmations[0].data.context, 'the drain confirmation draws the environment line of orders on the active connection').toStrictEqual({ subject: 'orders' });
      expect(confirmations[0].data.typedLabel).toBe('Type the queue name to confirm');
    });

    it('dead-letter tab: search to 3, select all, clear the search: the selection is gone and delete sends nothing', () => {
      const component = create({ initialTab: 1, deadLetterMessageCount: 20 }, [], messages(20, n => (n <= 3 ? `match ${n}` : `other ${n}`)));
      component.dlFilterText = 'match';
      component.onDLFilterChange();
      component.toggleAllDeadLetter(true);
      expect(component.getSelectedCount()).toBe(3);

      component.clearDLFilter();
      component.onBulkAction({ action: 'delete' });

      expect(component.getSelectedCount()).toBe(0);
      expect(queueService['deleteMessages']).not.toHaveBeenCalled();
    });

    it('dead-letter tab: 20 loaded of 37, select all, delete: all=false; every one of 20 selected: all=true', () => {
      const partial = create({ initialTab: 1, activeMessageCount: 20, deadLetterMessageCount: 37 }, [], messages(20));
      partial.toggleAllDeadLetter(true);
      partial.onBulkAction({ action: 'delete' });
      confirmations[0].closed.next(true);
      expect(queueService['deleteMessages'].mock.calls[0][2]).toBe(true);
      expect(queueService['deleteMessages'].mock.calls[0][3]).toBe(false);
      expect(queueService['deleteMessages'].mock.calls[0][1].length).toBe(20);

      TestBed.resetTestingModule();
      queueService['deleteMessages'].mockClear();
      const whole = create({ initialTab: 1, activeMessageCount: 37, deadLetterMessageCount: 20 }, [], messages(20));
      whole.toggleAllDeadLetter(true);
      whole.onBulkAction({ action: 'delete' });
      confirmations[1].closed.next(true);
      expect(queueService['deleteMessages'].mock.calls[0][3]).toBe(true);
    });

    it('the selection bar says how many are selected of how many loaded and how many the entity holds', () => {
      const component = create({ activeMessageCount: 50000, deadLetterMessageCount: 37 }, messages(20), messages(20));

      expect(component.getSelectionSummary()).toBe(`selected of 20 loaded, ${(50000).toLocaleString()} in the queue`);
      component.setTab(1);
      expect(component.getSelectionSummary()).toBe('selected of 20 loaded, 37 in the dead-letter queue');
    });
  });

  describe('a target that detects duplicates: "Send with a new message ID"', () => {
    const refusal = 'The target detects duplicates; a copy with the same message id would be dropped. Nothing was sent or removed.';
    const ok = (count: number): BatchOperationResult => ({ success: true, successCount: count, failureCount: 0, failures: [] });

    it('the bulk resubmit sends a new message id only when the user ticked the option, which shows when the target detects duplicates', () => {
      vi.useFakeTimers();
      const component = create({ initialTab: 1, targetDetectsDuplicates: true }, [], messages(1));
      queueService['resubmitDeadLetterMessages'].mockReturnValue(of(ok(1)));

      expect(component.targetDetectsDuplicates(), 'the option shows when the queue detects duplicates').toBe(true);
      component.resubmitSelected([1]);
      component.newMessageId.set(true);
      component.resubmitSelected([1]);
      vi.advanceTimersByTime(1500);

      expect(queueService['resubmitDeadLetterMessages'].mock.calls.map((call: unknown[]) => call[2]), 'unticked sends false, ticked sends true').toEqual([false, true]);
    });

    it('the single resubmit, where the app does not know, offers the option after a duplicate refusal and sends it only when ticked', () => {
      const component = create({ initialTab: 1 }, [], messages(1));
      queueService['resubmitDeadLetterMessage'] = vi.fn()
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 400, error: { message: refusal } })))
        .mockReturnValue(of({ success: true }));

      expect(component.targetDetectsDuplicates(), 'the option is hidden while the app does not know').toBe(false);
      component.resubmit(messages(1)[0]);
      expect(component.targetDetectsDuplicates(), 'a refusal by a target that detects duplicates offers the option on retry').toBe(true);
      component.resubmit(messages(1)[0]);
      component.newMessageId.set(true);
      component.resubmit(messages(1)[0]);

      expect(queueService['resubmitDeadLetterMessage'].mock.calls.map((call: unknown[]) => call[2]), 'only the resubmit made after ticking asks for a new id').toEqual([false, false, true]);
    });

    it('a bulk resubmit refused as a duplicate is retried with a new id when the user ticked it in the results', () => {
      vi.useFakeTimers();
      const component = create({ initialTab: 1 }, [], messages(2));
      queueService['resubmitDeadLetterMessages']
        .mockReturnValueOnce(of({ success: false, successCount: 0, failureCount: 2, failures: [{ sequenceNumber: 1, error: refusal }, { sequenceNumber: 2, error: refusal }] }))
        .mockReturnValue(of(ok(2)));
      resultsResponse = { retry: true, failedSequenceNumbers: [1, 2], newMessageIdOnDuplicateDetection: true };

      component.resubmitSelected([1, 2]);
      vi.advanceTimersByTime(3000);

      expect(queueService['resubmitDeadLetterMessages'].mock.calls.map((call: unknown[]) => [call[1], call[2]]), 'the refused pair is sent again, with a new id only on the retry the user ticked').toEqual([[[1, 2], false], [[1, 2], true]]);
    });
  });

  describe('Retry Failed never resends a possible duplicate', () => {
    it('on resubmit, the retry request names only the failure that was not sent', () => {
      vi.useFakeTimers();
      const component = create({ initialTab: 1 }, [], messages(3));
      queueService['resubmitDeadLetterMessages']
        .mockReturnValueOnce(of({
          success: false, successCount: 1, failureCount: 2,
          failures: [
            { sequenceNumber: 2, error: azureResubmitDuplicate },
            { sequenceNumber: 3, error: 'The lock supplied is invalid' }
          ]
        }))
        .mockReturnValue(of({ success: true, successCount: 1, failureCount: 0, failures: [] }));
      resultsResponse = { retry: true, failedSequenceNumbers: [2, 3] };

      component.resubmitSelected([1, 2, 3]);
      vi.advanceTimersByTime(1500);

      expect(queueService['resubmitDeadLetterMessages']).toHaveBeenCalledTimes(2);
      expect(queueService['resubmitDeadLetterMessages'].mock.calls[1][1]).toEqual([3]);
    });

    it('on resubmit, no retry is offered or sent when every failure is a possible duplicate', () => {
      vi.useFakeTimers();
      const component = create({ initialTab: 1 }, [], messages(1));
      queueService['resubmitDeadLetterMessages'].mockReturnValue(of({
        success: false, successCount: 0, failureCount: 1,
        failures: [{ sequenceNumber: 1, error: azureResubmitDuplicate }]
      }));
      resultsResponse = { retry: true, failedSequenceNumbers: [1] };

      component.resubmitSelected([1]);
      vi.advanceTimersByTime(1500);

      expect(resultsData[0].allowRetry).toBe(false);
      expect(queueService['resubmitDeadLetterMessages']).toHaveBeenCalledTimes(1);
    });

    it('on move, the retry request names only the failure that was not sent', () => {
      vi.useFakeTimers();
      const component = create({}, messages(3));
      component.toggleAllActive(true);
      queueService['moveMessages']
        .mockReturnValueOnce(of({
          success: false, successCount: 1, failureCount: 2,
          failures: [
            { sequenceNumber: 1, error: azureMoveDuplicate },
            { sequenceNumber: 2, error: 'Message not found' }
          ]
        }))
        .mockReturnValue(of({ success: true, successCount: 1, failureCount: 0, failures: [] }));
      resultsResponse = { retry: true, failedSequenceNumbers: [1, 2] };

      component.onBulkAction({ action: 'move' });
      vi.advanceTimersByTime(1500);

      expect(queueService['moveMessages']).toHaveBeenCalledTimes(2);
      expect(queueService['moveMessages'].mock.calls[1][2]).toEqual([2]);
    });
  });

  describe('a shortcut cannot stack a second delete', () => {
    it('Delete pressed while the confirmation is open does not open a second one', () => {
      const component = create({ activeMessageCount: 50000 }, messages(20));
      component.toggleAllActive(true);

      component.handleKeyboardShortcut(keyDown('Delete'));
      component.handleKeyboardShortcut(keyDown('Delete'));

      expect(confirmations.length).toBe(1);
    });

    it('two confirmed deletes send one request while the first is in flight', () => {
      const component = create({ activeMessageCount: 50000 }, messages(20));
      component.toggleAllActive(true);

      component.onBulkAction({ action: 'delete' });
      component.onBulkAction({ action: 'delete' });
      confirmations[0].closed.next(true);
      confirmations[1].closed.next(true);

      expect(queueService['deleteMessages']).toHaveBeenCalledTimes(1);
    });
  });

  describe('the message detail shows what the API sends about a message', () => {
    function render(selected: MessageInfo | null, capabilities: ProviderCapabilities | null = DEFAULT_AZURE_CAPABILITIES) {
      configure({}, selected ? [selected] : [], [], capabilities);
      const fixture = TestBed.createComponent(ViewMessagesDialogComponent);
      fixture.detectChanges();
      if (selected) {
        fixture.componentInstance.selectMessage(selected);
        fixture.changeDetectorRef.markForCheck();
        fixture.detectChanges();
      }
      return fixture.nativeElement as HTMLElement;
    }

    const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const detail = (el: HTMLElement, label: string) => {
      const item = Array.from(el.querySelectorAll('.detail-item')).find(i => text(i.querySelector('label')) === label);
      return item ? text(item.querySelector('span')) : undefined;
    };

    it('the message detail shows the state when it is not Active, the size, and the session, subject, to, reply to, scheduled time and expiry', () => {
      const scheduled = '2026-11-20T09:30:00Z';
      const expires = '2026-12-01T00:00:00Z';
      const el = render({
        ...message(7),
        state: 'Deferred',
        sizeInBytes: 1536,
        sessionId: 'session-42',
        subject: 'order-created',
        to: 'billing',
        replyTo: 'orders-replies',
        scheduledEnqueueTime: scheduled as unknown as Date,
        expiresAt: expires as unknown as Date
      });

      expect(detail(el, 'State')).toBe('Deferred');
      expect(detail(el, 'Size')).toBe('1,536 bytes');
      expect(detail(el, 'Session ID')).toBe('session-42');
      expect(detail(el, 'Subject')).toBe('order-created');
      expect(detail(el, 'To')).toBe('billing');
      expect(detail(el, 'Reply To')).toBe('orders-replies');
      expect(detail(el, 'Scheduled Time')).toBe(formatDate(scheduled, 'medium', 'en-US').replace(/\s+/g, ' '));
      expect(detail(el, 'Expires At')).toBe(formatDate(expires, 'medium', 'en-US').replace(/\s+/g, ' '));
    });

    it('an Active message has no State row, and a field the API did not send shows a dash', () => {
      const el = render({ ...message(8), state: 'Active', scheduledEnqueueTime: '0001-01-01T00:00:00+00:00' as unknown as Date });

      expect(detail(el, 'State')).toBeUndefined();
      for (const label of ['Size', 'Session ID', 'Subject', 'To', 'Reply To', 'Scheduled Time', 'Expires At']) {
        expect(detail(el, label), label).toBe('-');
      }
    });

    it('a broker without a dead-letter queue has no Dead Letter tab; Azure has it', () => {
      const tabs = (el: HTMLElement) => Array.from(el.querySelectorAll('.sub-queue-tab')).map(t => text(t).replace(/ \d+$/, ''));

      expect(tabs(render(null, { ...DEFAULT_AZURE_CAPABILITIES, supportsDeadLetterQueue: false }))).toEqual(['Active Messages']);
      TestBed.resetTestingModule();
      expect(tabs(render(null, DEFAULT_AZURE_CAPABILITIES))).toEqual(['Active Messages', 'Dead Letter']);
    });
  });
});

describe('ViewMessagesDialogComponent: transfer dead-letter queue, message state, cancel scheduled, disabled entity', () => {
  type Mocks = Record<string, ReturnType<typeof vi.fn>>;
  let queue: Mocks;
  let topic: Mocks;
  let dialog: { open: ReturnType<typeof vi.fn>; openDialogs: unknown[] };
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let opened: Array<{ component: unknown; data: any; closed: Subject<unknown>; config?: { disableClose?: boolean }; cancelRequested$: Subject<void> }>;
  const selfRef = { close: vi.fn() };
  const withTransfer: ProviderCapabilities = { ...DEFAULT_AZURE_CAPABILITIES, supportsTransferDeadLetter: true };
  const ok = (successCount: number): BatchOperationResult => ({ success: true, successCount, failureCount: 0, failures: [] });

  const lastOpened = (component: unknown) => [...opened].reverse().find(o => o.component === component);
  const confirm = () => lastOpened(ConfirmDialogComponent)!.closed.next(true);
  const sorted = (values: number[]) => [...values].sort((a, b) => a - b);

  function providers(data: Partial<ViewMessagesDialogData>, capabilities: ProviderCapabilities | null) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { entityType: 'queue', entityName: 'orders', ...data } },
        { provide: MatDialogRef, useValue: selfRef },
        { provide: MatDialog, useValue: dialog },
        { provide: QueueService, useValue: queue },
        { provide: TopicService, useValue: topic },
        { provide: ConnectionService, useValue: { isConnected: true, currentTarget: 'contoso-prod.servicebus.windows.net' } },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } },
        provideNoopAnimations()
      ]
    });
  }

  function lists(l: { active?: MessageInfo[]; deadLetter?: MessageInfo[]; transfer?: MessageInfo[] }) {
    for (const service of [queue, topic]) {
      service['peekMessages'].mockReturnValue(of(l.active ?? []));
      service['peekDeadLetterMessages'].mockReturnValue(of(l.deadLetter ?? []));
      service['peekTransferDeadLetterMessages'].mockReturnValue(of(l.transfer ?? []));
    }
  }

  function create(data: Partial<ViewMessagesDialogData>, l: Parameters<typeof lists>[0] = {}, capabilities: ProviderCapabilities | null = withTransfer) {
    lists(l);
    providers(data, capabilities);
    const component = TestBed.runInInjectionContext(() => new ViewMessagesDialogComponent());
    component.ngOnInit();
    return component;
  }

  function render(data: Partial<ViewMessagesDialogData>, l: Parameters<typeof lists>[0] = {}, capabilities: ProviderCapabilities | null = withTransfer) {
    lists(l);
    providers(data, capabilities);
    const fixture = TestBed.createComponent(ViewMessagesDialogComponent);
    fixture.detectChanges();
    const refresh = () => { fixture.changeDetectorRef.markForCheck(); fixture.detectChanges(); };
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, refresh };
  }

  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const tabs = (el: HTMLElement) => Array.from(el.querySelectorAll('.sub-queue-tab')).map(t => text(t).replace(/ \d+$/, ''));
  const toolbarButtons = (el: HTMLElement) => Array.from(el.querySelectorAll('app-bulk-actions-toolbar button')).map(b => text(b));
  const keyDown = (key: string, ctrlKey = false) =>
    ({ key, target: document.body, ctrlKey, metaKey: false, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

  beforeEach(() => {
    sessionStorage.clear();
    snackBar = { open: vi.fn() };
    opened = [];
    const peek = () => vi.fn().mockReturnValue(of([]));
    const pending = () => vi.fn().mockReturnValue(new Subject<BatchOperationResult>());
    queue = {
      peekMessages: peek(), peekDeadLetterMessages: peek(), peekTransferDeadLetterMessages: peek(),
      deleteMessages: pending(), deleteTransferDeadLetterMessages: pending(),
      resubmitDeadLetterMessages: pending(), resubmitTransferDeadLetterMessages: pending(),
      moveMessages: pending(), cancelScheduledMessages: pending(), settleDeferredMessages: pending(), settleActiveMessages: pending()
    };
    topic = {
      peekMessages: peek(), peekDeadLetterMessages: peek(), peekTransferDeadLetterMessages: peek(),
      deleteMessages: pending(), deleteTransferDeadLetterMessages: pending(),
      resubmitDeadLetterMessages: pending(), resubmitTransferDeadLetterMessages: pending(), settleDeferredMessages: pending(), settleActiveMessages: pending()
    };
    dialog = {
      openDialogs: [selfRef],
      open: vi.fn((component: unknown, config?: { data?: any; disableClose?: boolean }) => {
        const closed = new Subject<unknown>();
        const cancelRequested$ = new Subject<void>();
        opened.push({ component, data: config?.data, closed, config, cancelRequested$ });
        return {
          afterClosed: () => closed,
          close: vi.fn(),
          componentInstance: { cancelRequested$, updateProgress: vi.fn() }
        };
      })
    };
  });

  afterEach(() => vi.useRealTimers());

  describe('the transfer dead-letter queue is reachable', () => {
    it('RabbitMQ, which declares no safe bulk operations, offers no Delete, Move or Resubmit, in the toolbar or the detail pane; Azure offers them', () => {
      const rabbit = render({ initialTab: 1 }, { deadLetter: messages(2) }, DEFAULT_RABBITMQ_CAPABILITIES);
      expect(Array.from(rabbit.el.querySelectorAll('button')).map(b => text(b)).filter(t => t.includes('Auto resubmit')), 'no Auto resubmit beside the dead-letter search').toStrictEqual([]);
      expect(text(rabbit.el.querySelector('app-bulk-actions-toolbar')), 'the empty selection bar names only what RabbitMQ offers').not.toMatch(/resubmit|move|delete/i);
      rabbit.component.toggleAllDeadLetter(true);
      rabbit.component.selectMessage(rabbit.component.filteredDeadLetterMessages[0]);
      rabbit.refresh();
      const rabbitButtons = [...toolbarButtons(rabbit.el), ...Array.from(rabbit.el.querySelectorAll('.message-actions button')).map(b => text(b))];
      expect(rabbitButtons.filter(t => /Delete|Move|Resubmit/.test(t)), 'nothing that deletes, moves or resubmits').toStrictEqual([]);

      TestBed.resetTestingModule();
      const azure = render({ initialTab: 1 }, { deadLetter: messages(2) }, withTransfer);
      azure.component.toggleAllDeadLetter(true);
      azure.component.selectMessage(azure.component.filteredDeadLetterMessages[0]);
      azure.refresh();
      const azureButtons = [...toolbarButtons(azure.el), ...Array.from(azure.el.querySelectorAll('.message-actions button')).map(b => text(b))];
      expect(azureButtons.some(t => t.startsWith('Delete'))).toBe(true);
      expect(azureButtons.some(t => t.startsWith('Move'))).toBe(true);
      expect(azureButtons.some(t => t.includes('Resubmit'))).toBe(true);
    });

    it('the dead-letter tab of a subscription says that the topic sends a resubmit to every subscription, with or without a ticked row, since the detail pane resubmits one message at once; the active tab and a queue say nothing', () => {
      const { component, el, refresh } = render({ entityType: 'subscription', topicName: 'sales', entityName: 'eu', initialTab: 1 }, { deadLetter: messages(2) });
      expect(text(el.querySelector('.topic-resubmit-note[role="note"]')), 'nothing ticked: the detail pane can still resubmit')
        .toBe('Resubmit publishes to the topic sales. Every subscription of sales receives these messages again, not only eu.');

      component.toggleAllDeadLetter(true);
      refresh();
      expect(el.querySelectorAll('.topic-resubmit-note').length, 'one note, not one per row').toBe(1);

      TestBed.resetTestingModule();
      expect(render({ entityType: 'subscription', topicName: 'sales', entityName: 'eu', initialTab: 0 }, { active: messages(2) }).el.querySelector('.topic-resubmit-note'), 'the active tab resubmits nothing').toBeNull();

      TestBed.resetTestingModule();
      expect(render({ initialTab: 1 }, { deadLetter: messages(2) }).el.querySelector('.topic-resubmit-note'), 'a queue resubmits to itself').toBeNull();
    });

    it('a queue: the tab lists the transfer dead-letter queue, and delete and resubmit send the selected sequence numbers to its routes only', () => {
      const component = create({ initialTab: 2 }, { transfer: messages(3) });

      expect(queue['peekTransferDeadLetterMessages']).toHaveBeenCalledWith('orders', 20);
      expect(queue['peekDeadLetterMessages']).not.toHaveBeenCalled();
      expect(component.loadedOf('transferdeadletter').map(m => m.sequenceNumber)).toEqual([1, 2, 3]);

      component.toggleAll('transferdeadletter', true);
      component.onBulkAction({ action: 'delete' });
      confirm();
      expect(queue['deleteTransferDeadLetterMessages'].mock.calls.map(([name, seqs]) => [name, sorted(seqs)])).toEqual([['orders', [1, 2, 3]]]);

      component.toggleAll('transferdeadletter', true);
      component.onBulkAction({ action: 'resubmit' });
      expect(queue['resubmitTransferDeadLetterMessages'].mock.calls.map(([name, seqs]) => [name, sorted(seqs)])).toEqual([['orders', [1, 2, 3]]]);

      expect(queue['deleteMessages']).not.toHaveBeenCalled();
      expect(queue['resubmitDeadLetterMessages']).not.toHaveBeenCalled();
    });

    it('a subscription: the tab lists, deletes and resubmits through the subscription transfer dead-letter routes only', () => {
      const component = create({ entityType: 'subscription', topicName: 'sales', entityName: 'eu', initialTab: 2 }, { transfer: messages(2) });

      expect(topic['peekTransferDeadLetterMessages']).toHaveBeenCalledWith('sales', 'eu', 20);

      component.toggleAll('transferdeadletter', true);
      component.onBulkAction({ action: 'delete' });
      confirm();
      component.toggleAll('transferdeadletter', true);
      component.onBulkAction({ action: 'resubmit' });

      expect(topic['deleteTransferDeadLetterMessages'].mock.calls.map(([t, s, seqs]) => [t, s, sorted(seqs)])).toEqual([['sales', 'eu', [1, 2]]]);
      expect(topic['resubmitTransferDeadLetterMessages'].mock.calls.map(([t, s, seqs]) => [t, s, sorted(seqs)])).toEqual([['sales', 'eu', [1, 2]]]);
      expect(topic['deleteMessages']).not.toHaveBeenCalled();
      expect(topic['resubmitDeadLetterMessages']).not.toHaveBeenCalled();
      expect(queue['peekTransferDeadLetterMessages']).not.toHaveBeenCalled();
    });

    it('search on the tab narrows the loaded transfer dead-letter messages and clears the selection', () => {
      const component = create({ initialTab: 2 }, { transfer: messages(4, n => (n % 2 ? `invoice ${n}` : `other ${n}`)) });
      component.toggleAll('transferdeadletter', true);

      component.tdlFilterText = 'invoice';
      component.applyTDLFilter();

      expect(component.shownOf('transferdeadletter').map(m => m.sequenceNumber)).toEqual([1, 3]);
      expect(component.getSelectedCount()).toBe(0);
    });

    it('the tab offers refresh, search, select, delete, resubmit and export, and nothing else: no move, compare, single or edited resubmit', () => {
      const { component, el, refresh } = render({ initialTab: 2 }, { transfer: messages(3) });
      component.toggleSelection('transferdeadletter', component.loadedOf('transferdeadletter')[0], true);
      component.toggleSelection('transferdeadletter', component.loadedOf('transferdeadletter')[1], true);
      component.selectMessage(component.loadedOf('transferdeadletter')[0]);
      refresh();

      expect(toolbarButtons(el)).toEqual(['Resubmit', 'Export', 'Clear', 'Delete 2']);
      expect(el.querySelector('.message-actions')).toBeNull();
      const pane = el.querySelector('.tab-pane-content')!;
      expect(pane.querySelector('input[placeholder="Search in any field..."]')).not.toBeNull();
      expect(Array.from(pane.querySelectorAll('button')).map(b => text(b))).toContain('Refresh');

      component.onBulkAction({ action: 'move' });
      expect(queue['moveMessages']).not.toHaveBeenCalled();
    });

    it('says under the tab what these messages are, and the selection bar names the transfer dead-letter queue', () => {
      const { component, el } = render({ initialTab: 2, transferDeadLetterMessageCount: 5 }, { transfer: messages(3) });

      expect(text(el.querySelector('.tab-pane-content'))).toContain('Messages this queue could not forward to another entity.');
      expect(component.getSelectionSummary()).toBe('selected of 3 loaded, 5 in the transfer dead-letter queue');
    });

    it('selecting every transfer dead-letter message never drains the queue: the delete names each sequence number', () => {
      const component = create({ initialTab: 2, transferDeadLetterMessageCount: 3 }, { transfer: messages(3) });

      component.toggleAll('transferdeadletter', true);
      component.onBulkAction({ action: 'delete' });

      expect(lastOpened(ConfirmDialogComponent)!.data.typedName).toBeUndefined();
      confirm();
      expect(sorted(queue['deleteTransferDeadLetterMessages'].mock.calls[0][1])).toEqual([1, 2, 3]);
    });
  });

  describe('the tab and the sub-queue sent can never disagree, and the selection does not leak between tabs', () => {
    it('a dead-letter selection is gone on the transfer tab, and a transfer selection is gone on the dead-letter tab', () => {
      const component = create({ initialTab: 1 }, { deadLetter: messages(3), transfer: messages(3, n => `t${n}`).map(m => ({ ...m, sequenceNumber: m.sequenceNumber + 100 })) });
      component.toggleAllDeadLetter(true);

      component.setTab(2);
      expect(component.getSelectedCount()).toBe(0);
      component.onBulkAction({ action: 'delete' });
      expect(opened.filter(o => o.component === ConfirmDialogComponent)).toHaveLength(0);

      component.toggleAll('transferdeadletter', true);
      component.setTab(1);
      expect(component.getSelectedCount()).toBe(0);
      component.onBulkAction({ action: 'resubmit' });
      expect(queue['resubmitDeadLetterMessages']).not.toHaveBeenCalled();
      expect(queue['resubmitTransferDeadLetterMessages']).not.toHaveBeenCalled();
    });

    it('on the transfer tab, Ctrl+A selects the transfer list and the Delete key deletes through the transfer route', () => {
      const component = create({ initialTab: 2 }, { deadLetter: messages(2), transfer: messages(3).map(m => ({ ...m, sequenceNumber: m.sequenceNumber + 100 })) });

      component.handleKeyboardShortcut(keyDown('a', true));
      component.handleKeyboardShortcut(keyDown('Delete'));
      confirm();

      expect(sorted(queue['deleteTransferDeadLetterMessages'].mock.calls[0][1])).toEqual([101, 102, 103]);
      expect(queue['deleteMessages']).not.toHaveBeenCalled();
    });

    it('Retry Failed after a transfer resubmit goes to the transfer route again, never to the dead-letter route', () => {
      vi.useFakeTimers();
      const component = create({ initialTab: 2 }, { transfer: messages(2) });
      queue['resubmitTransferDeadLetterMessages']
        .mockReturnValueOnce(of({ success: false, successCount: 1, failureCount: 1, failures: [{ sequenceNumber: 2, error: 'The lock supplied is invalid' }] }))
        .mockReturnValue(of(ok(1)));
      component.toggleAll('transferdeadletter', true);

      component.onBulkAction({ action: 'resubmit' });
      vi.advanceTimersByTime(1000);
      lastOpened(BulkOperationResultsDialogComponent)!.closed.next({ retry: true });
      vi.advanceTimersByTime(500);

      expect(queue['resubmitTransferDeadLetterMessages'].mock.calls.map(c => c[1])).toEqual([[1, 2], [2]]);
      expect(queue['resubmitDeadLetterMessages']).not.toHaveBeenCalled();
    });
  });

  describe('a scheduled or deferred message shows its state; the Scheduled filter shows only scheduled among the loaded and says so', () => {
    const withStates = (states: Array<MessageInfo['state']>) => states.map((state, i) => ({ ...message(i + 1), state }));
    const stateFilter = (el: HTMLElement) => el.querySelector<HTMLSelectElement>('select#activeStateFilter');

    it('each row of a scheduled or deferred message carries a text chip with its state; an active row carries none', () => {
      const { el } = render({}, { active: withStates(['Scheduled', 'Deferred', 'Active', undefined]) });

      const chips = Array.from(el.querySelectorAll('.message-card')).map(card => text(card.querySelector('.state-chip')));
      expect(chips, 'as Messages.dc.html draws them: the clock icon, then the state').toEqual(['scheduleScheduled', 'scheduleDeferred', '', '']);
      const icons = Array.from(el.querySelectorAll('.message-card .state-chip mat-icon')).map(text);
      expect(icons, 'each state chip opens with the schedule icon').toEqual(['schedule', 'schedule']);
    });

    it('the filter on the Active tab narrows the loaded messages to the scheduled ones and says "2 scheduled of 20 loaded"', () => {
      const states = Array.from({ length: 20 }, (_, i) => (i === 3 || i === 11 ? 'Scheduled' : 'Active') as MessageInfo['state']);
      const { component, el, refresh } = render({}, { active: withStates(states) });
      const select = stateFilter(el)!;
      expect(text(el.querySelector('label[for="activeStateFilter"]'))).toBe('Show');
      expect(Array.from(select.options).map(o => o.textContent!.trim())).toEqual(['All', 'Scheduled']);

      select.value = select.options[1].value;
      select.dispatchEvent(new Event('change'));
      refresh();

      expect(component.shownOf('active').map(m => m.sequenceNumber)).toEqual([4, 12]);
      expect(text(el.querySelector('.state-count'))).toBe('2 scheduled of 20 loaded');
      expect(component.loadedOf('active')).toHaveLength(20);
    });

    it('changing the filter clears the selection, and a selection made under it never drains the queue', () => {
      const component = create({ activeMessageCount: 2 }, { active: withStates(['Scheduled', 'Scheduled']) });
      component.toggleAllActive(true);

      component.setStateFilter('Scheduled');
      expect(component.getSelectedCount()).toBe(0);

      component.toggleAllActive(true);
      component.onBulkAction({ action: 'delete' });
      confirm();
      const [, sequenceNumbers, , all] = queue['deleteMessages'].mock.calls[0];
      expect(all).toBe(false);
      expect(sorted(sequenceNumbers)).toEqual([1, 2]);
    });

    it('the filter is on the Active tab only, and absent when the broker has no scheduled messages', () => {
      const dl = render({ initialTab: 1 }, { deadLetter: messages(1) });
      expect(stateFilter(dl.el)).toBeNull();
      TestBed.resetTestingModule();
      const rabbit = render({}, { active: messages(1) }, { ...DEFAULT_AZURE_CAPABILITIES, supportsScheduledMessages: false });
      expect(stateFilter(rabbit.el)).toBeNull();
    });

    it('a deferred message says in its detail that this app cannot receive it; a scheduled one does not', () => {
      const { component, el, refresh } = render({}, { active: withStates(['Deferred', 'Scheduled']) });

      component.selectMessage(component.loadedOf('active')[0]);
      refresh();
      expect(text(el.querySelector('.message-detail'))).toContain('This app cannot receive a deferred message.');

      component.selectMessage(component.loadedOf('active')[1]);
      refresh();
      expect(text(el.querySelector('.message-detail'))).not.toContain('cannot receive');
    });

    it('opened from the Scheduled card, the Active tab starts filtered to the scheduled messages', () => {
      const component = create({ initialStateFilter: 'Scheduled' }, { active: withStates(['Active', 'Scheduled']) });

      expect(component.shownOf('active').map(m => m.sequenceNumber)).toEqual([2]);
    });
  });

  /** Renders the dialog with the dialog and snack bar mocks in place of the ones its own imports provide. */
  function wired(...args: Parameters<typeof render>) {
    const rendered = render(...args);
    Object.assign(rendered.component, { dialog, snackBar });
    return rendered;
  }

  describe('Load more reads the next page from the last sequence number, one page per click', () => {
    const paging: ProviderCapabilities = { ...withTransfer, supportsPeekFromSequenceNumber: true };
    const loadMoreButton = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('.list-pane button')).find(b => text(b) === 'Load more');
    const numbered = (from: number, count: number) => Array.from({ length: count }, (_, i) => message(from + i));

    it('a full Active page offers Load more; a click peeks from the last sequence number + 1, appends, and keeps the selection', () => {
      const { component, el, refresh } = wired({}, { active: numbered(1, 20) }, paging);
      component.toggleActiveSelection(component.loadedOf('active')[4], true);
      refresh();
      queue['peekMessages'].mockReturnValue(of(numbered(21, 7)));

      loadMoreButton(el)!.click();
      refresh();

      expect(queue['peekMessages'].mock.calls, 'the first read from the head, then one read from 20 + 1').toEqual([['orders', 20], ['orders', 20, 21]]);
      expect(component.loadedOf('active').map(m => m.sequenceNumber), 'the next page is appended to the loaded list').toEqual(numbered(1, 27).map(m => m.sequenceNumber));
      expect(component.bulkOperationsService.getSelectedSequenceNumbers('active'), 'the selection made before Load more stays').toEqual([5]);
      expect(loadMoreButton(el), 'a short page means nothing more to read: Load more is gone').toBeUndefined();
    });

    it('the Dead Letter tab pages the same way, from its own last sequence number', () => {
      const { el, refresh } = wired({ initialTab: 1 }, { deadLetter: numbered(101, 20) }, paging);
      queue['peekDeadLetterMessages'].mockReturnValue(of(numbered(121, 20)));

      loadMoreButton(el)!.click();
      refresh();

      expect(queue['peekDeadLetterMessages'].mock.calls, 'the dead-letter read from 120 + 1').toEqual([['orders', 20], ['orders', 20, 121]]);
      expect(text(el.querySelector('.load-more > span')), 'a full page offers the next one again, one page per click').toBe('The next 20 after #140');
    });

    it('a Count above 1000 still pages: the API returns at most 1000, which is a full page', () => {
      const { component, el, refresh } = wired({}, {}, paging);
      queue['peekMessages'].mockClear();
      queue['peekMessages'].mockReturnValue(of(numbered(1, 1000)));
      component.peekCount = 5000;
      component.reload('active');
      refresh();

      expect(text(el.querySelector('.load-more > span')), 'the next page is read after the 1000 returned').toBe('The next 1000 after #1000');
    }, 30000);

    it('not offered when the provider does not declare reading from a position, nor after a page shorter than the count', () => {
      const { el } = wired({}, { active: numbered(1, 20) }, withTransfer);
      expect(loadMoreButton(el), 'no supportsPeekFromSequenceNumber, no Load more').toBeUndefined();
      TestBed.resetTestingModule();

      const short = wired({}, { active: numbered(1, 19) }, paging);
      expect(loadMoreButton(short.el), 'a page shorter than the count is the end').toBeUndefined();
    });

    it('a failed Load more keeps the list on screen and says why in a snack bar', () => {
      const { component, el, refresh } = wired({}, { active: numbered(1, 20) }, paging);
      queue['peekMessages'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'The broker timed out' } })));

      loadMoreButton(el)!.click();
      refresh();

      expect(component.loadedOf('active'), 'the list read before stays').toHaveLength(20);
      expect(snackBar.open, 'the failure is said, not shown as an empty list').toHaveBeenCalled();
      expect(el.querySelector('[data-testid="load-error"]'), 'no error panel replaces the list').toBeNull();
    });
  });

  describe('deferred messages: delete, resubmit and dead-letter from the selection bar', () => {
    const deferral: ProviderCapabilities = { ...withTransfer, supportsDeferral: true };
    const mixed = () => [
      { ...message(1), state: 'Deferred' as const },
      { ...message(2), state: 'Active' as const },
      { ...message(3), state: 'Deferred' as const }
    ];
    const button = (el: HTMLElement, label: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('app-bulk-actions-toolbar button')).find(b => text(b) === label);
    const selectAll = (component: ViewMessagesDialogComponent) => component.toggleAllActive(true);
    const result = (failures: { sequenceNumber: number; error: string }[], successCount = 0): BatchOperationResult =>
      ({ success: failures.length === 0, successCount, failureCount: failures.length, failures });

    it('hidden when the provider does not declare deferral, even with deferred messages selected', () => {
      const { component, el, refresh } = wired({}, { active: mixed() }, withTransfer);
      selectAll(component);
      refresh();

      expect(toolbarButtons(el).filter(b => b.includes('deferred')), 'no deferred action without supportsDeferral').toEqual([]);
      expect(el.querySelector('.deferred-note'), 'no deferred note without supportsDeferral').toBeNull();
    });

    it('a mixed selection: Resubmit deferred sends only the deferred sequence numbers, and the bar says how many are left out and what Delete and Move cannot reach', () => {
      const { component, el, refresh } = wired({}, { active: mixed() }, deferral);
      selectAll(component);
      refresh();
      const offered = toolbarButtons(el);
      const note = text(el.querySelector('.deferred-note'));

      button(el, 'Resubmit deferred')!.click();

      expect(queue['settleDeferredMessages'].mock.calls, 'only the deferred sequence numbers reach the deferred resubmit route')
        .toEqual([['orders', 'resubmit', { sequenceNumbers: [1, 3], newMessageIdOnDuplicateDetection: false }]]);
      expect(offered, 'the deferred actions are offered, Delete N deferred apart').toEqual(['Move', 'Export', 'Cancel scheduled', 'Resubmit deferred', 'Dead-letter deferred', 'Clear', 'Delete 3', 'Delete 2 deferred']);
      expect(note, 'what is left out and what the other actions cannot reach')
        .toBe('The deferred actions act on the 2 deferred only; 1 of the 3 selected is not deferred and left out. Delete 3 and Move do not reach a deferred message: the broker hands one out only by its sequence number.');
    });

    it('Delete N deferred asks for the queue name typed, then sends only the deferred sequence numbers and shows the result per sequence number', () => {
      const { component, el, refresh } = wired({}, { active: mixed() }, deferral);
      selectAll(component);
      refresh();
      const answer = new Subject<BatchOperationResult>();
      queue['settleDeferredMessages'].mockReturnValue(answer);

      button(el, 'Delete 2 deferred')!.click();
      const confirmation = lastOpened(ConfirmDialogComponent)!;
      expect(confirmation.data.typedName, 'as every delete, the queue name is typed').toBe('orders');
      expect(confirmation.data.typedLabel).toBe('Type the queue name to confirm');
      expect(confirmation.data.message, 'the confirmation says what is left out').toContain('1 selected message is not deferred and left out.');
      expect(queue['settleDeferredMessages'], 'nothing is sent before the confirmation').not.toHaveBeenCalled();

      confirm();
      answer.next(result([{ sequenceNumber: 3, error: 'Not found as a deferred message.' }], 1));

      expect(queue['settleDeferredMessages'].mock.calls, 'the deferred delete route with the deferred numbers only').toEqual([['orders', 'delete', { sequenceNumbers: [1, 3] }]]);
      const results = lastOpened(BulkOperationResultsDialogComponent)!.data;
      expect([results.operation, results.deferred, results.allowRetry, results.result.failures], 'the bulk results dialog shows each failure, no retry of a delete')
        .toEqual(['delete', true, false, [{ sequenceNumber: 3, error: 'Not found as a deferred message.' }]]);
    });

    it('Dead-letter deferred asks for an optional reason and description, then sends them with the deferred numbers', () => {
      const { component, el, refresh } = wired({}, { active: mixed() }, deferral);
      selectAll(component);
      refresh();

      button(el, 'Dead-letter deferred')!.click();
      const dialogOpened = lastOpened(DeadLetterDeferredDialogComponent)!;
      expect(dialogOpened.data, 'the dialog names the entity and exactly the deferred numbers').toEqual({ entityName: 'orders', entityType: 'queue', sequenceNumbers: [1, 3] });
      expect(queue['settleDeferredMessages'], 'nothing is sent before the confirmation').not.toHaveBeenCalled();

      dialogOpened.closed.next({ reason: 'Bad payload', description: undefined });

      expect(queue['settleDeferredMessages'].mock.calls, 'the deferred dead-letter route with the reason').toEqual([['orders', 'deadletter', { sequenceNumbers: [1, 3], reason: 'Bad payload', description: undefined }]]);
    });

    it('a subscription reaches the deferred routes of the subscription', () => {
      const { component, el, refresh } = wired({ entityType: 'subscription', topicName: 'sales', entityName: 'eu' }, { active: mixed() }, deferral);
      selectAll(component);
      refresh();

      button(el, 'Resubmit deferred')!.click();

      expect(topic['settleDeferredMessages'].mock.calls, 'the subscription deferred route').toEqual([['sales', 'eu', 'resubmit', { sequenceNumbers: [1, 3], newMessageIdOnDuplicateDetection: false }]]);
      expect(queue['settleDeferredMessages'], 'never the queue route').not.toHaveBeenCalled();
    });

    it('a duplicate refusal offers "Send with a new message ID"; Retry resends the refused number with it, never the possible duplicate', () => {
      const { component, el, refresh } = wired({}, { active: mixed() }, deferral);
      queue['settleDeferredMessages']
        .mockReturnValueOnce(of(result([
          { sequenceNumber: 1, error: 'The target detects duplicates and no new message ID was asked for.' },
          { sequenceNumber: 3, error: 'Message was resubmitted but could not be removed from the deferred messages and may be duplicated on retry: lock lost' }
        ])))
        .mockReturnValue(of(result([], 1)));
      selectAll(component);
      refresh();

      button(el, 'Resubmit deferred')!.click();
      const results = lastOpened(BulkOperationResultsDialogComponent)!;
      expect(results.data.allowRetry, 'Retry is offered for the refused number').toBe(true);
      results.closed.next({ retry: true, newMessageIdOnDuplicateDetection: true });

      expect(queue['settleDeferredMessages'].mock.calls[1], 'Retry sends only the refused number, with a new message ID')
        .toEqual(['orders', 'resubmit', { sequenceNumbers: [1], newMessageIdOnDuplicateDetection: true }]);
      expect(component.targetDetectsDuplicates(), 'the option is offered from now on').toBe(true);
    });

    it.each([
      ['resubmit', 'Resubmit deferred', (): void => undefined],
      ['delete', 'Delete 2 deferred', (): void => confirm()],
      ['deadletter', 'Dead-letter deferred', (): void => lastOpened(DeadLetterDeferredDialogComponent)!.closed.next({ reason: undefined, description: undefined })]
    ] as const)('while a deferred %s runs, the messages dialog cannot be closed: the progress dialog covers it, and Cancel aborts the call and opens no results', (action, label, start) => {
      const { component, el, refresh } = wired({}, { active: mixed() }, deferral);
      const answer = new Subject<BatchOperationResult>();
      queue['settleDeferredMessages'].mockReturnValue(answer);
      selectAll(component);
      refresh();

      button(el, label)!.click();
      start();

      const progress = lastOpened(BulkOperationProgressDialogComponent);
      expect(progress, 'a deferred call sends then completes, so it runs under the progress dialog as every other send-then-complete flow').toBeDefined();
      expect([progress!.config?.disableClose, progress!.data.operation, progress!.data.deferred, progress!.data.totalCount, progress!.data.entityName],
        'Escape, the backdrop and the close button cannot end the call: the progress dialog cannot be dismissed and names the deferred action')
        .toEqual([true, action, true, 2, 'orders']);
      expect(answer.observed, 'the call runs while the progress dialog is open').toBe(true);

      progress!.cancelRequested$.next();
      answer.next(result([], 2));

      expect(answer.observed, 'Cancel aborts the call, so the server stops through RequestAborted').toBe(false);
      expect(lastOpened(BulkOperationResultsDialogComponent), 'no results after a cancel: the progress dialog says what may have been affected').toBeUndefined();
      expect(component.settlingDeferred(), 'the deferred actions are offered again once the call has ended').toBe(false);
    });

    it('a failed deferred call says why and keeps the selection', () => {
      const { component, el, refresh } = wired({}, { active: mixed() }, deferral);
      queue['settleDeferredMessages'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'sequenceNumbers must hold 1 to 1000 sequence numbers.' } })));
      selectAll(component);
      refresh();

      button(el, 'Resubmit deferred')!.click();

      expect(snackBar.open.mock.calls[0][0], 'the API refusal in its own words').toContain('sequenceNumbers must hold 1 to 1000 sequence numbers.');
      expect(component.getSelectedCount(), 'the selection stays for another try').toBe(3);
      expect(lastOpened(BulkOperationResultsDialogComponent), 'no results dialog for a call that failed').toBeUndefined();
    });

    it('with deferral declared, a deferred message says in its detail how it is reached', () => {
      const { component, el, refresh } = wired({}, { active: mixed() }, deferral);

      component.selectMessage(component.loadedOf('active')[0]);
      refresh();

      expect(text(el.querySelector('.message-detail .state-note')), 'the note names the deferred actions, not "cannot receive"')
        .toBe('A deferred message is reached only by its sequence number: tick it to delete, resubmit or dead-letter it.');
    });
  });

  describe('cancel a scheduled message', () => {
    const scheduled = (count: number) => messages(count).map(m => ({ ...m, state: 'Scheduled' as const }));
    const cancelButton = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('app-bulk-actions-toolbar button'))
      .find(b => text(b) === 'Cancel scheduled');
    const select = (component: ViewMessagesDialogComponent, ...sequenceNumbers: number[]) =>
      component.loadedOf('active').filter(m => sequenceNumbers.includes(m.sequenceNumber)).forEach(m => component.toggleActiveSelection(m, true));

    it('enabled for an all-scheduled selection on a queue; a mixed selection disables it with the reason as its accessible description', () => {
      const { component, el, refresh } = render({}, { active: [...scheduled(2), message(3)] });
      select(component, 1, 2);
      refresh();
      expect(cancelButton(el)!.getAttribute('aria-disabled')).toBeNull();

      select(component, 3);
      refresh();
      const button = cancelButton(el)!;
      expect(button.getAttribute('aria-disabled')).toBe('true');
      const reason = el.querySelector('#' + button.getAttribute('aria-describedby'));
      expect(text(reason)).toBe('Cancel scheduled is off: Only scheduled messages can be cancelled; 1 of the 3 selected is not scheduled.');

      button.click();
      component.onBulkAction({ action: 'cancel-scheduled' });
      expect(lastOpened(CancelScheduledDialogComponent)).toBeUndefined();
      expect(queue['cancelScheduledMessages']).not.toHaveBeenCalled();
    });

    it('not offered on a subscription, on the dead-letter or transfer tab, or when the broker has no scheduled messages', () => {
      const cases: Array<[Partial<ViewMessagesDialogData>, ProviderCapabilities]> = [
        [{ entityType: 'subscription', topicName: 'sales', entityName: 'eu' }, withTransfer],
        [{ initialTab: 1 }, withTransfer],
        [{ initialTab: 2 }, withTransfer],
        [{}, { ...withTransfer, supportsScheduledMessages: false }]
      ];
      for (const [data, capabilities] of cases) {
        TestBed.resetTestingModule();
        const { component, el, refresh } = render(data, { active: scheduled(1), deadLetter: scheduled(1), transfer: scheduled(1) }, capabilities);
        component.toggleSelection(component.subQueue, component.loadedOf(component.subQueue)[0], true);
        refresh();
        expect(component.getSelectedCount(), JSON.stringify(data)).toBe(1);
        expect(cancelButton(el), JSON.stringify(data)).toBeUndefined();
      }
    });

    it('after the confirmation, the request carries exactly the selected sequence numbers', () => {
      const component = create({}, { active: scheduled(5) });
      select(component, 2, 4);

      component.onBulkAction({ action: 'cancel-scheduled' });
      const confirmation = lastOpened(CancelScheduledDialogComponent)!;
      expect(confirmation.data.queueName).toBe('orders');
      expect(sorted(confirmation.data.sequenceNumbers)).toEqual([2, 4]);
      expect(queue['cancelScheduledMessages']).not.toHaveBeenCalled();

      confirmation.closed.next(true);
      expect(queue['cancelScheduledMessages'].mock.calls.map(([name, seqs]) => [name, sorted(seqs)])).toEqual([['orders', [2, 4]]]);
    });

    it('closing the confirmation without confirming sends nothing', () => {
      const component = create({}, { active: scheduled(2) });
      select(component, 1, 2);

      component.onBulkAction({ action: 'cancel-scheduled' });
      lastOpened(CancelScheduledDialogComponent)!.closed.next(undefined);

      expect(queue['cancelScheduledMessages']).not.toHaveBeenCalled();
    });

    it('more than 500 selected is refused with the reason and nothing is sent; 500 is allowed', () => {
      const component = create({}, { active: scheduled(501) });
      component.toggleAllActive(true);
      confirm();
      expect(component.getSelectedCount()).toBe(501);

      expect(component.cancelScheduledBlockedReason()).toBe('Cancel takes at most 500 messages at a time; 501 are selected.');
      component.onBulkAction({ action: 'cancel-scheduled' });
      expect(lastOpened(CancelScheduledDialogComponent)).toBeUndefined();

      component.toggleActiveSelection(component.loadedOf('active')[0], false);
      expect(component.cancelScheduledBlockedReason()).toBe('');
      component.onBulkAction({ action: 'cancel-scheduled' });
      lastOpened(CancelScheduledDialogComponent)!.closed.next(true);
      expect(queue['cancelScheduledMessages'].mock.calls[0][1]).toHaveLength(500);
    });

    it('the result is shown per sequence number, then the selection is cleared and the list refreshes', () => {
      const component = create({}, { active: scheduled(3) });
      const result: BatchOperationResult = {
        success: false, successCount: 2, failureCount: 1,
        failures: [{ sequenceNumber: 3, error: 'Message 3 is not a scheduled message.' }]
      };
      queue['cancelScheduledMessages'].mockReturnValue(of(result));
      component.toggleAllActive(true);

      component.onBulkAction({ action: 'cancel-scheduled' });
      lastOpened(CancelScheduledDialogComponent)!.closed.next(true);

      const shown = lastOpened(BulkOperationResultsDialogComponent)!;
      expect(shown.data.operation).toBe('cancel-scheduled');
      expect(shown.data.result).toEqual(result);
      expect(shown.data.allowRetry).toBe(false);
      expect(queue['peekMessages']).toHaveBeenCalledTimes(1);

      shown.closed.next({ retry: false });
      expect(queue['peekMessages']).toHaveBeenCalledTimes(2);
      expect(component.getSelectedCount()).toBe(0);
    });

    it('two confirmed cancels send one request while the first is in flight', () => {
      const component = create({}, { active: scheduled(2) });
      select(component, 1, 2);

      component.onBulkAction({ action: 'cancel-scheduled' });
      const first = lastOpened(CancelScheduledDialogComponent)!;
      component.onBulkAction({ action: 'cancel-scheduled' });
      const second = lastOpened(CancelScheduledDialogComponent)!;
      first.closed.next(true);
      second.closed.next(true);

      expect(queue['cancelScheduledMessages']).toHaveBeenCalledTimes(1);
    });
  });

  describe('a disabled entity is said plainly, and a failed call keeps the selection and the state', () => {
    const disabled = 'The entity is disabled for this operation.';
    const failure = (status: number, message?: string) =>
      () => throwError(() => new HttpErrorResponse({ status, error: message === undefined ? null : { message } }));
    const lastSnack = () => snackBar.open.mock.calls.at(-1)?.[0];
    const answers: Array<[string, number, string | undefined, (fallback: string) => string]> = [
      ['400', 400, 'This provider does not support the transfer dead-letter queue.', f => `${f}: This provider does not support the transfer dead-letter queue.`],
      ['404', 404, 'Queue orders was not found.', f => `${f}: Queue orders was not found.`],
      ['409 disabled', 409, disabled, () => disabled],
      ['500', 500, 'An internal error occurred.', f => f],
      ['no answer', 0, undefined, f => f]
    ];

    it.each(answers)('refreshing the transfer dead-letter tab fails with %s: the message is shown, the list and the selection stay, no spinner', (_, status, message, expected) => {
      const component = create({ initialTab: 2 }, { transfer: messages(3) });
      component.toggleAll('transferdeadletter', true);
      queue['peekTransferDeadLetterMessages'].mockImplementation(failure(status, message));

      component.loadTransferDeadLetterMessages();

      expect(lastSnack()).toBe(expected('Failed to load transfer dead-letter messages'));
      expect(component.loadedOf('transferdeadletter')).toHaveLength(3);
      expect(component.getSelectedCount()).toBe(3);
      expect(component.loadingTDL()).toBe(false);
    });

    it.each(answers)('a transfer dead-letter delete fails with %s: the message is shown, the selection stays, nothing is retried, no result', (_, status, message, expected) => {
      vi.useFakeTimers();
      const component = create({ initialTab: 2 }, { transfer: messages(3) });
      queue['deleteTransferDeadLetterMessages'].mockImplementation(failure(status, message));
      component.toggleAll('transferdeadletter', true);

      component.onBulkAction({ action: 'delete' });
      confirm();
      vi.advanceTimersByTime(2000);

      expect(lastSnack()).toBe(expected('Failed to delete messages. Please try again.'));
      expect(component.getSelectedCount()).toBe(3);
      expect(component.isBulkOperationInProgress()).toBe(false);
      expect(queue['deleteTransferDeadLetterMessages']).toHaveBeenCalledTimes(1);
      expect(lastOpened(BulkOperationResultsDialogComponent)).toBeUndefined();
    });

    it.each(answers)('a transfer dead-letter resubmit fails with %s: the message is shown, the selection stays, nothing is retried, no result', (_, status, message, expected) => {
      vi.useFakeTimers();
      const component = create({ initialTab: 2 }, { transfer: messages(2) });
      queue['resubmitTransferDeadLetterMessages'].mockImplementation(failure(status, message));
      component.toggleAll('transferdeadletter', true);

      component.onBulkAction({ action: 'resubmit' });
      vi.advanceTimersByTime(2000);

      expect(lastSnack()).toBe(expected('Failed to resubmit messages'));
      expect(component.getSelectedCount()).toBe(2);
      expect(component.isBulkOperationInProgress()).toBe(false);
      expect(queue['resubmitTransferDeadLetterMessages']).toHaveBeenCalledTimes(1);
      expect(lastOpened(BulkOperationResultsDialogComponent)).toBeUndefined();
    });

    it.each(answers)('a cancel fails with %s: the message is shown, nothing is shown as cancelled, the list is not reloaded', (_, status, message, expected) => {
      const component = create({}, { active: messages(2).map(m => ({ ...m, state: 'Scheduled' as const })) });
      queue['cancelScheduledMessages'].mockImplementation(failure(status, message));
      component.toggleAllActive(true);

      component.onBulkAction({ action: 'cancel-scheduled' });
      lastOpened(CancelScheduledDialogComponent)!.closed.next(true);

      expect(lastSnack()).toBe(expected('Failed to cancel the scheduled messages'));
      expect(lastOpened(BulkOperationResultsDialogComponent)).toBeUndefined();
      expect(queue['peekMessages']).toHaveBeenCalledTimes(1);
      expect(component.loadedOf('active').map(m => m.state)).toEqual(['Scheduled', 'Scheduled']);
      expect(component.getSelectedCount()).toBe(2);
      expect(component.isBulkOperationInProgress()).toBe(false);
    });

    it('a 409 on the active and dead-letter peeks says the entity is disabled, and the list and the selection stay', () => {
      const component = create({}, { active: messages(2), deadLetter: messages(2) });
      component.toggleAllActive(true);
      queue['peekMessages'].mockImplementation(failure(409, disabled));
      component.loadActiveMessages();
      expect(lastSnack()).toBe(disabled);
      expect(component.getSelectedCount()).toBe(2);
      expect(component.loadedOf('active')).toHaveLength(2);

      component.setTab(1);
      component.toggleAllDeadLetter(true);
      queue['peekDeadLetterMessages'].mockImplementation(failure(409, disabled));
      component.loadDeadLetterMessages();
      expect(lastSnack()).toBe(disabled);
      expect(component.getSelectedCount()).toBe(2);
    });

    it.each([
      ['delete', 0, 'deleteMessages'],
      ['move', 0, 'moveMessages'],
      ['resubmit', 1, 'resubmitDeadLetterMessages']
    ] as const)('a 409 on a %s says the entity is disabled for this operation, not the generic failure, and is not retried', (action, tab, method) => {
      vi.useFakeTimers();
      const component = create({ initialTab: tab }, { active: messages(2), deadLetter: messages(2) });
      queue[method].mockImplementation(failure(409, disabled));
      component.toggleAll(component.subQueue, true);

      component.onBulkAction({ action });
      if (action === 'delete') confirm();
      if (action === 'move') lastOpened(MoveMessagesDialogComponent)!.closed.next({ targetQueueName: 'orders-retry', newMessageIdOnDuplicateDetection: false });
      vi.advanceTimersByTime(2000);

      expect(lastSnack()).toBe(disabled);
      expect(queue[method]).toHaveBeenCalledTimes(1);
      expect(component.getSelectedCount()).toBe(2);
    });
  });

  describe('a possible duplicate from a transfer dead-letter resubmit is never retried', () => {
    it('Retry after a transfer resubmit resends only the failure that was not sent, never the possible duplicate', () => {
      vi.useFakeTimers();
      const component = create({ initialTab: 2 }, { transfer: messages(2) });
      queue['resubmitTransferDeadLetterMessages']
        .mockReturnValueOnce(of({
          success: false, successCount: 0, failureCount: 2,
          failures: [
            { sequenceNumber: 1, error: 'Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: lock lost' },
            { sequenceNumber: 2, error: 'The lock supplied is invalid' }
          ]
        }))
        .mockReturnValue(of(ok(1)));
      component.toggleAll('transferdeadletter', true);

      component.onBulkAction({ action: 'resubmit' });
      vi.advanceTimersByTime(1000);
      const results = lastOpened(BulkOperationResultsDialogComponent)!;
      expect(results.data.allowRetry).toBe(true);
      results.closed.next({ retry: true, failedSequenceNumbers: [1, 2] });
      vi.advanceTimersByTime(500);

      expect(queue['resubmitTransferDeadLetterMessages'].mock.calls.map(c => c[1])).toEqual([[1, 2], [2]]);
    });
  });

  describe('the progress and results of an operation name the sub-queue it ran on', () => {
    it.each([
      [2, 'delete', 'transferdeadletter'],
      [2, 'resubmit', 'transferdeadletter'],
      [1, 'delete', 'deadletter'],
      [1, 'resubmit', 'deadletter'],
      [0, 'delete', 'active']
    ] as const)('tab %s, %s: the progress and the results dialogs are given the sub-queue %s', (tab, action, subQueue) => {
      vi.useFakeTimers();
      const component = create({ initialTab: tab }, { active: messages(2), deadLetter: messages(2), transfer: messages(2) });
      for (const method of ['deleteMessages', 'deleteTransferDeadLetterMessages', 'resubmitDeadLetterMessages', 'resubmitTransferDeadLetterMessages']) {
        queue[method].mockReturnValue(of(ok(2)));
      }
      component.toggleAll(component.subQueue, true);

      component.onBulkAction({ action });
      if (action === 'delete') confirm();
      vi.advanceTimersByTime(1000);

      expect(lastOpened(BulkOperationProgressDialogComponent)!.data.subQueue).toBe(subQueue);
      expect(lastOpened(BulkOperationResultsDialogComponent)!.data.subQueue).toBe(subQueue);
    });
  });

  describe('the transfer dead-letter tab appears only when the API explicitly says it supports it', () => {
    it('shown for an explicit true; hidden when the flag is false or not sent', () => {
      expect(tabs(render({}, {}, withTransfer).el)).toEqual(['Active Messages', 'Dead Letter', 'Transfer dead-letter']);
      TestBed.resetTestingModule();
      expect(tabs(render({}, {}, { ...DEFAULT_AZURE_CAPABILITIES, supportsTransferDeadLetter: false }).el)).toEqual(['Active Messages', 'Dead Letter']);
      TestBed.resetTestingModule();
      expect(tabs(render({}, {}, DEFAULT_AZURE_CAPABILITIES).el)).toEqual(['Active Messages', 'Dead Letter']);
    });

    it('opened on the transfer tab when the flag is not sent, the dialog shows the active messages instead', () => {
      const component = create({ initialTab: 2 }, { active: messages(2), transfer: messages(2) }, DEFAULT_AZURE_CAPABILITIES);

      expect(component.subQueue).toBe('active');
      expect(queue['peekTransferDeadLetterMessages']).not.toHaveBeenCalled();
      expect(queue['peekMessages']).toHaveBeenCalledTimes(1);
    });
  });
  describe('the dialog as the Messages artboard draws it', () => {
    const fail = (status: number) => throwError(() => new HttpErrorResponse({ status, error: { message: 'boom' } }));

    it('a first load that fails is an error in place of the list, with no message shown and Retry', () => {
      lists({});
      queue['peekMessages'].mockReturnValueOnce(fail(500)).mockReturnValue(of(messages(2)));
      providers({}, withTransfer);
      const fixture = TestBed.createComponent(ViewMessagesDialogComponent);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      const panel = el.querySelector('[data-testid="load-error"]') as HTMLElement;
      expect(panel.getAttribute('aria-label')).toBe('Error');
      expect(text(panel)).toContain('Failed to load messages');
      expect(panel.querySelector('h2')?.textContent?.trim(), 'the failure title is a second-level heading, as drawn').toBe('Failed to load messages');
      expect(text(panel)).toContain('No message is shown because none was read, and nothing on the broker was changed.');
      expect(el.querySelectorAll('.message-card')).toHaveLength(0);
      expect(snackBar.open).not.toHaveBeenCalled();

      (Array.from(panel.querySelectorAll('button')).find(b => text(b).endsWith('Retry')) as HTMLElement).click();
      fixture.detectChanges();
      expect(queue['peekMessages']).toHaveBeenCalledTimes(2);
      expect(el.querySelector('[data-testid="load-error"]')).toBeNull();
      expect(el.querySelectorAll('.message-card')).toHaveLength(2);
    });

    it('as Messages.dc.html draws it: while a tab loads it says "Loading the {noun} messages of {entity} from {connection}"', () => {
      const loading = (initialTab: number) => {
        TestBed.resetTestingModule();
        lists({});
        for (const name of ['peekMessages', 'peekDeadLetterMessages', 'peekTransferDeadLetterMessages']) queue[name].mockReturnValue(new Subject());
        providers({ initialTab }, withTransfer);
        const fixture = TestBed.createComponent(ViewMessagesDialogComponent);
        fixture.detectChanges();
        return text((fixture.nativeElement as HTMLElement).querySelector('.list-state[role="status"]'));
      };

      expect(loading(0), 'the active tab').toBe('Loading the active messages of orders from contoso-prod.servicebus.windows.net');
      expect(loading(1), 'the dead-letter tab, spelled "dead letter" as drawn').toBe('Loading the dead letter messages of orders from contoso-prod.servicebus.windows.net');
      expect(loading(2), 'the transfer dead-letter tab').toBe('Loading the transfer dead-letter messages of orders from contoso-prod.servicebus.windows.net');
    });

    it('a first load the broker refuses for the status of the entity says so, and Load again reads again', () => {
      lists({});
      queue['peekMessages'].mockReturnValueOnce(fail(409));
      providers({}, withTransfer);
      const fixture = TestBed.createComponent(ViewMessagesDialogComponent);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      const panel = el.querySelector('[data-testid="load-disabled"]') as HTMLElement;
      expect(text(panel)).toContain('The entity is disabled for this operation.');
      expect(text(panel)).toContain('The broker refused to read from orders because of the status of the queue. No message was read and nothing was changed.');
      const loadAgain = Array.from(panel.querySelectorAll('button')).find(b => text(b).endsWith('Load again')) as HTMLElement;
      expect(text(loadAgain.querySelector('mat-icon')), 'as Messages.dc.html draws it: Load again with the refresh icon').toBe('refresh');
      loadAgain.click();
      expect(queue['peekMessages']).toHaveBeenCalledTimes(2);
    });

    /** The dialog's own MatDialogModule provides a MatDialog; this puts the mock in its place for a rendered dialog. */
    const openThroughTheMock = () =>
      TestBed.overrideComponent(ViewMessagesDialogComponent, { add: { providers: [{ provide: MatDialog, useValue: dialog }] } });

    it('the disabled panel offers Change status before Load again, opens Change status for the entity, and loads again once a status is set', () => {
      lists({});
      queue['peekMessages'].mockReturnValueOnce(fail(409));
      providers({}, withTransfer);
      openThroughTheMock();
      const fixture = TestBed.createComponent(ViewMessagesDialogComponent);
      fixture.detectChanges();
      const panel = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="load-disabled"]') as HTMLElement;

      const buttons = Array.from(panel.querySelectorAll('button'));
      expect(buttons.map(b => text(b).replace(/^refresh/, '')), 'as drawn: Change status, then Load again').toEqual(['Change status', 'Load again']);
      buttons[0].click();

      const status = lastOpened(EntityStatusDialogComponent);
      expect(status?.data, 'Change status opens for this queue, its status as read not known here')
        .toEqual({ kind: 'queue', entityName: 'orders', topicName: undefined, status: '' });
      status!.closed.next(undefined);
      expect(queue['peekMessages'], 'a cancelled Change status reads nothing').toHaveBeenCalledTimes(1);
      buttons[0].click();
      lastOpened(EntityStatusDialogComponent)!.closed.next({ name: 'orders', status: 'Active' });
      expect(queue['peekMessages'], 'after a status was set the tab loads again').toHaveBeenCalledTimes(2);
    });

    it('Change status is not offered when the provider does not declare entity updates', () => {
      lists({});
      queue['peekMessages'].mockReturnValueOnce(fail(409));
      providers({}, { ...withTransfer, supportsEntityUpdate: false });
      const fixture = TestBed.createComponent(ViewMessagesDialogComponent);
      fixture.detectChanges();
      const panel = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="load-disabled"]') as HTMLElement;
      expect(Array.from(panel.querySelectorAll('button')).map(b => text(b).replace(/^refresh/, '')), 'only Load again').toEqual(['Load again']);
    });

    it('the dead-letter toolbar has Auto resubmit after Refresh, opening the entity panel\'s automatic resubmit, and reads the tab again after a run', () => {
      lists({});
      providers({ deadLetterMessageCount: 7, initialTab: 1 }, withTransfer);
      openThroughTheMock();
      const fixture = TestBed.createComponent(ViewMessagesDialogComponent);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const refresh = () => { fixture.changeDetectorRef.markForCheck(); fixture.detectChanges(); };
      refresh();
      expect(text(el.querySelector('button.refresh')?.nextElementSibling ?? null).replace(/^replay ?/, ''), 'Auto resubmit sits right after Refresh in the dead-letter tab')
        .toBe('Auto resubmit');
      const auto = Array.from(el.querySelectorAll('button')).find(b => text(b).endsWith('Auto resubmit')) as HTMLElement;
      const reads = queue['peekDeadLetterMessages'].mock.calls.length;
      auto.click();

      const run = lastOpened(ContinuousResubmitDialogComponent);
      expect(run?.data, 'the same data the entity panel passes').toEqual({ entityType: 'queue', entityName: 'orders', topicName: undefined, deadLetterMessageCount: 7 });
      run!.closed.next({ totalProcessed: 7, totalSuccess: 7, totalFailure: 0, stopped: false, completed: true });
      expect(queue['peekDeadLetterMessages'], 'the dead-letter tab is read again after the run').toHaveBeenCalledTimes(reads + 1);
    });

    it('Auto resubmit is not in the active tab', () => {
      const { el } = render({}, { active: [] });
      expect(Array.from(el.querySelectorAll('button')).some(b => text(b).endsWith('Auto resubmit'))).toBe(false);
    });

    it('an empty queue says the broker answered with none, with the count asked for, Send a message and Refresh', () => {
      const { el } = render({}, { active: [] });
      const state = el.querySelector('.list-state') as HTMLElement;
      expect(text(state)).toContain('The queue answered and holds none. Nothing is hidden by a filter: the count asked for was 20 and the broker returned 0.');
      const buttons = Array.from(state.querySelectorAll('button')).map(b => text(b));
      expect(buttons).toEqual(['Send a message', 'Refresh']);
      (Array.from(state.querySelectorAll('button')).find(b => text(b) === 'Refresh') as HTMLElement).click();
      expect(queue['peekMessages']).toHaveBeenCalledTimes(2);
    });

    it.each([
      [1, 'No dead letter messages', 'peekDeadLetterMessages'],
      [2, 'No transfer dead-letter messages', 'peekTransferDeadLetterMessages'],
    ])('an empty tab %s says the broker answered with none and offers Send a message and Refresh', (tab, title, peek) => {
      const { el } = render({ initialTab: tab as number }, {});
      const state = el.querySelector('.list-state') as HTMLElement;
      expect(text(state)).toContain(title as string);
      expect(text(state)).toContain('The queue answered and holds none. Nothing is hidden by a filter: the count asked for was 20 and the broker returned 0.');
      expect(Array.from(state.querySelectorAll('button')).map(b => text(b))).toEqual(['Send a message', 'Refresh']);
      (Array.from(state.querySelectorAll('button')).find(b => text(b) === 'Refresh') as HTMLElement).click();
      expect(queue[peek as string]).toHaveBeenCalledTimes(2);
    });

    it('the header has Send and a Close named "Close messages"', () => {
      const { el } = render({}, { active: messages(1) });
      const head = el.querySelector('.dialog-head') as HTMLElement;
      expect(Array.from(head.querySelectorAll('button')).map(b => text(b) || b.getAttribute('aria-label'))).toEqual(['Send', 'Close messages']);
      expect(head.querySelector('[aria-label="Close messages"]')!.hasAttribute('mat-dialog-close')).toBe(true);
    });

    it('Send opens the send dialog on the queue, or on the topic of a subscription, and a send reloads the active messages', () => {
      const queueDialog = create({}, { active: [] });
      queueDialog.sendMessage();
      const sent = lastOpened(SendMessageDialogComponent)!;
      expect(sent.data).toEqual(expect.objectContaining({ entityType: 'queue', entityName: 'orders' }));
      sent.closed.next(true);
      expect(queue['peekMessages']).toHaveBeenCalledTimes(2);
    });

    it('a subscription sends to its topic', () => {
      const sub = create({ entityType: 'subscription', entityName: 'audit', topicName: 'orders-topic' }, { active: [] });
      sub.sendMessage();
      expect(lastOpened(SendMessageDialogComponent)!.data).toEqual(expect.objectContaining({ entityType: 'topic', entityName: 'orders-topic' }));
    });

    it('a dead-lettered message says why, the detail closes by its own button, and the body copies', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText } });
      const dead = { ...message(7, '{"a":1}'), deadLetterReason: 'MaxDeliveryCountExceeded', deadLetterErrorDescription: 'Delivered 10 times' };
      const { component, el, refresh } = render({ initialTab: 1 }, { deadLetter: [dead] });
      component.selectMessage(dead);
      refresh();

      const why = el.querySelector('[data-testid="why-dead-lettered"]') as HTMLElement;
      expect(text(why)).toContain('Why it was dead-lettered');
      expect(Array.from(why.querySelectorAll('.property')).map(p => [text(p.querySelector('dt')), text(p.querySelector('dd'))])).toEqual([
        ['Dead Letter Reason', 'MaxDeliveryCountExceeded'],
        ['Dead Letter Error Description', 'Delivered 10 times'],
      ]);
      const pane = el.querySelector('.message-detail') as HTMLElement;
      expect([text(pane.querySelector('h2.pane-title')), Array.from(pane.querySelectorAll('h3.section-title')).map(text)],
        'Message Details is a second-level heading and Body a third-level one, as drawn').toEqual(['Message Details', ['Body']]);
      expect(Array.from(pane.children).map(c => c.classList.contains('detail-grid') ? 'fields' : c.classList.contains('why-dead') ? 'why' : c.classList.contains('body-head') ? 'body' : null).filter(Boolean),
        'as Messages.dc.html draws it: the reason sits after the message fields and before the body').toEqual(['fields', 'why', 'body']);
      expect(el.querySelector('[aria-label="Close message details"]')?.getAttribute('title'), 'the close button is titled as drawn').toBe('Close message details');

      (Array.from(el.querySelectorAll('.body-head button')).find(b => text(b).endsWith('Copy body')) as HTMLElement).click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith('{"a":1}');

      (el.querySelector('[aria-label="Close message details"]') as HTMLElement).click();
      refresh();
      expect(component.selectedMessage).toBeNull();
    });

    it('an active message has no dead-letter block, and a deferred one says in a note that it cannot be received', () => {
      const deferred = { ...message(3), state: 'Deferred' } as MessageInfo;
      const { component, el, refresh } = render({}, { active: [deferred] });
      component.selectMessage(deferred);
      refresh();
      expect(el.querySelector('[data-testid="why-dead-lettered"]')).toBeNull();
      const note = el.querySelector('.state-note[role="note"]');
      expect(text(note)).toBe('This app cannot receive a deferred message.');
    });

    it('the regular expression toggle is named so', () => {
      const { el } = render({}, { active: messages(1) });
      expect(el.querySelector('.regex-toggle')!.getAttribute('aria-label')).toBe('Regular expression');
    });

    it('as Messages.dc.html draws it: six skeleton rows sit under the loading line, hidden from a screen reader', () => {
      lists({});
      queue['peekMessages'].mockReturnValue(new Subject());
      providers({}, withTransfer);
      const fixture = TestBed.createComponent(ViewMessagesDialogComponent);
      fixture.detectChanges();
      const pane = (fixture.nativeElement as HTMLElement).querySelector('.list-pane') as HTMLElement;

      const skeleton = pane.querySelector('.skeleton') as HTMLElement | null;
      expect(skeleton?.previousElementSibling?.getAttribute('role'), 'the skeleton follows the loading line').toBe('status');
      expect(skeleton!.getAttribute('aria-hidden'), 'the skeleton is hidden from a screen reader').toBe('true');
      expect(Array.from(skeleton!.children).map(row => (row as HTMLElement).style.width), 'six rows, the last two shorter, as drawn')
        .toEqual(['100%', '100%', '100%', '100%', '82%', '64%']);
    });

    it('as Messages.dc.html draws it: a message row is a button with aria-current on the opened row, and its checkbox selects without opening', () => {
      const { component, el, refresh } = render({}, { active: messages(2) });
      const rows = () => Array.from(el.querySelectorAll('.message-card')) as HTMLElement[];
      const open = (row: HTMLElement) => row.querySelector('button.message-content') as HTMLButtonElement | null;

      expect(rows().map(row => open(row)?.getAttribute('type')), 'each row opens through a button').toEqual(['button', 'button']);
      expect(rows().map(row => open(row)!.getAttribute('aria-current')), 'no row is current before one is opened').toEqual([null, null]);

      (rows()[1].querySelector('input[type="checkbox"]') as HTMLInputElement).click();
      refresh();
      expect(component.getSelectedCount(), 'the checkbox of a row selects it').toBe(1);
      expect(component.selectedMessage, 'the checkbox does not open the row').toBeNull();

      open(rows()[1])!.click();
      refresh();
      expect(component.selectedMessage?.sequenceNumber, 'the row button opens its message').toBe(2);
      expect(rows().map(row => open(row)!.getAttribute('aria-current')), 'the opened row is the current one').toEqual([null, 'true']);
    });

    it('as Messages.dc.html draws it: the no-match state holds its icon, "No messages match your filter" and Clear all, which shows the messages again', () => {
      const { component, el, refresh } = render({}, { active: messages(2) });
      component.activeFilterText = 'nothing like this';
      component.onFilterChange();
      refresh();

      const state = el.querySelector('.list-state') as HTMLElement;
      expect(state.querySelector('mat-icon')?.getAttribute('fontIcon'), 'the search-off icon').toBe('search_off');
      expect(text(state.querySelector('.state-title')), 'the drawn title').toBe('No messages match your filter');
      const clear = Array.from(el.querySelectorAll('button')).filter(b => text(b) === 'Clear all');
      expect(clear.map(b => state.contains(b)), 'one Clear all, inside the no-match state').toEqual([true]);

      clear[0].click();
      refresh();
      expect(component.activeFilterText, 'Clear all empties the search').toBe('');
      expect(el.querySelectorAll('.message-card'), 'the messages show again').toHaveLength(2);
    });

    it('as Messages.dc.html draws it: Show = Scheduled with none scheduled is the no-match state, and its Clear all sets Show back to All', async () => {
      const { fixture, component, el, refresh } = render({}, { active: messages(2) });
      const select = el.querySelector('select#activeStateFilter') as HTMLSelectElement;
      select.value = 'Scheduled';
      select.dispatchEvent(new Event('change'));
      refresh();

      const state = el.querySelector('.list-state') as HTMLElement;
      expect(text(state.querySelector('.state-title')), 'no scheduled message among the loaded').toBe('No messages match your filter');
      const clear = Array.from(state.querySelectorAll('button')).find(b => text(b) === 'Clear all') as HTMLButtonElement | undefined;
      expect(clear, 'the Scheduled no-match state holds Clear all').toBeDefined();
      clear!.click();
      refresh();
      await fixture.whenStable();

      expect(component.activeStateFilter, 'Clear all resets Show').toBe('All');
      expect((el.querySelector('select#activeStateFilter') as HTMLSelectElement).value, 'the Show select reads All').toBe('All');
      expect(el.querySelectorAll('.message-card'), 'the messages show again').toHaveLength(2);
    });

    it('the dead-letter and transfer dead-letter no-match states hold Clear all too', () => {
      const { component, el, refresh } = render({ initialTab: 1 }, { deadLetter: messages(1), transfer: messages(1) });
      const clearInState = () => Array.from((el.querySelector('.list-state') as HTMLElement).querySelectorAll('button')).find(b => text(b) === 'Clear all') as HTMLButtonElement | undefined;
      component.dlFilterText = 'nothing like this';
      component.onDLFilterChange();
      refresh();
      expect(clearInState(), 'the dead-letter no-match state holds Clear all').toBeDefined();
      clearInState()!.click();
      refresh();
      expect(el.querySelectorAll('.message-card'), 'the dead-letter messages show again').toHaveLength(1);

      component.setTab(2);
      refresh();
      component.tdlFilterText = 'nothing like this';
      component.applyTDLFilter();
      refresh();
      expect(clearInState(), 'the transfer dead-letter no-match state holds Clear all').toBeDefined();
      clearInState()!.click();
      refresh();
      expect(el.querySelectorAll('.message-card'), 'the transfer dead-letter messages show again').toHaveLength(1);
    });

    it('as Messages.dc.html draws it: a filtered list says "Showing X of Y messages" in the Select All row, for a quick search, an advanced condition and Show = Scheduled, with no Clear all there', () => {
      const loaded = [{ ...message(1, 'match a'), state: 'Scheduled' as const }, message(2, 'match b'), message(3, 'other')];
      const { component, el, refresh } = render({}, { active: loaded });
      const summary = () => {
        const row = el.querySelector('.select-all-row') as HTMLElement | null;
        return row?.contains(el.querySelector('#selectAllActive')) ? text(row.querySelector('.filter-summary')) : 'no Select All row';
      };
      const clearAll = () => Array.from(el.querySelectorAll('button')).filter(b => text(b) === 'Clear all');

      expect(summary(), 'an unfiltered list draws no summary').toBe('');

      component.activeFilterText = 'match';
      component.onFilterChange();
      refresh();
      expect(summary(), 'a quick search: the summary sits in the Select All row').toBe('Showing 2 of 3 messages');
      expect(el.querySelector('.filter-info'), 'no separate summary bar above the list').toBeNull();
      expect(clearAll(), 'Clear all lives only in the no-match state').toHaveLength(0);

      component.clearAllActiveFilters();
      component.onActiveAdvancedFilterChange({ conditions: [{ id: 'c1', property: 'messageId', operator: FilterOperator.Equals, value: 'id-3' }], logicOperator: FilterLogic.And });
      refresh();
      expect(summary(), 'an advanced condition').toBe('Showing 1 of 3 messages');

      component.clearAllActiveFilters();
      component.setStateFilter('Scheduled');
      refresh();
      expect(summary(), 'Show = Scheduled').toBe('Showing 1 of 3 messages');
      expect(clearAll(), 'no Clear all beside the summary').toHaveLength(0);
    });

    it('as Messages.dc.html draws it: the dead-letter and transfer dead-letter Select All rows carry the summary too, and the no-match state keeps it above its Clear all', () => {
      const { component, el, refresh } = render({ initialTab: 1 }, { deadLetter: messages(2), transfer: messages(3) });
      const summary = () => text(el.querySelector('.select-all-row .filter-summary'));

      component.dlFilterText = 'body 1';
      component.onDLFilterChange();
      refresh();
      expect(summary(), 'the dead-letter tab').toBe('Showing 1 of 2 messages');

      component.dlFilterText = 'nothing like this';
      component.onDLFilterChange();
      refresh();
      expect(summary(), 'the no-match state keeps the Select All row and its summary').toBe('Showing 0 of 2 messages');
      expect(text(el.querySelector('.list-state h2')), 'the no-match state still shows').toBe('No messages match your filter');

      component.setTab(2);
      refresh();
      component.tdlFilterText = 'body 3';
      component.applyTDLFilter();
      refresh();
      expect(summary(), 'the transfer dead-letter tab').toBe('Showing 1 of 3 messages');
      expect(el.querySelector('.filter-info'), 'no separate summary bar').toBeNull();
    });

    it('as Messages.dc.html draws it: "No messages match your filter" is a second-level heading', () => {
      const { component, el, refresh } = render({}, { active: messages(1) });
      component.activeFilterText = 'nothing like this';
      component.onFilterChange();
      refresh();
      const title = el.querySelector('.list-state .state-title');
      expect(title?.tagName, 'the no-match title is an h2').toBe('H2');
      expect(text(title)).toBe('No messages match your filter');
    });

    it.each([
      [0, 'No active messages'],
      [1, 'No dead letter messages'],
      [2, 'No transfer dead-letter messages'],
    ])('as Messages.dc.html draws it: the empty tab %s title is a second-level heading', (tab, words) => {
      const { el } = render({ initialTab: tab as number }, {});
      const title = el.querySelector('.list-state .state-title');
      expect(title?.tagName, `"${words}" is an h2`).toBe('H2');
      expect(text(title)).toBe(words);
    });

    it('as Messages.dc.html draws it: the message list is a list of items, each holding its checkbox and its row button', () => {
      const { el } = render({}, { active: messages(2) });
      const list = el.querySelector('cdk-virtual-scroll-viewport.messages-list ul') as HTMLElement | null;
      expect(list, 'the rows sit in a ul inside the scroll viewport').not.toBeNull();
      const items = Array.from(list!.children) as HTMLElement[];
      expect(items.map(item => item.tagName), 'each row is an li').toEqual(['LI', 'LI']);
      expect(items.map(item => item.classList.contains('message-card')), 'the li is the row').toEqual([true, true]);
      expect(items.map(item => item.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')), 'each item holds its checkbox').toEqual(['Select 1', 'Select 2']);
      expect(items.map(item => item.querySelector('button.message-content')?.getAttribute('type')), 'each item holds its row button').toEqual(['button', 'button']);
    });

    it('as Messages.dc.html draws it: "Send a message" in an empty tab carries the send icon', () => {
      const { el } = render({}, { active: [] });
      const send = Array.from((el.querySelector('.list-state') as HTMLElement).querySelectorAll('button')).find(b => text(b) === 'Send a message') as HTMLElement;
      expect(send.querySelector('mat-icon')?.getAttribute('fontIcon'), 'Send a message opens with the send icon').toBe('send');
      expect(send.querySelector('mat-icon')?.getAttribute('aria-hidden'), 'the icon is hidden from a screen reader').toBe('true');
    });

    it('as Messages.dc.html draws it: the disabled panel is a section named "Entity disabled"', () => {
      lists({});
      queue['peekMessages'].mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'boom' } })));
      providers({}, withTransfer);
      const fixture = TestBed.createComponent(ViewMessagesDialogComponent);
      fixture.detectChanges();
      const panel = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="load-disabled"]') as HTMLElement;

      expect([panel.tagName, panel.getAttribute('aria-label')], 'the disabled panel section and its name').toEqual(['SECTION', 'Entity disabled']);
    });
  });

  describe('one message: a binary body and the actions on it', () => {
    const full: ProviderCapabilities = { ...withTransfer, supportsDeferral: true, supportsManualDeadLetter: true };
    const binary = (): MessageInfo => ({
      ...message(41), body: btoa(String.fromCharCode(0x00, 0xff, 0x41, 0x42)), bodyEncoding: 'base64', contentType: 'application/octet-stream', sizeInBytes: 4
    });

    function shown(msg: MessageInfo, capabilities: ProviderCapabilities = full) {
      const view = render({}, { active: [msg] }, capabilities);
      view.component.selectMessage(msg);
      view.refresh();
      return view;
    }
    const button = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;

    it('a binary body is shown as hex with its byte count and content type, and copied as base64, never as garbled text', () => {
      const { el } = shown(binary());

      expect(text(el.querySelector('[data-testid="binary-body-hex"]')), 'the hex view lists each byte of the body').toContain('00 ff 41 42');
      const note = text(el.querySelector('[data-testid="binary-body-note"]'));
      expect(note, 'the note names the byte count and the content type').toContain('4 bytes (application/octet-stream)');
      expect(Array.from(el.querySelectorAll('.body-head button')).map(b => text(b)).join(), 'the copy takes the base64').toContain('Copy base64');
      expect(el.querySelectorAll('pre.body-content:not(.hex)').length, 'a binary body is never rendered as text').toBe(0);
    });

    it('a text body is shown as text, without the hex view', () => {
      const { el } = shown(message(42, '{"a":1}'));

      expect(el.querySelector('[data-testid="binary-body-hex"]')).toBeNull();
      expect(text(el.querySelector('pre.body-content'))).toContain('"a": 1');
    });

    it('defer asks first, says what the scan does to the other messages, and only then sends the one sequence number', () => {
      const component = create({}, { active: [message(42)] }, full);

      component.settleOne('defer', message(42));
      const confirmation = lastOpened(ConfirmDialogComponent)!;
      expect(queue['settleActiveMessages'], 'nothing is sent before the confirmation').not.toHaveBeenCalled();
      expect(confirmation.data.notice, 'the confirmation says other messages get one more delivery').toContain('delivery count raised by one');
      expect(confirmation.data.notice, 'the confirmation says operations are at-least-once').toContain('at-least-once');
      confirmation.closed.next(true);

      expect(queue['settleActiveMessages']).toHaveBeenCalledWith('orders', 'defer', { sequenceNumbers: [42] });
      (queue['settleActiveMessages'].mock.results[0].value as Subject<BatchOperationResult>).next({ success: false, successCount: 0, failureCount: 1, failures: [{ sequenceNumber: 42, error: 'Not found within scan window' }] });
      const results = lastOpened(BulkOperationResultsDialogComponent)!;
      expect(results.data.operation).toBe('defer');
      expect(results.data.result.failures, 'a message not found is reported, never dropped').toEqual([{ sequenceNumber: 42, error: 'Not found within scan window' }]);
    });

    it('a cancelled confirmation sends nothing', () => {
      create({}, { active: [message(42)] }, full).settleOne('defer', message(42));
      lastOpened(ConfirmDialogComponent)!.closed.next(false);

      expect(queue['settleActiveMessages']).not.toHaveBeenCalled();
    });

    it('dead-letter asks for a reason in the dead-letter dialog marked active, then sends the one number with it', () => {
      create({}, { active: [message(42)] }, full).settleOne('deadletter', message(42));
      const asked = lastOpened(DeadLetterDeferredDialogComponent)!;
      expect(asked.data, 'the dialog knows the message is active, so it states the scan').toEqual({ entityName: 'orders', entityType: 'queue', sequenceNumbers: [42], active: true });
      expect(queue['settleActiveMessages']).not.toHaveBeenCalled();
      asked.closed.next({ reason: 'bad-data', description: undefined });

      expect(queue['settleActiveMessages']).toHaveBeenCalledWith('orders', 'deadletter', { sequenceNumbers: [42], reason: 'bad-data', description: undefined });
    });

    it('a subscription sends the action to its own route', () => {
      create({ entityType: 'subscription', entityName: 'audit', topicName: 'events' }, { active: [message(43)] }, full).settleOne('defer', message(43));
      lastOpened(ConfirmDialogComponent)!.closed.next(true);

      expect(topic['settleActiveMessages']).toHaveBeenCalledWith('events', 'audit', 'defer', { sequenceNumbers: [43] });
    });

    it('a provider that declares neither action shows neither', () => {
      const rabbit = shown(message(42), { ...full, supportsDeferral: false, supportsManualDeadLetter: false });
      expect(button(rabbit.el, 'defer-one')).toBeNull();
      expect(button(rabbit.el, 'deadletter-one')).toBeNull();
    });

    it('a deferred message offers no scan action', () => {
      const deferred = shown({ ...message(43), state: 'Deferred' });
      expect(button(deferred.el, 'defer-one'), 'the scan never reaches a deferred message').toBeNull();
      expect(button(deferred.el, 'deadletter-one')).toBeNull();
      expect(button(deferred.el, 'delete-one')).toBeNull();
    });

    it('delete of one message sits apart from the routine actions', () => {
      const { el } = shown(message(42));
      const remove = button(el, 'delete-one')!;
      expect(remove.closest('.message-actions')!.classList.contains('apart'), 'delete sits apart from defer and dead-letter').toBe(true);
      expect(button(el, 'defer-one'), 'the routine actions are shown for an active message').not.toBeNull();
      expect(button(el, 'deadletter-one')).not.toBeNull();
    });

    it('delete of one message calls delete-batch with that one number only after the confirmation', () => {
      create({}, { active: [message(42)] }, full).deleteOne(message(42));
      expect(queue['deleteMessages'], 'nothing is deleted before the confirmation').not.toHaveBeenCalled();
      lastOpened(ConfirmDialogComponent)!.closed.next(true);

      expect(queue['deleteMessages']).toHaveBeenCalledWith('orders', [42], false, false);
    });
  });
});

