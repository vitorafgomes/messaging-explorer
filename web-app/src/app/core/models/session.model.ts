/** The queue or the subscription whose sessions are read. */
export type SessionEntity = { queueName: string } | { topicName: string; subscriptionName: string };

/** One session seen by a passive scan of the entity's messages. */
export interface SessionSummary {
  sessionId: string;
  /** Messages of this session seen within the scan only. */
  messageCount: number;
  firstSequenceNumber: number;
}

/** A session listing: peeked, so no session was locked to produce it. */
export interface SessionList {
  sessions: SessionSummary[];
  scannedMessages: number;
  /** The scan stopped before the end of the entity: more sessions or messages may exist. */
  truncated: boolean;
}

/** One session as read while it was accepted for a moment. */
export interface SessionDetail {
  sessionId: string;
  /** Null when the session holds no state; base64 when `stateIsBinary`. */
  state: string | null;
  stateIsBinary: boolean;
  lockedUntil: string;
}

/** A state write, refused by the server when the current state differs from `expectedState`. */
export interface SessionStateWrite {
  /** The new state, or null to clear it. */
  state: string | null;
  /** The state the user was shown; null when there was none. Always sent. */
  expectedState: string | null;
}
