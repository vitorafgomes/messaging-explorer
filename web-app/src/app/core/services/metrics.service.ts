import { Injectable, inject } from '@angular/core';
import { Observable, of, timer, fromEvent, merge, throwError } from 'rxjs';
import { catchError, map, switchMap, startWith, filter, shareReplay } from 'rxjs/operators';
import { ApiService } from './api.service';
import { MetricsData, MetricsTimeRange } from '../models';
import { HttpErrorResponse } from '@angular/common/http';

/**
 * Service for fetching Azure Monitor metrics for Service Bus entities.
 * This service fetches real-time metrics data from the backend API which queries Azure Monitor.
 * Includes graceful fallback to mock data when the API is unavailable.
 */
@Injectable({
  providedIn: 'root'
})
export class MetricsService {
  private api = inject(ApiService);

  /**
   * Gets Azure Monitor metrics for a specific queue.
   * @param queueName - The name of the queue
   * @param timeRange - The time range for the metrics query (default: OneHour)
   * @returns Observable with metrics data containing time series for the queue
   */
  getQueueMetrics(queueName: string, timeRange: MetricsTimeRange = MetricsTimeRange.OneHour): Observable<MetricsData> {
    return this.api.get<MetricsData>(`metrics/queues/${queueName}?timeRange=${timeRange}`).pipe(
      map(data => this.convertDates(data)),
      catchError(error => this.handleMetricsError(error, timeRange))
    );
  }

  /**
   * Gets Azure Monitor metrics for a specific topic.
   * @param topicName - The name of the topic
   * @param timeRange - The time range for the metrics query (default: OneHour)
   * @returns Observable with metrics data containing time series for the topic
   */
  getTopicMetrics(topicName: string, timeRange: MetricsTimeRange = MetricsTimeRange.OneHour): Observable<MetricsData> {
    return this.api.get<MetricsData>(`metrics/topics/${topicName}?timeRange=${timeRange}`).pipe(
      map(data => this.convertDates(data)),
      catchError(error => this.handleMetricsError(error, timeRange))
    );
  }

  /**
   * Gets Azure Monitor metrics for a specific subscription.
   * @param topicName - The name of the parent topic
   * @param subscriptionName - The name of the subscription
   * @param timeRange - The time range for the metrics query (default: OneHour)
   * @returns Observable with metrics data containing time series for the subscription
   */
  getSubscriptionMetrics(
    topicName: string,
    subscriptionName: string,
    timeRange: MetricsTimeRange = MetricsTimeRange.OneHour
  ): Observable<MetricsData> {
    return this.api.get<MetricsData>(
      `metrics/topics/${topicName}/subscriptions/${subscriptionName}?timeRange=${timeRange}`
    ).pipe(
      map(data => this.convertDates(data)),
      catchError(error => this.handleMetricsError(error, timeRange))
    );
  }

  /**
   * Gets queue metrics with automatic refresh at a configurable interval.
   * The observable emits metrics immediately and then at regular intervals.
   * Auto-refresh pauses when the browser tab is not visible to conserve resources.
   *
   * @param queueName - The name of the queue
   * @param timeRange - The time range for the metrics query (default: OneHour)
   * @param refreshIntervalSeconds - The refresh interval in seconds (default: 60)
   * @returns Observable that emits metrics data at regular intervals
   *
   * @example
   * ```typescript
   * // Subscribe to queue metrics that refresh every 30 seconds
   * this.metricsService.getQueueMetricsWithRefresh('myQueue', MetricsTimeRange.OneHour, 30)
   *   .pipe(takeUntil(this.destroy$))
   *   .subscribe(metrics => {
   *     // Update chart with new metrics
   *   });
   * ```
   */
  getQueueMetricsWithRefresh(
    queueName: string,
    timeRange: MetricsTimeRange = MetricsTimeRange.OneHour,
    refreshIntervalSeconds: number = 60
  ): Observable<MetricsData> {
    return this.createRefreshableMetrics(() => this.getQueueMetrics(queueName, timeRange), refreshIntervalSeconds);
  }

