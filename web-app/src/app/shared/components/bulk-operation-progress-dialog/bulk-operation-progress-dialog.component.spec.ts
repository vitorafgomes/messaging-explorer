import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BulkOperationProgressDialogComponent, BulkOperationProgressDialogData } from './bulk-operation-progress-dialog.component';

describe('BulkOperationProgressDialogComponent names the sub-queue the operation runs on', () => {
  function description(data: BulkOperationProgressDialogData): string {
    TestBed.configureTestingModule({
      imports: [BulkOperationProgressDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn(), disableClose: true } }
      ]
    });
    const fixture = TestBed.createComponent(BulkOperationProgressDialogComponent);
    fixture.detectChanges();
    return fixture.componentInstance.getOperationDescription();
  }

  it.each([
    ['delete', 'transferdeadletter', 3, 'Deleting 3 transfer dead-letter messages from orders...'],
    ['resubmit', 'transferdeadletter', 2, 'Resubmitting 2 transfer dead-letter messages from orders...'],
    ['delete', 'deadletter', 3, 'Deleting 3 dead letter messages from orders...'],
    ['resubmit', 'deadletter', 1, 'Resubmitting 1 dead letter message from orders...'],
    ['delete', 'active', 3, 'Deleting 3 active messages from orders...']
  ] as const)('a %s on %s of %i messages reads "%s"', (operation, subQueue, totalCount, expected) => {
    expect(description({ operation, subQueue, totalCount, entityName: 'orders', entityType: 'queue' })).toBe(expected);
  });
});
