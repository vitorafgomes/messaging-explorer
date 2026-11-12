import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TopicService } from './topic.service';
import { ApiService } from './api.service';
import { BatchOperationResult } from '../models';

describe('TopicService', () => {
  let service: TopicService;
  let apiPost: ReturnType<typeof vi.fn>;
  let apiGet: ReturnType<typeof vi.fn>;
  let apiDelete: ReturnType<typeof vi.fn>;

  const emptyResult: BatchOperationResult = {
    successCount: 0,
    failureCount: 0,
    failures: [],
    success: true
  };

  beforeEach(() => {
    apiPost = vi.fn().mockReturnValue(of(emptyResult));
    apiGet = vi.fn().mockReturnValue(of([]));
    apiDelete = vi.fn().mockReturnValue(of({ success: true }));
    const apiServiceMock = { post: apiPost, get: apiGet, delete: apiDelete } as unknown as ApiService;

    TestBed.configureTestingModule({
      providers: [
        TopicService,
        { provide: ApiService, useValue: apiServiceMock }
      ]
    });
    service = TestBed.inject(TopicService);
  });

  describe('deleteMessages', () => {
    it('forwards the selected sequence numbers with all=false by default', () => {
      service.deleteMessages('sales', 'sub1', [1, 2, 3], true).subscribe();

      expect(apiPost).toHaveBeenCalledWith(
        'topics/sales/subscriptions/sub1/deadletter/delete-batch',
        { sequenceNumbers: [1, 2, 3], all: false }
      );
    });

    it('carries all=true and an empty sequence list when draining the whole tab', () => {
      service.deleteMessages('sales', 'sub1', [], true, true).subscribe();

      expect(apiPost).toHaveBeenCalledWith(
        'topics/sales/subscriptions/sub1/deadletter/delete-batch',
        { sequenceNumbers: [], all: true }
      );
    });
  });

  describe('names in the URL', () => {
    it('sends the topic t/1 and the subscription s/2 as one segment each on every operation', () => {
      service.getTopic('t/1').subscribe();
      service.getSubscriptions('t/1').subscribe();
      service.getSubscription('t/1', 's/2').subscribe();
      service.peekMessages('t/1', 's/2', 5).subscribe();
      service.peekDeadLetterMessages('t/1', 's/2', 5).subscribe();
      service.deleteTopic('t/1').subscribe();
      service.deleteSubscription('t/1', 's/2').subscribe();
      service.purgeMessages('t/1', 's/2', 'all').subscribe();
      service.purgeDeadLetterMessages('t/1', 's/2').subscribe();
      service.sendMessage('t/1', { body: 'b' } as never).subscribe();
      service.sendMessages('t/1', []).subscribe();
      service.createSubscription('t/1', 's/2').subscribe();
      service.receiveMessages('t/1', 's/2', 6).subscribe();
      service.resubmitDeadLetterMessage('t/1', 's/2', 3).subscribe();
      service.resubmitDeadLetterMessages('t/1', 's/2', [2]).subscribe();
      service.deleteMessages('t/1', 's/2', [1], false).subscribe();

      expect(apiGet.mock.calls.map(c => c[0])).toEqual([
        'topics/t%2F1',
        'topics/t%2F1/subscriptions',
        'topics/t%2F1/subscriptions/s%2F2',
        'topics/t%2F1/subscriptions/s%2F2/messages?count=5',
        'topics/t%2F1/subscriptions/s%2F2/deadletter?count=5'
      ]);
      expect(apiDelete.mock.calls.map(c => c[0])).toEqual([
        'topics/t%2F1',
        'topics/t%2F1/subscriptions/s%2F2',
        'topics/t%2F1/subscriptions/s%2F2/messages',
        'topics/t%2F1/subscriptions/s%2F2/deadletter',
        'topics/t%2F1/subscriptions/s%2F2/deadletter'
      ]);
      expect(apiPost.mock.calls.map(c => c[0])).toEqual([
        'topics/t%2F1/messages',
        'topics/t%2F1/messages/batch',
        'topics/t%2F1/subscriptions',
        'topics/t%2F1/subscriptions/s%2F2/messages/receive?count=6',
        'topics/t%2F1/subscriptions/s%2F2/deadletter/3/resubmit',
        'topics/t%2F1/subscriptions/s%2F2/deadletter/resubmit-batch',
        'topics/t%2F1/subscriptions/s%2F2/messages/delete-batch'
      ]);
    });

    it('sends #, ?, % and a space inside a topic or subscription name as part of that one segment', () => {
      service.purgeMessages('orders#1', 'what?now').subscribe();
      service.deleteSubscription('50%off', 'my sub').subscribe();

      expect(apiDelete.mock.calls.map(c => c[0])).toEqual([
        'topics/orders%231/subscriptions/what%3Fnow/messages',
        'topics/50%25off/subscriptions/my%20sub'
      ]);
    });
  });
});
