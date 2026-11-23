import { Injectable, inject, signal } from '@angular/core';
import { Observable, concat, forkJoin, from, of } from 'rxjs';
import { map, catchError, finalize, mergeMap, switchMap, toArray } from 'rxjs/operators';
import { TreeNode, QueueNodeData, TopicNodeData, SubscriptionNodeData } from '../models';
import { QueueService } from './queue.service';
import { TopicService } from './topic.service';
import { LoggerService } from './logger.service';
import { DeadLetterNotificationService } from './dead-letter-notification.service';
import { QueueInfo } from '../models/queue.model';
import { TopicInfo, SubscriptionInfo, MessagingPattern, getDetectedPattern, getPatternDisplay, toMessagingPattern } from '../models/topic.model';

/** A stream queue is a Stream; a queue two or more consumers compete for is a work queue; any other has no label. */
function queuePattern(queue: QueueInfo): string | undefined {
  if (queue.queueType === 'stream') return 'Stream';
  return (queue.consumerCount ?? 0) >= 2 ? `Work queue, ${queue.consumerCount} consumers` : undefined;
}

/** How many topics are asked for their subscriptions at the same time while the tree is built. */
const SUBSCRIPTION_READS = 6;

@Injectable({
  providedIn: 'root'
})
export class TreeDataBuilderService {
  private readonly queueService = inject(QueueService);
  private readonly topicService = inject(TopicService);
  private readonly logger = inject(LoggerService);
  private readonly notificationService = inject(DeadLetterNotificationService);
  private lastTree: TreeNode[] = [];
  /** Whether the latest build succeeded and read the subscriptions of every topic. */
  private lastBuildWhole = false;
  /** Whether the latest build has given its queues and topics and is still reading the subscriptions. */
  readonly readingSubscriptions = signal(false);

  /** Queue and topic names of the tree built last. */
  loadedNames(): { queues: string[]; topics: string[] } {
    const names = (id: string) => this.lastTree.find(c => c.id === id)?.children?.map(n => n.name) ?? [];
    return { queues: names('category-queues'), topics: names('category-topics') };
  }

  /** How many queues, topics and subscriptions the tree built last holds. */
  loadedCounts(): { queues: number; topics: number; subscriptions: number } {
    const category = (id: string) => this.lastTree.find(c => c.id === id)?.children ?? [];
    const topics = category('category-topics');
    return {
      queues: category('category-queues').length,
      topics: topics.length,
      subscriptions: topics.reduce((sum, topic) => sum + (topic.children?.length ?? 0), 0),
    };
  }

  /** The counts of the tree built last, or null when the latest build failed or missed a topic's subscriptions. */
  wholeCounts(): { queues: number; topics: number; subscriptions: number } | null {
    return this.lastBuildWhole ? this.loadedCounts() : null;
  }

  /**
   * The tree of the connection. It is given at once with the queues and the topics, as soon as their two lists
   * answer, and again with the subscriptions under each topic once they are read: a connection with many topics
   * shows its entities while the subscriptions are still being read. The counts and the dead-letter alerts come
   * from the whole tree only.
   */
  buildTree(): Observable<TreeNode[]> {
    this.lastBuildWhole = false;
    this.readingSubscriptions.set(false);
    let whole = true;
    return forkJoin({
      queues: this.queueService.getQueues(),
      topics: this.topicService.getTopics()
    }).pipe(
      switchMap(({ queues, topics }) => {
        const withSubscriptions = topics.filter(t => t.subscriptionCount > 0);
        const finish = (all: TopicInfo[]) => {
          this.notificationService.updateFromSubscriptions(all.flatMap(t => t.subscriptions || []));
          this.lastTree = this.createTreeStructure(queues, all);
          this.lastBuildWhole = whole;
          this.readingSubscriptions.set(false);
          return this.lastTree;
        };
        if (withSubscriptions.length === 0) return of(finish(topics));

        this.lastTree = this.createTreeStructure(queues, topics);
        this.readingSubscriptions.set(true);
        return concat(
          of(this.lastTree),
          this.loadSubscriptionsForTopics(topics, withSubscriptions, () => whole = false).pipe(map(finish))
        );
      }),
      finalize(() => this.readingSubscriptions.set(false))
    );
  }

  /** The topics with the subscriptions read for each, at most SUBSCRIPTION_READS at a time; one that fails is reported through missed and left empty. */
  private loadSubscriptionsForTopics(topics: TopicInfo[], withSubscriptions: TopicInfo[], missed: () => void): Observable<TopicInfo[]> {
    return from(withSubscriptions).pipe(
      mergeMap(topic => this.topicService.getSubscriptions(topic.name).pipe(
        catchError(err => {
          this.logger.error(`[TreeDataBuilder] Error loading subscriptions for ${topic.name}:`, err);
          missed();
          return of([] as SubscriptionInfo[]);
        }),
        map(subscriptions => [topic.name, subscriptions] as const)
      ), SUBSCRIPTION_READS),
      toArray(),
      map(results => {
        const read = new Map(results);
        return topics.map(topic => ({ ...topic, subscriptions: read.get(topic.name) ?? [] }));
      })
    );
  }