  /**
   * Gets topic metrics with automatic refresh at a configurable interval.
   * The observable emits metrics immediately and then at regular intervals.
   * Auto-refresh pauses when the browser tab is not visible to conserve resources.
   *
   * @param topicName - The name of the topic
   * @param timeRange - The time range for the metrics query (default: OneHour)
   * @param refreshIntervalSeconds - The refresh interval in seconds (default: 60)
   * @returns Observable that emits metrics data at regular intervals
   *
   * @example
   * ```typescript
   * // Subscribe to topic metrics that refresh every minute
   * this.metricsService.getTopicMetricsWithRefresh('myTopic', MetricsTimeRange.SixHours)
   *   .pipe(takeUntil(this.destroy$))
   *   .subscribe(metrics => {
   *     // Update chart with new metrics
   *   });
   * ```
   */
  getTopicMetricsWithRefresh(
    topicName: string,
    timeRange: MetricsTimeRange = MetricsTimeRange.OneHour,
    refreshIntervalSeconds: number = 60
  ): Observable<MetricsData> {
    return this.createRefreshableMetrics(() => this.getTopicMetrics(topicName, timeRange), refreshIntervalSeconds);
  }

  /**
   * Gets subscription metrics with automatic refresh at a configurable interval.
   * The observable emits metrics immediately and then at regular intervals.
   * Auto-refresh pauses when the browser tab is not visible to conserve resources.
   *
   * @param topicName - The name of the parent topic
   * @param subscriptionName - The name of the subscription
   * @param timeRange - The time range for the metrics query (default: OneHour)
   * @param refreshIntervalSeconds - The refresh interval in seconds (default: 60)
   * @returns Observable that emits metrics data at regular intervals
   *
   * @example
   * ```typescript
   * // Subscribe to subscription metrics that refresh every 2 minutes
   * this.metricsService.getSubscriptionMetricsWithRefresh('myTopic', 'mySub', MetricsTimeRange.OneHour, 120)
   *   .pipe(takeUntil(this.destroy$))
   *   .subscribe(metrics => {
   *     // Update chart with new metrics
   *   });
   * ```
   */
  getSubscriptionMetricsWithRefresh(
    topicName: string,
    subscriptionName: string,
    timeRange: MetricsTimeRange = MetricsTimeRange.OneHour,
    refreshIntervalSeconds: number = 60
  ): Observable<MetricsData> {
    return this.createRefreshableMetrics(
      () => this.getSubscriptionMetrics(topicName, subscriptionName, timeRange),
      refreshIntervalSeconds
    );
  }

  /**
   * Creates an observable that fetches metrics with automatic refresh.
   * The refresh pauses when the browser tab is not visible using the Page Visibility API.
   * This conserves resources and reduces unnecessary API calls when the user is not viewing the page.
   *
   * @param fetchMetrics - Function that returns an Observable of metrics data
   * @param refreshIntervalSeconds - The refresh interval in seconds
   * @returns Observable that emits metrics data immediately and at regular intervals when visible
   */
  private createRefreshableMetrics(
    fetchMetrics: () => Observable<MetricsData>,
    refreshIntervalSeconds: number
  ): Observable<MetricsData> {
    const refreshIntervalMs = refreshIntervalSeconds * 1000;

    // Create observables for visibility change events
    const visibilityChange$ = fromEvent(document, 'visibilitychange').pipe(
      startWith(null),
      map(() => !document.hidden)
    );

    // Emit when the page becomes visible
    const pageVisible$ = visibilityChange$.pipe(filter(visible => visible === true));

    return merge(
      // Emit immediately when page is visible
      of(true).pipe(filter(() => !document.hidden)),
      // Emit when page becomes visible after being hidden
      pageVisible$
    ).pipe(
      // Switch to a timer that emits immediately and at intervals
      switchMap(() =>
        timer(0, refreshIntervalMs).pipe(
          // Only emit when page is visible
          filter(() => !document.hidden),
          // Fetch the metrics
          switchMap(() => fetchMetrics())
        )
      ),
      // Share the subscription to avoid multiple API calls for multiple subscribers
      shareReplay(1)
    );
  }

  /**
   * Handles metrics API errors with special treatment for configuration errors.
   * When Azure Monitor is not configured (503 with configurationRequired flag),
   * the error is propagated so the UI can show an informative message.
   * For other errors, falls back to mock data to keep the UI functional.
   * @param error - The error from the API call
   * @param timeRange - The time range for generating mock data if needed
   * @returns Observable with mock data or error
   */
  private handleMetricsError(error: any, timeRange: MetricsTimeRange): Observable<MetricsData> {
    // Check if this is a "not configured" error (503 with configurationRequired flag)
    if (error instanceof HttpErrorResponse && error.status === 503) {
      const errorBody = error.error;
      if (errorBody?.configurationRequired) {
        // Propagate configuration errors to the component
        console.warn('Azure Monitor metrics not configured:', errorBody.message);
        return throwError(() => ({
          type: 'NOT_CONFIGURED',
          message: errorBody.message || 'Azure Monitor metrics are not configured.',
          details: errorBody.error
        }));
      }
    }

    // For other errors, fall back to mock data to keep UI functional
    console.warn('Failed to fetch metrics, falling back to mock data:', error);
    return of(this.generateMockMetrics(timeRange));
  }

