import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TreeDataBuilderService } from './tree-data-builder.service';
import { QueueService } from './queue.service';
import { TopicService } from './topic.service';
import { LoggerService } from './logger.service';
import { DeadLetterNotificationService } from './dead-letter-notification.service';

describe('TreeDataBuilderService remembers the names of the tree it built last', () => {
  it('before a tree is built nothing is loaded; after, the queue and topic names are', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: QueueService, useValue: { getQueues: () => of([{ name: 'orders' }, { name: 'orders-retry' }]) } },
        {
          provide: TopicService,
          useValue: { getTopics: () => of([{ name: 'events', subscriptionCount: 1 }]), getSubscriptions: () => of([{ name: 'audit' }]) }
        },
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { updateFromSubscriptions: () => undefined } }
      ]
    });
    const builder = TestBed.inject(TreeDataBuilderService);
    expect(builder.loadedNames()).toStrictEqual({ queues: [], topics: [] });

    builder.buildTree().subscribe();

    expect(builder.loadedNames()).toStrictEqual({ queues: ['orders', 'orders-retry'], topics: ['events'] });
  });
});

describe('TreeDataBuilderService reports a failed load instead of an empty tree', () => {
  function builderWith(queues: () => any, topics: () => any) {
    const updateFromSubscriptions = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: QueueService, useValue: { getQueues: queues } },
        { provide: TopicService, useValue: { getTopics: topics, getSubscriptions: () => of([]) } },
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { updateFromSubscriptions } }
      ]
    });
    return { builder: TestBed.inject(TreeDataBuilderService), updateFromSubscriptions };
  }

  it('a queue list the API fails to return fails the tree, and the dead-letter alerts are not rebuilt from partial data', () => {
    const outage = new Error('503 Service Unavailable');
    const { builder, updateFromSubscriptions } = builderWith(
      () => throwError(() => outage),
      () => of([{ name: 'events', subscriptionCount: 0 }])
    );
    let received: unknown;
    let tree: unknown;

    builder.buildTree().subscribe({ next: t => (tree = t), error: e => (received = e) });

    expect(received).toBe(outage);
    expect(tree).toBeUndefined();
    expect(updateFromSubscriptions).not.toHaveBeenCalled();
  });

  it('a topic list the API fails to return fails the tree', () => {
    const outage = new Error('503 Service Unavailable');
    const { builder } = builderWith(() => of([{ name: 'orders' }]), () => throwError(() => outage));
    let received: unknown;

    builder.buildTree().subscribe({ error: e => (received = e) });

    expect(received).toBe(outage);
  });
});
