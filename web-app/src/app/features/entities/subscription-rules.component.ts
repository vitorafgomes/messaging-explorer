import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { SubscriptionInfo, SubscriptionRuleInfo } from '../../core/models';
import { EntitySelectionService, TopicService } from '../../core/services';
import { ProviderService } from '../../core/services/provider.service';
import { describeFilter } from './rule-validation';
import { RuleFormDialogComponent, RuleFormDialogData } from './rule-form-dialog.component';
import { RuleDeleteDialogComponent, RuleDeleteDialogData } from './rule-delete-dialog.component';

type ListState = 'ready' | 'loading' | 'failed' | 'gone';

const FILTER_LABELS: Record<string, string> = { Sql: 'SQL', Correlation: 'Correlation', True: 'True', False: 'False' };

/**
 * The rules of a subscription as a table. With the capability `supportsSubscriptionRules` explicitly
 * true it offers Add, Edit and Delete and reads the list again after each change; without it the
 * same table is read-only.
 */
@Component({
  selector: 'app-subscription-rules',
  standalone: true,
  imports: [MatTableModule, MatButtonModule, MatIconModule, MatChipsModule, MatTooltipModule, MatProgressBarModule],
  template: `
    <div class="bar">
      <span class="lead">A message is delivered when at least one rule matches.</span>
      @if (canEdit() && state() === 'ready') {
        <button mat-flat-button type="button" (click)="add()"><mat-icon>add</mat-icon>Add rule</button>
      }
    </div>

    @switch (state()) {
      @case ('loading') {
        <mat-progress-bar mode="indeterminate" aria-label="Reading the rules"></mat-progress-bar>
      }
      @case ('failed') {
        <div class="error" role="alert">
          <mat-icon aria-hidden="true">error</mat-icon>
          <span class="grow">Could not read the rules: the API did not answer. Nothing was changed by reading.</span>
          <button mat-button type="button" (click)="reload()">Retry</button>
        </div>
      }
      @case ('gone') {
        <div class="error" role="alert">
          <mat-icon aria-hidden="true">error</mat-icon>
          <span class="grow">This subscription no longer exists. Refresh to see the entities as they are now.</span>
          <button mat-button type="button" (click)="refreshTree()">Refresh</button>
        </div>
      }
      @default {
        @if (rules().length === 0) {
          <p class="empty">No rule: this subscription receives no message</p>
        } @else {
          <table mat-table [dataSource]="rules()" class="rules">
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>Rule</th>
              <td mat-cell *matCellDef="let rule">{{ rule.name }}</td>
            </ng-container>
            <ng-container matColumnDef="filter">
              <th mat-header-cell *matHeaderCellDef>Filter</th>
              <td mat-cell *matCellDef="let rule">
                <mat-chip-set><mat-chip [disableRipple]="true">{{ filterLabel(rule) }}</mat-chip></mat-chip-set>
              </td>
            </ng-container>
            <ng-container matColumnDef="expression">
              <th mat-header-cell *matHeaderCellDef>Expression</th>
              <td mat-cell *matCellDef="let rule" [class.mono]="rule.filterType !== 'True' && rule.filterType !== 'False'">{{ describe(rule) }}</td>
            </ng-container>
            <ng-container matColumnDef="action">
              <th mat-header-cell *matHeaderCellDef>Action</th>
              <td mat-cell *matCellDef="let rule" [class.mono]="!!rule.sqlAction" [class.muted]="!rule.sqlAction">{{ rule.sqlAction || 'None' }}</td>
            </ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef><span class="visually-hidden">Actions</span></th>
              <td mat-cell *matCellDef="let rule" class="acts">
                <button mat-icon-button type="button" [attr.aria-label]="'Edit rule ' + rule.name" [matTooltip]="'Edit rule ' + rule.name" (click)="edit(rule)">
                  <mat-icon>edit</mat-icon>
                </button>
                <button mat-icon-button type="button" class="danger" [attr.aria-label]="'Delete rule ' + rule.name" [matTooltip]="'Delete rule ' + rule.name" (click)="remove(rule)">
                  <mat-icon>delete</mat-icon>
                </button>
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns()"></tr>
            <tr mat-row class="rule-row" *matRowDef="let rule; columns: columns()"></tr>
          </table>
        }
      }
    }
  `,
  styles: [`
    :host { display: block; padding: 8px 16px; min-width: 0; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .lead, .muted, .empty { color: var(--mat-sys-on-surface-variant); }
    .empty { font: var(--mat-sys-body-medium); margin: 16px 0; }
    .rules { width: 100%; }
    td { overflow-wrap: anywhere; }
    .mono { font-family: ui-monospace, monospace; }
    .acts { white-space: nowrap; text-align: end; }
    .danger { color: var(--mat-sys-error); }
    .error {
      display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px;
      background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container);
    }
    .grow { flex: 1; min-width: 0; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  `]
})
export class SubscriptionRulesComponent {
  private readonly dialog = inject(MatDialog);
  private readonly topics = inject(TopicService);
  private readonly selection = inject(EntitySelectionService);
  private readonly providerService = inject(ProviderService);

  readonly subscription = input.required<SubscriptionInfo>();

  readonly rules = linkedSignal<SubscriptionRuleInfo[]>(() => this.subscription().rules ?? []);
  readonly state = linkedSignal<ListState>(() => Array.isArray(this.subscription().rules) ? 'ready' : 'failed');
  readonly canEdit = computed(() => this.providerService.capabilities()?.supportsSubscriptionRules === true);
  readonly columns = computed(() => this.canEdit() ? ['name', 'filter', 'expression', 'action', 'actions'] : ['name', 'filter', 'expression', 'action']);

  filterLabel(rule: SubscriptionRuleInfo): string {
    return FILTER_LABELS[rule.filterType] ?? rule.filterType;
  }

  describe(rule: SubscriptionRuleInfo): string {
    return describeFilter(rule);
  }

  add(): void {
    this.openForm({ mode: 'create', ...this.where() });
  }

  edit(rule: SubscriptionRuleInfo): void {
    this.openForm({ mode: 'edit', ...this.where(), rule });
  }

  remove(rule: SubscriptionRuleInfo): void {
    // ponytail: "last rule" is judged from the list on screen, which another client may have shortened; re-read the list before confirming if that matters.
    const data: RuleDeleteDialogData = { ...this.where(), ruleName: rule.name, isLast: this.rules().length === 1 };
    this.dialog.open(RuleDeleteDialogComponent, { data, width: '560px', maxWidth: '95vw', role: 'alertdialog' })
      .afterClosed().subscribe(changed => { if (changed) this.reload(); });
  }

  reload(): void {
    const subscription = this.subscription();
    this.state.set('loading');
    this.topics.getRules(subscription.topicName, subscription.name).subscribe({
      next: rules => {
        if (this.subscription() !== subscription) return;
        this.rules.set(rules);
        this.state.set('ready');
      },
      error: (error: HttpErrorResponse) => {
        if (this.subscription() !== subscription) return;
        this.state.set(error.status === 404 ? 'gone' : 'failed');
      }
    });
  }

  refreshTree(): void {
    this.selection.refreshTree();
    this.selection.clearSelection();
  }

  private where(): { topicName: string; subscriptionName: string } {
    return { topicName: this.subscription().topicName, subscriptionName: this.subscription().name };
  }

  private openForm(data: RuleFormDialogData): void {
    this.dialog.open(RuleFormDialogComponent, { data, width: '720px', maxWidth: '95vw' })
      .afterClosed().subscribe(changed => { if (changed) this.reload(); });
  }
}
