import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
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
