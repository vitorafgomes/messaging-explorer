import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MetricsService } from './metrics.service';
import { ApiService } from './api.service';
import { MetricsData, MetricsTimeRange } from '../models';

describe('MetricsService', () => {
  let service: MetricsService;
  let httpMock: HttpTestingController;
  let apiService: ApiService;

  // Helper function to create mock metrics data
  const createMockMetricsData = (): MetricsData => ({
    series: [
      {
        name: 'Incoming Messages',
        data: [
          { timestamp: new Date('2024-01-01T10:00:00Z'), value: 10 },
          { timestamp: new Date('2024-01-01T10:01:00Z'), value: 15 }
        ]
      },
      {
        name: 'Outgoing Messages',
        data: [
          { timestamp: new Date('2024-01-01T10:00:00Z'), value: 8 },
          { timestamp: new Date('2024-01-01T10:01:00Z'), value: 12 }
        ]
      }
    ],
    startTime: new Date('2024-01-01T10:00:00Z'),
    endTime: new Date('2024-01-01T11:00:00Z')
  });

  // Helper function to create API response with ISO date strings
  const createApiResponse = (): any => ({
    series: [
      {
        name: 'Incoming Messages',
        data: [
          { timestamp: '2024-01-01T10:00:00Z', value: 10 },
          { timestamp: '2024-01-01T10:01:00Z', value: 15 }
        ]
      },
      {
        name: 'Outgoing Messages',
        data: [
          { timestamp: '2024-01-01T10:00:00Z', value: 8 },
          { timestamp: '2024-01-01T10:01:00Z', value: 12 }
        ]
      }
    ],
    startTime: '2024-01-01T10:00:00Z',
    endTime: '2024-01-01T11:00:00Z'
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [MetricsService, ApiService]
    });
    service = TestBed.inject(MetricsService);
    apiService = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getQueueMetrics', () => {
    it('should call API with correct endpoint for queue metrics', () => {
      const queueName = 'test-queue';
      const expectedResponse = createApiResponse();
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`) &&
        request.url.includes('timeRange=0')
      );
      expect(req.request.method).toBe('GET');
      req.flush(expectedResponse);

      expect(result).toBeTruthy();
      expect(result!.series.length).toBe(2);
      expect(result!.series[0].name).toBe('Incoming Messages');
    });

    it('should use default time range of OneHour', () => {
      const queueName = 'test-queue';
      let called = false;

      service.getQueueMetrics(queueName).subscribe(() => {
        called = true;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes('timeRange=0')
      );
      req.flush(createApiResponse());
      expect(called).toBe(true);
    });

    it('should accept custom time range', () => {
      const queueName = 'test-queue';
      let called = false;

      service.getQueueMetrics(queueName, MetricsTimeRange.TwentyFourHours).subscribe(() => {
        called = true;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes('timeRange=3')
      );
      req.flush(createApiResponse());
      expect(called).toBe(true);
    });

    it('should convert date strings to Date objects', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush(createApiResponse());

      expect(result!.startTime instanceof Date).toBe(true);
      expect(result!.endTime instanceof Date).toBe(true);
      expect(result!.series[0].data[0].timestamp instanceof Date).toBe(true);
    });

    it('should handle 503 error with configurationRequired flag', () => {
      const queueName = 'test-queue';
      const errorResponse = {
        configurationRequired: true,
        message: 'Azure Monitor is not configured'
      };
      let caughtError: any;

      service.getQueueMetrics(queueName).subscribe({
        next: () => { throw new Error('Should have errored'); },
        error: (error) => {
          caughtError = error;
        }
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush(errorResponse, { status: 503, statusText: 'Service Unavailable' });

      expect(caughtError.type).toBe('NOT_CONFIGURED');
      expect(caughtError.message).toBe('Azure Monitor is not configured');
    });

    it('should fall back to mock data for other errors', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush('Server error', { status: 500, statusText: 'Internal Server Error' });

      expect(result).toBeTruthy();
      expect(result!.series.length).toBeGreaterThan(0);
      expect(result!.series[0].name).toBe('Incoming Messages');
    });

    it('should fall back to mock data for network errors', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.error(new ProgressEvent('error'));

      expect(result).toBeTruthy();
      expect(result!.series.length).toBeGreaterThan(0);
    });
  });

  describe('getTopicMetrics', () => {
    it('should call API with correct endpoint for topic metrics', () => {
      const topicName = 'test-topic';
      let result: MetricsData | undefined;

      service.getTopicMetrics(topicName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/topics/${topicName}`) &&
        request.url.includes('timeRange=0')
      );
      expect(req.request.method).toBe('GET');
      req.flush(createApiResponse());

      expect(result).toBeTruthy();
    });

    it('should accept custom time range', () => {
      const topicName = 'test-topic';
      let called = false;

      service.getTopicMetrics(topicName, MetricsTimeRange.SixHours).subscribe(() => {
        called = true;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes('timeRange=1')
      );
      req.flush(createApiResponse());
      expect(called).toBe(true);
    });

    it('should convert date strings to Date objects', () => {
      const topicName = 'test-topic';
      let result: MetricsData | undefined;

      service.getTopicMetrics(topicName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/topics/${topicName}`)
      );
      req.flush(createApiResponse());

      expect(result!.startTime instanceof Date).toBe(true);
      expect(result!.endTime instanceof Date).toBe(true);
    });
  });

  describe('getSubscriptionMetrics', () => {
    it('should call API with correct endpoint for subscription metrics', () => {
      const topicName = 'test-topic';
      const subscriptionName = 'test-subscription';
      let result: MetricsData | undefined;

      service.getSubscriptionMetrics(topicName, subscriptionName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/topics/${topicName}/subscriptions/${subscriptionName}`) &&
        request.url.includes('timeRange=0')
      );
      expect(req.request.method).toBe('GET');
      req.flush(createApiResponse());

      expect(result).toBeTruthy();
    });

    it('should accept custom time range', () => {
      const topicName = 'test-topic';
      const subscriptionName = 'test-subscription';
      let called = false;

      service.getSubscriptionMetrics(topicName, subscriptionName, MetricsTimeRange.TwelveHours).subscribe(() => {
        called = true;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes('timeRange=2')
      );
      req.flush(createApiResponse());
      expect(called).toBe(true);
    });
  });

  // TODO: These refresh tests need proper timer management for zoneless Angular 21
  describe.skip('getQueueMetricsWithRefresh', () => {
    it('should emit metrics immediately on subscription', () => {
      vi.useFakeTimers();
      const queueName = 'test-queue';
      let emitCount = 0;

      service.getQueueMetricsWithRefresh(queueName, MetricsTimeRange.OneHour, 60).subscribe(() => {
        emitCount++;
      });

      vi.advanceTimersByTime(100);

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush(createApiResponse());

      vi.advanceTimersByTime(100);

      expect(emitCount).toBe(1);
      vi.useRealTimers();
    });

    it('should refresh metrics at specified interval', () => {
      vi.useFakeTimers();
      const queueName = 'test-queue';
      const refreshIntervalSeconds = 2;
      let emitCount = 0;

      service.getQueueMetricsWithRefresh(queueName, MetricsTimeRange.OneHour, refreshIntervalSeconds).subscribe(() => {
        emitCount++;
      });

      // Initial emit
      vi.advanceTimersByTime(100);
      const req1 = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req1.flush(createApiResponse());
      vi.advanceTimersByTime(100);
      expect(emitCount).toBe(1);

      // First refresh after 2 seconds
      vi.advanceTimersByTime(2000);
      const req2 = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req2.flush(createApiResponse());
      vi.advanceTimersByTime(100);
      expect(emitCount).toBe(2);

      // Second refresh after another 2 seconds
      vi.advanceTimersByTime(2000);
      const req3 = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req3.flush(createApiResponse());
      vi.advanceTimersByTime(100);
      expect(emitCount).toBe(3);
      vi.useRealTimers();
    });

    it('should not emit when document is hidden', () => {
      vi.useFakeTimers();
      const queueName = 'test-queue';
      let emitCount = 0;

      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => true
      });

      service.getQueueMetricsWithRefresh(queueName, MetricsTimeRange.OneHour, 1).subscribe(() => {
        emitCount++;
      });

      vi.advanceTimersByTime(2000);

      expect(emitCount).toBe(0);

      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => false
      });
      vi.useRealTimers();
    });

    it('should resume refresh when document becomes visible', () => {
      vi.useFakeTimers();
      const queueName = 'test-queue';
      let emitCount = 0;
      let hiddenState = false;

      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => hiddenState
      });

      service.getQueueMetricsWithRefresh(queueName, MetricsTimeRange.OneHour, 1).subscribe(() => {
        emitCount++;
      });

      vi.advanceTimersByTime(100);
      const req1 = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req1.flush(createApiResponse());
      vi.advanceTimersByTime(100);
      expect(emitCount).toBe(1);

      hiddenState = true;
      vi.advanceTimersByTime(2000);
      expect(emitCount).toBe(1);

      hiddenState = false;
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(100);

      const req2 = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req2.flush(createApiResponse());
      vi.advanceTimersByTime(100);

      expect(emitCount).toBeGreaterThan(1);
      vi.useRealTimers();
    });
  });

  describe.skip('getTopicMetricsWithRefresh', () => {
    it('should emit metrics immediately on subscription', () => {
      vi.useFakeTimers();
      const topicName = 'test-topic';
      let emitCount = 0;

      service.getTopicMetricsWithRefresh(topicName, MetricsTimeRange.OneHour, 60).subscribe(() => {
        emitCount++;
      });

      vi.advanceTimersByTime(100);

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/topics/${topicName}`)
      );
      req.flush(createApiResponse());

      vi.advanceTimersByTime(100);

      expect(emitCount).toBe(1);
      vi.useRealTimers();
    });

    it('should use custom refresh interval', () => {
      vi.useFakeTimers();
      const topicName = 'test-topic';
      const refreshIntervalSeconds = 3;
      let emitCount = 0;

      service.getTopicMetricsWithRefresh(topicName, MetricsTimeRange.SixHours, refreshIntervalSeconds).subscribe(() => {
        emitCount++;
      });

      vi.advanceTimersByTime(100);
      const req1 = httpMock.expectOne((request) =>
        request.url.includes(`metrics/topics/${topicName}`)
      );
      req1.flush(createApiResponse());
      vi.advanceTimersByTime(100);

      vi.advanceTimersByTime(3000);
      const req2 = httpMock.expectOne((request) =>
        request.url.includes(`metrics/topics/${topicName}`)
      );
      req2.flush(createApiResponse());
      vi.advanceTimersByTime(100);

      expect(emitCount).toBe(2);
      vi.useRealTimers();
    });
  });

  describe.skip('getSubscriptionMetricsWithRefresh', () => {
    it('should emit metrics immediately on subscription', () => {
      vi.useFakeTimers();
      const topicName = 'test-topic';
      const subscriptionName = 'test-subscription';
      let emitCount = 0;

      service.getSubscriptionMetricsWithRefresh(topicName, subscriptionName, MetricsTimeRange.OneHour, 60).subscribe(() => {
        emitCount++;
      });

      vi.advanceTimersByTime(100);

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/topics/${topicName}/subscriptions/${subscriptionName}`)
      );
      req.flush(createApiResponse());

      vi.advanceTimersByTime(100);

      expect(emitCount).toBe(1);
      vi.useRealTimers();
    });

    it('should refresh at specified interval', () => {
      vi.useFakeTimers();
      const topicName = 'test-topic';
      const subscriptionName = 'test-subscription';
      let emitCount = 0;

      service.getSubscriptionMetricsWithRefresh(topicName, subscriptionName, MetricsTimeRange.OneHour, 1).subscribe(() => {
        emitCount++;
      });

      vi.advanceTimersByTime(100);
      const req1 = httpMock.expectOne((request) =>
        request.url.includes(`metrics/topics/${topicName}/subscriptions/${subscriptionName}`)
      );
      req1.flush(createApiResponse());
      vi.advanceTimersByTime(100);

      vi.advanceTimersByTime(1000);
      const req2 = httpMock.expectOne((request) =>
        request.url.includes(`metrics/topics/${topicName}/subscriptions/${subscriptionName}`)
      );
      req2.flush(createApiResponse());
      vi.advanceTimersByTime(100);

      expect(emitCount).toBe(2);
      vi.useRealTimers();
    });
  });

  describe('error handling', () => {
    it('should handle 503 with configurationRequired as NOT_CONFIGURED error', () => {
      const queueName = 'test-queue';
      const errorResponse = {
        configurationRequired: true,
        message: 'Azure Monitor credentials not configured',
        error: 'Missing configuration'
      };
      let caughtError: any;

      service.getQueueMetrics(queueName).subscribe({
        next: () => { throw new Error('Should have errored'); },
        error: (error) => {
          caughtError = error;
        }
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush(errorResponse, { status: 503, statusText: 'Service Unavailable' });

      expect(caughtError.type).toBe('NOT_CONFIGURED');
      expect(caughtError.message).toBe('Azure Monitor credentials not configured');
      expect(caughtError.details).toBe('Missing configuration');
    });

    it('should fall back to mock data for 503 without configurationRequired', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush('Service unavailable', { status: 503, statusText: 'Service Unavailable' });

      expect(result).toBeTruthy();
      expect(result!.series.length).toBeGreaterThan(0);
    });

    it('should fall back to mock data for 404 error', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush('Not found', { status: 404, statusText: 'Not Found' });

      expect(result).toBeTruthy();
      expect(result!.series.length).toBeGreaterThan(0);
    });

    it('should fall back to mock data for timeout', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.error(new ProgressEvent('timeout'));

      expect(result).toBeTruthy();
      expect(result!.series.length).toBeGreaterThan(0);
    });
  });

  describe('mock data generation', () => {
    it('should generate mock data with correct structure', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush('Error', { status: 500, statusText: 'Internal Server Error' });

      expect(result!.series.length).toBe(6);
      expect(result!.series[0].name).toBe('Incoming Messages');
      expect(result!.series[1].name).toBe('Outgoing Messages');
      expect(result!.series[2].name).toBe('Active Messages');
      expect(result!.series[3].name).toBe('Successful Requests');
      expect(result!.series[4].name).toBe('Server Errors');
      expect(result!.series[5].name).toBe('User Errors');
      expect(result!.startTime instanceof Date).toBe(true);
      expect(result!.endTime instanceof Date).toBe(true);
    });

    it('should generate mock data with correct number of points for OneHour', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName, MetricsTimeRange.OneHour).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush('Error', { status: 500, statusText: 'Internal Server Error' });

      expect(result!.series[0].data.length).toBe(60); // 1 minute intervals
    });

    it('should generate mock data with correct number of points for SixHours', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName, MetricsTimeRange.SixHours).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush('Error', { status: 500, statusText: 'Internal Server Error' });

      expect(result!.series[0].data.length).toBe(72); // 5 minute intervals
    });

    it('should generate mock data with correct number of points for TwelveHours', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName, MetricsTimeRange.TwelveHours).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush('Error', { status: 500, statusText: 'Internal Server Error' });

      expect(result!.series[0].data.length).toBe(72); // 10 minute intervals
    });

    it('should generate mock data with correct number of points for TwentyFourHours', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName, MetricsTimeRange.TwentyFourHours).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush('Error', { status: 500, statusText: 'Internal Server Error' });

      expect(result!.series[0].data.length).toBe(96); // 15 minute intervals
    });

    it('should generate mock data with correct number of points for SevenDays', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName, MetricsTimeRange.SevenDays).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush('Error', { status: 500, statusText: 'Internal Server Error' });

      expect(result!.series[0].data.length).toBe(168); // 1 hour intervals
    });

    it('should generate mock data points with timestamps and values', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush('Error', { status: 500, statusText: 'Internal Server Error' });

      const dataPoint = result!.series[0].data[0];
      expect(dataPoint.timestamp instanceof Date).toBe(true);
      expect(typeof dataPoint.value).toBe('number');
      expect(dataPoint.value).toBeGreaterThanOrEqual(0);
    });
  });

  describe('time range parameter handling', () => {
    it('should handle OneHour time range correctly', () => {
      const queueName = 'test-queue';

      service.getQueueMetrics(queueName, MetricsTimeRange.OneHour).subscribe();

      const req = httpMock.expectOne((request) =>
        request.url.includes('timeRange=0')
      );
      req.flush(createApiResponse());
    });

    it('should handle SixHours time range correctly', () => {
      const queueName = 'test-queue';

      service.getQueueMetrics(queueName, MetricsTimeRange.SixHours).subscribe();

      const req = httpMock.expectOne((request) =>
        request.url.includes('timeRange=1')
      );
      req.flush(createApiResponse());
    });

    it('should handle TwelveHours time range correctly', () => {
      const queueName = 'test-queue';

      service.getQueueMetrics(queueName, MetricsTimeRange.TwelveHours).subscribe();

      const req = httpMock.expectOne((request) =>
        request.url.includes('timeRange=2')
      );
      req.flush(createApiResponse());
    });

    it('should handle TwentyFourHours time range correctly', () => {
      const queueName = 'test-queue';

      service.getQueueMetrics(queueName, MetricsTimeRange.TwentyFourHours).subscribe();

      const req = httpMock.expectOne((request) =>
        request.url.includes('timeRange=3')
      );
      req.flush(createApiResponse());
    });

    it('should handle SevenDays time range correctly', () => {
      const queueName = 'test-queue';

      service.getQueueMetrics(queueName, MetricsTimeRange.SevenDays).subscribe();

      const req = httpMock.expectOne((request) =>
        request.url.includes('timeRange=4')
      );
      req.flush(createApiResponse());
    });
  });

  describe('date conversion', () => {
    it('should convert all date strings in response to Date objects', () => {
      const queueName = 'test-queue';
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush(createApiResponse());

      expect(result!.startTime instanceof Date).toBe(true);
      expect(result!.endTime instanceof Date).toBe(true);
      result!.series.forEach(series => {
        series.data.forEach(point => {
          expect(point.timestamp instanceof Date).toBe(true);
        });
      });
    });

    it('should preserve metric values during conversion', () => {
      const queueName = 'test-queue';
      const apiResponse = createApiResponse();
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush(apiResponse);

      expect(result!.series[0].data[0].value).toBe(apiResponse.series[0].data[0].value);
      expect(result!.series[0].data[1].value).toBe(apiResponse.series[0].data[1].value);
    });

    it('should preserve series names during conversion', () => {
      const queueName = 'test-queue';
      const apiResponse = createApiResponse();
      let result: MetricsData | undefined;

      service.getQueueMetrics(queueName).subscribe(data => {
        result = data;
      });

      const req = httpMock.expectOne((request) =>
        request.url.includes(`metrics/queues/${queueName}`)
      );
      req.flush(apiResponse);

      expect(result!.series[0].name).toBe(apiResponse.series[0].name);
      expect(result!.series[1].name).toBe(apiResponse.series[1].name);
    });
  });
});
