import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, switchMap, catchError, of, map, startWith } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ConnectionService } from '../../core/services';
import { MetricsService } from '../../core/services/metrics.service';
import { MetricsData, MetricsTimeRange } from '../../core/models';

/** The namespace metrics the API reads, in the order they are drawn, with the label each card shows. */
export const NAMESPACE_METRICS: readonly { name: string; label: string; gauge: boolean }[] = [
  { name: 'IncomingMessages', label: 'Incoming messages', gauge: false },
  { name: 'OutgoingMessages', label: 'Outgoing messages', gauge: false },
  { name: 'ActiveMessages', label: 'Active messages', gauge: true },
  { name: 'DeadletteredMessages', label: 'Dead-lettered messages', gauge: true },
  { name: 'ServerErrors', label: 'Server errors', gauge: false },
  { name: 'ThrottledRequests', label: 'Throttled requests', gauge: false }
];

/** The fixed text of each failure the panel shows; the API's own text is never shown. */
export const METRICS_FAILURES = {
  'sign-in': 'The sign-in with Entra ID did not complete, so Azure Monitor was not read.',
  'not-azure': 'Azure Monitor metrics exist for Azure Service Bus connections only.',
  failed: 'The call to Azure Monitor failed or did not answer in time. Nothing is shown because nothing was read.'
} as const;

type PanelState =
  | { kind: 'loading' }
  | { kind: 'data'; cards: MetricCard[] }
  | { kind: 'needs-sign-in' }
  | { kind: 'needs-resource-id' }
  | { kind: 'forbidden' }
  | { kind: 'failed'; text: string };

interface MetricCard {
  label: string;
  /** The total of a count over the range, the last value of a gauge; null when Azure Monitor sent no point. */
  value: number | null;
  note: string;
  /** One polyline per run of consecutive grains in a 380 by 96 box; a missing grain breaks the line. */
  segments: string[];
}

const RANGES = [
  { range: MetricsTimeRange.OneHour, label: 'Last hour', grainMs: 60_000 },
  { range: MetricsTimeRange.TwentyFourHours, label: 'Last day', grainMs: 30 * 60_000 }
] as const;

/**
 * The Azure Monitor metrics of the connected namespace on the Monitoring screen: six sparkline cards over the last
 * hour or day, read only when the tab is opened or Refresh is pressed. A new range or leaving the tab cancels the read
 * in flight. Every failure has its own fixed text; nothing is ever drawn that was not read.
 */
