import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { AT_LEAST_ONCE, ContinuousResubmitDialogComponent } from './continuous-resubmit-dialog.component';
import { ConnectionService, MessageExportService, QueueService, ResubmitRunService, TopicService } from '../../core/services';
import { ProviderService } from '../../core/services/provider.service';
import { BatchOperationResult, MessageInfo, ProviderCapabilities } from '../../core/models';

const head = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ sequenceNumber: from + i }) as MessageInfo);

const old = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    sequenceNumber: from + i,
    enqueuedTime: '2020-01-01T00:00:00Z',
    deadLetterReason: 'MaxDeliveryCountExceeded',
    body: 'sample body'
  }) as unknown as MessageInfo);

const ok = (count: number): BatchOperationResult => ({ success: true, successCount: count, failureCount: 0, failures: [] });

const flush = () => new Promise(resolve => setTimeout(resolve));

describe('ContinuousResubmitDialogComponent', () => {
  let queueService: {
    getQueue: ReturnType<typeof vi.fn>;
    peekDeadLetterMessages: ReturnType<typeof vi.fn>;
    resubmitDeadLetterMessages: ReturnType<typeof vi.fn>;
  };
  let capabilities: Partial<ProviderCapabilities> | null;
  let exporter: { downloadFile: ReturnType<typeof vi.fn> };

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { entityType: 'queue', entityName: 'orders', deadLetterMessageCount: 3 } },
        { provide: MatDialogRef, useValue: { close: vi.fn(), disableClose: false } },
        { provide: QueueService, useValue: queueService },
        { provide: TopicService, useValue: {} },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } },
        { provide: ConnectionService, useValue: { connectionStatus$: of({ connected: true }), currentTarget: 'sample.example.net', onBeforeSwitch: vi.fn() } },
        { provide: MessageExportService, useValue: exporter }
      ]
    });
  }

  function create() {
    configure();
    const component = TestBed.runInInjectionContext(() => new ContinuousResubmitDialogComponent());
    component.batchSize = 3;
    return component;
  }

  beforeEach(() => {
    capabilities = null;
    exporter = { downloadFile: vi.fn() };
    queueService = {
      getQueue: vi.fn().mockReturnValue(of({ name: 'orders', deadLetterMessageCount: 3 })),
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

  describe('falls back where the broker cannot read from a position', () => {
    it.each([
      ['an API that does not send the capability', null],
      ['an API that says it cannot', { supportsPeekFromSequenceNumber: false }]
    ])('with %s the dialog runs the head-of-queue loop of before and starts no run', async (_, given) => {
      capabilities = given as Partial<ProviderCapabilities> | null;
      queueService.resubmitDeadLetterMessages.mockReturnValue(of(ok(3)));
      const component = create();

      await component.start();

      expect(queueService.peekDeadLetterMessages.mock.calls[0]).toEqual(['orders', 3]);
      expect(TestBed.inject(ResubmitRunService).activeRuns()).toEqual([]);
      expect(component.run()).toBeUndefined();
    });

    it('when the API says exactly true the dialog starts a run that reads from position 0', async () => {
      capabilities = { supportsPeekFromSequenceNumber: true };
      queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(old(1, 3))).mockReturnValue(of([]));
      queueService.resubmitDeadLetterMessages.mockReturnValue(of(ok(3)));
      const component = create();

      await component.start();
      await component.run()!.done;

      expect(queueService.peekDeadLetterMessages.mock.calls[0]).toEqual(['orders', 3, 0, false]);
      expect(TestBed.inject(ResubmitRunService).find(component.target)).toBe(component.run());
      expect(component.run()!.progress()).toMatchObject({ status: 'completed', resubmitted: 3 });
    });
  });

  describe('runs with the dialog closed', () => {
    it('closing and destroying the dialog keeps the run going, and the dialog opened again shows that run', async () => {
      capabilities = { supportsPeekFromSequenceNumber: true };
      const peek = new Subject<MessageInfo[]>();
      queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(peek).mockReturnValue(of([]));
      queueService.resubmitDeadLetterMessages.mockReturnValue(of(ok(3)));
      const component = create();
      await component.start();
      await flush();

      component.close();
      component.ngOnDestroy();
      peek.next(old(1, 3));
      peek.complete();
      const run = component.run()!;
      await run.done;

      expect(TestBed.inject(MatDialogRef).close).toHaveBeenCalledWith(undefined);
      expect(queueService.resubmitDeadLetterMessages.mock.calls.map(call => call[1])).toEqual([[1, 2, 3]]);
      expect(run.progress().status).toBe('completed');
      const reopened = TestBed.runInInjectionContext(() => new ContinuousResubmitDialogComponent());
      expect(reopened.run()).toBe(run);
    });
  });

  describe('final report, retry the failed without the duplicates', () => {
    async function finishedWithOneFailedAndOneDuplicate() {
      capabilities = { supportsPeekFromSequenceNumber: true };
      queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(old(1, 3))).mockReturnValue(of([]));
      queueService.resubmitDeadLetterMessages.mockReturnValueOnce(of({
        success: false, successCount: 1, failureCount: 2,
        failures: [
          { sequenceNumber: 2, error: 'Not found within scan window' },
          { sequenceNumber: 3, error: 'Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: lock lost' }
        ]
      }));
      const component = create();
      await component.start();
      await component.run()!.done;
      return component;
    }

    it('Save report writes a JSON file with the failed and possible-duplicate sequence numbers and no message body', async () => {
      const component = await finishedWithOneFailedAndOneDuplicate();

      component.saveReport(component.run()!);

      const [content, filename, mimeType] = exporter.downloadFile.mock.calls[0];
      const report = JSON.parse(content);
      expect(filename).toMatch(/^resubmit-report-orders-.*\.json$/);
      expect(mimeType).toBe('application/json');
      expect(report.failedMessages.map((entry: { sequenceNumber: number }) => entry.sequenceNumber)).toEqual([2]);
      expect(report.possibleDuplicateMessages.map((entry: { sequenceNumber: number }) => entry.sequenceNumber)).toEqual([3]);
      expect(content).not.toContain('sample body');
    });

    it('Retry the failed resubmits exactly the failed sequence number, never the possible duplicate', async () => {
      const component = await finishedWithOneFailedAndOneDuplicate();
      queueService.resubmitDeadLetterMessages.mockReturnValue(of(ok(1)));

      component.retryFailed(component.run()!);
      await component.run()!.done;

      expect(queueService.resubmitDeadLetterMessages.mock.calls.map(call => call[1])).toEqual([[1, 2, 3], [2]]);
    });
  });

  describe('the screen states the at-least-once caveat', () => {
    it.each([
      ['the run', { supportsPeekFromSequenceNumber: true }],
      ['the head-of-queue loop', null]
    ])('the configure step of %s says that a message sent but not removed may be delivered twice', (_, given) => {
      capabilities = given as Partial<ProviderCapabilities> | null;
      configure();
      const fixture = TestBed.createComponent(ContinuousResubmitDialogComponent);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(AT_LEAST_ONCE);
      expect(AT_LEAST_ONCE).toContain('at-least-once');
      expect(AT_LEAST_ONCE).toContain('sent but not removed');
      expect(AT_LEAST_ONCE).toContain('delivered twice');
    });

    it('the report of a finished run says it as well, beside the messages it left behind', async () => {
      capabilities = { supportsPeekFromSequenceNumber: true };
      queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(old(1, 2))).mockReturnValue(of([]));
      queueService.resubmitDeadLetterMessages.mockReturnValue(of({
        success: false, successCount: 1, failureCount: 1, failures: [{ sequenceNumber: 2, error: 'Not found within scan window' }]
      }));
      configure();
      const fixture = TestBed.createComponent(ContinuousResubmitDialogComponent);
      fixture.componentInstance.batchSize = 2;
      await fixture.componentInstance.start();
      await fixture.componentInstance.run()!.done;
      fixture.detectChanges();

      const text: string = fixture.nativeElement.textContent;
      expect(text).toContain(AT_LEAST_ONCE);
      expect(text).toContain('Failed, not sent. Not found within scan window');
      expect(text).toContain('Retry the 1 failed');
    });
  });

  describe('the batch size of a run', () => {
    it('a run starts at 250 per batch, what the server reads per scan, and says that a smaller batch costs the broker more; the head-of-queue loop keeps 10', () => {
      capabilities = { supportsPeekFromSequenceNumber: true };
      configure();
      const fixture = TestBed.createComponent(ContinuousResubmitDialogComponent);
      fixture.detectChanges();

      expect(fixture.componentInstance.batchSize).toBe(250);
      expect(fixture.nativeElement.textContent).toContain('A smaller batch costs the broker more scans');

      TestBed.resetTestingModule();
      capabilities = null;
      configure();
      expect(TestBed.createComponent(ContinuousResubmitDialogComponent).componentInstance.batchSize).toBe(10);
    });
  });

  describe('the left-behind table keeps its rows while the run goes on', () => {
    it('a row of a message left behind is the same element after the next batch, not drawn again', async () => {
      capabilities = { supportsPeekFromSequenceNumber: true };
      const second = new Subject<MessageInfo[]>();
      queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(old(1, 2))).mockReturnValueOnce(second).mockReturnValue(of([]));
      queueService.resubmitDeadLetterMessages
        .mockReturnValueOnce(of({ success: false, successCount: 1, failureCount: 1, failures: [{ sequenceNumber: 2, error: 'Not found within scan window' }] }))
        .mockReturnValue(of(ok(2)));
      configure();
      const fixture = TestBed.createComponent(ContinuousResubmitDialogComponent);
      fixture.componentInstance.batchSize = 2;
      await fixture.componentInstance.start();
      await flush();
      fixture.detectChanges();
      const row = () => Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('tr.mat-mdc-row')).find(tr => tr.textContent?.includes('Not found'));
      const before = row();

      second.next(old(3, 2));
      second.complete();
      await fixture.componentInstance.run()!.done;
      fixture.detectChanges();

      expect(before).toBeDefined();
      expect(fixture.componentInstance.run()!.progress().read).toBe(3);
      expect(row()).toBe(before);
    });
  });

  describe('no run starts while the connection is changing', () => {
    it('Start during a connect says so and reads nothing from the broker', async () => {
      capabilities = { supportsPeekFromSequenceNumber: true };
      configure();
      const fixture = TestBed.createComponent(ContinuousResubmitDialogComponent);
      const connection = TestBed.inject(ConnectionService) as unknown as { onBeforeSwitch: ReturnType<typeof vi.fn> };
      await connection.onBeforeSwitch.mock.calls[0][0]();

      await fixture.componentInstance.start();
      fixture.detectChanges();

      expect(fixture.componentInstance.run()).toBeUndefined();
      expect(queueService.getQueue).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain('The connection is changing, so no run was started.');
    });
  });
});
