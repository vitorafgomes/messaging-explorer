import { Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ResubmitRun, ResubmitRunService } from '../../core/services';
import type { ContinuousResubmitDialogData } from './continuous-resubmit-dialog.component';

/** A toolbar button shown while any automatic dead-letter resubmit is running or paused; each entry opens its run. */
@Component({
  selector: 'app-resubmit-run-indicator',
  standalone: true,
  imports: [DecimalPipe, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  template: `
    @if (runs.activeRuns().length > 0) {
      <button mat-button class="indicator" [matMenuTriggerFor]="menu" [attr.aria-label]="label()" [matTooltip]="label()">
        <mat-icon aria-hidden="true">autorenew</mat-icon>
        <span aria-hidden="true">{{ runs.activeRuns().length }}</span>
      </button>
      <mat-menu #menu="matMenu">
        @for (run of runs.activeRuns(); track run) {
          <button mat-menu-item (click)="open(run)">
            <mat-icon aria-hidden="true">{{ run.progress().status === 'paused' ? 'pause_circle' : 'autorenew' }}</mat-icon>
            <span>
              Resubmit {{ run.progress().status === 'paused' ? 'paused' : 'running' }} on
              {{ run.target.topicName ? run.target.topicName + '/' : '' }}{{ run.target.entityName }}:
              {{ run.progress().read | number }} of {{ run.progress().total | number }}
            </span>
          </button>
        }
      </mat-menu>
    }
  `,
  styles: [`
    .indicator { color: inherit; }
  `]
})
export class ResubmitRunIndicatorComponent {
  readonly runs = inject(ResubmitRunService);
  private readonly dialog = inject(MatDialog);

  readonly label = computed(() => {
    const count = this.runs.activeRuns().length;
    return `Resubmit running: ${count} ${count === 1 ? 'run' : 'runs'}. Open a run`;
  });

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
