import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NgApexchartsModule } from 'ng-apexcharts';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexGrid,
  ApexLegend,
  ApexStroke,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis
} from 'ng-apexcharts';

type ChartOptions = {
  series?: ApexAxisChartSeries;
  chart?: ApexChart;
  xaxis?: ApexXAxis;
  yaxis?: ApexYAxis;
  stroke?: ApexStroke;
  tooltip?: ApexTooltip;
  legend?: ApexLegend;
  dataLabels?: ApexDataLabels;
  grid?: ApexGrid;
};

@Component({
  selector: 'app-metrics-dashboard',
  standalone: true,
  imports: [NgApexchartsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="metrics-header">
      <div class="time-range-selector">
        @for (range of timeRanges; track range.value) {
          <button class="time-range-btn" [class.selected]="selectedTimeRange() === range.value" (click)="selectTimeRange(range.value)">
            {{ range.label }}
          </button>
        }
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-container">
        <h3 class="chart-title">Requests</h3>
        <apx-chart [series]="requestsChartOptions.series!" [chart]="requestsChartOptions.chart!" [xaxis]="requestsChartOptions.xaxis!" [yaxis]="requestsChartOptions.yaxis!" [stroke]="requestsChartOptions.stroke!" [tooltip]="requestsChartOptions.tooltip!" [legend]="requestsChartOptions.legend!" [dataLabels]="requestsChartOptions.dataLabels!" [grid]="requestsChartOptions.grid!" />
      </div>
      <div class="chart-container">
        <h3 class="chart-title">Messages</h3>
        <apx-chart [series]="messagesChartOptions.series!" [chart]="messagesChartOptions.chart!" [xaxis]="messagesChartOptions.xaxis!" [yaxis]="messagesChartOptions.yaxis!" [stroke]="messagesChartOptions.stroke!" [tooltip]="messagesChartOptions.tooltip!" [legend]="messagesChartOptions.legend!" [dataLabels]="messagesChartOptions.dataLabels!" [grid]="messagesChartOptions.grid!" />
      </div>
    </div>
  `,
  styles: [`
    .metrics-header { padding: 16px; border-bottom: 1px solid var(--bs-border-color); margin-bottom: 24px; }
    .time-range-selector { display: flex; gap: 8px; justify-content: flex-start; }
    .time-range-btn { padding: 8px 16px; border: 1px solid var(--bs-border-color); background: var(--bs-body-bg); color: var(--bs-body-color); border-radius: 4px; cursor: pointer; font-size: 14px; transition: all .2s; }
    .time-range-btn:hover { border-color: #3b82f6; }
    .time-range-btn.selected { background: #3b82f6; color: white; border-color: #3b82f6; }
    .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 0 16px; }
    .chart-container { background: var(--bs-body-bg); border: 1px solid var(--bs-border-color); padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, .1); }
    .chart-title { margin: 0 0 16px; font-size: 16px; font-weight: 500; color: var(--bs-body-color); }
    @media (max-width: 768px) { .charts-grid { grid-template-columns: 1fr; } .time-range-selector { flex-wrap: wrap; } }
  `]
})
export class MetricsDashboardComponent {
  private readonly snackBar = inject(MatSnackBar);

  readonly timeRanges = [
    { label: '1 hour', value: '1h' }, { label: '6 hours', value: '6h' },
    { label: '12 hours', value: '12h' }, { label: '1 day', value: '1d' },
    { label: '7 days', value: '7d' }, { label: '30 days', value: '30d' }
  ];
  readonly selectedTimeRange = signal('1h');
  requestsChartOptions: ChartOptions = {};
  messagesChartOptions: ChartOptions = {};

  constructor() { this.initializeCharts(); }

  selectTimeRange(range: string): void {
    this.selectedTimeRange.set(range);
    this.initializeCharts();
    this.snackBar.open(`Time range updated to ${range}`, 'Close', { duration: 2000 });
  }

  private initializeCharts(): void {
    const chart: ApexChart = { type: 'line', height: 350, toolbar: { show: false }, zoom: { enabled: false } };
    const stroke: ApexStroke = { curve: 'smooth', width: 2 };
    const dataLabels: ApexDataLabels = { enabled: false };
    const grid: ApexGrid = { borderColor: '#e7e7e7', row: { colors: ['#f3f3f3', 'transparent'], opacity: .5 } };
    const xaxis = { categories: this.generateTimeLabels(20), labels: { rotate: -45, rotateAlways: true, style: { fontSize: '10px' } } };
    const tooltip: ApexTooltip = { shared: true, intersect: false, y: { formatter: (value: number, opts: { w: { config: { series: { name: string }[] } }; seriesIndex: number }) => `${opts.w.config.series[opts.seriesIndex].name}: ${value}` } };
    const legend: ApexLegend = { position: 'bottom', horizontalAlign: 'center', fontSize: '12px' };
    this.requestsChartOptions = { series: [{ name: 'Incoming Requests (Sum)', data: this.mockData(20, 0, 6), color: '#3b82f6' }, { name: 'Successful Requests (Sum)', data: this.mockData(20, 0, 5), color: '#ec4899' }, { name: 'Server Errors (Sum)', data: this.mockData(20, 0, 2), color: '#9ca3af' }, { name: 'Throttled Requests (Sum)', data: this.mockData(20, 0, 1), color: '#6b7280' }], chart, stroke, dataLabels, grid, xaxis, yaxis: { title: { text: 'Count' }, min: 0, max: 8 }, tooltip, legend };
    this.messagesChartOptions = { series: [{ name: 'Incoming Messages (Sum)', data: this.mockData(20, 0, 100), color: '#3b82f6' }, { name: 'Outgoing Messages (Sum)', data: this.mockData(20, 0, 95), color: '#ec4899' }], chart, stroke, dataLabels, grid, xaxis, yaxis: { title: { text: 'Count' }, min: 0, max: 120 }, tooltip, legend };
  }

  private mockData(points: number, min: number, max: number): number[] { return Array.from({ length: points }, () => Math.floor(Math.random() * (max - min + 1)) + min); }
  private generateTimeLabels(count: number): string[] { const now = Date.now(); return Array.from({ length: count }, (_, index) => new Date(now - (count - index - 1) * 900_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); }
}
