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
  supports: { logs: boolean; appSettings: boolean; confirmation: boolean };
  logsAllowed: boolean;
  connections: { connectionId: string; level: string }[];
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

  setLevel(connectionId: string, level: string): Observable<McpState> {
    return this.keep(this.api.put<McpState>(apiPath`mcp/connections/${connectionId}`, { level }));
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

  private keep(call: Observable<McpState>): Observable<McpState> {
    return call.pipe(tap(state => this.state.set(state)));
  }
}
