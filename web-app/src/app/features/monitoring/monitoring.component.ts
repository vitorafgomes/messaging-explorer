import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, interval } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { NgApexchartsModule } from 'ng-apexcharts';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexYAxis,
  ApexStroke,
  ApexTooltip,
  ApexLegend,
  ApexDataLabels,
  ApexGrid,
  ApexFill
} from 'ng-apexcharts';
import { MonitoringService, ConnectionService } from '../../core/services';
import { MonitoringSnapshot, MonitoringEntity, MonitoringSubscription } from '../../core/models';

interface SnapshotHistory {
  timestamp: string;
  totalActive: number;
  totalDeadLetter: number;
}

@Component({
  selector: 'app-monitoring',
  standalone: true,
  imports: [CommonModule, NgApexchartsModule],
  template: `
    <div class="monitoring-container">
      <div class="monitoring-header">
        <div class="header-left">
          <i class="fa fa-chart-line header-icon"></i>
          <h2>Monitoring Dashboard</h2>
        </div>
        <div class="header-right">
          <span class="last-update" *ngIf="lastUpdate()">
            <i class="fa fa-clock-o"></i>
            Last update: {{ lastUpdate() | date:'HH:mm:ss' }}
          </span>
          <button class="btn btn-sm btn-outline-primary"
                  (click)="fetchSnapshot()"
                  [disabled]="loading() || !isConnected">
            <i class="fa-solid fa-arrows-rotate" [class.fa-spin]="loading()"></i>
            Refresh
          </button>
        </div>
      </div>

      @if (!isConnected) {
        <div class="monitoring-empty">
          <i class="fa fa-cloud fa-4x"></i>
          <h3>Not Connected</h3>
          <p>Connect to a Service Bus to view monitoring data</p>
        </div>
      } @else if (loading() && !lastUpdate()) {
        <div class="monitoring-loading">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
          <span>Loading monitoring data...</span>
        </div>
      } @else if (error()) {
        <div class="monitoring-empty">
          <i class="fa fa-exclamation-triangle fa-4x text-warning"></i>
          <h3>Error loading data</h3>
          <p>{{ error() }}</p>
          <button class="btn btn-primary mt-2" (click)="fetchSnapshot()">Retry</button>
        </div>
      } @else {
        <!-- Summary Cards -->
        <div class="summary-cards">
          <div class="summary-card card-active">
            <div class="card-icon">
              <i class="fa fa-envelope"></i>
            </div>
            <div class="card-content">
              <span class="card-value">{{ totalActive() }}</span>
              <span class="card-label">Active Messages</span>
            </div>
            @if (deltaActive() !== 0) {
              <span class="card-delta" [class.positive]="deltaActive() > 0" [class.negative]="deltaActive() < 0">
                {{ deltaActive() > 0 ? '+' : '' }}{{ deltaActive() }}
              </span>
            }
          </div>

          <div class="summary-card card-deadletter">
            <div class="card-icon">
              <i class="fa fa-exclamation-circle"></i>
            </div>
            <div class="card-content">
              <span class="card-value">{{ totalDeadLetter() }}</span>
              <span class="card-label">Dead Letter Messages</span>
            </div>
            @if (deltaDeadLetter() !== 0) {
              <span class="card-delta" [class.positive]="deltaDeadLetter() > 0" [class.negative]="deltaDeadLetter() < 0">
                {{ deltaDeadLetter() > 0 ? '+' : '' }}{{ deltaDeadLetter() }}
              </span>
            }
          </div>

          <div class="summary-card card-transfer">
            <div class="card-icon">
              <i class="fa fa-exchange"></i>
            </div>
            <div class="card-content">
              <span class="card-value">{{ totalTransfer() }}</span>
              <span class="card-label">Transfer Messages</span>
            </div>
          </div>

          <div class="summary-card card-entities">
            <div class="card-icon">
              <i class="fa fa-sitemap"></i>
            </div>
            <div class="card-content">
              <span class="card-value">{{ totalEntities() }}</span>
              <span class="card-label">Monitored Entities</span>
            </div>
          </div>
        </div>

        <!-- Chart -->
        @if (history.length > 1) {
          <div class="chart-section">
            <div class="section-header">
              <i class="fa fa-area-chart"></i>
              <span>Message Trend (last {{ history.length }} polls)</span>
            </div>
            <div class="chart-wrapper">
              <apx-chart
                [series]="chartSeries"
                [chart]="chartOptions"
                [xaxis]="chartXAxis"
                [yaxis]="chartYAxis"
                [stroke]="chartStroke"
                [tooltip]="chartTooltip"
                [legend]="chartLegend"
                [dataLabels]="chartDataLabels"
                [grid]="chartGrid"
                [fill]="chartFill"
                [colors]="['#2196F3', '#f44336']"
              ></apx-chart>
            </div>
          </div>
        }

        <!-- Queues Table -->
        @if (queues().length > 0) {
          <div class="table-section">
            <div class="section-header">
              <i class="fa fa-inbox"></i>
              <span>Queues ({{ queues().length }})</span>
            </div>
            <div class="table-responsive">
              <table class="table table-hover">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th class="text-end">Active</th>
                    <th class="text-end">Dead Letter</th>
                    <th class="text-end">Transfer</th>
                    <th class="text-end">Scheduled</th>
                    <th class="text-end">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  @for (q of queues(); track q.name) {
                    <tr [class.has-deadletter]="q.deadLetterMessageCount > 0">
                      <td>
                        <i class="fa fa-inbox me-2 text-success"></i>
                        {{ q.name }}
                      </td>
                      <td class="text-end">
                        <span class="count-badge" [class.count-nonzero]="q.activeMessageCount > 0">
                          {{ q.activeMessageCount }}
                        </span>
                      </td>
                      <td class="text-end">
                        <span class="count-badge count-deadletter" [class.count-nonzero]="q.deadLetterMessageCount > 0">
                          {{ q.deadLetterMessageCount }}
                        </span>
                      </td>
                      <td class="text-end">{{ q.transferMessageCount }}</td>
                      <td class="text-end">{{ q.scheduledMessageCount || 0 }}</td>
                      <td class="text-end">
                        @if (queueDeltas[q.name] !== undefined && queueDeltas[q.name] !== 0) {
                          <span class="delta-badge" [class.positive]="queueDeltas[q.name] > 0" [class.negative]="queueDeltas[q.name] < 0">
                            {{ queueDeltas[q.name] > 0 ? '+' : '' }}{{ queueDeltas[q.name] }}
                          </span>
                        } @else {
                          <span class="delta-badge neutral">0</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }

        <!-- Subscriptions Table -->
        @if (subscriptions().length > 0) {
          <div class="table-section">
            <div class="section-header">
              <i class="fa-solid fa-bell"></i>
              <span>Subscriptions ({{ subscriptions().length }})</span>
            </div>
            <div class="table-responsive">
              <table class="table table-hover">
                <thead>
                  <tr>
                    <th>Topic / Subscription</th>
                    <th class="text-end">Active</th>
                    <th class="text-end">Dead Letter</th>
                    <th class="text-end">Transfer</th>
                    <th class="text-end">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of subscriptions(); track s.topicName + '/' + s.name) {
                    <tr [class.has-deadletter]="s.deadLetterMessageCount > 0">
                      <td>
                        <i class="fa-solid fa-bell me-2 text-primary"></i>
                        <span class="topic-name">{{ s.topicName }}</span>
                        <span class="separator">/</span>
                        <span class="sub-name">{{ s.name }}</span>
                      </td>
                      <td class="text-end">
                        <span class="count-badge" [class.count-nonzero]="s.activeMessageCount > 0">
                          {{ s.activeMessageCount }}
                        </span>
                      </td>
                      <td class="text-end">
                        <span class="count-badge count-deadletter" [class.count-nonzero]="s.deadLetterMessageCount > 0">
                          {{ s.deadLetterMessageCount }}
                        </span>
                      </td>
                      <td class="text-end">{{ s.transferMessageCount }}</td>
                      <td class="text-end">
                        @if (subscriptionDeltas[s.topicName + '/' + s.name] !== undefined && subscriptionDeltas[s.topicName + '/' + s.name] !== 0) {
                          <span class="delta-badge"
                                [class.positive]="subscriptionDeltas[s.topicName + '/' + s.name] > 0"
                                [class.negative]="subscriptionDeltas[s.topicName + '/' + s.name] < 0">
                            {{ subscriptionDeltas[s.topicName + '/' + s.name] > 0 ? '+' : '' }}{{ subscriptionDeltas[s.topicName + '/' + s.name] }}
                          </span>
                        } @else {
                          <span class="delta-badge neutral">0</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .monitoring-container {
      padding: 20px;
      max-width: 1400px;
      margin: 0 auto;
      overflow-y: auto;
      height: 100%;
    }

    .monitoring-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;

      h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: var(--bs-body-color);
      }
    }

    .header-icon {
      font-size: 24px;
      color: var(--bs-primary);
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .last-update {
      font-size: 12px;
      color: var(--bs-secondary-color);
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .monitoring-empty, .monitoring-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 80px 20px;
      color: var(--bs-secondary-color);
      gap: 12px;
      text-align: center;

      h3 {
        margin: 8px 0 0;
        color: var(--bs-body-color);
      }

      p {
        color: var(--bs-secondary-color);
      }
    }

    /* Summary Cards */
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .summary-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      border-radius: 8px;
      background: var(--bs-secondary-bg);
      border: 1px solid var(--bs-border-color);
      position: relative;
      overflow: hidden;
    }

    .card-icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 18px;
    }

    .card-active .card-icon {
      background: rgba(33, 150, 243, 0.15);
      color: #2196F3;
    }

    .card-deadletter .card-icon {
      background: rgba(244, 67, 54, 0.15);
      color: #f44336;
    }

    .card-transfer .card-icon {
      background: rgba(255, 152, 0, 0.15);
      color: #ff9800;
    }

    .card-entities .card-icon {
      background: rgba(76, 175, 80, 0.15);
      color: #4caf50;
    }

    .card-content {
      display: flex;
      flex-direction: column;
      flex: 1;
    }

    .card-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--bs-body-color);
      line-height: 1.2;
    }

    .card-label {
      font-size: 12px;
      color: var(--bs-secondary-color);
      margin-top: 2px;
    }

    .card-delta {
      position: absolute;
      top: 12px;
      right: 14px;
      font-size: 12px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 12px;

      &.positive {
        background: rgba(244, 67, 54, 0.1);
        color: #f44336;
      }

      &.negative {
        background: rgba(76, 175, 80, 0.1);
        color: #4caf50;
      }
    }

    /* Chart Section */
    .chart-section {
      margin-bottom: 24px;
      background: var(--bs-secondary-bg);
      border: 1px solid var(--bs-border-color);
      border-radius: 8px;
      overflow: hidden;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      font-weight: 600;
      font-size: 14px;
      color: var(--bs-body-color);
      border-bottom: 1px solid var(--bs-border-color);

      i {
        color: var(--bs-secondary-color);
      }
    }

    .chart-wrapper {
      padding: 16px;
    }

    /* Table Section */
    .table-section {
      margin-bottom: 24px;
      background: var(--bs-secondary-bg);
      border: 1px solid var(--bs-border-color);
      border-radius: 8px;
      overflow: hidden;
    }

    .table {
      margin: 0;
      font-size: 13px;

      th {
        font-weight: 600;
        font-size: 12px;
        text-transform: uppercase;
        color: var(--bs-secondary-color);
        border-bottom: 2px solid var(--bs-border-color);
        padding: 10px 16px;
      }

      td {
        padding: 10px 16px;
        vertical-align: middle;
        color: var(--bs-body-color);
        border-bottom: 1px solid var(--bs-border-color);
      }

      tr:last-child td {
        border-bottom: none;
      }

      tr.has-deadletter {
        background: rgba(244, 67, 54, 0.03);
      }

      tr:hover {
        background: rgba(var(--bs-primary-rgb), 0.04);
      }
    }

    .count-badge {
      font-weight: 500;

      &.count-nonzero {
        font-weight: 700;
      }

      &.count-deadletter.count-nonzero {
        color: #f44336;
      }
    }

    .delta-badge {
      font-size: 12px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;

      &.positive {
        background: rgba(244, 67, 54, 0.1);
        color: #f44336;
      }

      &.negative {
        background: rgba(76, 175, 80, 0.1);
        color: #4caf50;
      }

      &.neutral {
        color: var(--bs-secondary-color);
      }
    }

    .topic-name {
      color: var(--bs-secondary-color);
    }

    .separator {
      color: var(--bs-secondary-color);
      margin: 0 2px;
    }

    .sub-name {
      font-weight: 500;
    }
  `]
})
export class MonitoringComponent implements OnInit, OnDestroy {
  private monitoringService = inject(MonitoringService);
  private connectionService = inject(ConnectionService);
  private destroy$ = new Subject<void>();

