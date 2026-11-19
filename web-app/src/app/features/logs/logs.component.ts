import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppLogService, LogLevel, LogLine, LogSource } from '../../core/services/app-log.service';

const plain = (line: LogLine): string =>
  [`${line.time.toISOString()} ${line.level} ${line.source} ${line.text}`, ...line.detail.map(([key, value]) => `    ${key}: ${value}`)].join('\n');

/** The lines of the backend and of this screen since the app opened, for Developer mode. */
@Component({
  selector: 'app-logs',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  templateUrl: './logs.component.html',
  styleUrl: './logs.component.scss'
})
export class LogsComponent {
  private readonly log = inject(AppLogService);
  private readonly snackBar = inject(MatSnackBar);

  readonly level = signal<LogLevel | 'All'>('All');
  readonly source = signal<LogSource | ''>('');
  readonly query = signal('');
  readonly sources: LogSource[] = ['Backend', 'Desktop app', 'Screen'];
  readonly paused = signal(false);
  private readonly open = signal<Record<string, boolean>>({});
  /** What was on the list when Pause was pressed; the list stays on it until Resume. */
  private readonly held = signal<LogLine[]>([]);

  readonly readError = this.log.readError;
  readonly all = computed(() => this.paused() ? this.held() : this.log.lines());
  readonly counts = computed(() => {
    const lines = this.all();
    const of = (level: LogLevel) => lines.filter(line => line.level === level).length;
    return { All: lines.length, Error: of('Error'), Warning: of('Warning'), Info: of('Info') };
  });
  readonly shown = computed(() => {
    const level = this.level();
    const source = this.source();
    const query = this.query().trim().toLowerCase();
    return this.all().filter(line =>
      (level === 'All' || line.level === level)
      && (!source || line.source === source)
      && (!query || `${line.text} ${line.detail.map(d => d[1]).join(' ')}`.toLowerCase().includes(query)));
  });

  isOpen(line: LogLine): boolean {
    return !!this.open()[line.key];
  }

  toggle(line: LogLine): void {
    this.open.update(open => ({ ...open, [line.key]: !open[line.key] }));
  }

  togglePause(): void {
    if (!this.paused()) this.held.set(this.log.lines());
    this.paused.update(paused => !paused);
  }

  clear(): void {
    this.log.clear();
    this.held.set([]);
  }

  copy(lines: LogLine[]): void {
    void navigator.clipboard.writeText(lines.map(plain).join('\n')).then(
      () => this.snackBar.open(lines.length === 1 ? 'Line copied' : `${lines.length} lines copied`, 'Close', { duration: 3000 }),
      () => this.snackBar.open('The lines were not copied: the clipboard refused.', 'Close', { duration: 6000 }));
  }

  save(): void {
    const text = this.shown().map(plain).join('\n');
    const name = `messaging-explorer-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    const shell = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
    if (typeof shell?.saveExportFile === 'function') {
      void Promise.resolve(shell.saveExportFile(name, text)).catch(() => null).then((result: any) => {
        if (result?.status === 'cancelled') return;
        this.snackBar.open(result?.status === 'saved' ? `Saved as ${result.file}` : `The lines were not saved. ${result?.message ?? 'The desktop app gave no answer.'}`, 'Close', { duration: 6000 });
      });
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }
}