  private createTreeStructure(queues: QueueInfo[], topics: TopicInfo[]): TreeNode[] {
    const queuesCategory: TreeNode = {
      id: 'category-queues',
      name: 'Queues',
      type: 'category',
      icon: 'folder',
      expandable: queues.length > 0,
      level: 0,
      children: queues.map(q => this.createQueueNode(q))
    };

    const topicsCategory: TreeNode = {
      id: 'category-topics',
      name: 'Topics',
      type: 'category',
      icon: 'folder',
      expandable: topics.length > 0,
      level: 0,
      children: topics.map(t => this.createTopicNode(t))
    };

    // Set parent references
    queuesCategory.children?.forEach(child => child.parent = queuesCategory);
    topicsCategory.children?.forEach(child => child.parent = topicsCategory);

    return [queuesCategory, topicsCategory];
  }

  private createQueueNode(queue: QueueInfo): TreeNode {
    const data: QueueNodeData = {
      activeMessageCount: queue.activeMessageCount,
      deadLetterMessageCount: queue.deadLetterMessageCount,
      sizeInBytes: queue.sizeInBytes,
      status: queue.status,
      forwardTo: queue.forwardTo,
      patternDisplay: queuePattern(queue)
    };

    return {
      id: `queue-${queue.name}`,
      name: queue.name,
      type: 'queue',
      icon: 'inbox',
      expandable: false,
      level: 1,
      data
    };
  }

  private createTopicNode(topic: TopicInfo): TreeNode {
    // Get detected pattern for RabbitMQ exchanges (with error handling)
    let detectedPattern = null;
    try {
      detectedPattern = getDetectedPattern(topic);
    } catch (err) {
      console.error(`[TreeDataBuilder] Error detecting pattern for ${topic.name}:`, err);
    }

    const data: TopicNodeData = {
      subscriptionCount: topic.subscriptionCount,
      sizeInBytes: topic.sizeInBytes,
      status: topic.status,
      detectedPattern: detectedPattern ? {
        pattern: detectedPattern.pattern,
        confidence: detectedPattern.confidence,
        reason: detectedPattern.reason
      } : undefined,
      patternDisplay: detectedPattern && toMessagingPattern(detectedPattern.pattern) !== MessagingPattern.None ? getPatternDisplay(detectedPattern.pattern) : undefined
    };

    const hasSubscriptions = topic.subscriptions && topic.subscriptions.length > 0;
    this.logger.log(`[TreeDataBuilder] Creating topic node: ${topic.name}, subscriptions: ${topic.subscriptions?.length || 0}, expandable: ${hasSubscriptions}, pattern: ${data.patternDisplay || 'none'}`);

    const topicNode: TreeNode = {
      id: `topic-${topic.name}`,
      name: topic.name,
      type: 'topic',
      icon: 'topic',
      expandable: hasSubscriptions,
      level: 1,
      data,
      children: topic.subscriptions?.map(s => this.createSubscriptionNode(s, topic.name)) || []
    };

    this.logger.log(`[TreeDataBuilder] Topic node created: ${topic.name}, expandable: ${topicNode.expandable}, children: ${topicNode.children?.length || 0}`);

    // Set parent references for subscriptions
    topicNode.children?.forEach(child => child.parent = topicNode);

    return topicNode;
  }

  private createSubscriptionNode(subscription: SubscriptionInfo, topicName: string): TreeNode {
    const data: SubscriptionNodeData = {
      topicName,
      activeMessageCount: subscription.activeMessageCount,
      deadLetterMessageCount: subscription.deadLetterMessageCount,
      status: subscription.status,
      routingKey: subscription.rules?.find(r => (r.filterType as string) === 'RoutingKey')?.sqlExpression ?? undefined
    };

    return {
      id: `subscription-${topicName}-${subscription.name}`,
      name: subscription.name,
      type: 'subscription',
      icon: 'subscriptions',
      expandable: false,
      level: 2,
      data
    };
  }

  /** Reads the subscriptions of one topic as tree nodes under it, for a topic whose list came without them. */
  loadSubscriptions(topic: TreeNode): Observable<TreeNode[]> {
    return this.topicService.getSubscriptions(topic.name).pipe(
      map(subs => subs.map(s => ({ ...this.createSubscriptionNode(s, topic.name), parent: topic })))
    );
  }

  refreshQueues(): Observable<TreeNode[]> {
    return this.queueService.getQueues().pipe(
      map(queues => queues.map(q => this.createQueueNode(q)))
    );
  }

  refreshTopics(): Observable<TreeNode[]> {
    return this.topicService.getTopics().pipe(
      map(topics => topics.map(t => this.createTopicNode(t)))
    );
  }
}
