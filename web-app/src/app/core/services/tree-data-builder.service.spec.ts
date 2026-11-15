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

describe('TreeDataBuilderService gives its counts only from a whole build', () => {
  function builderWith(subscriptions: () => any) {
    TestBed.configureTestingModule({
      providers: [
        { provide: QueueService, useValue: { getQueues: () => of([{ name: 'orders' }]) } },
        { provide: TopicService, useValue: { getTopics: () => of([{ name: 'events', subscriptionCount: 2 }]), getSubscriptions: subscriptions } },
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { updateFromSubscriptions: () => undefined } }
      ]
    });
    return TestBed.inject(TreeDataBuilderService);
  }

  it('after a whole build it counts queues, topics and subscriptions; before any build it gives none', () => {
    const builder = builderWith(() => of([{ name: 'audit' }, { name: 'billing' }]));
    expect(builder.wholeCounts(), 'nothing is counted before a build').toBeNull();

    builder.buildTree().subscribe();

    expect(builder.wholeCounts()).toStrictEqual({ queues: 1, topics: 1, subscriptions: 2 });
  });

  it('a topic whose subscriptions could not be read makes the counts unknown, never an undercount', () => {
    const builder = builderWith(() => throwError(() => new Error('boom')));

    builder.buildTree().subscribe();

    expect(builder.wholeCounts(), 'a missed subscription read is not counted as none').toBeNull();
  });
});

describe('TreeDataBuilderService reads the subscriptions of one topic on demand', () => {
  it('asks for the subscriptions of that topic and answers them as subscription nodes under it, with their counts', async () => {
    const getSubscriptions = vi.fn(() => of([{ name: 'warehouse', activeMessageCount: 4, deadLetterMessageCount: 2, status: 'Active' }]));
    TestBed.configureTestingModule({
      providers: [
        { provide: QueueService, useValue: {} },
        { provide: TopicService, useValue: { getSubscriptions } },
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: {} }
      ]
    });
    const topic = { id: 'topic-order-events', name: 'order-events', type: 'topic', icon: 'topic', expandable: false, level: 1, children: [] } as never;

    const nodes = await new Promise<any[]>(done => TestBed.inject(TreeDataBuilderService).loadSubscriptions(topic).subscribe(done));

    expect(getSubscriptions).toHaveBeenCalledWith('order-events');
    expect(nodes.map(n => [n.id, n.type, n.level, n.data.topicName, n.data.deadLetterMessageCount, n.parent === topic]))
      .toStrictEqual([['subscription-order-events-warehouse', 'subscription', 2, 'order-events', 2, true]]);
  });
});

describe('TreeDataBuilderService names the pattern of a RabbitMQ exchange as the API sends it', () => {
  function build(topics: unknown[]) {
    TestBed.configureTestingModule({
      providers: [
        { provide: QueueService, useValue: { getQueues: () => of([]) } },
        { provide: TopicService, useValue: { getTopics: () => of(topics), getSubscriptions: () => of([]) } },
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { updateFromSubscriptions: () => undefined } }
      ]
    });
    let nodes: any[] = [];
    TestBed.inject(TreeDataBuilderService).buildTree().subscribe(tree => (nodes = tree.find(c => c.id === 'category-topics')?.children ?? []));
    return nodes.map(n => [n.name, n.data.patternDisplay]);
  }

  it('the provider and the pattern arrive by name ("RabbitMQ", "PubSub"), and the exchange is labelled Pub/Sub, Routing or Topics', () => {
    expect(build([
      { name: 'orders.dlx', providerType: 'RabbitMQ', exchangeType: 'fanout', subscriptionCount: 0, detectedPattern: { pattern: 'PubSub', confidence: 1, reason: 'fanout' } },
      { name: 'billing', providerType: 'RabbitMQ', exchangeType: 'direct', subscriptionCount: 0, detectedPattern: { pattern: 'Routing', confidence: 0.9, reason: 'direct' } },
      { name: 'orders', providerType: 'RabbitMQ', exchangeType: 'topic', subscriptionCount: 0, detectedPattern: { pattern: 'Topics', confidence: 0.9, reason: 'topic' } }
    ])).toStrictEqual([['orders.dlx', 'Pub/Sub'], ['billing', 'Routing'], ['orders', 'Topics']]);
  });

  it('an exchange with no detected pattern, or the pattern None, and an Azure topic carry no label', () => {
    expect(build([
      { name: 'plain', providerType: 'RabbitMQ', subscriptionCount: 0 },
      { name: 'none', providerType: 'RabbitMQ', subscriptionCount: 0, detectedPattern: { pattern: 'None', confidence: 0, reason: '' } },
      { name: 'events', providerType: 'AzureServiceBus', subscriptionCount: 0 }
    ])).toStrictEqual([['plain', undefined], ['none', undefined], ['events', undefined]]);
  });
});

describe('TreeDataBuilderService labels a RabbitMQ queue by how it is used', () => {
  function build(queues: unknown[]) {
    TestBed.configureTestingModule({
      providers: [
        { provide: QueueService, useValue: { getQueues: () => of(queues) } },
        { provide: TopicService, useValue: { getTopics: () => of([]), getSubscriptions: () => of([]) } },
        { provide: LoggerService, useValue: { log: () => undefined, error: () => undefined } },
        { provide: DeadLetterNotificationService, useValue: { updateFromSubscriptions: () => undefined } }
      ]
    });
    let nodes: any[] = [];
    TestBed.inject(TreeDataBuilderService).buildTree().subscribe(tree => (nodes = tree.find(c => c.id === 'category-queues')?.children ?? []));
    return nodes.map(n => [n.name, n.data.patternDisplay]);
  }

  it('a stream queue is Stream, a queue with two or more consumers is a Work queue with their count, and any other queue has no label', () => {
    expect(build([
      { name: 'events.stream', queueType: 'stream', consumerCount: 3 },
      { name: 'tasks', queueType: 'classic', consumerCount: 3 },
      { name: 'single', queueType: 'quorum', consumerCount: 1 },
      { name: 'idle', queueType: 'classic', consumerCount: 0 },
      { name: 'azure-queue' }
    ])).toStrictEqual([['events.stream', 'Stream'], ['tasks', 'Work queue, 3 consumers'], ['single', undefined], ['idle', undefined], ['azure-queue', undefined]]);
  });
});
