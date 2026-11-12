import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BulkOperationResultsDialogComponent, BulkOperationResultsDialogData } from './bulk-operation-results-dialog.component';

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
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(BulkOperationResultsDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('shows a possible duplicate as "Possible duplicate - do not retry", distinct from "Failed"', () => {
    const items = Array.from((render().nativeElement as HTMLElement).querySelectorAll('.failure-item'))
      .map(item => item.textContent!.replace(/\s+/g, ' '));

    expect(items[0]).toContain('9008');
    expect(items[0]).toContain('Possible duplicate - do not retry');
    expect(items[1]).toContain('9011');
    expect(items[1]).toContain('Failed');
    expect(items[1]).not.toContain('Possible duplicate');
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

    expect(text(el.querySelector('.modal-title'))).toBe('Cancel scheduled results');
    expect(text(el.querySelector('.operation-summary'))).toBe('Attempted to cancel 3 scheduled messages in billing.');
    expect(Array.from(el.querySelectorAll('.failure-item')).map(i => [text(i.querySelector('.failure-seq-value')), text(i.querySelector('.failure-error'))]))
      .toEqual([['13', 'Failed: Not a scheduled message']]);
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
    expect(items.map(i => text(i.querySelector('.failure-error')))).toEqual([`Failed: ${disabled}`]);
    expect(text(el)).not.toContain('Possible duplicate');
    // The existing rule: a failure that was not sent may be retried by hand, only where the operation offers retry.
    expect(component.getFailedSequenceNumbers()).toEqual([42]);
    const retry = Array.from(el.querySelectorAll('button')).map(text).filter(t => t.startsWith('Retry'));
    expect(retry).toEqual(allowRetry ? ['Retry Failed (1)'] : []);
  });
});