  /**
   * Converts date strings from API response to Date objects.
   * The API returns ISO date strings that need to be converted to Date objects.
   * @param data - The metrics data from the API
   * @returns The same data with dates converted to Date objects
   */
  private convertDates(data: any): MetricsData {
    return {
      ...data,
      startTime: new Date(data.startTime),
      endTime: new Date(data.endTime),
      series: data.series.map((series: any) => ({
        ...series,
        data: series.data.map((point: any) => ({
          ...point,
          timestamp: new Date(point.timestamp)
        }))
      }))
    };
  }

  /**
   * Generates mock metrics data for fallback when API is unavailable.
   * This ensures the UI continues to work even when Azure Monitor is not configured.
   * @param timeRange - The time range to generate mock data for
   * @returns Mock metrics data with realistic-looking time series
   */
  private generateMockMetrics(timeRange: MetricsTimeRange): MetricsData {
    const now = new Date();
    const points = this.getPointsForTimeRange(timeRange);
    const intervalMs = this.getIntervalForTimeRange(timeRange);

    const startTime = new Date(now.getTime() - (points * intervalMs));
    const endTime = now;

    return {
      series: [
        {
          name: 'Incoming Messages',
          data: this.generateMockDataPoints(points, intervalMs, startTime, 0, 100)
        },
        {
          name: 'Outgoing Messages',
          data: this.generateMockDataPoints(points, intervalMs, startTime, 0, 95)
        },
        {
          name: 'Active Messages',
          data: this.generateMockDataPoints(points, intervalMs, startTime, 0, 50)
        },
        {
          name: 'Successful Requests',
          data: this.generateMockDataPoints(points, intervalMs, startTime, 0, 5)
        },
        {
          name: 'Server Errors',
          data: this.generateMockDataPoints(points, intervalMs, startTime, 0, 2)
        },
        {
          name: 'User Errors',
          data: this.generateMockDataPoints(points, intervalMs, startTime, 0, 1)
        }
      ],
      startTime,
      endTime
    };
  }

  /**
   * Generates an array of mock data points with timestamps.
   * @param points - Number of data points to generate
   * @param intervalMs - Interval between data points in milliseconds
   * @param startTime - Start time for the first data point
   * @param min - Minimum value for random data
   * @param max - Maximum value for random data
   * @returns Array of mock data points
   */
  private generateMockDataPoints(
    points: number,
    intervalMs: number,
    startTime: Date,
    min: number,
    max: number
  ) {
    const data = [];
    for (let i = 0; i < points; i++) {
      data.push({
        timestamp: new Date(startTime.getTime() + (i * intervalMs)),
        value: Math.floor(Math.random() * (max - min + 1)) + min
      });
    }
    return data;
  }

  /**
   * Gets the number of data points based on the time range.
   * @param timeRange - The time range
   * @returns Number of data points to generate
   */
  private getPointsForTimeRange(timeRange: MetricsTimeRange): number {
    switch (timeRange) {
      case MetricsTimeRange.OneHour:
        return 60; // 1 minute intervals
      case MetricsTimeRange.SixHours:
        return 72; // 5 minute intervals
      case MetricsTimeRange.TwelveHours:
        return 72; // 10 minute intervals
      case MetricsTimeRange.TwentyFourHours:
        return 96; // 15 minute intervals
      case MetricsTimeRange.SevenDays:
        return 168; // 1 hour intervals
      default:
        return 60;
    }
  }

  /**
   * Gets the interval between data points in milliseconds based on the time range.
   * @param timeRange - The time range
   * @returns Interval in milliseconds
   */
  private getIntervalForTimeRange(timeRange: MetricsTimeRange): number {
    switch (timeRange) {
      case MetricsTimeRange.OneHour:
        return 60 * 1000; // 1 minute
      case MetricsTimeRange.SixHours:
        return 5 * 60 * 1000; // 5 minutes
      case MetricsTimeRange.TwelveHours:
        return 10 * 60 * 1000; // 10 minutes
      case MetricsTimeRange.TwentyFourHours:
        return 15 * 60 * 1000; // 15 minutes
      case MetricsTimeRange.SevenDays:
        return 60 * 60 * 1000; // 1 hour
      default:
        return 60 * 1000; // 1 minute
    }
  }
}
