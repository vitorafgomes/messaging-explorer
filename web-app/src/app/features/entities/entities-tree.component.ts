import {Component, OnInit, OnDestroy, inject, WritableSignal, signal, computed} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {finalize, Subject, Subscription} from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TreeNode } from '../../core/models';
import { TreeDataBuilderService, EntitySelectionService, ConnectionService, LoggerService, DeadLetterNotificationService } from '../../core/services';
import { ProviderService } from '../../core/services/provider.service';
import { EntityFormDialogComponent, EntityFormDialogData } from './entity-form-dialog.component';
import { ExportDefinitionsDialogComponent } from './export-definitions-dialog.component';
import { ImportDefinitionsDialogComponent } from './import-definitions-dialog.component';

@Component({
  selector: 'app-entities-tree',
  standalone: true,
  imports: [
    CommonModule,
    MatSnackBarModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule
  ],
  template: `
    <ng-template #createAction let-node>
      @if (canCreate() && createLabel(node); as label) {
        <button mat-icon-button type="button" class="create-btn" [attr.aria-label]="label" [matTooltip]="label" (click)="openCreate(node, $event)">
          <mat-icon fontIcon="add" />
        </button>
      }
    </ng-template>
    <ng-template #toggle let-node>
      <button type="button" class="node-icon-wrapper node-icon-expandable"
              [attr.aria-label]="(isExpanded(node) ? 'Collapse ' : 'Expand ') + node.name"
              [attr.aria-expanded]="isExpanded(node)"
              (click)="toggleNode(node, $event)">
        <mat-icon class="node-icon" [fontIcon]="isExpanded(node) ? 'expand_more' : 'chevron_right'" />
      </button>
    </ng-template>
    <ng-template #counts let-data>
      <div class="node-badges">
        @if (data.activeMessageCount > 0) {
          <span class="count-chip" title="Active Messages">{{ data.activeMessageCount | number }}</span>
        }
        @if (data.deadLetterMessageCount > 0) {
          <span class="count-chip dead-letter" title="Dead Letter Messages">
            <mat-icon class="chip-icon" fontIcon="warning" aria-hidden="true" />{{ data.deadLetterMessageCount | number }}
          </span>
        }
      </div>
    </ng-template>
    <ng-template #pattern let-topicData>
      <span class="count-chip pattern"
            [title]="topicData.detectedPattern ? 'Pattern: ' + topicData.patternDisplay + ' (Confidence: ' + (topicData.detectedPattern.confidence * 100).toFixed(0) + '%) - ' + topicData.detectedPattern.reason : topicData.patternDisplay">
        <mat-icon class="chip-icon" fontIcon="account_tree" aria-hidden="true" />{{ topicData.patternDisplay }}
      </span>
    </ng-template>
    <div class="tree-container">
      <div class="tree-header">
        <h2 class="tree-title">Entities</h2>
        @if (canUseDefinitions() && isConnected) {
          <button mat-icon-button type="button" class="definitions-btn" aria-label="Export definitions" matTooltip="Export definitions" (click)="openExportDefinitions()">
            <mat-icon fontIcon="download" />
          </button>
          <button mat-icon-button type="button" class="definitions-btn" aria-label="Import definitions" matTooltip="Import definitions" (click)="openImportDefinitions()">
            <mat-icon fontIcon="upload" />
          </button>
        }
        <button mat-icon-button type="button" class="refresh-btn"
                (click)="loadTree()"
                [disabled]="loading() || !isConnected"
                aria-label="Refresh entities"
                matTooltip="Refresh entities">
          <mat-icon fontIcon="refresh" />
        </button>
      </div>

      @if (!isConnected) {
        <div class="tree-empty">
          <mat-icon class="empty-icon" fontIcon="cloud_off" aria-hidden="true" />
          <span class="empty-title">Not Connected</span>
          <span class="empty-subtitle">Connect to a Service Bus to view entities</span>
        </div>
      } @else if (loading()) {
        <div class="tree-loading" role="status">
          <mat-progress-spinner mode="indeterminate" diameter="32" aria-hidden="true" />
          <span class="loading-text">Loading entities...</span>
        </div>
      } @else if (loadError()) {
        <div class="tree-empty" role="alert">
          <mat-icon class="empty-icon error" fontIcon="error" aria-hidden="true" />
          <span class="empty-title">Could not load entities</span>
          <span class="empty-subtitle">The broker did not answer the list of queues and topics.</span>
          <button mat-stroked-button type="button" (click)="loadTree()"><mat-icon fontIcon="refresh" />Retry</button>
        </div>
      } @else if (treeData.length === 0) {
        <div class="tree-empty">
          <mat-icon class="empty-icon" fontIcon="inbox" aria-hidden="true" />
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
                  <ng-container *ngTemplateOutlet="toggle; context: { $implicit: node }" />
                  <span class="node-name" (click)="selectNode(node)">{{ node.name }}</span>
                  @if (node.type === 'category') {
                    <span class="node-count" [title]="(node.children?.length || 0) + ' ' + node.name.toLowerCase()">{{ node.children?.length || 0 }}</span>
                    <ng-container *ngTemplateOutlet="createAction; context: { $implicit: node }" />
                  }
                  @if (node.type === 'topic' && node.data) {
                    @let topicData = $any(node.data);
                    <span class="node-count" [title]="topicData.subscriptionCount + ' subscriptions'">{{ topicData.subscriptionCount }}</span>
                  }
                </div>
                @if (isExpanded(node) && node.children) {
                  <div class="tree-children">
                    @for (child of node.children; track child.id) {
                      @if (hasChild(0, child)) {
                        <div class="tree-node tree-node-parent"
                             [class.selected]="isSelected(child)"
                             [class.node-topic]="child.type === 'topic'">
                          <ng-container *ngTemplateOutlet="toggle; context: { $implicit: child }" />
                          <span class="node-name" (click)="selectNode(child)">{{ child.name }}</span>
                          @if (child.type === 'topic' && child.data) {
                            @let topicData = $any(child.data);
                            <span class="node-count" [title]="topicData.subscriptionCount + ' subscriptions'">{{ topicData.subscriptionCount }}</span>
                            @if (topicData.patternDisplay) {
                              <div class="node-badges">
                                <ng-container *ngTemplateOutlet="pattern; context: { $implicit: topicData }" />
                              </div>
                            }
                          }
                          <ng-container *ngTemplateOutlet="createAction; context: { $implicit: child }" />
                        </div>
                        @if (isExpanded(child) && child.children) {
                          <div class="tree-children">
                            @for (subscription of child.children; track subscription.id) {
                              <div class="tree-node"
                                   [class.selected]="isSelected(subscription)"
                                   [class.node-subscription]="subscription.type === 'subscription'"
                                   (click)="selectNode(subscription)">
                                <mat-icon class="node-icon" fontIcon="subdirectory_arrow_right" aria-hidden="true" />
                                <span class="node-name">{{ subscription.name }}</span>
                                @if (subscription.type === 'subscription' && subscription.data) {
                                  <ng-container *ngTemplateOutlet="counts; context: { $implicit: subscription.data }" />
                                }
                              </div>
                            }
                          </div>
                        }
                      } @else {
                        <div class="tree-node"
                             [class.selected]="isSelected(child)"
                             [class.node-queue]="child.type === 'queue'"
                             [class.node-topic]="child.type === 'topic'"
                             (click)="selectNode(child)">
                          <mat-icon class="node-icon" [fontIcon]="child.type === 'topic' ? 'campaign' : 'inbox'" aria-hidden="true" />
                          <span class="node-name">{{ child.name }}</span>
                          @if ((child.type === 'queue' || child.type === 'subscription') && child.data) {
                            <ng-container *ngTemplateOutlet="counts; context: { $implicit: child.data }" />
                          }
                          @if (child.type === 'topic' && child.data) {
                            @let topicData = $any(child.data);
                            <div class="node-badges">
                              @if (topicData.patternDisplay) {
                                <ng-container *ngTemplateOutlet="pattern; context: { $implicit: topicData }" />
                              }
                            </div>
                          }
                          <ng-container *ngTemplateOutlet="createAction; context: { $implicit: child }" />
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
                  <mat-icon class="node-icon" [fontIcon]="node.type === 'category' ? 'folder' : node.type === 'subscription' ? 'subdirectory_arrow_right' : 'inbox'" aria-hidden="true" />
                  <span class="node-name">{{ node.name }}</span>
                  <ng-container *ngTemplateOutlet="createAction; context: { $implicit: node }" />
                  @if ((node.type === 'queue' || node.type === 'subscription') && node.data) {
                    <ng-container *ngTemplateOutlet="counts; context: { $implicit: node.data }" />
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './entities-tree.component.scss'
})
export class EntitiesTreeComponent implements OnInit, OnDestroy {
  private treeDataBuilder = inject(TreeDataBuilderService);
  private selectionService = inject(EntitySelectionService);
  private connectionService = inject(ConnectionService);
  private logger = inject(LoggerService);
  private notificationService = inject(DeadLetterNotificationService);
  private dialog = inject(MatDialog);
  private providerService = inject(ProviderService);
  private destroy$ = new Subject<void>();

  /** Create is offered only when the connected broker's API explicitly declares entity administration. */
  readonly canCreate = computed(() => this.providerService.capabilities()?.supportsEntityUpdate === true);

  /** Export and import of definitions are offered only when the connected broker's API explicitly declares them. */
  readonly canUseDefinitions = computed(() => this.providerService.capabilities()?.supportsDefinitions === true);

  treeData: TreeNode[] = [];
  expandedNodes = new Set<string>();
  loading: WritableSignal<boolean> = signal<boolean>(false);
  loadError = signal(false);
  private treeLoad?: Subscription;
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
          this.notificationService.clear();
          this.loadTree();
        } else {
          this.treeData = [];
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
    this.treeLoad?.unsubscribe();
    this.loading.set(true);
    this.loadError.set(false);
    this.treeLoad = this.treeDataBuilder.buildTree()
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
        error: (err) => {
          this.logger.error('[EntitiesTree] Failed to load entities:', err);
          this.treeData = [];
          this.loadError.set(true);
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

  createLabel(node: TreeNode): string | null {
    if (node.id === 'category-queues') return 'Create queue';
    if (node.id === 'category-topics') return 'Create topic';
    if (node.type === 'topic') return `Create subscription in ${node.name}`;
    return null;
  }

  openCreate(node: TreeNode, event: Event) {
    event.stopPropagation();
    const data: EntityFormDialogData = node.type === 'topic'
      ? { mode: 'create', kind: 'subscription', topicName: node.name }
      : { mode: 'create', kind: node.id === 'category-queues' ? 'queue' : 'topic', topicName: undefined };
    this.dialog.open(EntityFormDialogComponent, { data, width: '720px', maxWidth: '95vw' });
  }

  openExportDefinitions() {
    this.dialog.open(ExportDefinitionsDialogComponent, { width: '520px', maxWidth: '95vw' });
  }

  openImportDefinitions() {
    this.dialog.open(ImportDefinitionsDialogComponent, { width: '760px', maxWidth: '95vw' });
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
