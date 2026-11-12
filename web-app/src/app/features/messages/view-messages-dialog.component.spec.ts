import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { formatDate } from '@angular/common';
import { Observable, of, Subject } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ViewMessagesDialogComponent, ViewMessagesDialogData } from './view-messages-dialog.component';
import { ConnectionService, QueueService, TopicService } from '../../core/services';
import { BatchOperationResult, MessageInfo } from '../../core/models';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { MoveMessagesDialogComponent } from './move-messages-dialog.component';
import { BulkOperationProgressDialogComponent } from '../../shared/components/bulk-operation-progress-dialog/bulk-operation-progress-dialog.component';
import { BulkOperationResultsDialogComponent } from '../../shared/components/bulk-operation-results-dialog/bulk-operation-results-dialog.component';
import { DEFAULT_AZURE_CAPABILITIES, ProviderService } from '../../core/services/provider.service';
import { ProviderCapabilities } from '../../core/models/provider.model';

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
      const tabs = (el: HTMLElement) => Array.from(el.querySelectorAll('.nav-link')).map(t => text(t).replace(/ \d+$/, ''));

      expect(tabs(render(null, { ...DEFAULT_AZURE_CAPABILITIES, supportsDeadLetterQueue: false }))).toEqual(['Active Messages']);
      TestBed.resetTestingModule();
      expect(tabs(render(null, DEFAULT_AZURE_CAPABILITIES))).toEqual(['Active Messages', 'Dead Letter']);
    });
  });
});
