import { Component, input, output, OnInit, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, switchMap, startWith, catchError, of } from 'rxjs';
import { TopicService } from '../../core/services';
import { SubscriptionInfo } from '../../core/models';

/**
 * Reads the selected subscription every 3 seconds and emits it, so the panel shows live counts;
 * it draws nothing. A failed read is skipped until the next one.
 */
@Component({
  selector: 'app-transfer-monitor',
  standalone: true,
  template: ''
})
export class TransferMonitorComponent implements OnInit {
  private topicService = inject(TopicService);
  private destroyRef = inject(DestroyRef);

  topicName = input.required<string>();
  subscriptionName = input.required<string>();
  subscriptionUpdated = output<SubscriptionInfo>();

  ngOnInit(): void {
    interval(3000).pipe(
      startWith(0),
      switchMap(() => this.topicService.getSubscription(this.topicName(), this.subscriptionName()).pipe(
        catchError(() => of(null))
      )),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(sub => {
      if (sub) this.subscriptionUpdated.emit(sub);
    });
  }
}
