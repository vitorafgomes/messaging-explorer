import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap, throwError } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { apiPath } from '../../core/services/api-path';

/** The MCP server as the API reports it. The token itself is never part of it. */
export interface McpState {
  enabled: boolean;
  url: string;
  hasToken: boolean;
  tokenCreatedAt: string | null;
  /** The levels a connection can be offered at, as the API lists them: "read", "readAndSend", "all". */
  levels: string[];
  /** What this API can do; `entities` comes with a later phase, and an absent field is read as false. */
  supports: { logs: boolean; appSettings: boolean; confirmation: boolean; entities?: boolean };
  logsAllowed: boolean;
  /**
   * The connections offered. The last three fields come with the confirmation window; an older API leaves them out,
   * and an absent field is read as false.
   */
  connections: { connectionId: string; level: string; production?: boolean; canNeverAsk?: boolean; neverAsk?: boolean }[];
}

/** One request an assistant made that waits for the user's answer. Every text in it is shown as text, never as markup. */
export interface McpRequest {
  id: string;
  time: string;
  assistant: string;
  /** What is asked; a kind the app does not know can only be denied. */
  kind: string;
  title: string;
  facts: { label: string; value: string }[];
  note: string;
  allowLabel: string;
  expiresAt: string;
  /** Whether allowing it removes or moves messages; an older API leaves it out, which is read as false. */
  danger?: boolean;
  /** The word the user types, exactly, before the request can be allowed; absent or null when none is asked. */
  typed?: { label: string; word: string } | null;
}

/** One thing an assistant asked for, as the API kept it: no message body and no secret. */
export interface McpActivity {
  time: string;
  assistant: string;
  asked: string;
  where: string;
  outcome: string;
  kind: 'ok' | 'error' | 'plain';
}

/**
 * The MCP server group of Settings and the toolbar mark: the state the API answered last, shared by both.
 * A call that fails leaves the state as it was and reaches the caller, which says so where it happened.
 */
@Injectable({ providedIn: 'root' })
export class McpSettingsService {
  private readonly api = inject(ApiService);
  /** The state the API answered last; null until read, and when the API has no MCP server. */
  readonly state = signal<McpState | null>(null);
  /** Whether the API answered 404 to GET mcp: it lacks the feature, so nothing of it is shown. */
  readonly absent = signal(false);

  /** Reads the state; a 404 marks the feature absent and answers null, any other failure reaches the caller. */
  load(): Observable<McpState | null> {
    return this.api.get<McpState>('mcp').pipe(
      tap(state => { this.absent.set(false); this.state.set(state); }),
      catchError((error: { status?: number }) => {
        if (error?.status !== 404) return throwError(() => error);
        this.absent.set(true);
        this.state.set(null);
        return of(null);
      }));
  }

  setEnabled(enabled: boolean): Observable<McpState> {
    return this.keep(this.api.put<McpState>('mcp/enabled', { enabled }));
  }

  /** Creates a token, which ends the old one, and answers it to the caller alone: this service never keeps it. */
  createToken(): Observable<string> {
    return this.api.post<{ token: string; state: McpState }>('mcp/token', {}).pipe(
      tap(answer => this.state.set(answer.state)),
      map(answer => answer.token));
  }

  /** Offers a connection at a level; `neverAsk` is sent only when given, for a connection the API says can be a local test broker. */
  setLevel(connectionId: string, level: string, neverAsk?: boolean): Observable<McpState> {
    const body = neverAsk === undefined ? { level } : { level, neverAsk };
    return this.keep(this.api.put<McpState>(apiPath`mcp/connections/${connectionId}`, body));
  }

  removeConnection(connectionId: string): Observable<McpState> {
    return this.keep(this.api.delete<McpState>(apiPath`mcp/connections/${connectionId}`));
  }

  setLogs(allowed: boolean): Observable<McpState> {
    return this.keep(this.api.put<McpState>('mcp/logs', { allowed }));
  }

  /** What assistants asked for since the app opened, newest first. */
  activity(): Observable<McpActivity[]> {
    return this.api.get<McpActivity[]>('mcp/activity');
  }

  clearActivity(): Observable<void> {
    return this.api.delete<void>('mcp/activity');
  }

  /** The requests that wait for the user's answer. An older API answers 404, which reaches the caller. */
  requests(): Observable<McpRequest[]> {
    return this.api.get<McpRequest[]>('mcp/requests');
  }

  /**
   * Answers one waiting request, with the word the user typed when the request asks for one. A 400 means the word
   * was wrong and the request still waits; a 404 means it is no longer waiting.
   */
  answer(id: string, allow: boolean, typed?: string): Observable<void> {
    return this.api.post<void>(apiPath`mcp/requests/${id}/answer`, typed === undefined ? { allow } : { allow, typed });
  }

  private keep(call: Observable<McpState>): Observable<McpState> {
    return call.pipe(tap(state => this.state.set(state)));
  }
}
