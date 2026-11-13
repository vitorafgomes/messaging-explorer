import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { apiPath } from './api-path';
import { SessionDetail, SessionEntity, SessionList, SessionStateWrite } from '../models';

/**
 * The sessions of a queue or a subscription. Listing peeks and locks nothing; reading one session
 * with its messages, or writing its state, accepts that session for the length of the call.
 */
@Injectable({
  providedIn: 'root'
})
export class SessionService {
  private api = inject(ApiService);

  list(entity: SessionEntity, maxMessages = 1000): Observable<SessionList> {
    return this.api.get<SessionList>(`${sessions(entity)}${apiPath`?maxMessages=${maxMessages}`}`);
  }

  get(entity: SessionEntity, sessionId: string, messageCount = 100): Observable<SessionDetail> {
    return this.api.get<SessionDetail>(`${sessions(entity)}${apiPath`/${sessionId}?messageCount=${messageCount}`}`);
  }

  setState(entity: SessionEntity, sessionId: string, write: SessionStateWrite): Observable<SessionDetail> {
    return this.api.put<SessionDetail>(`${sessions(entity)}${apiPath`/${sessionId}/state`}`, write);
  }
}

function sessions(entity: SessionEntity): string {
  return 'queueName' in entity
    ? apiPath`queues/${entity.queueName}/sessions`
    : apiPath`topics/${entity.topicName}/subscriptions/${entity.subscriptionName}/sessions`;
}
