import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { MonitoringSnapshot } from '../models/monitoring.model';

@Injectable({ providedIn: 'root' })
export class MonitoringService {
  private api = inject(ApiService);

  getSnapshot(): Observable<MonitoringSnapshot> {
    return this.api.get<MonitoringSnapshot>('monitoring/snapshot');
  }

  getHistory(count: number = 20): Observable<MonitoringSnapshot[]> {
    return this.api.get<MonitoringSnapshot[]>(`monitoring/history?count=${count}`);
  }
}
