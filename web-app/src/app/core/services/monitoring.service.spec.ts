import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { MonitoringService } from './monitoring.service';

describe('MonitoringService: the counts of one entity, read now', () => {
  let service: MonitoringService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(MonitoringService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('names the queue, or the topic and the subscription, as query values encoded once', () => {
    service.getQueueCounts('a/b#c').subscribe();
    service.getSubscriptionCounts('t/1', '50%off&x').subscribe();

    const urls = httpMock.match(() => true).map(req => {
      req.flush({});
      return req.request.url.replace(/&_t=\d+$/, '');
    });

    expect(urls).toEqual([
      'http://localhost:5917/api/monitoring/counts?queue=a%2Fb%23c',
      'http://localhost:5917/api/monitoring/counts?topic=t%2F1&subscription=50%25off%26x'
    ]);
  });
});
