import { Component, computed, inject, input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EntityKind, EntityStatus, QueueInfo, SubscriptionInfo, TopicInfo } from '../../core/models';
import { ProviderService } from '../../core/services/provider.service';
import { EntityFormDialogComponent, EntityFormDialogData } from './entity-form-dialog.component';
import { EntityStatusDialogComponent, EntityStatusDialogData, STATUS_TEXT } from './entity-status-dialog.component';

/**
 * One administration action of an entity panel: with `part="status"` its status as a chip that opens
 * Change status, otherwise Edit. Shown only when the connected broker's API explicitly declares
 * `supportsEntityUpdate`.
 */
@Component({
  selector: 'app-entity-admin-actions',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    @if (enabled() && entity(); as current) {
      @if (part() === 'status') {
        <button mat-stroked-button type="button" class="status-chip" [class]="tone()"
                [attr.aria-label]="'Status: ' + statusLabel() + '. Change status'" matTooltip="Change status"
                (click)="changeStatus(current)">
          <mat-icon aria-hidden="true" [fontIcon]="statusIcon()" />{{ statusLabel() }}
        </button>
      } @else {
        <button mat-stroked-button type="button" (click)="edit(current)"><mat-icon fontIcon="edit" />Edit</button>
      }
    }
  `,
  styles: [`
    :host { display: contents; }
    .status-chip { --mat-button-outlined-container-height: 28px; }
    .success mat-icon { color: var(--app-success); }
    .partial {
      --mat-button-outlined-label-text-color: var(--app-on-warning-container);
      background: var(--app-warning-container);
    }
    .stopped {
      --mat-button-outlined-label-text-color: var(--mat-sys-on-error-container);
      background: var(--mat-sys-error-container);
    }
  `]
})
export class EntityAdminActionsComponent {
  private readonly dialog = inject(MatDialog);
  private readonly providerService = inject(ProviderService);

  readonly kind = input.required<EntityKind>();
  readonly entity = input<QueueInfo | TopicInfo | SubscriptionInfo | null | undefined>();
  /** Which action this instance shows: the status chip beside the name, or Edit among the actions. */
  readonly part = input<'status' | 'edit'>('edit');

  readonly enabled = computed(() => this.providerService.capabilities()?.supportsEntityUpdate === true);
  private readonly status = computed(() => STATUS_TEXT[this.entity()?.status as EntityStatus] ?? null);
  readonly active = computed(() => this.entity()?.status === 'Active');
  readonly statusLabel = computed(() => this.status()?.label ?? (this.entity()?.status || 'Status not known'));
  readonly statusIcon = computed(() => this.status()?.icon ?? 'help');
  /** Active reads as success, Disabled as error, a status that stops one side as a warning. */
  readonly tone = computed(() => this.active() ? 'success' : this.entity()?.status === 'Disabled' ? 'stopped' : 'partial');

  edit(entity: QueueInfo | TopicInfo | SubscriptionInfo): void {
    const data: EntityFormDialogData = { mode: 'edit', kind: this.kind(), entity, topicName: (entity as SubscriptionInfo).topicName };
    this.dialog.open(EntityFormDialogComponent, { data, width: '720px', maxWidth: '95vw' });
  }

  changeStatus(entity: QueueInfo | TopicInfo | SubscriptionInfo): void {
    const data: EntityStatusDialogData = {
      kind: this.kind(),
      entityName: entity.name,
      topicName: (entity as SubscriptionInfo).topicName,
      status: entity.status
    };
    this.dialog.open(EntityStatusDialogComponent, { data, width: '560px', maxWidth: '95vw' });
  }
}
