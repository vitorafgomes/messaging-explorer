import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { formatDate } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { AT_LEAST_ONCE, ContinuousResubmitDialogComponent } from './continuous-resubmit-dialog.component';
import { ViewMessagesDialogComponent } from './view-messages-dialog.component';
import { ConnectionService, MessageExportService, QueueService, ResubmitRunService, TopicService, formatDuration } from '../../core/services';
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

  it('on a subscription the dialog says that the topic sends every resubmitted message to all its subscriptions', () => {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { entityType: 'subscription', entityName: 'eu', topicName: 'sales', deadLetterMessageCount: 3 } },
        { provide: MatDialogRef, useValue: { close: vi.fn(), disableClose: false } },
        { provide: QueueService, useValue: queueService },
        { provide: TopicService, useValue: { getSubscription: vi.fn().mockReturnValue(of({ name: 'eu', deadLetterMessageCount: 3 })) } },
        { provide: ProviderService, useValue: { capabilities: signal(capabilities) } },
        { provide: ConnectionService, useValue: { connectionStatus$: of({ connected: true }), currentTarget: 'sample.example.net', onBeforeSwitch: vi.fn() } },
        { provide: MessageExportService, useValue: exporter }
      ]
    });
    const fixture = TestBed.createComponent(ContinuousResubmitDialogComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.topic-resubmit-note[role="note"]')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('Resubmit publishes to the topic sales. Every subscription of sales receives these messages again, not only eu.');
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
          { sequenceNumber: 2, error: 'The entity is disabled for this operation.' },
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
        success: false, successCount: 1, failureCount: 1, failures: [{ sequenceNumber: 2, error: 'The entity is disabled for this operation.' }]
      }));
      configure();
      const fixture = TestBed.createComponent(ContinuousResubmitDialogComponent);
      fixture.componentInstance.batchSize = 2;
      await fixture.componentInstance.start();
      await fixture.componentInstance.run()!.done;
      fixture.detectChanges();

      const text: string = fixture.nativeElement.textContent;
      expect(text).toContain(AT_LEAST_ONCE);
      expect(text).toContain('Failed, not sent. The entity is disabled for this operation.');
      expect(text).toContain('Retry the 1 failed');
    });
  });

  describe('the batch size of a run', () => {
    it('a run starts at 250 per batch, what the server reads per scan, and says the cycles that takes; the head-of-queue loop keeps 10', () => {
      capabilities = { supportsPeekFromSequenceNumber: true };
      configure();
      const fixture = TestBed.createComponent(ContinuousResubmitDialogComponent);
      fixture.detectChanges();

      expect(fixture.componentInstance.batchSize).toBe(250);
      expect(fixture.nativeElement.textContent).toContain('1 to 500 messages per cycle: 1 cycle for 3.');

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
      queueService.getQueue.mockReturnValue(of({ name: 'orders', deadLetterMessageCount: 10 }));
      queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(old(1, 2))).mockReturnValueOnce(second).mockReturnValue(new Subject());
      queueService.resubmitDeadLetterMessages
        .mockReturnValueOnce(of({ success: false, successCount: 1, failureCount: 1, failures: [{ sequenceNumber: 2, error: 'The entity is disabled for this operation.' }] }))
        .mockReturnValue(of(ok(2)));
      configure();
      const fixture = TestBed.createComponent(ContinuousResubmitDialogComponent);
      fixture.componentInstance.batchSize = 2;
      await fixture.componentInstance.start();
      await flush();
      fixture.detectChanges();
      const row = () => Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('tr.mat-mdc-row')).find(tr => tr.textContent?.includes('The entity is disabled'));
      const before = row();

      second.next(old(3, 2));
      second.complete();
      await flush();
      fixture.detectChanges();

      expect(before).toBeDefined();
      expect(fixture.componentInstance.run()!.progress().read, 'the next batch was read and the run goes on').toBe(4);
      expect(row()).toBe(before);
      fixture.componentInstance.run()!.stop();
      await fixture.componentInstance.run()!.done;
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

  describe('the configure screen says what a run continues past and what a filter costs', () => {
    function configureScreen() {
      capabilities = { supportsPeekFromSequenceNumber: true };
      configure();
      const fixture = TestBed.createComponent(ContinuousResubmitDialogComponent);
      fixture.detectChanges();
      return fixture;
    }

    it('"continue past a failure" is said to cover a refused send and a possible duplicate, never a message the server cannot find', () => {
      const text: string = configureScreen().nativeElement.textContent;

      expect(text).toContain('Continuing applies to a message the broker refused and to a possible duplicate. A message the server cannot find is tried again once its lock is released, and then stops the run.');
    });

    it('with a filter set, the screen warns that a filtered run may stop early; without one it does not', async () => {
      const fixture = configureScreen();
      const warning = 'A filter leaves the messages it skips at the head of the queue; the server can reach only a few hundred messages past them, so a filtered run may stop early.';
      expect(fixture.nativeElement.textContent).not.toContain(warning);

      fixture.componentInstance.onlyMatching = true;
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain(warning);

      fixture.componentInstance.reasonFilter = 'MaxDeliveryCountExceeded';
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(warning);

      fixture.componentInstance.reasonFilter = ' ';
      fixture.componentInstance.textFilter = 'order-7';
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(warning);
    });
  });

  describe('Pause and Resume through the buttons of the dialog', () => {
    it('Pause holds the run after the request in flight, with no peek or resubmit, and Resume carries it on', async () => {
      capabilities = { supportsPeekFromSequenceNumber: true };
      const answer = new Subject<BatchOperationResult>();
      queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(old(1, 2))).mockReturnValue(of([]));
      queueService.resubmitDeadLetterMessages.mockReturnValueOnce(answer);
      configure();
      const fixture = TestBed.createComponent(ContinuousResubmitDialogComponent);
      fixture.detectChanges();
      const button = (label: string) =>
        Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button')).find(b => b.textContent?.trim().endsWith(label))!;
      const status = () => (fixture.nativeElement.querySelector('.status')?.textContent ?? '').replace(/\s+/g, ' ').trim();

      button('Start: resubmit 3').click();
      await flush();
      fixture.detectChanges();
      button('Pause').click();
      answer.next(ok(2));
      answer.complete();
      await flush();
      fixture.detectChanges();

      expect(status()).toContain('Paused.');
      expect(queueService.peekDeadLetterMessages).toHaveBeenCalledTimes(1);
      expect(queueService.resubmitDeadLetterMessages).toHaveBeenCalledTimes(1);

      button('Resume').click();
      await flush();
      fixture.detectChanges();

      expect(queueService.peekDeadLetterMessages).toHaveBeenCalledTimes(2);
      expect(status()).toContain('Finished.');
    });
  });

  describe('the screens the artboard draws', () => {
    const text = (e: Element | null | undefined) => {
      const copy = e?.cloneNode(true) as Element | undefined;
      copy?.querySelectorAll('mat-icon, mat-progress-spinner').forEach(icon => icon.remove());
      return (copy?.textContent ?? '').replace(/\s+/g, ' ').trim();
    };
    const icons = (e: Element | null) => Array.from(e?.querySelectorAll('mat-icon') ?? []).map(i => i.textContent?.trim());
    /** The text of each child, spaced as the screen reads it. */
    const joined = (e: Element) => Array.from(e.children).map(text).filter(t => t !== '').join(' ');

    function screen(given: Partial<ProviderCapabilities> | null, data?: object) {
      capabilities = given;
      configure();
      if (data) {
        TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
      }
      const fixture = TestBed.createComponent(ContinuousResubmitDialogComponent);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const buttons = () => Array.from(el.querySelectorAll('mat-dialog-actions button')).map(text);
      const button = (label: string) => Array.from<HTMLButtonElement>(el.querySelectorAll('mat-dialog-actions button')).find(b => text(b) === label)!;
      const update = async () => { await flush(); fixture.detectChanges(); };
      return { fixture, el, buttons, button, update };
    }

    describe('where the broker cannot read from a position: the head-of-queue loop', () => {
      it('configure: the title with its icon, what the run does, the batch size and the dead-letter count', () => {
        const { el } = screen(null);

        expect(text(el.querySelector('h2[mat-dialog-title]'))).toBe('Auto Resubmit Dead Letters');
        expect(icons(el.querySelector('h2[mat-dialog-title]')), 'the title carries the resubmit icon').toStrictEqual(['refresh']);
        expect(text(el.querySelector('.intro'))).toBe('This will continuously resubmit dead letter messages in batches until the queue is empty or you stop the process.');
        expect(text(el.querySelector('.batch > label'))).toBe('Batch Size');
        expect(text(el.querySelector('.batch mat-hint')), 'the hint says the range and the starting size').toBe('Number of messages to process per cycle (1 to 500). The app starts at 10.');
        expect(text(el.querySelector('.note.count')), 'the dead-letter count sits in an info notice').toBe('Approximately 3 dead letter messages in queue.');
        expect(icons(el.querySelector('.note.count'))).toStrictEqual(['info']);
      });

      it('configure: says what the run costs as the app is today, from the batch size and the count', () => {
        const { el } = screen(null);

        expect(text(el.querySelector('.cost strong'))).toBe('What this run costs as the app is today');
        expect(Array.from(el.querySelectorAll('.cost dl > div')).map(row => `${text(row.querySelector('dt'))}: ${text(row.querySelector('dd'))}`)).toStrictEqual([
          'Cycles: 1 cycle of 10, for 3 messages',
          'Requests to the broker: 2: one peek, then one resubmit, per cycle, one after the other',
          'While it runs: The loop lives in this dialog. It stays open for every cycle and cannot be closed; quitting the app ends the run.',
          'If one message fails: The run stops at that batch and names the sequence numbers. Read the dead-letter queue again before another run: what that batch did is not known.'
        ]);
        expect(text(el.querySelector('.cost .cost-note'))).toBe('This loop does not send first: the broker can take a message out of dead-letter before it is published again, so a failed publish can lose it, and a batch whose call fails has an unknown outcome. Read the dead-letter queue again before you retry.');
      });

      it('configure: a batch size outside 1 to 500 says so, marks the field and keeps Start disabled', () => {
        const { fixture, el, button } = screen(null);
        fixture.componentInstance.batchSize = 0;
        fixture.changeDetectorRef.markForCheck();
        fixture.detectChanges();

        expect(text(el.querySelector('.batch mat-hint')), 'the hint turns into what to enter').toBe('Enter a whole number from 1 to 500. Start stays disabled until then.');
        expect(el.querySelector('.batch mat-hint')!.classList.contains('invalid')).toBe(true);
        expect(el.querySelector('.batch input')!.getAttribute('aria-invalid')).toBe('true');
        expect(Array.from(el.querySelectorAll('.cost dl dd')).slice(0, 2).map(text)).toStrictEqual(['Not known until the batch size is a number from 1 to 500', 'Not known: one peek, then one resubmit, per cycle, one after the other']);
        expect(button('Start').disabled).toBe(true);
      });

      it('running: Batch, Processed, Success and Failed, the overall progress in percent, the status with a spinner, the batch log and a tonal Stop', async () => {
        const second = new Subject<MessageInfo[]>();
        queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(head(1, 3))).mockReturnValueOnce(second);
        queueService.resubmitDeadLetterMessages.mockReturnValue(of(ok(3)));
        const { fixture, el, buttons, button } = screen(null, { entityType: 'queue', entityName: 'orders', deadLetterMessageCount: 3000 });
        fixture.componentInstance.batchSize = 3;
        void fixture.componentInstance.start();
        await flush();
        fixture.detectChanges();

        expect(Array.from(el.querySelectorAll('.stat')).map(joined)).toStrictEqual(['Batch 2', 'Processed 3', 'Success 3', 'Failed 0']);
        expect(joined(el.querySelector('.overall')!), 'the percent of the count resubmitted sits beside its label').toBe('Overall Progress 0%');
        expect(el.querySelector('.status mat-progress-spinner'), 'a running batch shows a spinner').not.toBeNull();
        expect(text(el.querySelector('.status'))).toBe('Batch #2: Peeking messages...');
        expect(text(el.querySelector('.log-label')), 'the batch log is labelled on screen').toBe('Batch Log');
        expect(Array.from(el.querySelectorAll('.log li')).map(joined)).toStrictEqual(['#1 3 peeked, 3 ok']);
        expect(buttons()).toStrictEqual(['Stop']);
        expect(button('Stop').getAttribute('matbutton'), 'Stop is the tonal button').toBe('tonal');

        button('Stop').click();
        second.next([]);
        second.complete();
        await flush();
        fixture.detectChanges();
        expect(text(el.querySelector('.status')), 'stopped by the user says so').toBe('Stopped by user');
        expect(icons(el.querySelector('.status'))).toStrictEqual(['stop_circle']);
        expect(el.querySelector('.status')!.classList.contains('tone-stopped')).toBe(true);
      });

      it('completed: the status says the queue is empty with a check, and Close ends it', async () => {
        queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(head(1, 2))).mockReturnValue(of([]));
        queueService.resubmitDeadLetterMessages.mockReturnValue(of(ok(2)));
        const { fixture, el, buttons } = screen(null);
        await fixture.componentInstance.start();
        fixture.detectChanges();

        expect(text(el.querySelector('.status'))).toBe('Completed - Dead letter queue is empty');
        expect(icons(el.querySelector('.status'))).toStrictEqual(['check_circle']);
        expect(el.querySelector('.status')!.classList.contains('tone-success')).toBe(true);
        expect(buttons()).toStrictEqual(['Close']);
      });

      it('stopped on a failure: the failed count of a batch in the error colour, and what to do next with each sequence number', async () => {
        queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(head(1, 3)));
        queueService.resubmitDeadLetterMessages.mockReturnValue(of({
          success: false, successCount: 1, failureCount: 2,
          failures: [
            { sequenceNumber: 2, error: 'Not found within scan window' },
            { sequenceNumber: 3, error: 'Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: lock lost' }
          ]
        }));
        const { fixture, el } = screen(null);
        fixture.componentInstance.batchSize = 3;
        await fixture.componentInstance.start();
        fixture.detectChanges();

        expect(text(el.querySelector('.status'))).toBe('Stopped: batch #1 reported 2 failure(s); they are not resubmitted again (failed: 2; possible duplicate - do not retry: 3)');
        expect(el.querySelector('.status')!.classList.contains('tone-failed')).toBe(true);
        expect(joined(el.querySelector('.log li')!)).toBe('#1 3 peeked, 1 ok, 2 failed');
        expect(text(el.querySelector('.log li .error')), 'only the failed part is in the error colour').toBe(', 2 failed');
        expect(text(el.querySelector('.next strong'))).toBe('What you can do next');
        expect(Array.from(el.querySelectorAll('.next li')).map(li => text(li)), 'each next step names its sequence numbers').toStrictEqual([
          '2 failed and was not sent. It is still in dead-letter and can be resubmitted from the message list.',
          '3 was sent to orders and could not be removed from dead-letter. Do not resubmit it: check that it arrived, then delete it from dead-letter.',
          'Starting again reads from the head of the dead-letter queue, where these 2 still are, and would send 3 a second time. Deal with the 2 first.'
        ]);
      });
    });

    describe('where the broker reads from a position: the run', () => {
      const POSITIONAL = { supportsPeekFromSequenceNumber: true };

      it('configure: which messages, All with the count or Only the matching ones, the batch hint with its cycles and Start naming the count', () => {
        const { fixture, el, buttons } = screen(POSITIONAL);

        expect(text(el.querySelector('h2[mat-dialog-title]'))).toBe('Auto resubmit dead-letter');
        expect(text(el.querySelector('.scope legend'))).toBe('Which messages');
        expect(Array.from(el.querySelectorAll('.scope mat-radio-button')).map(r => text(r))).toStrictEqual(['All 3 dead-letter messages', 'Only the messages that match']);
        expect(el.querySelector('select[name="reason"]'), 'the filter fields wait for "Only the messages that match"').toBeNull();
        expect(text(el.querySelector('.batch > label'))).toBe('Batch Size');
        expect(text(el.querySelector('.batch mat-hint')), 'the cycles a run of all of them takes').toBe('1 to 500 messages per cycle: 1 cycle for 3.');
        expect(buttons()).toStrictEqual(['Cancel', 'Start: resubmit 3']);

        fixture.componentInstance.onlyMatching = true;
        fixture.changeDetectorRef.markForCheck();
        fixture.detectChanges();

        expect(text(el.querySelector('select[name="reason"]')!.closest('mat-form-field')!.querySelector('mat-label'))).toBe('Dead-letter reason');
        expect(el.querySelector('input[name="text"]')).not.toBeNull();
        expect(text(el.querySelector('.batch mat-hint')), 'how many match is not known before the run').toBe('1 to 500 messages per cycle.');
        expect(buttons()).toStrictEqual(['Cancel', 'Start']);
      });

      it('All the dead-letter messages starts a run with no filter, whatever was typed in the filter before', async () => {
        queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(old(1, 3))).mockReturnValue(of([]));
        queueService.resubmitDeadLetterMessages.mockReturnValue(of(ok(3)));
        const { fixture } = screen(POSITIONAL);
        const dialog = fixture.componentInstance;
        dialog.onlyMatching = true;
        dialog.reasonFilter = 'TTLExpiredException';
        dialog.textFilter = 'order-7';
        dialog.onlyMatching = false;

        await dialog.start();
        await dialog.run()!.done;

        expect(dialog.run()!.options, 'All means every dead-letter message').toMatchObject({ reason: undefined, text: undefined });
        expect(queueService.resubmitDeadLetterMessages.mock.calls.map(call => call[1])).toEqual([[1, 2, 3]]);
      });

      it('running: the heading, Read, Resubmitted, Failed not sent and Possible duplicate, how many of the count were read in percent, and the left behind newest first', async () => {
        const second = new Subject<MessageInfo[]>();
        queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(old(1, 2))).mockReturnValueOnce(second);
        queueService.resubmitDeadLetterMessages.mockReturnValueOnce(of({
          success: false, successCount: 0, failureCount: 2,
          failures: [{ sequenceNumber: 1, error: 'The entity is disabled for this operation.' }, { sequenceNumber: 2, error: 'The entity is disabled for this operation.' }]
        }));
        const { fixture, el, update } = screen(POSITIONAL);
        fixture.componentInstance.batchSize = 2;
        await fixture.componentInstance.start();
        await update();

        expect(text(el.querySelector('h2[mat-dialog-title]'))).toBe('Resubmit running');
        expect(Array.from(el.querySelectorAll('.stat')).map(joined)).toStrictEqual(['Read 2', 'Resubmitted 0', 'Failed, not sent 2', 'Possible duplicate 0']);
        expect(joined(el.querySelector('.read-of')!), 'what was read of the count, and its percent, above the bar').toBe('2 of 3 read 67%');
        expect(text(el.querySelector('.left caption'))).toBe('Left behind so far: 2, each by sequence number. Newest first, 2 shown.');
        expect(Array.from(el.querySelectorAll('.left tr.mat-mdc-row td:first-child')).map(td => text(td)), 'newest first').toStrictEqual(['2', '1']);

        fixture.componentInstance.run()!.stop();
        second.complete();
        await fixture.componentInstance.run()!.done;
      });

      it('running with a filter also says how many matched so far', async () => {
        queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(old(1, 3))).mockReturnValue(new Subject());
        queueService.resubmitDeadLetterMessages.mockReturnValue(of(ok(3)));
        const { fixture, el, update } = screen(POSITIONAL, { entityType: 'queue', entityName: 'orders', deadLetterMessageCount: 3 });
        queueService.getQueue.mockReturnValue(of({ name: 'orders', deadLetterMessageCount: 6 }));
        fixture.componentInstance.onlyMatching = true;
        fixture.componentInstance.reasonFilter = 'MaxDeliveryCountExceeded';
        await fixture.componentInstance.start();
        await update();

        expect(Array.from(el.querySelectorAll('.stat')).map(joined)).toStrictEqual(['Read 3', 'Matched so far 3', 'Left by the filter 0', 'Resubmitted 3', 'Failed, not sent 0', 'Possible duplicate 0']);
        fixture.componentInstance.run()!.stop();
        await fixture.componentInstance.run()!.done;
      });

      async function finished() {
        queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(old(1, 3))).mockReturnValue(of([]));
        queueService.resubmitDeadLetterMessages.mockReturnValueOnce(of({
          success: false, successCount: 1, failureCount: 2,
          failures: [
            { sequenceNumber: 3, error: 'Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: lock lost' },
            { sequenceNumber: 2, error: 'The entity is disabled for this operation.' }
          ]
        }));
        const s = screen(POSITIONAL);
        await s.fixture.componentInstance.start();
        await s.fixture.componentInstance.run()!.done;
        s.fixture.detectChanges();
        return s;
      }

      it('finished: the heading, the reasons with their total, every left-behind message by sequence number, and the actions in the order drawn', async () => {
        const { el, buttons, button } = await finished();

        expect(text(el.querySelector('h2[mat-dialog-title]'))).toBe('Resubmit finished');
        expect(Array.from(el.querySelectorAll('.reasons tr.mat-mdc-row')).map(r => Array.from(r.querySelectorAll('td')).map(td => text(td)))).toStrictEqual([
          ['MaxDeliveryCountExceeded', '3', '1', '1', '1'],
          ['Total', '3', '1', '1', '1']
        ]);
        expect(text(el.querySelector('.left caption'))).toBe('Left in dead-letter: 2, by sequence number. 2 shown, all 2 in the file.');
        expect(Array.from(el.querySelectorAll('.left tr.mat-mdc-row')).map(joined), 'by sequence number, lowest first').toStrictEqual([
          '2 MaxDeliveryCountExceeded Failed, not sent. The entity is disabled for this operation.',
          '3 MaxDeliveryCountExceeded Possible duplicate, do not retry. Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: lock lost'
        ]);
        expect(buttons()).toStrictEqual(['Save report, JSON', 'Save report, CSV', 'Retry the 1 failed', 'New run', 'Close']);
        expect(button('Close').getAttribute('matbutton'), 'Close is the tonal button').toBe('tonal');
      });

      it('Save report, CSV writes every left-behind message with its reason and result, escaped for a spreadsheet, and no message body', async () => {
        const { button } = await finished();
        const run = (TestBed.inject(ResubmitRunService)).find({ entityType: 'queue', entityName: 'orders', subQueue: 'deadletter' })!;
        run.failed.push({ sequenceNumber: 9, deadLetterReason: '=HYPERLINK("x")', error: 'Said "no", twice' });

        button('Save report, CSV').click();

        const [content, filename, mimeType] = exporter.downloadFile.mock.calls[0];
        expect(filename).toMatch(/^resubmit-report-orders-.*\.csv$/);
        expect(mimeType).toBe('text/csv');
        expect(content.split('\r\n'), 'one line per message left behind, quotes doubled, a formula never left to run').toStrictEqual([
          '"Sequence Number","Reason","Result","Detail"',
          '"2","MaxDeliveryCountExceeded","Failed, not sent.","The entity is disabled for this operation."',
          '"3","MaxDeliveryCountExceeded","Possible duplicate, do not retry.","Message was resubmitted but could not be removed from the dead-letter queue and may be duplicated on retry: lock lost"',
          '"9","\'=HYPERLINK(""x"")","Failed, not sent.","Said ""no"", twice"'
        ]);
        expect(content).not.toContain('sample body');
      });

      it('Save report, CSV leaves no cell starting with +, -, @, a tab or a carriage return to run as a formula', async () => {
        const { button } = await finished();
        const run = (TestBed.inject(ResubmitRunService)).find({ entityType: 'queue', entityName: 'orders', subQueue: 'deadletter' })!;
        run.failed.push(
          { sequenceNumber: 11, deadLetterReason: '+1', error: '-2' },
          { sequenceNumber: 12, deadLetterReason: '@x', error: '\tz' },
          { sequenceNumber: 13, deadLetterReason: '\ry', error: 'plain' },
        );
        button('Save report, CSV').click();
        const lines = (exporter.downloadFile.mock.calls[0][0] as string).split('\r\n');
        expect(lines.find(l => l.startsWith('"11"'))).toBe(`"11","'+1","Failed, not sent.","'-2"`);
        expect(lines.find(l => l.startsWith('"12"'))).toBe(`"12","'@x","Failed, not sent.","'\tz"`);
        expect(lines.find(l => l.startsWith('"13"'))).toContain(`"'\ry"`);
      });
    });

    describe('the proposed panels of the AutoResubmit artboard', () => {
      const POSITIONAL = { supportsPeekFromSequenceNumber: true };
      const local = (value: string) => new Date(value).getTime();
      const disabledReason = { sequenceNumber: 2, error: 'The entity is disabled for this operation.' };

      /** Chooses "Only the messages that match" and types the filter, as the user does. */
      async function filtered(s: ReturnType<typeof screen>, values: { reason?: string; from?: string; to?: string }) {
        if (!s.fixture.componentInstance.onlyMatching) {
          s.el.querySelectorAll<HTMLInputElement>('.scope mat-radio-button input')[1].click();
          await s.update();
        }
        const type = (name: string, value: string) => {
          const input = s.el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
          input.value = value;
          input.dispatchEvent(new Event('input'));
        };
        const reason = s.el.querySelector<HTMLSelectElement>('select[name="reason"]')!;
        reason.value = values.reason ?? '';
        reason.dispatchEvent(new Event('change'));
        type('enqueuedFrom', values.from ?? '');
        type('enqueuedTo', values.to ?? '');
        await s.update();
        return s.fixture.componentInstance;
      }

      it('configure: Enqueued from and to, then "N of M match" counted by peeking, with "Count again", and the batch hint and Start naming the match count', async () => {
        queueService.peekDeadLetterMessages = vi.fn()
          .mockReturnValueOnce(of([...old(1, 3), { ...old(4, 1)[0], deadLetterReason: 'TTLExpiredException' } as MessageInfo]))
          .mockReturnValue(of([]));
        const s = screen(POSITIONAL);
        const dialog = await filtered(s, { reason: 'MaxDeliveryCountExceeded' });

        expect(Array.from(s.el.querySelectorAll('.dates mat-label')).map(l => text(l))).toStrictEqual(['Enqueued from', 'Enqueued to']);
        expect(Array.from<HTMLInputElement>(s.el.querySelectorAll('.dates input')).map(i => i.type), 'a date and a time each').toStrictEqual(['datetime-local', 'datetime-local']);
        dialog.countMatching();
        await s.update();

        expect(joined(s.el.querySelector('.match-count .counted')!), 'the count and how it was made, as drawn').toBe('3 of 4 match Counted by reading the dead-letter queue once: 2 peeks of 500. Nothing was changed.');
        expect(text(s.el.querySelector('.match-count button'))).toBe('Count again');
        expect(queueService.resubmitDeadLetterMessages, 'a count changes nothing').not.toHaveBeenCalled();
        expect(text(s.el.querySelector('.batch mat-hint')), 'the batch hint names the match count').toBe('1 to 500 messages per cycle: 1 cycle for 4, 3 of them matching.');
        expect(s.buttons(), 'Start names the match count').toStrictEqual(['Cancel', 'Start: resubmit 3']);

        await filtered(s, { reason: 'TTLExpiredException' });

        expect(s.el.querySelector('.match-count .counted'), 'a changed filter drops the count it no longer describes').toBeNull();
        expect(s.buttons()).toStrictEqual(['Cancel', 'Start']);
      });

      it('the dead-letter reason is chosen from "Any reason" and the named reasons the artboard draws, or typed under Other; the run takes a message whose reason equals it', async () => {
        const s = screen(POSITIONAL);
        s.el.querySelectorAll<HTMLInputElement>('.scope mat-radio-button input')[1].click();
        await s.update();
        const select = () => s.el.querySelector<HTMLSelectElement>('select[name="reason"]')!;
        const choose = async (value: string) => { select().value = value; select().dispatchEvent(new Event('change')); await s.update(); };
        const start = () => Array.from<HTMLButtonElement>(s.el.querySelectorAll('mat-dialog-actions button')).find(b => text(b) === 'Start')!;

        expect(Array.from(select()?.options ?? []).map(o => o.textContent?.trim()), 'Any reason, the three reasons drawn, then Other')
          .toStrictEqual(['Any reason', 'MaxDeliveryCountExceeded', 'TTLExpiredException', 'HeaderSizeExceeded', 'Other']);
        expect(select().value, 'Any reason by default').toBe('');
        expect(s.el.querySelector('input[name="reasonOther"]'), 'no field to type until Other is chosen').toBeNull();

        await choose('TTLExpiredException');
        expect(s.fixture.componentInstance.filter().reason, 'a named reason is the reason the run matches').toBe('TTLExpiredException');

        await choose(select().options[4].value);
        const other = s.el.querySelector<HTMLInputElement>('input[name="reasonOther"]')!;
        expect(text(other.closest('mat-form-field')!.querySelector('mat-label')), 'Other opens a field to type the reason').toBe('Other reason');
        expect(start().disabled, 'Other with nothing typed starts nothing: it would take every reason').toBe(true);

        other.value = ' SessionLockLost ';
        other.dispatchEvent(new Event('input'));
        await s.update();
        expect(s.fixture.componentInstance.filter().reason, 'a typed reason is matched as typed, trimmed').toBe('SessionLockLost');
        expect(start().disabled, 'Start once the reason is typed').toBe(false);
        expect(s.el.textContent, 'the designer\'s note on the old app is not shown').not.toContain('(what the app does today)');
      });

      it('a count that reached its cap says so and leaves Start unnamed; a count whose peek fails says so, never a number', async () => {
        const s = screen(POSITIONAL);
        const dialog = await filtered(s, { reason: 'MaxDeliveryCountExceeded' });
        dialog.matchCount.set({ read: 100_000, matched: 7, peeks: 200, capped: true, done: true });
        s.fixture.detectChanges();

        expect(joined(s.el.querySelector('.match-count .counted')!)).toBe('7 of the first 100,000 match Counted in the first 100,000 messages only: 200 peeks of 500; the rest was not read. Nothing was changed.');
        expect(s.buttons(), 'a capped count is not the number the run resubmits').toStrictEqual(['Cancel', 'Start']);

        queueService.peekDeadLetterMessages = vi.fn().mockReturnValue(throwError(() => ({ status: 503 })));
        dialog.countMatching();
        await s.update();

        expect(s.el.querySelector('.match-count .counted'), 'a failed count shows no number').toBeNull();
        expect(text(s.el.querySelector('.match-count [role="alert"]'))).toBe('The count failed. Nothing was changed.');
      });

      it('Start passes the enqueued range to the run in local time; a range that ends before it starts says so and keeps Start and Count disabled', async () => {
        queueService.peekDeadLetterMessages = vi.fn().mockReturnValue(new Subject());
        const s = screen(POSITIONAL);
        const dialog = await filtered(s, { from: '2026-11-12T14:00', to: '2026-11-10T00:00' });

        expect(text(s.el.querySelector('.dates-invalid')), 'the guard on the range fires').toBe('Enqueued to is before Enqueued from.');
        expect(s.button('Start').disabled).toBe(true);
        expect((s.el.querySelector('.match-count button') as HTMLButtonElement).disabled).toBe(true);

        await filtered(s, { from: '2026-11-10T00:00', to: '2026-11-12T14:00' });
        expect(s.button('Start').disabled).toBe(false);
        await dialog.start();

        expect(dialog.run()!.options, 'the run selects by the range as typed, in local time').toMatchObject({ enqueuedFrom: local('2026-11-10T00:00'), enqueuedTo: local('2026-11-12T14:00') });
        dialog.run()!.stop();
        await dialog.run()!.done;
      });

      it('running: "Batch N of M: resubmitting K.", the left behind with their Batch, and the rate over the last 5 minutes', async () => {
        const first = new Subject<BatchOperationResult>();
        queueService.getQueue.mockReturnValue(of({ name: 'orders', deadLetterMessageCount: 4 }));
        queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(old(1, 2))).mockReturnValueOnce(of(old(3, 2))).mockReturnValue(new Subject());
        queueService.resubmitDeadLetterMessages.mockReturnValueOnce(first).mockReturnValueOnce(new Subject());
        const s = screen(POSITIONAL);
        const T = Date.parse('2026-11-12T09:00:00Z');
        let clock = T;
        TestBed.inject(ResubmitRunService).now = () => clock;
        s.fixture.componentInstance.batchSize = 2;
        await s.fixture.componentInstance.start();
        await s.update();
        clock = T + 400_000;
        first.next({ success: false, successCount: 1, failureCount: 1, failures: [disabledReason] });
        first.complete();
        await s.update();

        expect(text(s.el.querySelector('.status'))).toBe('Running. Batch 2 of 2: resubmitting 2. Reading onward from sequence number 5; the 1 left behind are not read again by this run.');
        expect(Array.from(s.el.querySelectorAll('.left th')).map(th => text(th)), 'while running the table names the batch').toStrictEqual(['Sequence Number', 'Batch', 'Result']);
        expect(Array.from(s.el.querySelectorAll('.left tr.mat-mdc-row')).map(joined)).toStrictEqual(['2 1 Failed, not sent. The entity is disabled for this operation.']);
        expect(joined(s.el.querySelector('.timing')!), 'the rate says it covers the last 5 minutes').toBe('Elapsed 6 min 40 s Rate 0 messages per second, last 5 minutes About 0 s left');
        s.fixture.componentInstance.run()!.stop();
        await s.fixture.componentInstance.run()!.done;
      });

      it('finished: the report line with the cycles, the duration, the average rate, the start and the finish, and how many the filter left', async () => {
        const answer = new Subject<BatchOperationResult>();
        queueService.peekDeadLetterMessages = vi.fn()
          .mockReturnValueOnce(of([...old(1, 2), { ...old(3, 1)[0], deadLetterReason: 'TTLExpiredException' } as MessageInfo]))
          .mockReturnValue(of([]));
        queueService.resubmitDeadLetterMessages.mockReturnValueOnce(answer);
        const s = screen(POSITIONAL);
        const T = Date.parse('2026-11-12T09:02:10Z');
        let clock = T;
        TestBed.inject(ResubmitRunService).now = () => clock;
        await filtered(s, { reason: 'MaxDeliveryCountExceeded' });
        await s.fixture.componentInstance.start();
        await s.update();
        clock = T + 2_000;
        answer.next(ok(2));
        answer.complete();
        await s.fixture.componentInstance.run()!.done;
        s.fixture.detectChanges();

        expect(text(s.el.querySelector('.report-line'))).toBe(`1 cycle in 2 s, 1.5 messages per second on average. Started ${formatDate(T, 'medium', 'en-US')}, finished ${formatDate(T + 2_000, 'mediumTime', 'en-US')}.`.replace(/\s+/g, ' '));
        expect(Array.from(s.el.querySelectorAll('.stat')).map(joined), 'the report says how many the filter left in dead-letter').toStrictEqual(['Read 3', 'Matched so far 2', 'Left by the filter 1', 'Resubmitted 2', 'Failed, not sent 0', 'Possible duplicate 0']);
        expect(formatDuration(14_000_000, true), 'the report duration keeps its seconds').toBe('3 h 53 min 20 s');
      });

      it('the head-of-queue loop: Elapsed and Rate once a batch was done, and after a stop on a failure "View dead-letter messages" opens the messages on the dead-letter tab', async () => {
        const open = vi.fn();
        queueService.peekDeadLetterMessages = vi.fn().mockReturnValueOnce(of(head(1, 3)));
        queueService.resubmitDeadLetterMessages.mockReturnValue(of({ success: false, successCount: 2, failureCount: 1, failures: [disabledReason] }));
        capabilities = null;
        configure();
        TestBed.overrideProvider(MatDialog, { useValue: { open } });
        const fixture = TestBed.createComponent(ContinuousResubmitDialogComponent);
        const dialog = fixture.componentInstance;
        dialog.now = vi.fn().mockReturnValueOnce(0).mockReturnValue(2_000);
        dialog.batchSize = 3;
        await dialog.start();
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;

        expect(joined(el.querySelector('.loop-timing')!)).toBe('Elapsed 2 s Rate 1.5 messages per second');
        const view = el.querySelector<HTMLButtonElement>('.next button')!;
        expect(text(view)).toBe('View dead-letter messages');
        await dialog.viewDeadLetter();

        expect(open, 'the messages dialog opens on the dead-letter tab of this queue, the way the entity panel opens it').toHaveBeenCalledWith(ViewMessagesDialogComponent, expect.objectContaining({
          data: { entityType: 'queue', entityName: 'orders', topicName: undefined, deadLetterMessageCount: 3, initialTab: 1 }
        }));
      });
    });
  });
});
