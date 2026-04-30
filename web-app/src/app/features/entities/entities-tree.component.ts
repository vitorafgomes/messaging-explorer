import {Component, OnInit, OnDestroy, inject, WritableSignal, signal} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import {finalize, Subject} from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TreeNode } from '../../core/models';
import { TreeDataBuilderService, EntitySelectionService, ConnectionService, LoggerService, DeadLetterNotificationService } from '../../core/services';

@Component({
  selector: 'app-entities-tree',
  standalone: true,
  imports: [
    CommonModule,
    MatSnackBarModule
  ],
  template: `
    <div class="tree-container">
      <div class="tree-header">
        <div class="header-content">
          <i class="fa fa-sitemap header-icon"></i>
          <span class="tree-title">Service Bus Entities</span>
        </div>
        <button class="btn btn-sm btn-outline-secondary refresh-btn"
                (click)="loadTree()"
                [disabled]="loading() || !isConnected"
                title="Refresh Entities">
          <i class="fa-solid fa-arrows-rotate"></i>
        </button>
      </div>

      @if (!isConnected) {
        <div class="tree-empty">
          <i class="fa fa-cloud fa-4x empty-icon"></i>
          <span class="empty-title">Not Connected</span>
          <span class="empty-subtitle">Connect to a Service Bus to view entities</span>
        </div>
      } @else if (loading()) {
        <div class="tree-loading">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
          <span class="loading-text">Loading entities...</span>
        </div>
      } @else if (treeData.length === 0) {
        <div class="tree-empty">
          <i class="fa fa-inbox fa-4x empty-icon"></i>
          <span class="empty-title">No Entities Found</span>
          <span class="empty-subtitle">No queues or topics available</span>
        </div>
      } @else {
        <div class="entity-tree">
          @for (node of treeData; track node.id) {
            <div class="tree-node-wrapper">
              @if (hasChild(0, node)) {
                <div class="tree-node tree-node-parent"
                     [class.selected]="isSelected(node)"
                     [class.node-category]="node.type === 'category'"
                     [class.node-topic]="node.type === 'topic'">
                  <div class="node-icon-wrapper node-icon-expandable" (click)="toggleNode(node, $event)">
                    <i class="fa node-icon"
                       [class.fa-plus-square-o]="!isExpanded(node)"
                       [class.fa-minus-square-o]="isExpanded(node)"></i>
                  </div>
                  <div class="node-icon-wrapper" [class]="getIconClass(node)" (click)="selectNode(node)">
                    <i class="fa node-icon"
                       [class.fa-folder-open]="node.type === 'category' && isExpanded(node)"
                       [class.fa-folder]="node.type === 'category' && !isExpanded(node)"
                       [class.fa-tower-broadcast]="node.type === 'topic'"></i>
                  </div>
                  <span class="node-name" (click)="selectNode(node)">{{ node.name }}</span>
                  @if (node.type === 'category') {
                    <span class="node-count">
                      <i class="fa-solid fa-hashtag count-icon"></i>
                      {{ node.children?.length || 0 }}
                    </span>
                  }
                  @if (node.type === 'topic' && node.data) {
                    @let topicData = $any(node.data);
                    <span class="node-count">
                      <i class="fa-solid fa-bell count-icon"></i>
                      {{ topicData.subscriptionCount }}
                    </span>
                  }
                </div>
                @if (isExpanded(node) && node.children) {
                  <div class="tree-children">
                    @for (child of node.children; track child.id) {
                      @if (hasChild(0, child)) {
                        <!-- Topic with subscriptions - expandable -->
                        <div class="tree-node tree-node-parent"
                             [class.selected]="isSelected(child)"
                             [class.node-topic]="child.type === 'topic'">
                          <div class="node-icon-wrapper node-icon-expandable" (click)="toggleNode(child, $event)">
                            <i class="fa-solid node-icon"
                               [class.fa-square-plus]="!isExpanded(child)"
                               [class.fa-square-minus]="isExpanded(child)"></i>
                          </div>
                          <span class="node-name" (click)="selectNode(child)">{{ child.name }}</span>
                          @if (child.type === 'topic' && child.data) {
                            @let topicData = $any(child.data);
                            <span class="node-count">
                              <i class="fa-solid fa-bell count-icon"></i>
                              {{ topicData.subscriptionCount }}
                            </span>
                            @if (topicData.patternDisplay) {
                              <div class="node-badges">
                                <span class="badge badge-pattern"
                                      [title]="topicData.detectedPattern ? 'Pattern: ' + topicData.patternDisplay + ' (Confidence: ' + (topicData.detectedPattern.confidence * 100).toFixed(0) + '%) - ' + topicData.detectedPattern.reason : topicData.patternDisplay">
                                  <i class="fa fa-project-diagram badge-icon"></i>
                                  {{ topicData.patternDisplay }}
                                </span>
                              </div>
                            }
                          }
                        </div>
                        @if (isExpanded(child) && child.children) {
                          <div class="tree-children">
                            @for (subscription of child.children; track subscription.id) {
                              <div class="tree-node"
                                   [class.selected]="isSelected(subscription)"
                                   [class.node-subscription]="subscription.type === 'subscription'"
                                   (click)="selectNode(subscription)">

                                <div class="node-icon-wrapper" [class]="getIconClass(subscription)">
                                  <i class="fa node-icon fa-rss"></i>
                                </div>
                                <span class="node-name">{{ subscription.name }}</span>
                                @if (subscription.type === 'subscription' && subscription.data) {
                                  @let subData = $any(subscription.data);
                                  <div class="node-badges">
                                    @if (subData.activeMessageCount > 0) {
                                      <span class="badge badge-active" title="Active Messages">
                                        <i class="fa fa-envelope badge-icon"></i>
                                        {{ subData.activeMessageCount }}
                                      </span>
                                    }
                                    @if (subData.deadLetterMessageCount > 0) {
                                      <span class="badge badge-warning" title="Dead Letter Messages">
                                        <i class="fa fa-exclamation-circle badge-icon"></i>
                                        {{ subData.deadLetterMessageCount }}
                                      </span>
                                    }
                                  </div>
                                }
                              </div>
                            }
                          </div>
                        }
                      } @else {
                        <!-- Queue or topic without subscriptions - not expandable -->
                        <div class="tree-node"
                             [class.selected]="isSelected(child)"
                             [class.node-queue]="child.type === 'queue'"
                             [class.node-topic]="child.type === 'topic'"
                             (click)="selectNode(child)">
                          <div class="node-icon-wrapper" [class]="getIconClass(child)">
                            <i class="fa node-icon"
                               [class.fa-inbox]="child.type === 'queue'"
                               [class.fa-tower-broadcast]="child.type === 'topic'"></i>
                          </div>
                          <span class="node-name">{{ child.name }}</span>
                        @if (child.type === 'queue' && child.data) {
                          @let queueData = $any(child.data);
                          <div class="node-badges">
                            @if (queueData.activeMessageCount > 0) {
                              <span class="badge badge-active" title="Active Messages">
                                <i class="fa fa-envelope badge-icon"></i>
                                {{ queueData.activeMessageCount }}
                              </span>
                            }
                            @if (queueData.deadLetterMessageCount > 0) {
                              <span class="badge badge-warning" title="Dead Letter Messages">
                                <i class="fa fa-exclamation-circle badge-icon"></i>
                                {{ queueData.deadLetterMessageCount }}
                              </span>
                            }
                          </div>
                        }
                        @if (child.type === 'subscription' && child.data) {
                          @let subData = $any(child.data);
                          <div class="node-badges">
                            @if (subData.activeMessageCount > 0) {
                              <span class="badge badge-active" title="Active Messages">
                                <i class="fa fa-envelope badge-icon"></i>
                                {{ subData.activeMessageCount }}
                              </span>
                            }
                            @if (subData.deadLetterMessageCount > 0) {
                              <span class="badge badge-warning" title="Dead Letter Messages">
                                <i class="fa fa-exclamation-circle badge-icon"></i>
                                {{ subData.deadLetterMessageCount }}
                              </span>
                            }
                          </div>
                        }
                        @if (child.type === 'topic' && child.data) {
                          @let topicData = $any(child.data);
                          <div class="node-badges">
                            @if (topicData.patternDisplay) {
                              <span class="badge badge-pattern"
                                    [title]="topicData.detectedPattern ? 'Pattern: ' + topicData.patternDisplay + ' (Confidence: ' + (topicData.detectedPattern.confidence * 100).toFixed(0) + '%) - ' + topicData.detectedPattern.reason : topicData.patternDisplay">
                                <i class="fa fa-project-diagram badge-icon"></i>
                                {{ topicData.patternDisplay }}
                              </span>
                            }
                          </div>
                        }
                        </div>
                      }
                    }
                  </div>
                }
              } @else {
                <div class="tree-node"
                     [class.selected]="isSelected(node)"
                     [class.node-queue]="node.type === 'queue'"
                     [class.node-subscription]="node.type === 'subscription'"
                     (click)="selectNode(node)">
                  <div class="node-icon-wrapper" [class]="getIconClass(node)">
                    <i class="fa node-icon"
                       [class.fa-inbox]="node.type === 'queue'"
                       [class.fa-rss]="node.type === 'subscription'"></i>
                  </div>
                  <span class="node-name">{{ node.name }}</span>
                  @if (node.type === 'queue' && node.data) {
                    @let queueData = $any(node.data);
                    <div class="node-badges">
                      @if (queueData.activeMessageCount > 0) {
                        <span class="badge badge-active" title="Active Messages">
                          <i class="fa fa-envelope badge-icon"></i>
                          {{ queueData.activeMessageCount }}
                        </span>
                      }
                      @if (queueData.deadLetterMessageCount > 0) {
                        <span class="badge badge-warning" title="Dead Letter Messages">
                          <i class="fa fa-exclamation-circle badge-icon"></i>
                          {{ queueData.deadLetterMessageCount }}
                        </span>
                      }
                    </div>
                  }
                  @if (node.type === 'subscription' && node.data) {
                    @let subData = $any(node.data);
                    <div class="node-badges">
                      @if (subData.activeMessageCount > 0) {
                        <span class="badge badge-active" title="Active Messages">
                          <i class="fa fa-envelope badge-icon"></i>
                          {{ subData.activeMessageCount }}
                        </span>
                      }
                      @if (subData.deadLetterMessageCount > 0) {
                        <span class="badge badge-warning" title="Dead Letter Messages">
                          <i class="fa fa-exclamation-circle badge-icon"></i>
                          {{ subData.deadLetterMessageCount }}
                        </span>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .tree-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--bs-body-bg);
      height: 100%;
    }

    .tree-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      background: var(--bs-secondary-bg);
      border-bottom: 1px solid var(--bs-border-color);
    }

    .header-content {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .header-icon {
      font-size: 18px;
      color: var(--bs-secondary-color);
    }

    .tree-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--bs-body-color);
    }

    .refresh-btn {
      padding: 4px 8px;

      i {
        font-size: 14px;
      }
    }

    .tree-loading, .tree-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      color: var(--bs-secondary-color);
      gap: 12px;
      text-align: center;
    }

    .empty-icon {
      color: var(--bs-secondary-color);
      opacity: 0.5;
    }

    .empty-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--bs-body-color);
    }

    .empty-subtitle {
      font-size: 12px;
      color: var(--bs-secondary-color);
    }

    .loading-text {
      margin-top: 8px;
      font-size: 13px;
      color: var(--bs-secondary-color);
    }

    .entity-tree {
      flex: 1;
      overflow: auto;
      padding: 4px 0;
    }

    .tree-node-wrapper {
      position: relative;
    }

    .tree-node {
      display: flex;
      align-items: center;
      padding: 0 8px;
      min-height: 28px;
      transition: background-color 0.15s ease;
      user-select: none;
      position: relative;

      &:hover {
        background: var(--bs-secondary-bg);
      }

      &.node-category .node-icon {
        color: var(--bs-secondary-color);
      }

      &.node-queue .node-icon {
        color: #66bb6a;
      }

      &.node-topic .node-icon {
        color: #ffa726;
      }

      &.node-subscription .node-icon {
        color: #42a5f5;
      }

      &.selected {
        background: rgba(var(--bs-primary-rgb), 0.1);
        border-left: 4px solid var(--bs-primary);
        animation: pulse-selection 2s ease-in-out infinite;
        position: relative;

        .node-name {
          font-weight: 600;
          color: var(--bs-primary);
        }

        &.node-category {
          background: var(--bs-secondary-bg);
          border-left: 4px solid var(--bs-secondary-color);
          animation: none;

          .node-name {
            color: var(--bs-body-color);
            font-weight: 600;
          }

          .node-icon {
            color: var(--bs-secondary-color);
          }
        }

        &.node-queue {
          background: rgba(102, 187, 106, 0.15);
          border-left: 4px solid #4caf50;
          box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.4);

          .node-name {
            color: #2e7d32;
            font-weight: 600;
          }

          .node-icon {
            color: #4caf50;
            animation: pulse-icon 2s ease-in-out infinite;
          }
        }

        &.node-topic {
          background: rgba(255, 167, 38, 0.15);
          border-left: 4px solid #ff9800;
          box-shadow: 0 0 0 0 rgba(255, 152, 0, 0.4);

          .node-name {
            color: #e65100;
            font-weight: 600;
          }

          .node-icon {
            color: #ff9800;
            animation: pulse-icon 2s ease-in-out infinite;
          }
        }

        &.node-subscription {
          background: rgba(66, 165, 245, 0.15);
          border-left: 4px solid #1976d2;
          box-shadow: 0 0 0 0 rgba(25, 118, 210, 0.4);

          .node-name {
            color: #1565c0;
            font-weight: 600;
          }

          .node-icon {
            color: #1976d2;
            animation: pulse-icon 2s ease-in-out infinite;
          }
        }
      }

      &.tree-node-parent {
        .node-name {
          font-weight: 500;
        }
      }
    }

    .node-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      margin-right: 4px;
      flex-shrink: 0;
      cursor: pointer;
      transition: transform 0.2s ease;

      &:hover .toggle-icon {
        color: var(--bs-primary);
      }
    }

    .toggle-icon {
      font-size: 14px;
      color: var(--bs-secondary-color);
      transition: color 0.15s ease, transform 0.2s ease;
    }

    .node-icon-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      margin-right: 4px;
      flex-shrink: 0;

      &.node-icon-expandable {
        cursor: pointer;
        margin-right: 2px;

        &:hover .node-icon {
          opacity: 0.7;
          transform: scale(1.1);
        }
      }

      &:hover .node-icon {
        opacity: 0.7;
      }
    }

    .node-icon {
      font-size: 16px;
      transition: color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
    }

    .node-name {
      flex: 1;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--bs-body-color);
      line-height: 28px;
      cursor: pointer;
    }

    .node-badges {
      display: flex;
      gap: 4px;
      margin-left: 8px;
      flex-shrink: 0;
    }

    .badge {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      line-height: 1;

      &.badge-active {
        background: rgba(var(--bs-primary-rgb), 0.15);
        color: var(--bs-primary);
      }

      &.badge-warning {
        background: rgba(var(--bs-danger-rgb), 0.15);
        color: var(--bs-danger);
      }

      &.badge-pattern {
        background: rgba(var(--bs-success-rgb), 0.15);
        color: var(--bs-success);
      }
    }

    .badge-icon {
      font-size: 10px;
    }

    .node-count {
      display: flex;
      align-items: center;
      gap: 3px;
      color: var(--bs-secondary-color);
      font-size: 11px;
      margin-left: 6px;
      flex-shrink: 0;
    }

    .count-icon {
      font-size: 12px;
    }

    .tree-children {
      padding-left: 24px;
      position: relative;

      /* Vertical line for subscriptions (inside topics) */
      .tree-children {
        &::before {
          content: '';
          position: absolute;
          left: 12px;
          top: 0;
          bottom: 0;
          width: 1px;
          background: var(--bs-border-color);
        }

        .tree-node::after {
          content: '';
          position: absolute;
          left: 12px;
          top: 14px;
          width: 8px;
          height: 1px;
          background: var(--bs-border-color);
        }

        .tree-node:last-child::before {
          content: '';
          position: absolute;
          left: 12px;
          top: 14px;
          bottom: 0;
          width: 1px;
          background: var(--bs-body-bg);
        }
      }
    }

    .entity-tree::-webkit-scrollbar {
      width: 8px;
    }

    .entity-tree::-webkit-scrollbar-track {
      background: var(--bs-secondary-bg);
    }

    .entity-tree::-webkit-scrollbar-thumb {
      background: var(--bs-border-color);
      border-radius: 4px;

      &:hover {
        background: var(--bs-secondary-color);
      }
    }

    @keyframes pulse-selection {
      0%, 100% {
        box-shadow: 0 0 0 0 rgba(var(--bs-primary-rgb), 0.4);
      }
      50% {
        box-shadow: 0 0 0 4px rgba(var(--bs-primary-rgb), 0);
      }
    }

    @keyframes pulse-icon {
      0%, 100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.7;
        transform: scale(1.1);
      }
    }
  `]
})
export class EntitiesTreeComponent implements OnInit, OnDestroy {
  private treeDataBuilder = inject(TreeDataBuilderService);
  private selectionService = inject(EntitySelectionService);
  private connectionService = inject(ConnectionService);
  private logger = inject(LoggerService);
  private notificationService = inject(DeadLetterNotificationService);
  private destroy$ = new Subject<void>();

