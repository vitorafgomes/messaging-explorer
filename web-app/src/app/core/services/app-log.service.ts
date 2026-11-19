import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { DevSettingsService } from './dev-settings.service';

export type LogLevel = 'Error' | 'Warning' | 'Info';
export type LogSource = 'Backend' | 'Desktop app' | 'Screen';

/** One line of the Logs screen. `detail` holds what is shown when the line is opened. */
export interface LogLine {
  key: string;
  time: Date;
  level: LogLevel;
  source: LogSource;
  text: string;
  detail: [string, string][];
}

interface BackendLine {
  id: number;
  time: string;
  level: string;
  category: string;
  text: string;
  errorType?: string | null;
  where?: string | null;
}

interface ShellLine {
  id: number;
  time: string;
  level: string;
  category: string;
  text: string;
}

const SCREEN_LIMIT = 500;
const SHELL_LIMIT = 500;
const BACKEND_LIMIT = 2000;
const POLL_MS = 5000;

const levelOf = (level: string): LogLevel => level === 'Error' || level === 'Critical' ? 'Error' : level === 'Warning' ? 'Warning' : 'Info';

/**
 * What the Logs screen of Developer mode shows: the lines the backend kept in memory, the lines the desktop app kept,
 * and the calls of this screen the backend did not log, those with no answer and those the key check refused: any other
 * the backend answered with an error is already among its lines. Nothing is read or kept while Developer mode is off. A line names no body, no header and no secret.
 */
@Injectable({ providedIn: 'root' })
export class AppLogService {
  private readonly api = inject(ApiService);
  private readonly devMode = inject(DevSettingsService).devMode;
  private readonly backend = signal<LogLine[]>([]);
  private readonly screen = signal<LogLine[]>([]);
  private readonly shell = signal<LogLine[]>([]);
  private lastId = 0;
  private lastShellId = 0;
  private screenCount = 0;
  private reading = false;

  /** Every line kept, newest first. */
  readonly lines = computed(() => [...this.backend(), ...this.shell(), ...this.screen()].sort((a, b) => b.time.getTime() - a.time.getTime()));
  readonly errorCount = computed(() => this.lines().filter(line => line.level === 'Error').length);
  /** Why the backend's lines could not be read, or '' when they were. */
  readonly readError = signal('');

  constructor() {
    this.api.failures.subscribe(failure => {
      if (!this.devMode() || failure.endpoint === 'logs' || (failure.status !== 0 && failure.status !== 401)) return;
      const call = `${failure.method} ${failure.endpoint}`;
      this.addScreen({
        key: `s${++this.screenCount}`, time: new Date(), level: 'Error', source: 'Screen',
        text: failure.status === 0 ? `${call} got no answer.` : `${call} was refused before the backend logged it (401).`,
        detail: [['Call', call], ['Status', failure.status === 0 ? 'no answer' : '401']]
      });
    });
    effect(onCleanup => {
      if (!this.devMode()) return;
      this.refresh();
      const timer = setInterval(() => this.refresh(), POLL_MS);
      onCleanup(() => clearInterval(timer));
    });
  }

  /** Reads the lines the backend and the desktop app logged since the last read. */
  refresh(): void {
    this.readShell();
    if (this.reading) return;
    this.reading = true;
    this.api.get<BackendLine[]>(`logs?after=${this.lastId}`).subscribe({
      next: read => {
        this.reading = false;
        this.readError.set('');
        if (!Array.isArray(read) || read.length === 0) return;
        this.lastId = Math.max(this.lastId, ...read.map(line => line.id));
        const added = read.map((line): LogLine => ({
          key: `b${line.id}`, time: new Date(line.time), level: levelOf(line.level), source: 'Backend', text: line.text,
          detail: [['Category', line.category], ...(line.errorType ? [['Error', line.errorType] as [string, string]] : []), ...(line.where ? [['Where', line.where] as [string, string]] : [])]
        }));
        this.backend.update(lines => [...lines, ...added].slice(-BACKEND_LIMIT));
      },
      error: () => {
        this.reading = false;
        this.readError.set('The lines of the backend could not be read. The local API gave no answer.');
      }
    });
  }

  /** Forgets every line, here and on the backend. */
  clear(): void {
    this.backend.set([]);
    this.screen.set([]);
    this.shell.set([]);
    const desktop = this.desktop();
    if (typeof desktop?.clearShellLogs === 'function') void Promise.resolve(desktop.clearShellLogs()).catch(() => undefined);
    this.api.delete('logs').subscribe({ error: () => undefined });
  }

  private desktop(): any {
    return typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
  }

  private readShell(): void {
    const desktop = this.desktop();
    if (typeof desktop?.getShellLogs !== 'function') return;
    void Promise.resolve(desktop.getShellLogs(this.lastShellId)).then((read: ShellLine[]) => {
      if (!Array.isArray(read) || read.length === 0) return;
      this.lastShellId = Math.max(this.lastShellId, ...read.map(line => line.id));
      const added = read.map((line): LogLine => ({
        key: `d${line.id}`, time: new Date(line.time), level: levelOf(line.level), source: 'Desktop app', text: line.text,
        detail: line.category ? [['Category', line.category]] : []
      }));
      this.shell.update(lines => [...lines, ...added].slice(-SHELL_LIMIT));
    }).catch(() => undefined);
  }

  private addScreen(line: LogLine): void {
    this.screen.update(lines => [...lines, line].slice(-SCREEN_LIMIT));
  }
}
