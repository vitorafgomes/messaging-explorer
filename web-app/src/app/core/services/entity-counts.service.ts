import { Injectable, signal } from '@angular/core';

/** The two counts every display of a queue or a subscription shows. */
export interface EntityCounts {
  activeMessageCount: number;
  deadLetterMessageCount: number;
}

/**
 * The latest counts read from the broker for a queue or a subscription, kept in one signal so that every display
 * of the same entity (the tree, the panel, the messages dialog) shows the same number at the same time. A display
 * falls back to the counts it was loaded with while nothing was written here for its entity.
 */
@Injectable({ providedIn: 'root' })
export class EntityCountsService {
  private readonly counts = signal<ReadonlyMap<string, EntityCounts>>(new Map());

  /** The key of a queue, or of a subscription when its topic is given. */
  static key(name: string, topicName?: string | null): string {
    return topicName ? `subscription:${topicName}/${name}` : `queue:${name}`;
  }

  /** The latest counts written for the entity, or undefined; a template or a computed that calls this follows them. */
  of(key: string): EntityCounts | undefined {
    return this.counts().get(key);
  }

  put(key: string, counts: EntityCounts): void {
    const current = this.counts().get(key);
    if (current?.activeMessageCount === counts.activeMessageCount && current.deadLetterMessageCount === counts.deadLetterMessageCount) {
      return;
    }
    this.counts.set(new Map(this.counts()).set(key, {
      activeMessageCount: counts.activeMessageCount,
      deadLetterMessageCount: counts.deadLetterMessageCount
    }));
  }

  /** Forgets every count, as when the entities are read again from the broker or the connection changes. */
  clear(): void {
    if (this.counts().size > 0) {
      this.counts.set(new Map());
    }
  }
}
