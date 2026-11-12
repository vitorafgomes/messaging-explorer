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
