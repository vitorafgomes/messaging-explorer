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
    <div class="transfer-monitor" role="button" tabindex="0"
      [attr.aria-label]="'View the ' + currentCount() + ' active messages'"
      (click)="clicked.emit()"
      (keydown.enter)="clicked.emit()"
      (keydown.space)="$event.preventDefault(); clicked.emit()">
      <div class="monitor-header">
        <span class="monitor-title">Active Messages</span>
        <span class="live-badge">
          <span class="live-dot"></span>
          Live
        </span>
      </div>
      <div class="current-value" [class.pulse]="justChanged()">
        {{ currentCount() | number }}
        @if (delta() !== 0) {
          <span class="delta" [class.positive]="delta() > 0" [class.negative]="delta() < 0">
            {{ delta() > 0 ? '+' : '' }}{{ delta() | number }}
          </span>
        }
      </div>
      <svg class="sparkline" aria-hidden="true" [attr.viewBox]="'0 0 ' + sparklineWidth + ' ' + sparklineHeight" preserveAspectRatio="none">
        @if (sparklinePath()) {
          <path class="line" [attr.d]="sparklinePath()" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path class="area" [attr.d]="sparklineAreaPath()"/>
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
  `,
  styleUrl: './transfer-monitor.component.scss'
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
