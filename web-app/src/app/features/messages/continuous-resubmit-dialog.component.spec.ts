import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ContinuousResubmitDialogComponent } from './continuous-resubmit-dialog.component';
import { QueueService, TopicService } from '../../core/services';
import { BatchOperationResult, MessageInfo } from '../../core/models';

const head = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ sequenceNumber: from + i }) as MessageInfo);

const ok = (count: number): BatchOperationResult => ({ success: true, successCount: count, failureCount: 0, failures: [] });

describe('ContinuousResubmitDialogComponent', () => {
  let queueService: { peekDeadLetterMessages: ReturnType<typeof vi.fn>; resubmitDeadLetterMessages: ReturnType<typeof vi.fn> };

  function create() {
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { entityType: 'queue', entityName: 'orders', deadLetterMessageCount: 3 } },
        { provide: MatDialogRef, useValue: { close: vi.fn(), disableClose: false } },
        { provide: QueueService, useValue: queueService },
        { provide: TopicService, useValue: {} }
      ]
    });
    const component = TestBed.runInInjectionContext(() => new ContinuousResubmitDialogComponent());
    component.batchSize = 3;
    return component;
  }

  beforeEach(() => {
    queueService = {
      peekDeadLetterMessages: vi.fn()
        .mockReturnValueOnce(of(head(1, 3)))
        .mockReturnValueOnce(of(head(1, 3)))
        .mockReturnValue(of([])),
      resubmitDeadLetterMessages: vi.fn()
    };
  });

  describe('continuous resubmit never re-sends a message that failed or may be duplicated, and stops on a failure', () => {
    it('a batch with one possible duplicate stops the loop: the head still holding it is not sent again, and the dialog says why', async () => {
      queueService.resubmitDeadLetterMessages.mockReturnValue(of({
        success: false, successCount: 2, failureCount: 1,
        failures: [{ sequenceNumber: 2, error: 'Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: lock lost' }]
      }));
      const component = create();

      await component.start();

      expect(queueService.resubmitDeadLetterMessages).toHaveBeenCalledTimes(1);
      expect(component.stoppedByError()).toBe(true);
      expect(component.statusMessage()).toContain('possible duplicate - do not retry: 2');
    });

    it('a batch with one failure stops the loop and names the message that failed', async () => {
      queueService.resubmitDeadLetterMessages.mockReturnValue(of({
        success: false, successCount: 2, failureCount: 1,
        failures: [{ sequenceNumber: 3, error: 'The lock supplied is invalid' }]
      }));
      const component = create();

      await component.start();

      expect(queueService.resubmitDeadLetterMessages).toHaveBeenCalledTimes(1);
      expect(component.statusMessage()).toContain('failed: 3');
    });

    it('batches with no failure keep going until the dead-letter queue is drained', async () => {
      queueService.peekDeadLetterMessages = vi.fn()
        .mockReturnValueOnce(of(head(1, 3)))
        .mockReturnValueOnce(of(head(4, 1)));
      queueService.resubmitDeadLetterMessages
        .mockReturnValueOnce(of(ok(3)))
        .mockReturnValueOnce(of(ok(1)));
      const component = create();

      await component.start();

      expect(queueService.resubmitDeadLetterMessages.mock.calls.map(call => call[1])).toEqual([[1, 2, 3], [4]]);
      expect(component.stoppedByError()).toBe(false);
      expect(component.totalSuccess()).toBe(4);
    });
  });

  describe('an unexpected error ends the run as a failure, never as completed', () => {
    it('a resubmit answer the dialog cannot read stops the loop, shows the error and closes with completed false', async () => {
      queueService.resubmitDeadLetterMessages.mockReturnValue(of(null));
      const component = create();

      await component.start();
      component.close();

      expect(queueService.resubmitDeadLetterMessages).toHaveBeenCalledTimes(1);
      expect(component.stoppedByError()).toBe(true);
      expect(component.statusMessage()).toBe('Unexpected error occurred');
      const dialogRef = TestBed.inject(MatDialogRef);
      expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ completed: false, stopped: false }));
    });
  });
});
