import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';
import { map, switchMap, tap, catchError } from 'rxjs/operators';
import { EntitySelection, SelectionState, EntityType, TreeNode, SubscriptionNodeData } from '../models';
import { QueueService } from './queue.service';
import { TopicService } from './topic.service';
import { LoggerService } from './logger.service';
import { QueueInfo } from '../models/queue.model';
import { TopicInfo, SubscriptionInfo } from '../models/topic.model';

@Injectable({
  providedIn: 'root'
})
export class EntitySelectionService {
  private readonly queueService = inject(QueueService);
  private readonly topicService = inject(TopicService);
  private readonly logger = inject(LoggerService);

  private stateSubject = new BehaviorSubject<SelectionState>({
    selection: null,
    loading: false,
    error: null
  });

  private treeRefreshSubject = new Subject<void>();

  state$ = this.stateSubject.asObservable();
  selection$ = this.state$.pipe(map(state => state.selection));
  loading$ = this.state$.pipe(map(state => state.loading));
  error$ = this.state$.pipe(map(state => state.error));
  treeRefresh$ = this.treeRefreshSubject.asObservable();

  select(node: TreeNode): void {
    if (node.type === 'root' || node.type === 'category') {
      this.stateSubject.next({
        selection: { type: node.type, node },
        loading: false,
        error: null
      });
      return;
    }

    this.stateSubject.next({
      ...this.stateSubject.value,
      loading: true,
      error: null
    });

    this.loadEntityDetails(node).subscribe({
      next: (entity) => {
        this.stateSubject.next({
          selection: { type: node.type, node, entity },
          loading: false,
          error: null
        });
      },
      error: (err) => {
        this.stateSubject.next({
          selection: { type: node.type, node },
          loading: false,
          error: err.message || 'Failed to load entity details'
        });
      }
    });
  }

  clearSelection(): void {
    this.stateSubject.next({
      selection: null,
      loading: false,
      error: null
    });
  }

  refreshCurrentSelection(): void {
    const current = this.stateSubject.value.selection;
    if (current && current.node) {
      this.select(current.node);
    }
  }

  refreshTree(): void {
    this.treeRefreshSubject.next();
  }

  private loadEntityDetails(node: TreeNode): Observable<QueueInfo | TopicInfo | SubscriptionInfo | undefined> {
    switch (node.type) {
      case 'queue':
        return this.queueService.getQueue(node.name);
      case 'topic':
        return this.topicService.getTopic(node.name);
      case 'subscription':
        const subscriptionData = node.data as SubscriptionNodeData | undefined;
        const topicName = node.parent?.name || subscriptionData?.topicName;
        this.logger.log('Loading subscription details:', { nodeName: node.name, topicName, nodeData: node.data, parent: node.parent?.name });
        if (topicName) {
          return this.topicService.getSubscription(topicName, node.name);
        }
        return of(undefined);
      default:
        return of(undefined);
    }
  }

  get currentSelection(): EntitySelection | null {
    return this.stateSubject.value.selection;
  }

  get isLoading(): boolean {
    return this.stateSubject.value.loading;
  }

  navigateToSubscription(topicName: string, subscriptionName: string): void {
    const node: TreeNode = {
      id: `${topicName}/subscriptions/${subscriptionName}`,
      name: subscriptionName,
      type: 'subscription',
      icon: 'mail',
      expandable: false,
      level: 2,
      data: { topicName } as SubscriptionNodeData,
    };
    this.select(node);
  }
}
