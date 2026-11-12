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
  let apiPatch: ReturnType<typeof vi.fn>;

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
    apiPatch = vi.fn().mockReturnValue(of({}));
    const apiServiceMock = { post: apiPost, get: apiGet, delete: apiDelete, patch: apiPatch } as unknown as ApiService;

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

  describe('the transfer dead-letter queue of a queue is reached through its own routes', () => {
    it('peek, delete and resubmit go to api/queues/{name}/transferdeadletter with the dead-letter bodies, the name as one segment', () => {
      service.peekTransferDeadLetterMessages('a/b', 5).subscribe();
      service.deleteTransferDeadLetterMessages('a/b', [1, 2]).subscribe();
      service.resubmitTransferDeadLetterMessages('a/b', [3]).subscribe();

      expect(apiGet.mock.calls).toEqual([['queues/a%2Fb/transferdeadletter?count=5']]);
      expect(apiPost.mock.calls).toEqual([
        ['queues/a%2Fb/transferdeadletter/delete-batch', { sequenceNumbers: [1, 2], all: false }],
        ['queues/a%2Fb/transferdeadletter/resubmit-batch', { sequenceNumbers: [3] }]
      ]);
    });

    it('a transfer dead-letter delete never asks the server to drain the whole queue', () => {
      service.deleteTransferDeadLetterMessages('orders', [7]).subscribe();

      expect(apiPost.mock.calls[0][1]).toStrictEqual({ sequenceNumbers: [7], all: false });
    });
  });

  describe('cancel scheduled messages', () => {
    it('posts exactly the given sequence numbers to api/queues/{name}/messages/cancel-scheduled', () => {
      service.cancelScheduledMessages('billing/invoices', [12, 13]).subscribe();

      expect(apiPost.mock.calls).toEqual([['queues/billing%2Finvoices/messages/cancel-scheduled', { sequenceNumbers: [12, 13] }]]);
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

  describe('create and update a queue', () => {
    it('create with nothing set posts the name only, so the broker applies its defaults', () => {
      service.createQueue('orders').subscribe();

      expect(apiPost.mock.calls).toHaveLength(1);
      expect(apiPost.mock.calls[0][0]).toBe('queues');
      expect(apiPost.mock.calls[0][1]).toStrictEqual({ name: 'orders' });
    });

    it('create with options posts the name and exactly the options given to POST api/queues', () => {
      service.createQueue('orders', { lockDuration: '00:00:30', enableBatchedOperations: false }).subscribe();

      expect(apiPost.mock.calls[0][0]).toBe('queues');
      expect(apiPost.mock.calls[0][1]).toStrictEqual({ name: 'orders', options: { lockDuration: '00:00:30', enableBatchedOperations: false } });
    });

    it('update sends a PATCH to api/queues/{name}, name encoded as one segment, with the changes as the body', () => {
      service.updateQueue('a/b', { maxDeliveryCount: 10, forwardTo: '' }).subscribe();

      expect(apiPatch.mock.calls).toHaveLength(1);
      expect(apiPatch.mock.calls[0][0]).toBe('queues/a%2Fb');
      expect(apiPatch.mock.calls[0][1]).toStrictEqual({ maxDeliveryCount: 10, forwardTo: '' });
    });
  });
});
