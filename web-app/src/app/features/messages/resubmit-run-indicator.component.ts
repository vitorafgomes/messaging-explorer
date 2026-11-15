import { Component, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ResubmitRun, ResubmitRunService, formatDuration } from '../../core/services';
import type { ContinuousResubmitDialogData } from './continuous-resubmit-dialog.component';

const n = (value: number) => (value ?? 0).toLocaleString('en-US');

/** The percent of its count a run has read, 0 while the count is not known. */
export function runPercent(run: ResubmitRun): number {
  const { read, total } = run.progress();
  return total > 0 ? Math.min(100, Math.round((read * 100) / total)) : 0;
}

/** "resubmit running on orders, 480,000 of 700,000", or paused. */
export function runSummary(run: ResubmitRun): string {
  const p = run.progress();
  return `resubmit ${p.status === 'paused' ? 'paused' : 'running'} on ${run.target.entityName}, ${n(p.read)} of ${n(p.total)}`;
}

/**
 * The card of each automatic dead-letter resubmit that is running or paused, shown in the menu of
 * the Notifications bell; Open, Pause and Stop act through the run itself, as the dialog does.
 */
@Component({
  selector: 'app-resubmit-run-indicator',
  standalone: true,
  imports: [DecimalPipe, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    @for (run of runs.activeRuns(); track run) {
      @let p = run.progress();
      <div class="run-card">
        <strong>Resubmit {{ p.status === 'paused' ? 'paused' : 'running' }}: {{ p.read | number }} of {{ p.total | number }}</strong>
        <span class="where">Dead-letter of {{ run.target.entityName }}, back to the {{ run.target.topicName ? 'topic ' + run.target.topicName : 'queue' }}. {{ where(run) }}</span>
        <mat-progress-bar mode="determinate" [value]="percent(run)" [attr.aria-label]="'Read ' + p.read + ' of ' + p.total" />
        <span class="left">{{ leftLine(run) }}</span>
        <div class="actions">
          <button mat-button type="button" (click)="open(run)">Open</button>
          @if (p.status === 'paused') {
            <button mat-button type="button" (click)="run.resume()"><mat-icon aria-hidden="true">play_arrow</mat-icon>Resume</button>
          } @else {
            <button mat-button type="button" (click)="run.pause()"><mat-icon aria-hidden="true">pause</mat-icon>Pause</button>
          }
          <button mat-button type="button" (click)="run.stop()"><mat-icon aria-hidden="true">stop</mat-icon>Stop</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .run-card { display: flex; flex-direction: column; gap: 8px; min-width: 300px; padding: 12px 16px; }
    .where, .left { font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }
    .actions { display: flex; justify-content: flex-end; gap: 4px; }
  `]
})
export class ResubmitRunIndicatorComponent {
  readonly runs = inject(ResubmitRunService);
  private readonly dialog = inject(MatDialog);

  /**
   * The environment of the active connection. A connection change stops every active run, so an
   * active run is always on the active connection.
   */
  readonly environment = input<string | null | undefined>();

  readonly percent = runPercent;

  /** "Production, contoso.servicebus.windows.net.", or the connection alone with no environment. */
  where(run: ResubmitRun): string {
    const environment = this.environment();
    return environment ? `${environment}, ${run.connection ?? 'an unnamed connection'}.` : `${run.connection ?? 'An unnamed connection'}.`;
  }

  /** "About 1 h 13 min left. 12 left behind, 3 of them possible duplicates." */
  leftLine(run: ResubmitRun): string {
    const p = run.progress();
    const left = (p.failed ?? 0) + (p.possibleDuplicates ?? 0);
    const time = p.remainingMs != null ? `About ${formatDuration(p.remainingMs)} left. ` : '';
    return time + (left === 0 ? 'Nothing left behind.' : `${n(left)} left behind, ${n(p.possibleDuplicates)} of them possible duplicates.`);
  }

  /** Opens the resubmit dialog of the run's entity, loaded on demand so the toolbar does not carry it. */
  async open(run: ResubmitRun): Promise<void> {
    const { ContinuousResubmitDialogComponent } = await import('./continuous-resubmit-dialog.component');
    const data: ContinuousResubmitDialogData = {
      entityType: run.target.entityType,
      entityName: run.target.entityName,
      topicName: run.target.topicName
    };
    this.dialog.open(ContinuousResubmitDialogComponent, { width: '760px', maxWidth: '95vw', data });
  }
}
