import { TestBed } from '@angular/core/testing';
import { of, firstValueFrom } from 'rxjs';
import { SessionService } from './session.service';
import { ApiService } from './api.service';
import { SessionInfo } from '../models';

describe('SessionService', () => {
  let service: SessionService;
  let apiServiceMock: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

  const mockSessions: SessionInfo[] = [
    { sessionId: 'session-1', state: '{"key": "value"}', lockedUntil: '2026-04-08T22:00:00Z' },
    { sessionId: 'session-2' },
  ];

  beforeEach(() => {
    apiServiceMock = {
      get: vi.fn().mockReturnValue(of(mockSessions)),
      put: vi.fn().mockReturnValue(of({ success: true })),
    };

    TestBed.configureTestingModule({
      providers: [
        SessionService,
        { provide: ApiService, useValue: apiServiceMock },
      ],
    });
    service = TestBed.inject(SessionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getSubscriptionSessions', () => {
    it('should call correct URL', () => {
      service.getSubscriptionSessions('my-topic', 'my-sub').subscribe();
      expect(apiServiceMock.get).toHaveBeenCalledWith(
        'sessions/my-topic/subscriptions/my-sub?maxSessions=50'
      );
    });

    it('should pass maxSessions param', () => {
      service.getSubscriptionSessions('my-topic', 'my-sub', 100).subscribe();
      expect(apiServiceMock.get).toHaveBeenCalledWith(
        'sessions/my-topic/subscriptions/my-sub?maxSessions=100'
      );
    });

    it('should return sessions from API', async () => {
      const sessions = await firstValueFrom(service.getSubscriptionSessions('my-topic', 'my-sub'));
      expect(sessions).toEqual(mockSessions);
      expect(sessions.length).toBe(2);
    });
  });

  describe('getQueueSessions', () => {
    it('should call correct URL', () => {
      service.getQueueSessions('my-queue').subscribe();
      expect(apiServiceMock.get).toHaveBeenCalledWith(
        'sessions/my-queue?maxSessions=50'
      );
    });

    it('should pass maxSessions param', () => {
      service.getQueueSessions('my-queue', 25).subscribe();
      expect(apiServiceMock.get).toHaveBeenCalledWith(
        'sessions/my-queue?maxSessions=25'
      );
    });

    it('should return sessions from API', async () => {
      const sessions = await firstValueFrom(service.getQueueSessions('my-queue'));
      expect(sessions).toEqual(mockSessions);
    });
  });

  describe('setSubscriptionSessionState', () => {
    it('should call PUT with state body', () => {
      const newState = '{"updated": true}';
      service.setSubscriptionSessionState('my-topic', 'my-sub', 'session-1', newState).subscribe();
      expect(apiServiceMock.put).toHaveBeenCalledWith(
        'sessions/my-topic/subscriptions/my-sub/session-1/state',
        { state: newState }
      );
    });

    it('should send null state', () => {
      service.setSubscriptionSessionState('my-topic', 'my-sub', 'session-1', null).subscribe();
      expect(apiServiceMock.put).toHaveBeenCalledWith(
        'sessions/my-topic/subscriptions/my-sub/session-1/state',
        { state: null }
      );
    });

    it('should return success response', async () => {
      const result = await firstValueFrom(
        service.setSubscriptionSessionState('my-topic', 'my-sub', 'session-1', 'data')
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('setQueueSessionState', () => {
    it('should call PUT with state body', () => {
      const newState = '{"updated": true}';
      service.setQueueSessionState('my-queue', 'session-1', newState).subscribe();
      expect(apiServiceMock.put).toHaveBeenCalledWith(
        'sessions/my-queue/state/session-1',
        { state: newState }
      );
    });

    it('should send null state', () => {
      service.setQueueSessionState('my-queue', 'session-1', null).subscribe();
      expect(apiServiceMock.put).toHaveBeenCalledWith(
        'sessions/my-queue/state/session-1',
        { state: null }
      );
    });

    it('should return success response', async () => {
      const result = await firstValueFrom(
        service.setQueueSessionState('my-queue', 'session-1', 'data')
      );
      expect(result).toEqual({ success: true });
    });
  });
});