  loading = signal(false);
  error = signal<string | null>(null);
  lastUpdate = signal<Date | null>(null);

  queues = signal<MonitoringEntity[]>([]);
  subscriptions = signal<MonitoringSubscription[]>([]);

  totalActive = signal(0);
  totalDeadLetter = signal(0);
  totalTransfer = signal(0);
  totalEntities = signal(0);

  deltaActive = signal(0);
  deltaDeadLetter = signal(0);

  queueDeltas: Record<string, number> = {};
  subscriptionDeltas: Record<string, number> = {};

  history: SnapshotHistory[] = [];
  private previousSnapshot: MonitoringSnapshot | null = null;
  private lastProcessedTimestamp: string | null = null;

  // Chart configuration
  chartSeries: ApexAxisChartSeries = [];
  chartOptions: ApexChart = {
    type: 'area',
    height: 250,
    toolbar: { show: false },
    zoom: { enabled: false },
    background: 'transparent'
  };
  chartXAxis: ApexXAxis = {
    type: 'category',
    categories: [],
    labels: { style: { fontSize: '11px', colors: '#999' } }
  };
  chartYAxis: ApexYAxis = {
    labels: { style: { fontSize: '11px', colors: '#999' } },
    min: 0
  };
  chartStroke: ApexStroke = {
    curve: 'smooth',
    width: 2
  };
  chartTooltip: ApexTooltip = {
    theme: 'dark'
  };
  chartLegend: ApexLegend = {
    position: 'top',
    horizontalAlign: 'right',
    labels: { colors: '#999' }
  };
  chartDataLabels: ApexDataLabels = {
    enabled: false
  };
  chartGrid: ApexGrid = {
    borderColor: 'rgba(150,150,150,0.15)',
    strokeDashArray: 4
  };
  chartFill: ApexFill = {
    type: 'gradient',
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.3,
      opacityTo: 0.05,
      stops: [0, 90, 100]
    }
  };

  get isConnected(): boolean {
    return this.connectionService.isConnected;
  }

  ngOnInit() {
    if (this.isConnected) {
      this.loadHistory();
    }

    this.connectionService.connectionStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        if (status.connected) {
          this.history = [];
          this.previousSnapshot = null;
          this.lastProcessedTimestamp = null;
          this.loadHistory();
        }
      });

    // Auto-poll every 30 seconds
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
    this.loading.set(true);
    this.error.set(null);

    this.monitoringService.getSnapshot()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (snapshot) => {
          // Skip empty snapshots (store not yet populated) and duplicates
          if (snapshot.queues.length === 0 && snapshot.subscriptions.length === 0) {
            this.loading.set(false);
            return;
          }
          if (snapshot.timestamp === this.lastProcessedTimestamp) {
            this.loading.set(false);
            return;
          }
          this.processSnapshot(snapshot);
          this.loading.set(false);
          this.lastUpdate.set(new Date());
        },
        error: (err) => {
          this.error.set(err?.error?.message || err?.message || 'Failed to load monitoring data');
          this.loading.set(false);
        }
      });
  }

  private loadHistory() {
    this.loading.set(true);
    this.error.set(null);
    this.history = [];
    this.previousSnapshot = null;
    this.lastProcessedTimestamp = null;

    this.monitoringService.getHistory(20)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (snapshots) => {
          for (const snapshot of snapshots) {
            this.processSnapshot(snapshot);
          }
          this.loading.set(false);
          if (snapshots.length > 0) {
            this.lastUpdate.set(new Date(snapshots[snapshots.length - 1].timestamp));
          }
        },
        error: (err) => {
          this.error.set(err?.error?.message || err?.message || 'Failed to load monitoring history');
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

      // Per-queue deltas
      this.queueDeltas = {};
      for (const q of snapshot.queues) {
        const prev = this.previousSnapshot.queues.find(pq => pq.name === q.name);
        if (prev) {
          this.queueDeltas[q.name] = q.activeMessageCount - prev.activeMessageCount;
        }
      }

      // Per-subscription deltas
      this.subscriptionDeltas = {};
      for (const s of snapshot.subscriptions) {
        const key = `${s.topicName}/${s.name}`;
        const prev = this.previousSnapshot.subscriptions.find(
          ps => ps.topicName === s.topicName && ps.name === s.name
        );
        if (prev) {
          this.subscriptionDeltas[key] = s.activeMessageCount - prev.activeMessageCount;
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
    this.chartSeries = [
      {
        name: 'Active Messages',
        data: this.history.map(h => h.totalActive)
      },
      {
        name: 'Dead Letter Messages',
        data: this.history.map(h => h.totalDeadLetter)
      }
    ];

    this.chartXAxis = {
      ...this.chartXAxis,
      categories: this.history.map(h => h.timestamp)
    };
  }
}
