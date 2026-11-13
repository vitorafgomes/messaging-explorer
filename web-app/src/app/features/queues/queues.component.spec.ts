import { TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { ConnectionService, QueueService } from '../../core/services';
import { QueueInfo } from '../../core/models';
import { QueuesComponent } from './queues.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';

const queue = (name: string) =>
  ({ name, activeMessageCount: 3, deadLetterMessageCount: 1, scheduledMessageCount: 0, sizeInBytes: 2048 }) as QueueInfo;

describe('QueuesComponent', () => {
  let queueService: { getQueues: ReturnType<typeof vi.fn> };
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function render() {
    TestBed.configureTestingModule({
      imports: [QueuesComponent],
      providers: [
        { provide: QueueService, useValue: queueService },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(QueuesComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('a queue list the API fails to return is an error with Retry, never "No queues found"; Retry asks again and shows the queues', async () => {
    queueService = {
      getQueues: vi.fn()
        .mockReturnValueOnce(throwError(() => new Error('503 Service Unavailable')))
        .mockReturnValueOnce(of([queue('orders')]))
    };
    const { fixture, el } = render();

    const error = el.querySelector('[role="alert"]');
    expect(text(error?.querySelector('h3') ?? null)).toBe('Could not load the queues');
    expect(text(el)).not.toContain('No queues found');

    (Array.from(error!.querySelectorAll('button')).find(b => text(b) === 'Retry') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(queueService.getQueues).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(text(el.querySelector('td'))).toBe('orders');
  });

  it('an answer with no queue says so', () => {
    queueService = { getQueues: vi.fn().mockReturnValue(of([])) };
    const { el } = render();

    expect(text(el)).toContain('No queues found');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('QueuesComponent purges from the More actions menu', () => {
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('each purge is disabled at a count of 0, asks the same confirmation, purges nothing when cancelled and purges the queue when confirmed', async () => {
    const queueService = {
      getQueues: vi.fn().mockReturnValue(of([
        { ...queue('orders'), activeMessageCount: 3, deadLetterMessageCount: 0 },
        { ...queue('billing'), activeMessageCount: 0, deadLetterMessageCount: 2 }
      ])),
      purgeMessages: vi.fn().mockReturnValue(of(undefined)),
      purgeDeadLetterMessages: vi.fn().mockReturnValue(of(undefined))
    };
    const answers: boolean[] = [];
    TestBed.configureTestingModule({
      imports: [QueuesComponent],
      providers: [
        { provide: QueueService, useValue: queueService },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } }
      ]
    });
    const fixture = TestBed.createComponent(QueuesComponent);
    const open = vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open')
      .mockImplementation(() => ({ afterClosed: () => of(answers.shift()) }) as never);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const menu = async (name: string) => {
      const trigger = el.querySelector(`button[aria-label="More actions for ${name}"]`) as HTMLButtonElement;
      trigger.click();
      fixture.detectChanges();
      await fixture.whenStable();
      const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
      return Array.from(panel.querySelectorAll<HTMLButtonElement>('[mat-menu-item]'));
    };
    const close = async () => {
      document.querySelectorAll<HTMLElement>('.cdk-overlay-backdrop').forEach(backdrop => backdrop.click());
      await fixture.whenStable();
    };
    const pick = async (name: string, item: string, confirmed: boolean) => {
      answers.push(confirmed);
      (await menu(name)).find(b => text(b) === item)!.click();
      await fixture.whenStable();
    };

    expect((await menu('orders')).map(b => [text(b), b.disabled])).toStrictEqual([['Purge Messages', false], ['Purge Dead Letter', true]]);
    await close();
    expect((await menu('billing')).map(b => [text(b), b.disabled])).toStrictEqual([['Purge Messages', true], ['Purge Dead Letter', false]]);
    await close();

    await pick('orders', 'Purge Messages', false);
    expect(open).toHaveBeenLastCalledWith(ConfirmDialogComponent, { data: expect.objectContaining({
      title: 'Purge Messages',
      message: 'Are you sure you want to delete all 3 active messages from queue "orders"? This action cannot be undone.',
      confirmText: 'Purge'
    }) });
    expect(queueService.purgeMessages).not.toHaveBeenCalled();

    await pick('orders', 'Purge Messages', true);
    expect(queueService.purgeMessages.mock.calls).toStrictEqual([['orders']]);

    await pick('billing', 'Purge Dead Letter', false);
    expect(open).toHaveBeenLastCalledWith(ConfirmDialogComponent, { data: expect.objectContaining({
      title: 'Purge Dead Letter Queue',
      message: 'Are you sure you want to delete all 2 dead letter messages from queue "billing"? This action cannot be undone.',
      confirmText: 'Purge'
    }) });
    expect(queueService.purgeDeadLetterMessages).not.toHaveBeenCalled();

    await pick('billing', 'Purge Dead Letter', true);
    expect(queueService.purgeDeadLetterMessages.mock.calls).toStrictEqual([['billing']]);
  });
});
