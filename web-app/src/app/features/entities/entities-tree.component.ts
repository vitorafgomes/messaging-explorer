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
import { SubscriptionNodeData, TreeNode, getProviderMetadata } from '../../core/models';
import { TreeDataBuilderService, EntitySelectionService, ConnectionService, LoggerService, DeadLetterNotificationService, ResubmitRunService } from '../../core/services';
import { ProviderService } from '../../core/services/provider.service';
import { EntityFormDialogComponent, EntityFormDialogData } from './entity-form-dialog.component';
import { ExportDefinitionsDialogComponent } from './export-definitions-dialog.component';
import { ImportDefinitionsDialogComponent } from './import-definitions-dialog.component';

/** The statuses that get a marker in the tree, with its icon and tooltip; Active and any other provider's status get none. */
export const STATUS_MARKERS: Partial<Record<string, { icon: string; text: string }>> = {
  Disabled: { icon: 'block', text: 'Disabled: no message can be sent or received' },
  SendDisabled: { icon: 'cancel_schedule_send', text: 'Send disabled: messages can be received, not sent' },
  ReceiveDisabled: { icon: 'do_not_disturb_on', text: 'Receive disabled: messages can be sent, not received' }
};

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
    <ng-template #row let-node>
      <div class="tree-row">
        <button type="button" class="tree-node"
                [class.selected]="isSelected(node)"
                [class.node-queue]="node.type === 'queue'"
                [class.node-topic]="node.type === 'topic'"
                [class.node-subscription]="node.type === 'subscription'"
                [attr.aria-current]="isSelected(node) ? 'true' : 'false'"
                [attr.aria-expanded]="node.type === 'topic' ? isExpanded(node) : null"
                (click)="selectNode(node)">
          <mat-icon class="node-icon" [fontIcon]="node.type === 'topic' ? 'campaign' : node.type === 'subscription' ? 'subdirectory_arrow_right' : 'inbox'" aria-hidden="true" />
          <span class="node-name">{{ node.name }}</span>
          @if (node.type === 'subscription' && $any(node.data)?.routingKey; as key) {
            <span class="routing-key" [matTooltip]="'Routing key ' + key">{{ key }}</span>
          }
          @if (node.type !== 'subscription' && $any(node.data)?.patternDisplay; as pattern) {
            <span class="pattern-chip" [matTooltip]="$any(node.data)?.detectedPattern?.reason || pattern">{{ pattern }}</span>
          }
          @if (statusMarker(node); as marker) {
            <mat-icon class="node-marker" [fontIcon]="marker.icon" [matTooltip]="marker.text" [attr.aria-label]="marker.text" role="img" />
          }
          @if (forwardMarker(node); as marker) {
            <mat-icon class="node-marker" fontIcon="forward" [matTooltip]="marker" [attr.aria-label]="marker" role="img" />
          }
          @if (node.type !== 'topic' && node.data; as data) {
            @if ($any(data).activeMessageCount > 0) {
              <span class="count-chip"><span class="count" aria-hidden="true">{{ $any(data).activeMessageCount | number }}</span><span class="visually-hidden">, {{ $any(data).activeMessageCount | number }} active messages</span></span>
            }
            @if ($any(data).deadLetterMessageCount > 0) {
              <span class="count-chip dead-letter"><mat-icon class="chip-icon" fontIcon="warning" aria-hidden="true" /><span class="count" aria-hidden="true">{{ $any(data).deadLetterMessageCount | number }}</span><span class="visually-hidden">, {{ $any(data).deadLetterMessageCount | number }} dead-letter messages</span></span>
            }
            @if (resubmitRunning(node)) {
              <mat-progress-spinner class="resubmit-spinner" mode="indeterminate" diameter="14" aria-hidden="true" /><span class="visually-hidden">, resubmit running</span>
            }
          }
        </button>
        @if (node.type === 'topic') {
          <ng-container *ngTemplateOutlet="createAction; context: { $implicit: node }" />
        }
      </div>
    </ng-template>
    <div class="tree-container">
      <div class="tree-header">
        <label class="filter">
          <mat-icon fontIcon="search" aria-hidden="true" />
          <input type="text" aria-label="Filter entities by name" placeholder="Filter by name" autocomplete="off"
                 [value]="filter()" (input)="filter.set($any($event.target).value)">
        </label>
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
          @if (hiddenCount() > 0) {
            <p class="hidden-note" aria-live="polite">{{ hiddenCount() }} of {{ entityCount() }} entities hidden by the filter</p>
          }
          @for (category of treeData; track category.id) {
            <div class="section">
              <h2 class="section-head">{{ category.id === 'category-topics' ? terms().topics : category.name }} <span class="section-count">{{ category.children?.length || 0 | number }}</span></h2>
              <ng-container *ngTemplateOutlet="createAction; context: { $implicit: category }" />
            </div>
            @for (node of shown(category.children); track node.id) {
              <ng-container *ngTemplateOutlet="row; context: { $implicit: node }" />
              @if (node.type === 'topic' && isExpanded(node) && subscriptionsFailed().has(node.id)) {
                <p class="subscriptions-error" role="alert">Could not load the subscriptions of {{ node.name }}.</p>
              }
              @if (node.type === 'topic' && isExpanded(node) && shownChildren(node).length) {
                <div class="tree-children">
                  @for (subscription of shownChildren(node); track subscription.id) {
                    <ng-container *ngTemplateOutlet="row; context: { $implicit: subscription }" />
                  }
                </div>
              }
            }
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
  private readonly resubmitRuns = inject(ResubmitRunService);

  /** An automatic dead-letter resubmit is running or paused on this queue or subscription. */
  resubmitRunning(node: TreeNode): boolean {
    if (node.type !== 'queue' && node.type !== 'subscription') return false;
    return !!this.resubmitRuns.find({
      entityType: node.type,
      entityName: node.name,
      topicName: node.type === 'subscription' ? node.parent?.name ?? (node.data as SubscriptionNodeData | undefined)?.topicName : undefined,
      subQueue: 'deadletter'
    })?.isActive();
  }
  private logger = inject(LoggerService);
  private notificationService = inject(DeadLetterNotificationService);
  private dialog = inject(MatDialog);
  private providerService = inject(ProviderService);
  private destroy$ = new Subject<void>();

  /** Create is offered only when the connected broker's API explicitly declares entity administration. */
  /** The connected broker's words for topics and subscriptions: Exchanges and bindings on RabbitMQ. */
  terms() {
    return getProviderMetadata(this.providerService.selectedProvider).terms;
  }

  readonly canCreate = computed(() => this.providerService.capabilities()?.supportsEntityUpdate === true);

  /** Export and import of definitions are offered only when the connected broker's API explicitly declares them. */
  readonly canUseDefinitions = computed(() => this.providerService.capabilities()?.supportsDefinitions === true);

  treeData: TreeNode[] = [];
  /** The text typed in the filter; a row is shown when its name holds it, in any case. */
  readonly filter = signal('');
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
          this.subscriptionsFailed.set(new Set());
          for (const topic of data.find(c => c.id === 'category-topics')?.children ?? []) {
            if (this.opened().has(topic.id) && !topic.children?.length) this.loadSubscriptions(topic);
          }
        },
        error: (err) => {
          this.logger.error('[EntitiesTree] Failed to load entities:', err);
          this.treeData = [];
          this.loadError.set(true);
        }
      });
  }

  private matches(node: TreeNode): boolean {
    const text = this.filter().trim().toLowerCase();
    return !text || node.name.toLowerCase().includes(text);
  }

  /** The children of a topic shown under it: all of them when the topic matches the filter, else those that match. */
  shownChildren(topic: TreeNode): TreeNode[] {
    const children = topic.children ?? [];
    return this.matches(topic) ? children : children.filter(child => this.matches(child));
  }

  /** The entities of a section that pass the filter; a topic stays when one of its subscriptions does. */
  shown(nodes: TreeNode[] | undefined): TreeNode[] {
    return (nodes ?? []).filter(node => this.matches(node) || (node.type === 'topic' && this.shownChildren(node).length > 0));
  }

  /** Every queue, topic and subscription of the tree. */
  entityCount(): number {
    return this.treeData.flatMap(category => category.children ?? []).reduce((count, node) => count + 1 + (node.type === 'topic' ? node.children?.length ?? 0 : 0), 0);
  }

  /** How many entities the filter hides. */
  hiddenCount(): number {
    const visible = this.treeData.flatMap(category => this.shown(category.children))
      .reduce((count, node) => count + 1 + (node.type === 'topic' ? this.shownChildren(node).length : 0), 0);
    return this.entityCount() - visible;
  }

  /** A marker for a queue or topic the broker reads as disabled, send-disabled or receive-disabled; none for any other status. */
  statusMarker(node: TreeNode): { icon: string; text: string } | null {
    if (node.type !== 'queue' && node.type !== 'topic') return null;
    const status = (node.data as { status?: string } | undefined)?.status ?? '';
    return STATUS_MARKERS[status] ?? null;
  }

  /** The tooltip of the forwarding marker of a queue that forwards its messages; null when it does not forward. */
  forwardMarker(node: TreeNode): string | null {
    const target = node.type === 'queue' ? (node.data as { forwardTo?: string | null } | undefined)?.forwardTo : null;
    return target ? `Forwards every message to ${target}` : null;
  }

  /** The topics whose subscriptions the user opened; every topic starts closed. */
  private readonly opened = signal<ReadonlySet<string>>(new Set());

  /** A topic shows its subscriptions when opened, while the filter has text, or when one of them is selected. */
  isExpanded(topic: TreeNode): boolean {
    return this.opened().has(topic.id)
      || this.filter().trim() !== ''
      || (!!this.selectedNode && (topic.children ?? []).some(child => child.id === this.selectedNode!.id));
  }

  /** The topics whose subscriptions could not be read when they were opened. */
  readonly subscriptionsFailed = signal<ReadonlySet<string>>(new Set());

  selectNode(node: TreeNode) {
    if (node.type === 'topic') {
      const next = new Set(this.opened());
      const opening = !next.delete(node.id);
      if (opening) next.add(node.id);
      this.opened.set(next);
      if (opening && !node.children?.length) this.loadSubscriptions(node);
    }
    this.selectionService.select(node);
  }

  /** Reads the subscriptions of a topic whose list came without them, as when its count said none. */
  private loadSubscriptions(topic: TreeNode) {
    const failed = new Set(this.subscriptionsFailed());
    failed.delete(topic.id);
    this.subscriptionsFailed.set(failed);
    this.treeDataBuilder.loadSubscriptions(topic).pipe(takeUntil(this.destroy$)).subscribe({
      next: subscriptions => {
        topic.children = subscriptions;
        this.opened.set(new Set(this.opened()));
      },
      error: err => {
        this.logger.error(`[EntitiesTree] Could not load the subscriptions of ${topic.name}`, err);
        this.subscriptionsFailed.set(new Set(this.subscriptionsFailed()).add(topic.id));
      }
    });
  }

  createLabel(node: TreeNode): string | null {
    if (node.id === 'category-queues') return 'Create queue';
    if (node.id === 'category-topics') return `Create ${this.terms().topic}`;
    if (node.type === 'topic') return `Create ${this.terms().subscription} in ${node.name}`;
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
}
