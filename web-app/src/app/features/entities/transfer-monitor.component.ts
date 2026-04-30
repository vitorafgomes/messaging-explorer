import { Component, input, output, signal, computed, OnInit, OnDestroy, DestroyRef, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, switchMap, Subject, startWith, catchError, of } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TopicService } from '../../core/services';
import { SubscriptionInfo } from '../../core/models';

@Component({
  selector: 'app-transfer-monitor',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="transfer-monitor" (click)="clicked.emit()" style="cursor: pointer;">
      <div class="monitor-header">
        <i class="fa-solid fa-envelope"></i>
        <span class="monitor-title">Active Messages</span>
        <span class="live-badge">
          <span class="live-dot"></span>
          LIVE
        </span>
      </div>
      <div class="monitor-body">
        <div class="current-value" [class.pulse]="justChanged()">
          {{ currentCount() | number }}
          @if (delta() !== 0) {
            <span class="delta" [class.positive]="delta() > 0" [class.negative]="delta() < 0">
              {{ delta() > 0 ? '+' : '' }}{{ delta() | number }}
            </span>
          }
        </div>
        <svg class="sparkline" [attr.viewBox]="'0 0 ' + sparklineWidth + ' ' + sparklineHeight" preserveAspectRatio="none">
          @if (sparklinePath()) {
            <path [attr.d]="sparklinePath()" fill="none" stroke="var(--bs-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path [attr.d]="sparklineAreaPath()" fill="var(--bs-primary)" opacity="0.1"/>
          }
        </svg>
        <div class="monitor-stats">
          <span class="stat">
            <span class="stat-label">Peak</span>
            <span class="stat-value">{{ peak() | number }}</span>
          </span>
          <span class="stat">
            <span class="stat-label">Processed</span>
            <span class="stat-value">{{ totalProcessed() | number }}</span>
          </span>
          <span class="stat">
            <span class="stat-label">Rate</span>
            <span class="stat-value">{{ processingRate() }}/s</span>
          </span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .transfer-monitor {
      background: var(--bs-body-bg);
      border: 1px solid var(--bs-border-color);
      border-radius: 8px;
      overflow: hidden;
      grid-column: span 2;
    }

    .monitor-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: linear-gradient(135deg, #2196F3 0%, #1565c0 100%);
      color: white;
      font-size: 13px;
      font-weight: 500;

      i {
        font-size: 16px;
      }
    }

    .monitor-title {
      flex: 1;
    }

    .live-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
    }

    .live-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #4caf50;
      box-shadow: 0 0 4px #4caf50;
      animation: blink 1.5s ease-in-out infinite;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .monitor-body {
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .current-value {
      font-size: 32px;
      font-weight: 700;
      color: var(--bs-body-color);
      line-height: 1;
      transition: transform 0.3s ease;
    }

    .current-value.pulse {
      animation: pulse-value 0.6s ease;
    }

    @keyframes pulse-value {
      0% { transform: scale(1); }
      50% { transform: scale(1.08); }
      100% { transform: scale(1); }
    }

    .delta {
      font-size: 14px;
      font-weight: 600;
      margin-left: 8px;
      padding: 2px 6px;
      border-radius: 8px;

      &.positive {
        background: rgba(76, 175, 80, 0.15);
        color: #4caf50;
      }

      &.negative {
        background: rgba(244, 67, 54, 0.15);
        color: #f44336;
      }
    }

    .sparkline {
      width: 100%;
      height: 40px;
    }

    .monitor-stats {
      display: flex;
      gap: 16px;
    }

    .stat {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .stat-label {
      font-size: 11px;
      color: var(--bs-secondary-color);
      text-transform: uppercase;
      font-weight: 500;
    }

    .stat-value {
      font-size: 16px;
      font-weight: 600;
      color: var(--bs-body-color);
    }
  `]
})
export class TransferMonitorComponent implements OnInit, OnDestroy {
  private topicService = inject(TopicService);
  private destroyRef = inject(DestroyRef);
  private stop$ = new Subject<void>();

  topicName = input.required<string>();
  subscriptionName = input.required<string>();
  subscriptionUpdated = output<SubscriptionInfo>();
  clicked = output<void>();

  readonly sparklineWidth = 200;
  readonly sparklineHeight = 40;
  private readonly maxDataPoints = 20;

  private history = signal<number[]>([]);
  private previousCount = signal<number | null>(null);

  currentCount = signal(0);
  delta = signal(0);
  justChanged = signal(false);
  peak = signal(0);
  totalProcessed = signal(0);
  processingRate = signal('0');

  sparklinePath = computed(() => {
    const data = this.history();
    if (data.length < 2) return '';
    const max = Math.max(...data, 1);
    const stepX = this.sparklineWidth / (this.maxDataPoints - 1);
    const points = data.map((v, i) => {
      const x = i * stepX;
      const y = this.sparklineHeight - (v / max) * (this.sparklineHeight - 4) - 2;
      return `${x},${y}`;
    });
    return 'M' + points.join(' L');
  });

  sparklineAreaPath = computed(() => {
    const line = this.sparklinePath();
    if (!line) return '';
    const data = this.history();
    const stepX = this.sparklineWidth / (this.maxDataPoints - 1);
    const lastX = (data.length - 1) * stepX;
    return line + ` L${lastX},${this.sparklineHeight} L0,${this.sparklineHeight} Z`;
  });

  ngOnInit(): void {
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stop$.next();
    this.stop$.complete();
  }

  private startPolling(): void {
    this.stop$.next();
    this.history.set([]);
    this.previousCount.set(null);
    this.peak.set(0);
    this.totalProcessed.set(0);
    this.processingRate.set('0');

    const pollInterval = 3000;

    interval(pollInterval).pipe(
      startWith(0),
      switchMap(() => this.topicService.getSubscription(this.topicName(), this.subscriptionName()).pipe(
        catchError(() => of(null))
      )),
      takeUntil(this.stop$),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(sub => {
      if (!sub) return;
      this.subscriptionUpdated.emit(sub);
      const count = sub.activeMessageCount;
      const prev = this.previousCount();

      this.currentCount.set(count);

      if (prev !== null) {
        const d = count - prev;
        this.delta.set(d);
        // Negative delta means messages were processed
        if (d < 0) {
          this.totalProcessed.update(t => t + Math.abs(d));
        }
        // Calculate rate: messages processed per second
        const rate = Math.abs(d) / (pollInterval / 1000);
        this.processingRate.set(rate < 1 && rate > 0 ? rate.toFixed(1) : Math.round(rate).toString());
      }

      this.previousCount.set(count);

      if (count > this.peak()) {
        this.peak.set(count);
      }

      this.history.update(h => {
        const newH = [...h, count];
        return newH.length > this.maxDataPoints ? newH.slice(-this.maxDataPoints) : newH;
      });

      // Pulse animation
      if (prev !== null && count !== prev) {
        this.justChanged.set(true);
        setTimeout(() => this.justChanged.set(false), 600);
      }
    });
  }
}
