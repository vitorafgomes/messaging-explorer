import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BulkOperationResultsDialogComponent, BulkOperationResultsDialogData } from './bulk-operation-results-dialog.component';
import { ConnectionGroupService, ConnectionService } from '../../../core/services';

describe('BulkOperationResultsDialogComponent', () => {
  const data: BulkOperationResultsDialogData = {
    operation: 'resubmit',
    entityName: 'orders',
    entityType: 'queue',
    isDeadLetter: true,
    allowRetry: true,
    result: {
      success: false,
      successCount: 1,
      failureCount: 2,
      failures: [
        { sequenceNumber: 9008, error: 'Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: lock lost' },
        { sequenceNumber: 9011, error: 'The lock supplied is invalid' }
      ]
    }
  };

  function render() {
    TestBed.configureTestingModule({
      imports: [BulkOperationResultsDialogComponent],
      providers: [
        // The environment line reads the active connection; none is known here, so nothing is requested.
        { provide: ConnectionService, useValue: { currentTarget: 'sample.example.net', currentConnectionId: null } },
        { provide: ConnectionGroupService, useValue: {} },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(BulkOperationResultsDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  const baseResult = data.result;
  afterEach(() => { data.result = baseResult; });

  it('shows the new message id of each copy, the delivery counts it raised and, as a warning, the unselected messages it dead-lettered', () => {
    data.result = {
      success: true, successCount: 2, failureCount: 0, failures: [],
      newMessageIds: { 7: 'new-7', 8: 'new-8' },
      unselectedDeliveryCountRaised: 3,
      unselectedDeadLettered: [41, 42]
    };
    const element = render().nativeElement as HTMLElement;
    const text = (selector: string) => element.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

    expect(Array.from(element.querySelectorAll('.new-ids tbody tr')).map(row => Array.from(row.querySelectorAll('td')).map(cell => cell.textContent!.trim()).join(' ')), 'each sequence number with its new message id').toEqual(['7 new-7', '8 new-8']);
    expect(text('.delivery-count'), 'the delivery counts the scan raised').toBe('At least 3 unselected messages had their delivery count raised by one.');
    expect(text('.dead-lettered'), 'the unselected messages that reached the dead-letter queue, never silent').toBe('Sent to the dead-letter queue: at least 2 unselected messages reached the max delivery count during the scan: 41, 42.');
    expect(element.querySelector('.dead-lettered')?.getAttribute('role'), 'the dead-letter warning is announced').toBe('alert');
  });

  it('a resubmit refused because the target detects duplicates offers "Send with a new message ID" on Retry, off by default', () => {
    data.result = {
      success: false, successCount: 0, failureCount: 1,
      failures: [{ sequenceNumber: 5, error: 'The target detects duplicates; a copy with the same message id would be dropped. Nothing was sent or removed.' }]
    };
    const fixture = render();
    const component = fixture.componentInstance;

    expect((fixture.nativeElement as HTMLElement).querySelector('.new-message-id')?.textContent?.trim(), 'the option is offered beside Retry').toBe('Send with a new message ID');
    expect(component.newMessageId(), 'the option is off by default').toBe(false);
  });

  it('Retry hands back the choice of a new message ID: false when the option is left off, true once it is ticked', () => {
    const refused = {
      success: false, successCount: 0, failureCount: 1,
      failures: [{ sequenceNumber: 5, error: 'The target detects duplicates; a copy with the same message id would be dropped. Nothing was sent or removed.' }]
    };
    const closes: unknown[] = [];
    for (const tick of [false, true]) {
      TestBed.resetTestingModule();
      data.result = refused;
      const fixture = render();
      const element = fixture.nativeElement as HTMLElement;
      const close = TestBed.inject(MatDialogRef).close as ReturnType<typeof vi.fn>;
      if (tick) {
        element.querySelector<HTMLInputElement>('.new-message-id input')!.click();
        fixture.detectChanges();
      }
      Array.from(element.querySelectorAll('button')).find(b => b.textContent!.includes('Retry Failed'))!.click();
      closes.push(close.mock.calls.at(-1)?.[0]);
    }

    expect(closes, 'Retry carries the option as the user left it').toEqual([
      { retry: true, failedSequenceNumbers: [5], newMessageIdOnDuplicateDetection: false },
      { retry: true, failedSequenceNumbers: [5], newMessageIdOnDuplicateDetection: true }
    ]);
  });

  it('shows a possible duplicate as "Possible duplicate - do not retry", distinct from "Failed"', () => {
    const items = Array.from((render().nativeElement as HTMLElement).querySelectorAll('.failure-item'))
      .map(item => item.textContent!.replace(/\s+/g, ' '));

    expect(items[0]).toContain('9008');
    expect(items[0]).toContain('Possible duplicate - do not retry');
    expect(items[1]).toContain('9011');
    expect(items[1]).toContain('Failed');
    expect(items[1]).not.toContain('Possible duplicate');
  });

  it('lists the failures in a table with Sequence Number, Result and Error, a possible duplicate as a chip, and says Retry takes only the others', () => {
    const el = render().nativeElement as HTMLElement;
    const table = el.querySelector('table.failures-table') as HTMLElement;
    const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text(table.querySelector('caption'))).toMatch(/^Failed Messages \(\d+\)$/);
    expect(Array.from(table.querySelectorAll('th')).map(text)).toEqual(['Sequence Number', 'Result', 'Error']);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(text(rows[0].querySelector('.duplicate-chip'))).toBe('Possible duplicate - do not retry');
    expect(rows[1].querySelector('.duplicate-chip')).toBeNull();
    expect(text(el.querySelector('.retry-info'))).toContain('Retry takes 9011 only: a possible duplicate is never sent again.');
    expect(text(el.querySelector('.stat-card.failure mat-icon')) || el.querySelector('.stat-card.failure mat-icon')?.getAttribute('fonticon')).toBe('report');
  });

  it('names at most ten sequence numbers Retry takes, and leaves out the duplicate sentence when there is no duplicate', () => {
    const mount = (failures: { sequenceNumber: number; error: string }[]) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [BulkOperationResultsDialogComponent],
        providers: [
        // The environment line reads the active connection; none is known here, so nothing is requested.
        { provide: ConnectionService, useValue: { currentTarget: 'sample.example.net', currentConnectionId: null } },
        { provide: ConnectionGroupService, useValue: {} },
          { provide: MAT_DIALOG_DATA, useValue: { ...data, result: { success: false, successCount: 0, failureCount: failures.length, failures } } },
          { provide: MatDialogRef, useValue: { close: vi.fn() } }
        ]
      });
      const fixture = TestBed.createComponent(BulkOperationResultsDialogComponent);
      fixture.detectChanges();
      return fixture;
    };
    const many = Array.from({ length: 12 }, (_, i) => ({ sequenceNumber: 100 + i, error: 'Lock lost' }));
    const withDuplicate = mount([...many, data.result.failures[0]]);
    expect(withDuplicate.componentInstance.retryList()).toBe('100, 101, 102, 103, 104, 105, 106, 107, 108, 109 and 2 more');
    expect((withDuplicate.nativeElement as HTMLElement).querySelector('.retry-info')?.textContent).toContain('a possible duplicate is never sent again');

    const plain = mount([{ sequenceNumber: 5, error: 'Lock lost' }]).nativeElement as HTMLElement;
    expect(plain.querySelector('.retry-info')?.textContent).not.toContain('possible duplicate');
  });

  it('offers to retry only the failure that was not sent', () => {
    const fixture = render();
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .map(button => button.textContent!.trim());

    expect(fixture.componentInstance.getFailedSequenceNumbers()).toEqual([9011]);
    expect(buttons).toContain('Retry Failed (1)');
  });
});

describe('BulkOperationResultsDialogComponent for a scheduled-message cancel', () => {
  it('is titled as a cancel of scheduled messages, says how many were requested, lists each failed sequence number and offers no retry', () => {
    TestBed.configureTestingModule({
      imports: [BulkOperationResultsDialogComponent],
      providers: [
        // The environment line reads the active connection; none is known here, so nothing is requested.
        { provide: ConnectionService, useValue: { currentTarget: 'sample.example.net', currentConnectionId: null } },
        { provide: ConnectionGroupService, useValue: {} },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            operation: 'cancel-scheduled', entityName: 'billing', entityType: 'queue', isDeadLetter: false, allowRetry: false,
            result: { success: false, successCount: 2, failureCount: 1, failures: [{ sequenceNumber: 13, error: 'Not a scheduled message' }] }
          } satisfies BulkOperationResultsDialogData
        },
        { provide: MatDialogRef, useValue: { close: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(BulkOperationResultsDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

    expect(text(el.querySelector('[mat-dialog-title]'))).toBe('Cancel scheduled results');
    expect(text(el.querySelector('.operation-summary'))).toBe('Attempted to cancel 3 scheduled messages in billing.');
    expect(Array.from(el.querySelectorAll('.failure-item')).map(i => Array.from(i.querySelectorAll('td')).map(text)))
      .toEqual([['13', 'Failed', 'Not a scheduled message']]);
    expect(Array.from(el.querySelectorAll('button')).map(text)).toEqual(['Close']);
  });
});

describe('BulkOperationResultsDialogComponent names the sub-queue and shows a disabled entity plainly', () => {
  const disabled = 'The entity is disabled for this operation.';
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function render(data: BulkOperationResultsDialogData) {
    TestBed.configureTestingModule({
      imports: [BulkOperationResultsDialogComponent],
      providers: [
        // The environment line reads the active connection; none is known here, so nothing is requested.
        { provide: ConnectionService, useValue: { currentTarget: 'sample.example.net', currentConnectionId: null } },
        { provide: ConnectionGroupService, useValue: {} },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(BulkOperationResultsDialogComponent);
    fixture.detectChanges();
    return { component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it.each([
    ['delete', 'Attempted to delete 3 transfer dead-letter messages from orders.'],
    ['resubmit', 'Attempted to resubmit 3 transfer dead-letter messages from orders.']
  ] as const)('a %s on the transfer dead-letter queue says so: "%s"', (operation, summary) => {
    const { el } = render({
      operation, entityName: 'orders', entityType: 'queue', subQueue: 'transferdeadletter', allowRetry: false,
      result: { success: true, successCount: 3, failureCount: 0, failures: [] }
    });

    expect(text(el.querySelector('.operation-summary'))).toBe(summary);
  });

  it.each([
    ['delete', 'deadletter', false],
    ['resubmit', 'deadletter', true],
    ['cancel-scheduled', 'active', false]
  ] as const)('a %s whose failure is the disabled entity shows that wording as a failure, never as a possible duplicate', (operation, subQueue, allowRetry) => {
    const { component, el } = render({
      operation, entityName: 'orders', entityType: 'queue', subQueue, allowRetry,
      result: { success: false, successCount: 1, failureCount: 1, failures: [{ sequenceNumber: 42, error: disabled }] }
    });

    const items = Array.from(el.querySelectorAll('.failure-item'));
    expect(items.map(i => text(i.querySelector('.failure-seq-value')))).toEqual(['42']);
    expect(items.map(i => Array.from(i.querySelectorAll('td')).slice(1).map(text))).toEqual([['Failed', disabled]]);
    expect(text(el)).not.toContain('Possible duplicate');
    // The existing rule: a failure that was not sent may be retried by hand, only where the operation offers retry.
    expect(component.getFailedSequenceNumbers()).toEqual([42]);
    const retry = Array.from(el.querySelectorAll('button')).map(text).filter(t => t.startsWith('Retry'));
    expect(retry).toEqual(allowRetry ? ['Retry Failed (1)'] : []);
  });
});

describe('BulkOperationResultsDialogComponent for deferred messages', () => {
  function render(data: object) {
    TestBed.configureTestingModule({
      imports: [BulkOperationResultsDialogComponent],
      providers: [
        { provide: ConnectionService, useValue: { currentTarget: 'sample.example.net', currentConnectionId: null } },
        { provide: ConnectionGroupService, useValue: {} },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(BulkOperationResultsDialogComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const notFound = { success: false, successCount: 1, failureCount: 1, failures: [{ sequenceNumber: 13, error: 'Not found as a deferred message.' }] };

  it('a deferred delete names the deferred messages and shows "Not found as a deferred message." for its sequence number', () => {
    const el = render({ operation: 'delete', deferred: true, entityName: 'billing', entityType: 'queue', subQueue: 'active', allowRetry: false, result: notFound });

    expect(text(el.querySelector('.operation-summary')), 'the summary names deferred messages, not active ones').toBe('Attempted to delete 2 deferred messages from billing.');
    expect(Array.from(el.querySelectorAll('.failure-item')).map(i => Array.from(i.querySelectorAll('td')).map(text)), 'each failure by its sequence number, in the API words')
      .toEqual([['13', 'Failed', 'Not found as a deferred message.']]);
  });

  it('a deferred resubmit and a deferred dead-letter are titled and summarised as such', () => {
    const resubmit = render({ operation: 'resubmit', deferred: true, entityName: 'billing', entityType: 'queue', subQueue: 'active', allowRetry: false, result: notFound });
    expect(text(resubmit.querySelector('.operation-summary')), 'a deferred resubmit is not called a dead-letter resubmit').toBe('Attempted to resubmit 2 deferred messages from billing.');
    TestBed.resetTestingModule();

    const deadLetter = render({ operation: 'deadletter', deferred: true, entityName: 'billing', entityType: 'queue', subQueue: 'active', allowRetry: false, result: notFound });
    expect(text(deadLetter.querySelector('[mat-dialog-title]')), 'the dead-letter title').toBe('Dead-letter Results');
    expect(text(deadLetter.querySelector('.operation-summary')), 'the dead-letter summary').toBe('Attempted to dead-letter 2 deferred messages in billing.');
  });
});
