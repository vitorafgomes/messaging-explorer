import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TopicService } from './topic.service';
import { ApiService } from './api.service';
import { BatchOperationResult } from '../models';

describe('TopicService', () => {
  let service: TopicService;
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
});
