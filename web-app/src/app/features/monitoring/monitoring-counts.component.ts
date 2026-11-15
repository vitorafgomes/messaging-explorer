import { AfterViewInit, ChangeDetectionStrategy, Component, computed, effect, inject, input, model, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MonitoringEntity, MonitoringSnapshot } from '../../core/models';
import { EntitySelectionService } from '../../core/services';
import { ProviderService } from '../../core/services/provider.service';
import type { ContinuousResubmitDialogData } from '../messages/continuous-resubmit-dialog.component';

export const DEAD_LETTER_THRESHOLD_KEY = 'monitoring-dead-letter-threshold';
const DEFAULT_THRESHOLD = '100';

/** The periods the screen can read the snapshot at; 30 seconds is the floor. */
export const REFRESH_PERIODS: ReadonlyArray<{ seconds: number; label: string }> = [
  { seconds: 30, label: '30 seconds' },
  { seconds: 60, label: '1 minute' },
  { seconds: 300, label: '5 minutes' }
];

export interface CountsRow {
  key: string;
  kind: 'Queue' | 'Subscription';
  name: string;
  topicName: string | null;
  active: number;
  deadLetter: number;
  scheduled: number | null;
  transferDeadLetter: number | null;
}

function matches(row: CountsRow, needle: string): boolean {
  return row.name.toLowerCase().includes(needle) || (row.topicName ?? '').toLowerCase().includes(needle);
}

function toRow(entity: MonitoringEntity, topicName: string | null): CountsRow {
  return {
    key: topicName === null ? `queue:${entity.name}` : `subscription:${topicName}/${entity.name}`,
    kind: topicName === null ? 'Queue' : 'Subscription',
    name: entity.name,
    topicName,
    active: entity.activeMessageCount,
    deadLetter: entity.deadLetterMessageCount,
    scheduled: entity.scheduledMessageCount,
    transferDeadLetter: entity.transferDeadLetterMessageCount
  };
}

/**
 * The counts of every queue and subscription of one snapshot in one table: sorted by any column,
 * filtered by name, the dead-letter rows above a threshold the user sets (kept in this browser)
 * marked, a name that opens the entity, and an auto resubmit where dead-letter messages wait.
 */
@Component({
  selector: 'app-monitoring-counts',
  standalone: true,
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSortModule, MatTableModule],
  templateUrl: './monitoring-counts.component.html',
  styleUrl: './monitoring-counts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MonitoringCountsComponent implements AfterViewInit {
  private readonly selection = inject(EntitySelectionService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly provider = inject(ProviderService);

  /** Auto resubmit is offered unless the provider says it has no dead-letter queue or no safe bulk operations, as on the entity panel. */
  readonly canResubmit = computed(() => this.provider.capabilities()?.supportsDeadLetterQueue !== false && this.provider.capabilities()?.supportsBulkMessageOperations !== false);

  readonly snapshot = input.required<MonitoringSnapshot>();
  /** How often the screen reads the snapshot, in seconds; the screen that polls owns it. */
  readonly refreshSeconds = model(REFRESH_PERIODS[0].seconds);
  readonly periods = REFRESH_PERIODS;

  readonly columns = ['name', 'kind', 'active', 'deadLetter', 'scheduled', 'transferDeadLetter', 'actions'];
  readonly filter = signal('');
  readonly thresholdText = signal(localStorage.getItem(DEAD_LETTER_THRESHOLD_KEY) ?? DEFAULT_THRESHOLD);
  readonly threshold = computed(() => /^\d+$/.test(this.thresholdText().trim()) ? Number(this.thresholdText().trim()) : null);

  // ponytail: every row is rendered; virtualise or page the table when a namespace passes a few hundred entities.
  readonly rows = computed(() => {
    const snapshot = this.snapshot();
    return [
      ...snapshot.queues.map(q => toRow(q, null)),
      ...snapshot.subscriptions.map(s => toRow(s, s.topicName))
    ];
  });

  private readonly needle = computed(() => this.filter().trim().toLowerCase());
  private readonly visibleRows = computed(() => this.rows().filter(row => matches(row, this.needle())));

  readonly dataSource = new MatTableDataSource<CountsRow>([]);
  readonly trackRow = (_: number, row: CountsRow) => row.key;
  private readonly sort = viewChild.required(MatSort);

  readonly summary = computed(() => {
    const total = this.rows().length;
    const shown = this.visibleRows();
    const threshold = this.threshold();
    const entities = shown.length === total ? `${total} ${total === 1 ? 'entity' : 'entities'}.` : `${shown.length} of ${total} entities match the filter.`;
    if (threshold === null) return `${entities} Enter a whole number as the threshold to mark rows.`;
    const over = shown.filter(r => r.deadLetter > threshold).length;
    return `${entities} ${over} over the dead-letter threshold of ${threshold.toLocaleString('en-US')}.`;
  });

  constructor() {
    this.dataSource.filterPredicate = matches;
    this.dataSource.sortingDataAccessor = (row, column) => {
      const value = row[column as keyof CountsRow];
      if (value === null) return -1;
      return typeof value === 'string' ? value.toLowerCase() : (value as number);
    };
    effect(() => {
      this.dataSource.data = this.rows();
      this.dataSource.filter = this.needle();
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort();
  }

  onFilter(value: string): void {
    this.filter.set(value);
  }

  onThreshold(value: string): void {
    this.thresholdText.set(value);
    localStorage.setItem(DEAD_LETTER_THRESHOLD_KEY, value);
  }

  onRefreshEvery(value: string): void {
    const period = REFRESH_PERIODS.find(p => String(p.seconds) === value);
    if (period) {
      this.refreshSeconds.set(period.seconds);
    }
  }

  isOver(row: CountsRow): boolean {
    const threshold = this.threshold();
    return threshold !== null && row.deadLetter > threshold;
  }

  count(value: number | null): string {
    return value === null ? 'Not counted' : value.toLocaleString('en-US');
  }

  open(row: CountsRow): void {
    if (row.topicName === null) {
      this.selection.select({ id: `queue-${row.name}`, name: row.name, type: 'queue', icon: 'inbox', expandable: false, level: 1 });
    } else {
      this.selection.navigateToSubscription(row.topicName, row.name);
    }
    this.router.navigate(['/entities']);
  }

  /** Opens the auto resubmit of the row's dead-letter queue, loaded on demand so the screen does not carry it. */
  async autoResubmit(row: CountsRow): Promise<void> {
    const { ContinuousResubmitDialogComponent } = await import('../messages/continuous-resubmit-dialog.component');
    const data: ContinuousResubmitDialogData = {
      entityType: row.topicName === null ? 'queue' : 'subscription',
      entityName: row.name,
      topicName: row.topicName ?? undefined,
      deadLetterMessageCount: row.deadLetter
    };
    this.dialog.open(ContinuousResubmitDialogComponent, { width: '720px', maxWidth: '95vw', data });
  }
}
