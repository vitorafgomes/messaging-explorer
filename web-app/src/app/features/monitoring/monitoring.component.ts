import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, forkJoin, interval, of } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MonitoringService, ConnectionService } from '../../core/services';
import { MonitoringSnapshot, MonitoringEntity, MonitoringStatus, MonitoringSubscription } from '../../core/models';
import { MonitoringCountsComponent } from './monitoring-counts.component';

interface Trend {
  label: string;
  first: number;
  last: number;
  /** Polyline points in a 380 by 96 box, the lowest value at y 88 and the highest at y 8. */
  points: string;
}

function trend(label: string, values: number[]): Trend {
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  const step = 380 / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(88 - (span ? (v - min) / span : 0) * 80).toFixed(1)}`).join(' ');
  return { label, first: values[0] ?? 0, last: values[values.length - 1] ?? 0, points };
}

interface SnapshotHistory {
  timestamp: string;
  totalActive: number;
  totalDeadLetter: number;
}

@Component({
  selector: 'app-monitoring',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTableModule, MatTabsModule, MonitoringCountsComponent],
  template: `
    <div class="monitoring-container">
      <div class="monitoring-header">
        <div class="header-left">
          <mat-icon class="header-icon" aria-hidden="true">monitoring</mat-icon>
          <h2>Monitoring</h2>
        </div>
        <div class="header-right">
          @if (status(); as s) {
            <span class="last-update" aria-live="polite">
              @if (s.snapshot) {
                Last update {{ s.snapshot.timestamp | date:'HH:mm:ss' }}.
              }
              The API reads the broker every {{ s.pollIntervalSeconds }} seconds.
            </span>
          }
          <button mat-stroked-button type="button" (click)="fetchSnapshot()" [disabled]="loading() || !isConnected">
            <mat-icon aria-hidden="true">refresh</mat-icon>
            Refresh
          </button>
        </div>
      </div>

      @if (!isConnected) {
        <div class="monitoring-state">
          <mat-icon class="state-icon" aria-hidden="true">cloud_off</mat-icon>
          <h3>Not connected</h3>
          <p>Connect to a broker to see its counts.</p>
        </div>
      } @else if (error()) {
        <section class="monitoring-error" role="alert" aria-label="Error">
          <mat-icon aria-hidden="true">error</mat-icon>
          <div class="grow">
            <h3>Could not load the monitoring data</h3>
            <p>{{ error() }} Nothing is shown because nothing was read, and nothing on the broker was changed.</p>
            <button mat-stroked-button type="button" (click)="fetchSnapshot()">Retry</button>
          </div>
        </section>
      } @else if (!status()) {
        <div class="monitoring-state" role="status">
          <mat-progress-spinner mode="indeterminate" diameter="32" aria-label="Loading"></mat-progress-spinner>
          <span>Loading the monitoring data</span>
        </div>
      } @else if (!status()!.snapshot) {
        @if (status()!.lastPollFailedAt) {
          <section class="monitoring-error" role="alert" aria-label="Error">
            <mat-icon aria-hidden="true">error</mat-icon>
            <div class="grow">
              <h3>Could not read the counts from the broker</h3>
              <p>The API's poll failed at {{ status()!.lastPollFailedAt | date:'HH:mm:ss' }}. Nothing is shown because nothing was read, and nothing on the broker was changed. The API tries again every {{ status()!.pollIntervalSeconds }} seconds.</p>
              <button mat-stroked-button type="button" (click)="fetchSnapshot()">Retry</button>
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
          <mat-icon class="state-icon" aria-hidden="true">inbox</mat-icon>
          <h3>Nothing to monitor in this namespace</h3>
          <p>The broker answered and holds no queue and no subscription. Counts appear here once an entity exists.</p>
        </div>
      } @else {
        @if (status()!.lastPollFailedAt) {
          <p class="stale" role="alert">The API's last poll failed at {{ status()!.lastPollFailedAt | date:'HH:mm:ss' }}. These counts are from {{ status()!.snapshot!.timestamp | date:'HH:mm:ss' }}.</p>
        }
        <mat-tab-group mat-stretch-tabs="false" animationDuration="0ms">
          <mat-tab label="Overview">
        <div class="overview">
          <div class="summary-cards">
            <div class="summary-card">
              <span class="card-label">Active</span>
              <span class="card-value">{{ totalActive() }}</span>
              @if (deltaActive() !== 0) {
                <span class="card-note">{{ signed(deltaActive()) }} since the last poll</span>
              }
            </div>
            <div class="summary-card" [class.attention]="totalDeadLetter() > 0">
              <span class="card-label">
                @if (totalDeadLetter() > 0) {
                  <mat-icon fontIcon="warning" aria-hidden="true"></mat-icon>
                }
                Dead-letter
              </span>
              <span class="card-value">{{ totalDeadLetter() }}</span>
              @if (deltaDeadLetter() !== 0) {
                <span class="card-note">{{ signed(deltaDeadLetter()) }} since the last poll</span>
              }
            </div>
            <div class="summary-card">
              <span class="card-label">Transfer</span>
              <span class="card-value">{{ totalTransfer() }}</span>
              <span class="card-note">On their way to another entity</span>
            </div>
            <div class="summary-card">
              <span class="card-label">Monitored entities</span>
              <span class="card-value">{{ totalEntities() }}</span>
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
                      <span class="trend-range">{{ t.first }} to {{ t.last }}</span>
                    </figcaption>
                    <svg role="img" [attr.aria-label]="t.label + ' messages over the last ' + history.length + ' polls, from ' + t.first + ' to ' + t.last"
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
                  <td mat-cell *matCellDef="let q" class="number">{{ q.activeMessageCount }}</td>
                </ng-container>
                <ng-container matColumnDef="deadLetter">
                  <th mat-header-cell *matHeaderCellDef class="number">Dead-letter</th>
                  <td mat-cell *matCellDef="let q" class="number">
                    @if (q.deadLetterMessageCount > 0) {
                      <span class="dead-letter"><mat-icon fontIcon="warning" aria-hidden="true"></mat-icon>{{ q.deadLetterMessageCount }}</span>
                    } @else {
                      {{ q.deadLetterMessageCount }}
                    }
                  </td>
                </ng-container>
                <ng-container matColumnDef="transfer">
                  <th mat-header-cell *matHeaderCellDef class="number">Transfer</th>
                  <td mat-cell *matCellDef="let q" class="number">{{ q.transferMessageCount }}</td>
                </ng-container>
                <ng-container matColumnDef="scheduled">
                  <th mat-header-cell *matHeaderCellDef class="number">Scheduled</th>
                  <td mat-cell *matCellDef="let q" class="number" [class.muted]="q.scheduledMessageCount === null">{{ q.scheduledMessageCount ?? 'Not counted' }}</td>
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
                  <td mat-cell *matCellDef="let s" class="name"><span class="topic-name">{{ s.topicName }}</span><span class="separator">/</span><span>{{ s.name }}</span></td>
                </ng-container>
                <ng-container matColumnDef="active">
                  <th mat-header-cell *matHeaderCellDef class="number">Active</th>
                  <td mat-cell *matCellDef="let s" class="number">{{ s.activeMessageCount }}</td>
                </ng-container>
                <ng-container matColumnDef="deadLetter">
                  <th mat-header-cell *matHeaderCellDef class="number">Dead-letter</th>
                  <td mat-cell *matCellDef="let s" class="number">
                    @if (s.deadLetterMessageCount > 0) {
                      <span class="dead-letter"><mat-icon fontIcon="warning" aria-hidden="true"></mat-icon>{{ s.deadLetterMessageCount }}</span>
                    } @else {
                      {{ s.deadLetterMessageCount }}
                    }
                  </td>
                </ng-container>
                <ng-container matColumnDef="transfer">
                  <th mat-header-cell *matHeaderCellDef class="number">Transfer</th>
                  <td mat-cell *matCellDef="let s" class="number">{{ s.transferMessageCount }}</td>
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
              <app-monitoring-counts class="counts-tab" [snapshot]="status()!.snapshot!"></app-monitoring-counts>
            </ng-template>
          </mat-tab>
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
    return value > 0 ? `+${value}` : `${value}`;
  }

  count(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  get isConnected(): boolean {
    return this.connectionService.isConnected;
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
          this.load(true);
        }
      });

    interval(30000)
      .pipe(
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

  /** Reads the API's status, and with it the recent history when the screen starts or the connection changes. */
  private load(withHistory: boolean) {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      history: withHistory ? this.monitoringService.getHistory(20) : of(null),
      status: this.monitoringService.getSnapshot()
    })
      .pipe(takeUntil(this.destroy$))
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
          this.loading.set(false);
        },
        error: () => {
          this.error.set('The API did not answer the request for the monitoring data.');
          this.loading.set(false);
        }
      });
  }

  private processSnapshot(snapshot: MonitoringSnapshot) {
    this.queues.set(snapshot.queues);
    this.subscriptions.set(snapshot.subscriptions);

    // Calculate totals
    const allEntities = [...snapshot.queues, ...snapshot.subscriptions];
    const active = allEntities.reduce((sum, e) => sum + e.activeMessageCount, 0);
    const deadLetter = allEntities.reduce((sum, e) => sum + e.deadLetterMessageCount, 0);
    const transfer = allEntities.reduce((sum, e) => sum + e.transferMessageCount, 0);

    this.totalActive.set(active);
    this.totalDeadLetter.set(deadLetter);
    this.totalTransfer.set(transfer);
    this.totalEntities.set(allEntities.length);

    // Calculate deltas from previous snapshot
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

    // Update history (keep last 20 snapshots = ~10 min)
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
