import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { QueueService } from './queue.service';
import { ApiService } from './api.service';
import { BatchOperationResult } from '../models';

describe('QueueService', () => {
  let service: QueueService;
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
        QueueService,
        { provide: ApiService, useValue: apiServiceMock }
      ]
    });
    service = TestBed.inject(QueueService);
  });

  describe('deleteMessages', () => {
    it('forwards the selected sequence numbers with all=false by default', () => {
      service.deleteMessages('orders', [1, 2, 3], true).subscribe();

      expect(apiPost).toHaveBeenCalledWith(
        'queues/orders/deadletter/delete-batch',
        { sequenceNumbers: [1, 2, 3], all: false }
      );
    });

    it('carries all=true and an empty sequence list when draining the whole tab', () => {
      service.deleteMessages('orders', [], true, true).subscribe();

      expect(apiPost).toHaveBeenCalledWith(
        'queues/orders/deadletter/delete-batch',
        { sequenceNumbers: [], all: true }
      );
    });

    it('targets the active path when isDeadLetter is false', () => {
      service.deleteMessages('orders', [7], false, false).subscribe();

      expect(apiPost).toHaveBeenCalledWith(
        'queues/orders/messages/delete-batch',
        { sequenceNumbers: [7], all: false }
      );
    });
  });

  describe('names in the URL', () => {
    it('purging a queue named orders#1 purges that queue and never deletes the queue orders', () => {
      service.purgeMessages('orders#1').subscribe();

      expect(apiDelete.mock.calls).toEqual([['queues/orders%231/messages']]);
    });

    it('deleting a queue named a/messages deletes that queue and never purges the queue a', () => {
      service.deleteQueue('a/messages').subscribe();

      expect(apiDelete.mock.calls).toEqual([['queues/a%2Fmessages']]);
    });

    it.each([
      ['a/messages', 'a%2Fmessages'],
      ['a/deadletter', 'a%2Fdeadletter'],
      ['orders#1', 'orders%231'],
      ['what?now', 'what%3Fnow'],
      ['50%off', '50%25off'],
      ['my queue', 'my%20queue'],
      ['a.b-c_d', 'a.b-c_d']
    ])('sends the queue name %s as the single segment %s on every operation', (name, segment) => {
      service.getQueue(name).subscribe();
      service.peekMessages(name, 5).subscribe();
      service.peekDeadLetterMessages(name, 5).subscribe();
      service.purgeMessages(name, 'all').subscribe();
      service.purgeDeadLetterMessages(name).subscribe();
      service.deleteMessages(name, [1], false).subscribe();
      service.resubmitDeadLetterMessages(name, [2]).subscribe();
      service.resubmitDeadLetterMessage(name, 3).subscribe();
      service.moveMessages(name, 'target', [4], true).subscribe();
      service.receiveMessages(name, 6).subscribe();
      service.sendMessage(name, { body: 'b' } as never).subscribe();
      service.sendMessages(name, []).subscribe();

      expect(apiGet.mock.calls.map(c => c[0])).toEqual([
        `queues/${segment}`,
        `queues/${segment}/messages?count=5`,
        `queues/${segment}/deadletter?count=5`
      ]);
      expect(apiDelete.mock.calls.map(c => c[0])).toEqual([
        `queues/${segment}/messages`,
        `queues/${segment}/deadletter`,
        `queues/${segment}/deadletter`
      ]);
      expect(apiPost.mock.calls.map(c => c[0])).toEqual([
        `queues/${segment}/messages/delete-batch`,
        `queues/${segment}/deadletter/resubmit-batch`,
        `queues/${segment}/deadletter/3/resubmit`,
        `queues/${segment}/deadletter/move-batch`,
        `queues/${segment}/messages/receive?count=6`,
        `queues/${segment}/messages`,
        `queues/${segment}/messages/batch`
      ]);
    });
  });
});
