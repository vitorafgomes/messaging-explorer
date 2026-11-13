import { TestBed } from '@angular/core/testing';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ConnectionService, LoggerService, TopicService } from '../../core/services';
import { TopicInfo } from '../../core/models';
import { TopicsComponent } from './topics.component';

const topic = (name: string, subscriptionCount: number) =>
  ({ name, subscriptionCount, sizeInBytes: 0, subscriptions: [] }) as unknown as TopicInfo;

describe('TopicsComponent loads the subscriptions of a topic when it is opened, not one request per topic', () => {
  let topicService: { getTopics: ReturnType<typeof vi.fn>; getSubscriptions: ReturnType<typeof vi.fn> };

  function render() {
    TestBed.configureTestingModule({
      imports: [TopicsComponent],
      providers: [
        { provide: TopicService, useValue: topicService },
        { provide: ConnectionService, useValue: { isConnected: true, connectionStatus$: NEVER } },
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: MatDialog, useValue: { open: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(TopicsComponent);
    const snackBarOpen = vi.spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open').mockReturnValue(undefined as never);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const open = async (name: string) => {
      const header = Array.from(element.querySelectorAll('.card-header')).find(h => h.textContent?.includes(name)) as HTMLElement;
      header.click();
      await fixture.whenStable();
      return element.textContent ?? '';
    };
    return { element, open, snackBarOpen, fixture };
  }

  beforeEach(() => {
    topicService = {
      getTopics: vi.fn().mockReturnValue(of([topic('orders', 2), topic('billing', 1), topic('audit', 0)])),
      getSubscriptions: vi.fn().mockReturnValue(of([{ name: 'invoice-sub', activeMessageCount: 0, deadLetterMessageCount: 0 }]))
    };
  });

  it('opening the page asks for the topic list once and for no subscription list', () => {
    const { element } = render();

    expect(topicService.getTopics).toHaveBeenCalledTimes(1);
    expect(topicService.getSubscriptions).not.toHaveBeenCalled();
    expect(element.textContent).toContain('billing');
  });

  it('opening a topic asks for its subscriptions once and shows them when they arrive; closing and opening it again asks for nothing more', async () => {
    const answer = new Subject<unknown[]>();
    topicService.getSubscriptions.mockReturnValueOnce(answer);
    const { element, open, fixture } = render();

    const whileLoading = await open('billing');
    answer.next([{ name: 'invoice-sub', activeMessageCount: 0, deadLetterMessageCount: 0 }]);
    answer.complete();
    await fixture.whenStable();
    const shown = element.textContent ?? '';
    await open('billing');
    await open('billing');

    expect(topicService.getSubscriptions.mock.calls).toStrictEqual([['billing']]);
    expect(whileLoading).toContain('Loading subscriptions...');
    expect(whileLoading).not.toContain('No subscriptions');
    expect(shown).toContain('invoice-sub');
  });

  it('a subscription list the API fails to return is reported and the topic closes, so opening it again retries', async () => {
    topicService.getSubscriptions.mockReturnValueOnce(throwError(() => new Error('503 Service Unavailable')));
    const { open, snackBarOpen } = render();

    const afterFailure = await open('billing');
    const afterRetry = await open('billing');

    expect(snackBarOpen).toHaveBeenCalledWith('Failed to load the subscriptions of billing', 'Close', { duration: 3000 });
    expect(afterFailure).not.toContain('No subscriptions');
    expect(topicService.getSubscriptions).toHaveBeenCalledTimes(2);
    expect(afterRetry).toContain('invoice-sub');
  });
});