@Component({
  selector: 'app-monitoring-metrics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, DatePipe, MatButtonModule, MatButtonToggleModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="metrics-head">
      <mat-button-toggle-group [value]="range()" (change)="choose($event.value)" aria-label="Time range" hideSingleSelectionIndicator>
        @for (r of ranges; track r.range) {
          <mat-button-toggle [value]="r.range">{{ r.label }}</mat-button-toggle>
        }
      </mat-button-toggle-group>
      <button mat-stroked-button type="button" (click)="refresh()" [disabled]="state().kind === 'loading'">
        <mat-icon aria-hidden="true">refresh</mat-icon>Refresh
      </button>
    </div>
    @switch (state().kind) {
      @case ('loading') {
        <p class="metrics-note" role="status" aria-live="polite">
          <mat-progress-spinner mode="indeterminate" diameter="20" aria-hidden="true" />
          <span>Reading the Azure Monitor metrics of {{ host ?? 'the namespace' }}</span>
        </p>
      }
      @case ('needs-sign-in') {
        <section class="metrics-state" role="status" aria-label="Metrics need a sign-in">
          <mat-icon aria-hidden="true">login</mat-icon>
          <div><h2>Metrics need a sign-in with Entra ID</h2>
            <p>This connection uses a connection string, which cannot read Azure Monitor. Sign in with Entra ID on the connection and give it the Azure resource ID of the namespace to see its metrics.</p></div>
        </section>
      }
      @case ('needs-resource-id') {
        <section class="metrics-state" role="status" aria-label="Metrics need the resource ID">
          <mat-icon aria-hidden="true">badge</mat-icon>
          <div><h2>Metrics need the Azure resource ID of the namespace</h2>
            <p>Edit the connection and add the resource ID, as /subscriptions/&#123;id&#125;/resourceGroups/&#123;group&#125;/providers/Microsoft.ServiceBus/namespaces/&#123;namespace&#125;. The Azure portal shows it under the namespace's JSON view.</p></div>
        </section>
      }
      @case ('forbidden') {
        <section class="metrics-error" role="alert" aria-label="Error">
          <mat-icon aria-hidden="true">lock</mat-icon>
          <div><h2>Azure Monitor refused the read</h2>
            <p>The signed-in identity needs the Monitoring Reader role on the namespace. Nothing is shown because nothing was read.</p>
            <button mat-stroked-button type="button" (click)="refresh()"><mat-icon aria-hidden="true">refresh</mat-icon>Retry</button></div>
        </section>
      }
      @case ('failed') {
        <section class="metrics-error" role="alert" aria-label="Error">
          <mat-icon aria-hidden="true">warning</mat-icon>
          <div><h2>Could not read the metrics</h2>
            <p>{{ failedText() }}</p>
            <button mat-stroked-button type="button" (click)="refresh()"><mat-icon aria-hidden="true">refresh</mat-icon>Retry</button></div>
        </section>
      }
      @case ('data') {
        <div class="metric-cards">
          @for (card of cards(); track card.label) {
            <figure class="metric-card">
              <figcaption>
                <span class="metric-label">{{ card.label }}</span>
                <span class="metric-value">{{ card.value === null ? 'No data' : (card.value | number:'1.0-1') }}</span>
              </figcaption>
              <svg role="img" [attr.aria-label]="card.label + ', ' + rangeLabel() + ': ' + (card.value === null ? 'no data' : card.note)" viewBox="0 0 380 96" preserveAspectRatio="none" class="spark">
                <path class="grid" d="M0 8H380M0 48H380M0 88H380" vector-effect="non-scaling-stroke"></path>
                @for (segment of card.segments; track $index) {
                  <polyline class="line" [attr.points]="segment" vector-effect="non-scaling-stroke"></polyline>
                }
              </svg>
              <span class="metric-note">{{ card.value === null ? 'Azure Monitor sent no value in this range.' : card.note }}</span>
            </figure>
          }
        </div>
        <p class="metrics-note">From Azure Monitor, {{ rangeLabel().toLowerCase() }}. Read when the tab opens and on Refresh.</p>
      }
    }
  `,
  styleUrl: './monitoring-metrics.component.scss'
})
export class MonitoringMetricsComponent implements OnInit {
  private readonly metrics = inject(MetricsService);
  private readonly connections = inject(ConnectionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reads = new Subject<void>();

  readonly ranges = RANGES;
  readonly range = signal<MetricsTimeRange>(MetricsTimeRange.OneHour);
  readonly state = signal<PanelState>({ kind: 'loading' });

  get host(): string | undefined {
    return this.connections.currentTarget;
  }

  ngOnInit(): void {
    this.reads.pipe(
      startWith(undefined),
      switchMap(() => {
        const range = this.range();
        const id = this.connections.currentConnectionId;
        if (!id) return of<PanelState>({ kind: 'failed', text: METRICS_FAILURES.failed });
        return this.metrics.getNamespaceMetrics(id, range).pipe(
          map(data => ({ kind: 'data', cards: cardsOf(data, range) }) as PanelState),
          catchError((err: unknown) => of(stateOf(err))),
          startWith({ kind: 'loading' } as PanelState)
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(state => this.state.set(state));
  }

  choose(range: MetricsTimeRange): void {
    this.range.set(range);
    this.reads.next();
  }

  refresh(): void {
    this.reads.next();
  }

  cards(): MetricCard[] {
    const state = this.state();
    return state.kind === 'data' ? state.cards : [];
  }

  failedText(): string {
    const state = this.state();
    return state.kind === 'failed' ? state.text : '';
  }

  rangeLabel(): string {
    return RANGES.find(r => r.range === this.range())?.label ?? '';
  }
}

/** The panel state for a failed read, from the API's code only; any other failure is the fixed failed text. */
function stateOf(err: unknown): PanelState {
  const code = err instanceof HttpErrorResponse ? err.error?.code : undefined;
  switch (code) {
    case 'connection-string': return { kind: 'needs-sign-in' };
    case 'no-resource-id': return { kind: 'needs-resource-id' };
    case 'forbidden': return { kind: 'forbidden' };
    case 'sign-in': return { kind: 'failed', text: METRICS_FAILURES['sign-in'] };
    case 'not-azure': return { kind: 'failed', text: METRICS_FAILURES['not-azure'] };
    default: return { kind: 'failed', text: METRICS_FAILURES.failed };
  }
}

function cardsOf(data: MetricsData, range: MetricsTimeRange): MetricCard[] {
  const grainMs = RANGES.find(r => r.range === range)?.grainMs ?? 60_000;
  const start = data.startTime.getTime();
  const span = Math.max(data.endTime.getTime() - start, 1);
  return NAMESPACE_METRICS.map(metric => {
    const points = data.series.find(s => s.name === metric.name)?.data ?? [];
    if (points.length === 0) return { label: metric.label, value: null, note: '', segments: [] };
    const values = points.map(p => p.value);
    const min = Math.min(...values);
    const top = Math.max(...values) - min;
    const segments: string[] = [];
    let current: string[] = [];
    points.forEach((p, i) => {
      if (i > 0 && p.timestamp.getTime() - points[i - 1].timestamp.getTime() > grainMs * 1.5) {
        segments.push(current.join(' '));
        current = [];
      }
      const x = ((p.timestamp.getTime() - start) / span) * 380;
      const y = 88 - (top ? (p.value - min) / top : 0) * 80;
      current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
    segments.push(current.join(' '));
    const value = metric.gauge ? values[values.length - 1] : values.reduce((sum, v) => sum + v, 0);
    return {
      label: metric.label,
      value,
      note: metric.gauge ? 'Last value read' : 'Total over the range',
      segments
    };
  });
}
