import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { apiPath } from './api-path';
import { MonitoringEntity, MonitoringSnapshot, MonitoringStatus, MonitoringSubscription } from '../models/monitoring.model';

@Injectable({ providedIn: 'root' })
export class MonitoringService {
  private api = inject(ApiService);

  getSnapshot(): Observable<MonitoringStatus> {
    return this.api.get<MonitoringStatus>('monitoring/snapshot');
  }

  getHistory(count: number = 20): Observable<MonitoringSnapshot[]> {
    return this.api.get<MonitoringSnapshot[]>(apiPath`monitoring/history?count=${count}`);
  }

  /** Reads one queue's counts from the broker now, outside the API's poll. */
  getQueueCounts(queueName: string): Observable<MonitoringEntity> {
    return this.api.get<MonitoringEntity>(apiPath`monitoring/counts?queue=${queueName}`);
  }

  /** Reads one subscription's counts from the broker now, outside the API's poll. */
  getSubscriptionCounts(topicName: string, subscriptionName: string): Observable<MonitoringSubscription> {
    return this.api.get<MonitoringSubscription>(apiPath`monitoring/counts?topic=${topicName}&subscription=${subscriptionName}`);
  }
}