  treeData: TreeNode[] = [];
  expandedNodes = new Set<string>();
  loading: WritableSignal<boolean> = signal<boolean>(false);
  selectedNode: TreeNode | null = null;

  get isConnected(): boolean {
    return this.connectionService.isConnected;
  }

  ngOnInit() {
    if (this.isConnected) {
      this.loadTree();
    }

    this.connectionService.connectionStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        if (status.connected) {
          this.loadTree();
        } else {
          this.treeData = [];
          this.selectionService.clearSelection();
          this.notificationService.clear();
        }
      });

    this.selectionService.selection$
      .pipe(takeUntil(this.destroy$))
      .subscribe(selection => {
        this.selectedNode = selection?.node || null;
      });

    this.selectionService.treeRefresh$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadTree();
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadTree() {
    this.logger.log('[EntitiesTree] loadTree() called');
    this.loading.set(true);
    this.treeDataBuilder.buildTree()
      .pipe(
        finalize(() => {
          this.loading.set(false);
        }),
        takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.logger.log('[EntitiesTree] Tree data received:', data);
          this.treeData = data;

          // Log topics with their children
          data.forEach(category => {
            if (category.type === 'category' && category.name === 'Topics') {
              this.logger.log('[EntitiesTree] Topics category children:', category.children?.length);
              category.children?.forEach(topic => {
                this.logger.log(`[EntitiesTree] Topic: ${topic.name}, expandable: ${topic.expandable}, children: ${topic.children?.length || 0}`);
                if (topic.children && topic.children.length > 0) {
                  this.logger.log(`[EntitiesTree]   -> Children:`, topic.children.map(c => c.name));
                }
              });
            }
          });

          // Auto-expand only categories, not topics
          data.forEach(node => {
            if (node.type === 'category') {
              this.expandedNodes.add(node.id);
              this.logger.log('[EntitiesTree] Auto-expanded category:', node.name);
            }
          });
        },
        error: () => {
          this.treeData = [];
        }
      });
  }

  hasChild = (_: number, node: TreeNode) => {
    const result = node.expandable && node.children && node.children.length > 0;
    if (node.type === 'topic') {
      this.logger.log(`[EntitiesTree] hasChild(${node.name}): expandable=${node.expandable}, hasChildren=${!!node.children}, childCount=${node.children?.length || 0}, result=${result}`);
    }
    return result;
  };

  isExpanded(node: TreeNode): boolean {
    return this.expandedNodes.has(node.id);
  }

  selectNode(node: TreeNode) {
    this.logger.log('Tree selectNode:', { node, type: node.type, data: node.data, parent: node.parent?.name });
    this.selectionService.select(node);
  }

  toggleNode(node: TreeNode, event: Event) {
    event.stopPropagation();
    this.logger.log('[EntitiesTree] toggleNode called for:', node.name, 'type:', node.type, 'expandable:', node.expandable, 'children:', node.children?.length);

    if (this.expandedNodes.has(node.id)) {
      this.logger.log('[EntitiesTree] Collapsing node:', node.name);
      this.expandedNodes.delete(node.id);
    } else {
      this.logger.log('[EntitiesTree] Expanding node:', node.name);
      this.expandedNodes.add(node.id);
    }

    this.logger.log('[EntitiesTree] Node is now expanded:', this.expandedNodes.has(node.id));
  }

  isSelected(node: TreeNode): boolean {
    return this.selectedNode?.id === node.id;
  }

  getIconClass(node: TreeNode): string {
    switch (node.type) {
      case 'queue': return 'icon-queue';
      case 'topic': return 'icon-topic';
      case 'subscription': return 'icon-subscription';
      case 'category': return 'icon-category';
      default: return '';
    }
  }
}
