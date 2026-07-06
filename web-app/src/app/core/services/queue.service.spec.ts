import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { QueueService } from './queue.service';
import { ApiService } from './api.service';
import { BatchOperationResult } from '../models';

describe('QueueService', () => {
  let service: QueueService;
  let apiPost: ReturnType<typeof vi.fn>;

  const emptyResult: BatchOperationResult = {
    successCount: 0,
    failureCount: 0,
    failures: [],
    success: true
  };

  beforeEach(() => {
    apiPost = vi.fn().mockReturnValue(of(emptyResult));
    const apiServiceMock = { post: apiPost } as unknown as ApiService;

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
});
