import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { TreeNode, QueueNodeData, TopicNodeData, SubscriptionNodeData } from '../models';
import { QueueService } from './queue.service';
import { TopicService } from './topic.service';
import { LoggerService } from './logger.service';
import { DeadLetterNotificationService } from './dead-letter-notification.service';
import { QueueInfo } from '../models/queue.model';
import { TopicInfo, SubscriptionInfo, getDetectedPattern, getPatternDisplay } from '../models/topic.model';

@Injectable({
  providedIn: 'root'
})
export class TreeDataBuilderService {
  private readonly queueService = inject(QueueService);
  private readonly topicService = inject(TopicService);
  private readonly logger = inject(LoggerService);
  private readonly notificationService = inject(DeadLetterNotificationService);

  buildTree(): Observable<TreeNode[]> {
    this.logger.log('[TreeDataBuilder] Building tree...');
    return forkJoin({
      queues: this.queueService.getQueues().pipe(catchError(() => of([]))),
      topics: this.topicService.getTopics().pipe(catchError(() => of([])))
    }).pipe(
      switchMap(({ queues, topics }) => {
        this.logger.log('[TreeDataBuilder] Got topics:', topics.length, topics.map(t => ({ name: t.name, subscriptionCount: t.subscriptionCount })));
        return this.loadSubscriptionsForTopics(topics).pipe(
          map(topicsWithSubs => {
            this.logger.log('[TreeDataBuilder] Topics with subs loaded:', topicsWithSubs.map(t => ({ name: t.name, subs: t.subscriptions?.length || 0 })));
            const allSubscriptions = topicsWithSubs.flatMap(t => t.subscriptions || []);
            this.notificationService.updateFromSubscriptions(allSubscriptions);
            return this.createTreeStructure(queues, topicsWithSubs);
          })
        );
      })
    );
  }

  private loadSubscriptionsForTopics(topics: TopicInfo[]): Observable<TopicInfo[]> {
    this.logger.log('[TreeDataBuilder] loadSubscriptionsForTopics called with', topics.length, 'topics');

    if (topics.length === 0) {
      this.logger.log('[TreeDataBuilder] No topics to load subscriptions for');
      return of([]);
    }

    const topicsWithSubscriptionCount = topics.filter(t => t.subscriptionCount > 0);
    this.logger.log('[TreeDataBuilder] Topics with subscription count > 0:', topicsWithSubscriptionCount.length);
    this.logger.log('[TreeDataBuilder] Topic names:', topicsWithSubscriptionCount.map(t => `${t.name} (${t.subscriptionCount})`));

    if (topicsWithSubscriptionCount.length === 0) {
      this.logger.log('[TreeDataBuilder] No topics with subscriptions, returning original topics');
      return of(topics);
    }

    const subscriptionRequests = topicsWithSubscriptionCount.map(topic => {
      this.logger.log(`[TreeDataBuilder] Creating request for subscriptions of topic: ${topic.name}`);
      return this.topicService.getSubscriptions(topic.name).pipe(
        map(subs => {
          this.logger.log(`[TreeDataBuilder] Received ${subs.length} subscriptions for ${topic.name}:`, subs.map(s => s.name));
          return { topicName: topic.name, subscriptions: subs };
        }),
        catchError(err => {
          this.logger.error(`[TreeDataBuilder] Error loading subscriptions for ${topic.name}:`, err);
          return of({ topicName: topic.name, subscriptions: [] as SubscriptionInfo[] });
        })
      );
    });

    this.logger.log('[TreeDataBuilder] Executing', subscriptionRequests.length, 'subscription requests...');

    return forkJoin(subscriptionRequests).pipe(
      map(results => {
        this.logger.log('[TreeDataBuilder] All subscription requests completed, results:', results);
        const subsMap = new Map<string, SubscriptionInfo[]>();
        results.forEach(r => {
          this.logger.log(`[TreeDataBuilder] Mapping ${r.subscriptions.length} subscriptions for ${r.topicName}`);
          subsMap.set(r.topicName, r.subscriptions);
        });

        const enrichedTopics = topics.map(topic => ({
          ...topic,
          subscriptions: subsMap.get(topic.name) || []
        }));

        this.logger.log('[TreeDataBuilder] Enriched topics:', enrichedTopics.map(t => ({ name: t.name, subsCount: t.subscriptions?.length || 0 })));

        return enrichedTopics;
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
      status: queue.status
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
      patternDisplay: detectedPattern ? getPatternDisplay(detectedPattern.pattern) : undefined
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
      status: subscription.status
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
