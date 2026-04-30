import { SessionInfo } from './session.model';

describe('SessionInfo', () => {
  it('should create with required fields', () => {
    const session: SessionInfo = { sessionId: 'test-session-1' };
    expect(session.sessionId).toBe('test-session-1');
  });

  it('should create with all optional fields', () => {
    const session: SessionInfo = {
      sessionId: 'test-session-1',
      state: '{"key": "value"}',
      lockedUntil: '2026-04-08T22:00:00Z'
    };
    expect(session.state).toBe('{"key": "value"}');
    expect(session.lockedUntil).toBe('2026-04-08T22:00:00Z');
  });

  it('should allow undefined optional fields', () => {
    const session: SessionInfo = { sessionId: 'test' };
    expect(session.state).toBeUndefined();
    expect(session.lockedUntil).toBeUndefined();
  });
});
