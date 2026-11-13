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
import { BulkOperationProgressDialogComponent } from '../../shared/components/bulk-operation-progress-dialog/bulk-operation-progress-dialog.component';
import { BulkOperationResultsDialogComponent } from '../../shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component';
import { DEFAULT_AZURE_CAPABILITIES, ProviderService } from '../../core/services/provider.service';
import { ProviderCapabilities } from '../../core/models/provider.model';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

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
          return { afterClosed: () => of('orders-retry') };
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
      expect(confirmations[0].data.requireAcknowledgement).toBeFalsy();
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

    it('every message of the entity selected, no filter: all=true after an acknowledged confirmation', () => {
      const component = create({ activeMessageCount: 20 }, messages(20));

      component.toggleAllActive(true);
      component.onBulkAction({ action: 'delete' });
      confirmations[0].closed.next(true);

      const [, sequenceNumbers, , all] = queueService['deleteMessages'].mock.calls[0];
      expect(all).toBe(true);
      expect(sequenceNumbers).toEqual([]);
      expect(confirmations[0].data.requireAcknowledgement).toBe(true);
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
  let opened: Array<{ component: unknown; data: any; closed: Subject<unknown> }>;
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
        { provide: ConnectionService, useValue: { isConnected: true } },
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
      moveMessages: pending(), cancelScheduledMessages: pending()
    };
    topic = {
      peekMessages: peek(), peekDeadLetterMessages: peek(), peekTransferDeadLetterMessages: peek(),
      deleteMessages: pending(), deleteTransferDeadLetterMessages: pending(),
      resubmitDeadLetterMessages: pending(), resubmitTransferDeadLetterMessages: pending()
    };
    dialog = {
      openDialogs: [selfRef],
      open: vi.fn((component: unknown, config?: { data?: any }) => {
        const closed = new Subject<unknown>();
        opened.push({ component, data: config?.data, closed });
        return {
          afterClosed: () => closed,
          close: vi.fn(),
          componentInstance: { cancelRequested$: new Subject<void>(), updateProgress: vi.fn() }
        };
      })
    };
  });

  afterEach(() => vi.useRealTimers());

  describe('the transfer dead-letter queue is reachable', () => {
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

      expect(toolbarButtons(el)).toEqual(['Delete', 'Resubmit', 'Export', 'Clear']);
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

      expect(lastOpened(ConfirmDialogComponent)!.data.requireAcknowledgement).toBeFalsy();
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
      expect(chips).toEqual(['Scheduled', 'Deferred', '', '']);
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
      expect(text(reason)).toBe('Only scheduled messages can be cancelled; 1 of the 3 selected is not scheduled.');

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
      if (action === 'move') lastOpened(MoveMessagesDialogComponent)!.closed.next('orders-retry');
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
});
