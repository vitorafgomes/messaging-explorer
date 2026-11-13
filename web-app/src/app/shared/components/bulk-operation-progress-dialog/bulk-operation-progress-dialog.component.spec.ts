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

describe('BulkOperationProgressDialogComponent reports the operation in flight, its outcome and a cancel', () => {
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function render() {
    TestBed.configureTestingModule({
      imports: [BulkOperationProgressDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { operation: 'resubmit', subQueue: 'deadletter', totalCount: 5, entityName: 'orders', entityType: 'queue' } },
        { provide: MatDialogRef, useValue: { close: vi.fn(), disableClose: false } }
      ]
    });
    const fixture = TestBed.createComponent(BulkOperationProgressDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = () => Array.from(el.querySelectorAll('button')).map(text);
    const update = (successCount: number, failureCount: number) => {
      fixture.componentInstance.updateProgress({ processed: 5, successCount, failureCount });
      fixture.detectChanges();
    };
    return { fixture, el, buttons, update };
  }

  it('while the request is in flight it cannot be dismissed, says what it processes and offers Cancel only', () => {
    const { fixture, el, buttons } = render();

    expect(TestBed.inject(MatDialogRef).disableClose).toBe(true);
    expect(text(el)).toContain('Processing 5 messages...');
    expect(text(el)).toContain('Starting operation...');
    expect(el.querySelector('mat-progress-bar')).not.toBeNull();
    expect(buttons()).toEqual(['Cancel']);
    expect(fixture.componentInstance.isComplete()).toBe(false);
  });

  it.each([
    [5, 0, 'Operation completed successfully!'],
    [3, 2, 'Operation completed with some failures'],
    [0, 5, 'Operation failed']
  ])('a final update of %i succeeded and %i failed reads "%s" and offers Close', (successCount, failureCount, status) => {
    const { el, buttons, update } = render();

    update(successCount, failureCount);

    expect(text(el)).toContain('5 of 5 messages processed');
    expect(text(el)).toContain(`Success: ${successCount}`);
    expect(text(el).includes(`Failed: ${failureCount}`)).toBe(failureCount > 0);
    expect(text(el)).toContain(status);
    expect(buttons()).toEqual(['Close']);
  });

  it('Cancel asks the caller to abort once, says messages already processed may have been affected and offers Close', () => {
    const { fixture, el, buttons } = render();
    const requested = vi.fn();
    fixture.componentInstance.cancelRequested$.subscribe(requested);

    (Array.from(el.querySelectorAll('button')).find(b => text(b) === 'Cancel') as HTMLButtonElement).click();
    fixture.componentInstance.cancel();
    fixture.detectChanges();

    expect(requested).toHaveBeenCalledTimes(1);
    expect(text(el)).toContain('Operation cancelled');
    expect(text(el)).toContain('Cancelled: The request was aborted. Any messages already processed by the server before the abort may still have been affected. Refresh the list to see the current state.');
    expect(text(el)).not.toContain('Success:');
    expect(buttons()).toEqual(['Close']);
  });
});
