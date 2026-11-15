import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { Subject, TimeoutError, forkJoin, interval, of } from 'rxjs';
import { filter, switchMap, takeUntil, timeout } from 'rxjs/operators';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MonitoringService, ConnectionService } from '../../core/services';
import { MonitoringSnapshot, MonitoringEntity, MonitoringStatus, MonitoringSubscription } from '../../core/models';
import { MonitoringCountsComponent, REFRESH_PERIODS } from './monitoring-counts.component';
import { MonitoringMetricsComponent } from './monitoring-metrics.component';
import { ProviderType } from '../../core/models';

/** How long the screen waits for the API's answer before it says the request timed out. */
export const REQUEST_TIMEOUT_MS = 30_000;

interface Trend {
  label: string;
  first: number;
  last: number;
  /** How the last value compares with the first, as the sparkline's label says it. */
  direction: 'rising' | 'falling' | 'steady';
  /** Polyline points in a 380 by 96 box, the lowest value at y 88 and the highest at y 8. */
  points: string;
}

function trend(label: string, values: number[]): Trend {
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  const step = 380 / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(88 - (span ? (v - min) / span : 0) * 80).toFixed(1)}`).join(' ');
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  return { label, first, last, direction: last > first ? 'rising' : last < first ? 'falling' : 'steady', points };
}

interface SnapshotHistory {
  timestamp: string;
  totalActive: number;
  totalDeadLetter: number;
}

@Component({
  selector: 'app-monitoring',
  standalone: true,
  imports: [CommonModule, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTableModule, MatTabsModule, MonitoringCountsComponent, MonitoringMetricsComponent],
  template: `
    <div class="monitoring-container">
      <div class="monitoring-header">
        <div class="header-left">
          @if (host) {
            <div class="host">{{ host }}</div>
          }
          <h1>Monitoring</h1>
        </div>
        @if (hasData()) {
          <div class="header-right">
            <span class="last-update" aria-live="polite">Last update {{ status()!.snapshot!.timestamp | date:'HH:mm:ss' }}.@if (tab() === 0) { Refreshes every {{ periodLabel() }}.}</span>
            <button mat-stroked-button type="button" (click)="fetchSnapshot()" [disabled]="loading()">
              <mat-icon aria-hidden="true">refresh</mat-icon>
              Refresh
            </button>
          </div>
        }
      </div>

      @if (!isConnected) {
        <div class="monitoring-state">
          <mat-icon class="state-icon" aria-hidden="true">cloud_off</mat-icon>
          <h2>Not connected</h2>
          <p>Connect to a broker to see its counts.</p>
        </div>
      } @else if (error()) {
        <section class="monitoring-error" role="alert" aria-label="Error">
          <mat-icon aria-hidden="true">warning</mat-icon>
          <div class="grow">
            <h2>Could not load the monitoring data</h2>
            <p>{{ error() }} Nothing is shown because nothing was read, and nothing on the broker was changed.</p>
            <button mat-stroked-button type="button" (click)="fetchSnapshot()" [disabled]="loading()"><mat-icon aria-hidden="true">refresh</mat-icon>Retry</button>
          </div>
        </section>
      } @else if (!status()) {
        <div class="monitoring-loading">
          <p aria-live="polite">
            <mat-progress-spinner mode="indeterminate" diameter="20" aria-hidden="true"></mat-progress-spinner>
            <span>Loading the monitoring data from {{ host ?? 'the broker' }}</span>
          </p>
          <div class="skeleton-cards" aria-hidden="true"><div></div><div></div><div></div><div></div></div>
          <div class="skeleton-lines" aria-hidden="true"><div></div><div></div><div></div></div>
        </div>
      } @else if (!status()!.snapshot) {
        @if (status()!.lastPollFailedAt) {
          <section class="monitoring-error" role="alert" aria-label="Error">
            <mat-icon aria-hidden="true">warning</mat-icon>
            <div class="grow">
              <h2>Could not read the counts from the broker</h2>
              <p>The API's poll failed at {{ status()!.lastPollFailedAt | date:'HH:mm:ss' }}. Nothing is shown because nothing was read, and nothing on the broker was changed. The API tries again every {{ status()!.pollIntervalSeconds }} seconds.</p>
              <button mat-stroked-button type="button" (click)="fetchSnapshot()" [disabled]="loading()"><mat-icon aria-hidden="true">refresh</mat-icon>Retry</button>
            </div>
          </section>
        } @else {
          <div class="monitoring-state" role="status">
            <mat-progress-spinner mode="indeterminate" diameter="32" aria-label="Waiting"></mat-progress-spinner>
            <span>Waiting for the API's first poll of the broker</span>
          </div>
        }
      } @else if (totalEntities() === 0) {
        <div class="monitoring-state">
          <mat-icon class="state-icon" aria-hidden="true">show_chart</mat-icon>
          <h2>Nothing to monitor in this namespace</h2>
          <p>{{ host ?? 'The broker' }} answered and holds no queue and no subscription. Counts appear here once an entity exists.</p>
          <a matButton="tonal" routerLink="/entities"><mat-icon aria-hidden="true">add</mat-icon>Create one in Entities</a>
        </div>
      } @else {
        @if (status()!.lastPollFailedAt) {
          <p class="stale" role="alert">The API's last poll failed at {{ status()!.lastPollFailedAt | date:'HH:mm:ss' }}. These counts are from {{ status()!.snapshot!.timestamp | date:'HH:mm:ss' }}.</p>
        }
        <mat-tab-group mat-stretch-tabs="false" animationDuration="0ms" [selectedIndex]="tab()" (selectedIndexChange)="tab.set($event)">
          <mat-tab label="Overview">
        <div class="overview">
          <div class="summary-cards">
            <div class="summary-card">
              <span class="card-label">Active</span>
              <span class="card-value">{{ totalActive() | number }}</span>
              @if (deltaActive() !== 0) {
                <span class="card-note">{{ signed(deltaActive()) }} since the last poll</span>
              }
            </div>
            <div class="summary-card" [class.attention]="totalDeadLetter() > 0">
              <span class="card-label">
                @if (totalDeadLetter() > 0) {
                  <mat-icon aria-hidden="true">warning</mat-icon>
                }
                Dead-letter
              </span>
              <span class="card-value">{{ totalDeadLetter() | number }}</span>
              @if (deltaDeadLetter() !== 0) {
                <span class="card-note">{{ signed(deltaDeadLetter()) }} since the last poll</span>
              }
            </div>
            <div class="summary-card">
              <span class="card-label">Transfer</span>
              <span class="card-value">{{ totalTransfer() | number }}</span>
              <span class="card-note">On their way to another entity</span>
            </div>
            <div class="summary-card">
              <span class="card-label">Monitored entities</span>
              <span class="card-value">{{ totalEntities() | number }}</span>
              <span class="card-note">{{ count(queues().length, 'queue', 'queues') }}, {{ count(subscriptions().length, 'subscription', 'subscriptions') }}</span>
            </div>
          </div>

          @if (history.length > 1) {
            <section class="trend-section">
              <h3>Message trend, last {{ history.length }} polls</h3>
              <div class="trends">
                @for (t of trends; track t.label) {
                  <figure class="trend">
                    <figcaption>
                      <span class="trend-label">{{ t.label }}</span>
                      <span class="trend-range">{{ t.first | number }} to {{ t.last | number }}</span>
                    </figcaption>
                    <svg role="img" [attr.aria-label]="t.label + ' messages over the last ' + history.length + ' polls, ' + (t.direction === 'steady' ? 'steady at ' + (t.last | number) : t.direction + ' from ' + (t.first | number) + ' to ' + (t.last | number))"
                         viewBox="0 0 380 96" preserveAspectRatio="none" class="spark">
                      <path class="grid" d="M0 8H380M0 48H380M0 88H380" vector-effect="non-scaling-stroke"></path>
                      <polygon class="area" [attr.points]="'0,96 ' + t.points + ' 380,96'"></polygon>
                      <polyline class="line" [attr.points]="t.points" vector-effect="non-scaling-stroke"></polyline>
                    </svg>
                    <div class="trend-times"><span>{{ history[0].timestamp }}</span><span>{{ history[history.length - 1].timestamp }}</span></div>
                  </figure>
                }
              </div>
            </section>
          }

          @if (queues().length > 0) {
            <section class="table-section">
              <h3>Queues ({{ queues().length }})</h3>
              <table mat-table [dataSource]="queues()" [trackBy]="queueKey" aria-label="Queues">
                <ng-container matColumnDef="name">
                  <th mat-header-cell *matHeaderCellDef>Name</th>
                  <td mat-cell *matCellDef="let q" class="name"><span>{{ q.name }}</span></td>
                </ng-container>
                <ng-container matColumnDef="active">
                  <th mat-header-cell *matHeaderCellDef class="number">Active</th>
                  <td mat-cell *matCellDef="let q" class="number">{{ q.activeMessageCount | number }}</td>
                </ng-container>
                <ng-container matColumnDef="deadLetter">
                  <th mat-header-cell *matHeaderCellDef class="number">Dead-letter</th>
                  <td mat-cell *matCellDef="let q" class="number">
                    @if (q.deadLetterMessageCount > 0) {
                      <span class="dead-letter"><mat-icon aria-hidden="true">warning</mat-icon>{{ q.deadLetterMessageCount | number }}</span>
                    } @else {
                      {{ q.deadLetterMessageCount | number }}
                    }
                  </td>
                </ng-container>
                <ng-container matColumnDef="transfer">
                  <th mat-header-cell *matHeaderCellDef class="number">Transfer</th>
                  <td mat-cell *matCellDef="let q" class="number">{{ q.transferMessageCount | number }}</td>
                </ng-container>
                <ng-container matColumnDef="scheduled">
                  <th mat-header-cell *matHeaderCellDef class="number">Scheduled</th>
                  <td mat-cell *matCellDef="let q" class="number" [class.muted]="q.scheduledMessageCount === null">{{ q.scheduledMessageCount === null ? 'Not counted' : (q.scheduledMessageCount | number) }}</td>
                </ng-container>
                <ng-container matColumnDef="change">
                  <th mat-header-cell *matHeaderCellDef class="number">Change</th>
                  <td mat-cell *matCellDef="let q" class="number" [class.muted]="!queueDeltas[q.name]">{{ signed(queueDeltas[q.name] ?? 0) }}</td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="queueColumns"></tr>
                <tr mat-row *matRowDef="let q; columns: queueColumns"></tr>
              </table>
            </section>
          }

          @if (subscriptions().length > 0) {
            <section class="table-section">
              <h3>Subscriptions ({{ subscriptions().length }})</h3>
              <table mat-table [dataSource]="subscriptions()" [trackBy]="subscriptionKey" aria-label="Subscriptions">
                <ng-container matColumnDef="name">
                  <th mat-header-cell *matHeaderCellDef>Topic / Subscription</th>
                  <td mat-cell *matCellDef="let s" class="name"><span class="topic-name">{{ s.topicName }}</span><span class="separator"> / </span><span>{{ s.name }}</span></td>
                </ng-container>
                <ng-container matColumnDef="active">
                  <th mat-header-cell *matHeaderCellDef class="number">Active</th>
                  <td mat-cell *matCellDef="let s" class="number">{{ s.activeMessageCount | number }}</td>
                </ng-container>
                <ng-container matColumnDef="deadLetter">
                  <th mat-header-cell *matHeaderCellDef class="number">Dead-letter</th>
                  <td mat-cell *matCellDef="let s" class="number">
                    @if (s.deadLetterMessageCount > 0) {
                      <span class="dead-letter"><mat-icon aria-hidden="true">warning</mat-icon>{{ s.deadLetterMessageCount | number }}</span>
                    } @else {
                      {{ s.deadLetterMessageCount | number }}
                    }
                  </td>
                </ng-container>
                <ng-container matColumnDef="transfer">
                  <th mat-header-cell *matHeaderCellDef class="number">Transfer</th>
                  <td mat-cell *matCellDef="let s" class="number">{{ s.transferMessageCount | number }}</td>
                </ng-container>
                <ng-container matColumnDef="change">
                  <th mat-header-cell *matHeaderCellDef class="number">Change</th>
                  <td mat-cell *matCellDef="let s" class="number" [class.muted]="!subscriptionDeltas[subscriptionKey(0, s)]">{{ signed(subscriptionDeltas[subscriptionKey(0, s)] ?? 0) }}</td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="subscriptionColumns"></tr>
                <tr mat-row *matRowDef="let s; columns: subscriptionColumns"></tr>
              </table>
            </section>
          }

          <p class="footnote">Change is the difference in active messages since the last poll.</p>
        </div>
          </mat-tab>
          <mat-tab label="All entities">
            <ng-template matTabContent>
              <app-monitoring-counts class="counts-tab" [snapshot]="status()!.snapshot!" [(refreshSeconds)]="refreshSeconds"></app-monitoring-counts>
            </ng-template>
          </mat-tab>
          @if (isAzure) {
            <mat-tab label="Azure Monitor">
              <ng-template matTabContent>
                <app-monitoring-metrics></app-monitoring-metrics>
              </ng-template>
            </mat-tab>
          }
        </mat-tab-group>
      }
    </div>
  `,
  styleUrl: './monitoring.component.scss'
})
export class MonitoringComponent implements OnInit, OnDestroy {
  private monitoringService = inject(MonitoringService);
  private connectionService = inject(ConnectionService);
  private destroy$ = new Subject<void>();

  loading = signal(false);
  error = signal<string | null>(null);
  status = signal<MonitoringStatus | null>(null);

  queues = signal<MonitoringEntity[]>([]);
  subscriptions = signal<MonitoringSubscription[]>([]);

  totalActive = signal(0);
  totalDeadLetter = signal(0);
  totalTransfer = signal(0);
  totalEntities = signal(0);

  deltaActive = signal(0);
  deltaDeadLetter = signal(0);

  /** The tab shown: 0 the Overview, 1 All entities. */
  readonly tab = signal(0);
  /** How often the screen reads the snapshot, chosen on All entities; never below 30 seconds. */
  readonly refreshSeconds = signal(REFRESH_PERIODS[0].seconds);
  readonly periodLabel = computed(() => REFRESH_PERIODS.find(p => p.seconds === this.refreshSeconds())?.label ?? `${this.refreshSeconds()} seconds`);
  /** Refresh and the last-update note show only over counts that were read. */
  readonly hasData = computed(() => !this.error() && !!this.status()?.snapshot && this.totalEntities() > 0);
  private readonly refreshPeriod$ = toObservable(this.refreshSeconds);

  queueDeltas: Partial<Record<string, number>> = {};
  subscriptionDeltas: Partial<Record<string, number>> = {};

  history: SnapshotHistory[] = [];
  private previousSnapshot: MonitoringSnapshot | null = null;
  private lastProcessedTimestamp: string | null = null;

  trends: Trend[] = [];
  readonly queueColumns = ['name', 'active', 'deadLetter', 'transfer', 'scheduled', 'change'];
  readonly subscriptionColumns = ['name', 'active', 'deadLetter', 'transfer', 'change'];
  readonly queueKey = (_: number, q: MonitoringEntity) => q.name;
  readonly subscriptionKey = (_: number, s: MonitoringSubscription) => `${s.topicName}/${s.name}`;

  signed(value: number): string {
    const grouped = value.toLocaleString('en-US');
    return value > 0 ? `+${grouped}` : grouped;
  }

  count(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  get isConnected(): boolean {
    return this.connectionService.isConnected;
  }

  /** Azure Monitor metrics exist for an Azure Service Bus namespace only. */
  get isAzure(): boolean {
    return this.connectionService.currentProviderType === ProviderType.AzureServiceBus;
  }

  /** The namespace or host of the connection the counts are read from. */
  get host(): string | undefined {
    return this.connectionService.currentTarget;
  }

  ngOnInit() {
    if (this.isConnected) {
      this.load(true);
    }

    this.connectionService.connectionStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        if (status.connected) {
          this.status.set(null);
          this.error.set(null);
          this.load(true);
        }
      });

    this.refreshPeriod$
      .pipe(
        switchMap(seconds => interval(Math.max(REFRESH_PERIODS[0].seconds, seconds) * 1000)),
        filter(() => this.connectionService.isConnected),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.fetchSnapshot();
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  fetchSnapshot() {
    this.load(false);
  }

  /**
   * Reads the API's status, and with it the recent history when the screen starts or the connection
   * changes. An error stays on screen until a read succeeds, so the next poll does not hide it.
   */
  private load(withHistory: boolean) {
    this.loading.set(true);

    forkJoin({
      history: withHistory ? this.monitoringService.getHistory(20) : of(null),
      status: this.monitoringService.getSnapshot()
    })
      .pipe(timeout(REQUEST_TIMEOUT_MS), takeUntil(this.destroy$))
      .subscribe({
        next: ({ history, status }) => {
          if (history) {
            this.history = [];
            this.previousSnapshot = null;
            this.lastProcessedTimestamp = null;
            for (const snapshot of history) {
              this.processSnapshot(snapshot);
            }
          }
          if (status.snapshot && status.snapshot.timestamp !== this.lastProcessedTimestamp) {
            this.processSnapshot(status.snapshot);
          }
          this.status.set(status);
          this.error.set(null);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(this.failure(err));
          this.loading.set(false);
        }
      });
  }

  /** What went wrong with the request, in one sentence that names the namespace. */
  private failure(err: unknown): string {
    const target = `The request to ${this.host ?? 'the broker'}`;
    if (err instanceof TimeoutError) {
      return `${target} timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`;
    }
    const message = err instanceof HttpErrorResponse && err.status ? err.error?.message : null;
    if (typeof message === 'string' && message.trim()) {
      const said = message.trim();
      return `${target} failed: ${/[.!?]$/.test(said) ? said : said + '.'}`;
    }
    return `${target} got no answer from the API.`;
  }

  private processSnapshot(snapshot: MonitoringSnapshot) {
    this.queues.set(snapshot.queues);
    this.subscriptions.set(snapshot.subscriptions);

    const allEntities = [...snapshot.queues, ...snapshot.subscriptions];
    const active = allEntities.reduce((sum, e) => sum + e.activeMessageCount, 0);
    const deadLetter = allEntities.reduce((sum, e) => sum + e.deadLetterMessageCount, 0);
    const transfer = allEntities.reduce((sum, e) => sum + e.transferMessageCount, 0);

    this.totalActive.set(active);
    this.totalDeadLetter.set(deadLetter);
    this.totalTransfer.set(transfer);
    this.totalEntities.set(allEntities.length);

    if (this.previousSnapshot) {
      const prevAllEntities = [...this.previousSnapshot.queues, ...this.previousSnapshot.subscriptions];
      const prevActive = prevAllEntities.reduce((sum, e) => sum + e.activeMessageCount, 0);
      const prevDeadLetter = prevAllEntities.reduce((sum, e) => sum + e.deadLetterMessageCount, 0);

      this.deltaActive.set(active - prevActive);
      this.deltaDeadLetter.set(deadLetter - prevDeadLetter);

      const previousQueues = new Map(this.previousSnapshot.queues.map(q => [q.name, q.activeMessageCount]));
      this.queueDeltas = {};
      for (const q of snapshot.queues) {
        const prev = previousQueues.get(q.name);
        if (prev !== undefined) {
          this.queueDeltas[q.name] = q.activeMessageCount - prev;
        }
      }

      const previousSubscriptions = new Map(this.previousSnapshot.subscriptions.map(s => [`${s.topicName}/${s.name}`, s.activeMessageCount]));
      this.subscriptionDeltas = {};
      for (const s of snapshot.subscriptions) {
        const key = `${s.topicName}/${s.name}`;
        const prev = previousSubscriptions.get(key);
        if (prev !== undefined) {
          this.subscriptionDeltas[key] = s.activeMessageCount - prev;
        }
      }
    }

    this.previousSnapshot = snapshot;
    this.lastProcessedTimestamp = snapshot.timestamp;

    const time = new Date(snapshot.timestamp);
    this.history.push({
      timestamp: time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      totalActive: active,
      totalDeadLetter: deadLetter
    });

    if (this.history.length > 20) {
      this.history = this.history.slice(-20);
    }

    this.updateChart();
  }

  private updateChart() {
    this.trends = [
      trend('Active', this.history.map(h => h.totalActive)),
      trend('Dead-letter', this.history.map(h => h.totalDeadLetter))
    ];
  }
}
