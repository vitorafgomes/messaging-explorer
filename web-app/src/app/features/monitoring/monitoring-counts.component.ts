import { AfterViewInit, Component, DestroyRef, computed, effect, inject, input, linkedSignal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable } from 'rxjs';
import { MonitoringEntity, MonitoringSnapshot } from '../../core/models';
import { EntitySelectionService, MonitoringService } from '../../core/services';

export const DEAD_LETTER_THRESHOLD_KEY = 'monitoring-dead-letter-threshold';
const DEFAULT_THRESHOLD = '100';

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
 * marked, a name that opens the entity, and a refresh that reads one entity's counts now.
 */
@Component({
  selector: 'app-monitoring-counts',
  standalone: true,
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSortModule, MatTableModule, MatTooltipModule],
  templateUrl: './monitoring-counts.component.html',
  styleUrl: './monitoring-counts.component.scss'
})
export class MonitoringCountsComponent implements AfterViewInit {
  private readonly monitoring = inject(MonitoringService);
  private readonly selection = inject(EntitySelectionService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly snapshot = input.required<MonitoringSnapshot>();

  readonly columns = ['name', 'kind', 'active', 'deadLetter', 'scheduled', 'transferDeadLetter', 'actions'];
  readonly filter = signal('');
  readonly thresholdText = signal(localStorage.getItem(DEAD_LETTER_THRESHOLD_KEY) ?? DEFAULT_THRESHOLD);
  readonly threshold = computed(() => /^\d+$/.test(this.thresholdText().trim()) ? Number(this.thresholdText().trim()) : null);
  readonly refreshing = signal<ReadonlySet<string>>(new Set());
  readonly refreshFailure = signal<string | null>(null);

  /** Counts read one entity at a time since the snapshot was taken; a snapshot taken later drops them. */
  private readonly refreshed = linkedSignal<string, Record<string, CountsRow>>({
    source: computed(() => this.snapshot().timestamp),
    computation: () => ({})
  });

  // ponytail: every row is rendered; virtualise or page the table when a namespace passes a few hundred entities.
  readonly rows = computed(() => {
    const snapshot = this.snapshot();
    const refreshed = this.refreshed();
    return [
      ...snapshot.queues.map(q => toRow(q, null)),
      ...snapshot.subscriptions.map(s => toRow(s, s.topicName))
    ].map(row => refreshed[row.key] ?? row);
  });

  private readonly needle = computed(() => this.filter().trim().toLowerCase());
  private readonly visibleRows = computed(() => this.rows().filter(row => matches(row, this.needle())));

  readonly dataSource = new MatTableDataSource<CountsRow>([]);
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

  refresh(row: CountsRow): void {
    this.refreshing.update(keys => new Set(keys).add(row.key));
    this.refreshFailure.set(null);
    const read: Observable<MonitoringEntity> = row.topicName === null
      ? this.monitoring.getQueueCounts(row.name)
      : this.monitoring.getSubscriptionCounts(row.topicName, row.name);
    read.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: entity => {
        this.refreshed.update(rows => ({ ...rows, [row.key]: toRow(entity, row.topicName) }));
        this.done(row);
      },
      error: (err: HttpErrorResponse) => {
        const reason = err?.status && err.error?.message ? err.error.message : 'the API did not answer.';
        this.refreshFailure.set(`Could not refresh ${row.name}: ${reason} The counts shown are from the last poll.`);
        this.done(row);
      }
    });
  }

  isRefreshing(row: CountsRow): boolean {
    return this.refreshing().has(row.key);
  }

  private done(row: CountsRow): void {
    this.refreshing.update(keys => {
      const next = new Set(keys);
      next.delete(row.key);
      return next;
    });
  }
}
