/**
 * Response model containing Azure Monitor metrics data with time series.
 */
export interface MetricsData {
  /**
   * Collection of metric series (e.g., incoming messages, outgoing messages, active messages).
   */
  series: MetricsSeries[];

  /**
   * Start time of the metrics data range.
   */
  startTime: Date;

  /**
   * End time of the metrics data range.
   */
  endTime: Date;
}

/**
 * Represents a single metric series with name and data points.
 */
export interface MetricsSeries {
  /**
   * Name of the metric (e.g., "Incoming Messages", "Outgoing Messages", "Active Messages").
   */
  name: string;

  /**
   * Collection of data points for this metric series.
   */
  data: MetricsDataPoint[];
}

/**
 * Represents a single data point in a metric series with timestamp and value.
 */
export interface MetricsDataPoint {
  /**
   * Timestamp of the data point.
   */
  timestamp: Date;

  /**
   * Metric value at the given timestamp.
   */
  value: number;
}

/**
 * Request model for fetching Azure Monitor metrics for a Service Bus entity.
 */
export interface MetricsRequest {
  /**
   * Name of the Service Bus entity (queue, topic, or subscription name).
   */
  entityName: string;

  /**
   * Type of the Service Bus entity.
   */
  entityType: MetricsEntityType;

  /**
   * Time range for the metrics query.
   */
  timeRange: MetricsTimeRange;

  /**
   * For subscriptions, the parent topic name.
   */
  topicName?: string;
}

/**
 * Defines the supported time ranges for metrics queries.
 */
export enum MetricsTimeRange {
  /** Last 1 hour of metrics data. */
  OneHour = 0,

  /** Last 6 hours of metrics data. */
  SixHours = 1,

  /** Last 12 hours of metrics data. */
  TwelveHours = 2,

  /** Last 24 hours of metrics data. */
  TwentyFourHours = 3,

  /** Last 7 days of metrics data. */
  SevenDays = 4
}

/**
 * Defines the types of Service Bus entities for metrics queries.
 * Note: This is separate from the UI EntityType to match backend DTOs.
 */
export enum MetricsEntityType {
  /** Service Bus Queue. */
  Queue = 0,

  /** Service Bus Topic. */
  Topic = 1,

  /** Service Bus Subscription. */
  Subscription = 2
}
