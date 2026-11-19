import { Component, DestroyRef, OnInit, computed, inject, input, output } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Observable, catchError, defer, filter, map, of, switchMap, timer } from 'rxjs';
import { EntityCounts, EntityCountsService, QueueService, TopicService } from '../../core/services';

/**
 * Reads the selected queue or subscription every 3 seconds and emits its counts, so every display of that entity
 * shows live numbers; it draws nothing. It reads at once when the entity changes, skips a read while the window is
 * hidden, and skips a failed read until the next one.
 */
@Component({
  selector: 'app-transfer-monitor',
  standalone: true,
  template: ''
})
export class TransferMonitorComponent implements OnInit {
  private queueService = inject(QueueService);
  private topicService = inject(TopicService);
  private destroyRef = inject(DestroyRef);

  /** The topic of the subscription; absent for a queue. */
  topicName = input<string | null | undefined>();
  entityName = input.required<string>();
  /** The counts read, with the key of the entity they were read for, which may no longer be the one shown. */
  countsRead = output<EntityCounts & { key: string }>();

  private readonly entity = computed(() => ({ topic: this.topicName(), name: this.entityName() }));
  private readonly entity$ = toObservable(this.entity);

  ngOnInit(): void {
    this.entity$.pipe(
      switchMap(({ topic, name }) => timer(0, 3000).pipe(
        filter(() => !document.hidden),
        switchMap(() => {
          const read: Observable<EntityCounts> = defer(() => topic ? this.topicService.getSubscription(topic, name) : this.queueService.getQueue(name));
          return read.pipe(
            map(counts => ({ key: EntityCountsService.key(name, topic), activeMessageCount: counts.activeMessageCount, deadLetterMessageCount: counts.deadLetterMessageCount })),
            catchError(() => of(null)));
        })
      )),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(counts => {
      if (counts) this.countsRead.emit(counts);
    });
  }
}
