import { TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { ConnectionService, QueueService } from '../../core/services';
import { QueueInfo } from '../../core/models';
import { QueuesComponent } from './queues.component';

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
