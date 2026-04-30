import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { SessionInfo } from '../models';

@Injectable({
  providedIn: 'root'
})
export class SessionService {
  private api = inject(ApiService);

  getSubscriptionSessions(topicName: string, subscriptionName: string, maxSessions = 50): Observable<SessionInfo[]> {
    return this.api.get<SessionInfo[]>(
      `sessions/${topicName}/subscriptions/${subscriptionName}?maxSessions=${maxSessions}`
    );
  }

  getQueueSessions(queueName: string, maxSessions = 50): Observable<SessionInfo[]> {
    return this.api.get<SessionInfo[]>(
      `sessions/${queueName}?maxSessions=${maxSessions}`
    );
  }

  setSubscriptionSessionState(topicName: string, subscriptionName: string, sessionId: string, state: string | null): Observable<{ success: boolean }> {
    return this.api.put<{ success: boolean }>(
      `sessions/${topicName}/subscriptions/${subscriptionName}/${sessionId}/state`,
      { state }
    );
  }

  setQueueSessionState(queueName: string, sessionId: string, state: string | null): Observable<{ success: boolean }> {
    return this.api.put<{ success: boolean }>(
      `sessions/${queueName}/state/${sessionId}`,
      { state }
    );
  }
}
