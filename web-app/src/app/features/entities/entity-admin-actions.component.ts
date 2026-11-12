import { Component, computed, inject, input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { EntityKind, EntityStatus, QueueInfo, SubscriptionInfo, TopicInfo } from '../../core/models';
import { ProviderService } from '../../core/services/provider.service';
import { EntityFormDialogComponent, EntityFormDialogData } from './entity-form-dialog.component';
import { EntityStatusDialogComponent, EntityStatusDialogData, STATUS_TEXT } from './entity-status-dialog.component';

/**
 * The administration actions of an entity panel: its status as a chip, Edit and Status. Shown only
 * when the connected broker's API explicitly declares `supportsEntityUpdate`.
 */
@Component({
  selector: 'app-entity-admin-actions',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatChipsModule],
  template: `
    @if (enabled() && entity(); as current) {
      <div class="admin">
        <mat-chip-set aria-label="Status">
          <mat-chip [disableRipple]="true" [class.inactive]="!active()">
            <mat-icon matChipAvatar aria-hidden="true">{{ statusIcon() }}</mat-icon>
            <span class="label">{{ statusLabel() }}</span>
          </mat-chip>
        </mat-chip-set>
        <button mat-stroked-button type="button" (click)="edit(current)"><mat-icon>edit</mat-icon>Edit</button>
        <button mat-stroked-button type="button" (click)="changeStatus(current)"><mat-icon>toggle_on</mat-icon>Status</button>
      </div>
    }
  `,
  styles: [`
    :host { margin-inline-start: auto; min-width: 0; }
    .admin { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; }
    .inactive {
      --mat-chip-elevated-container-color: var(--mat-sys-error-container);
      --mat-chip-label-text-color: var(--mat-sys-on-error-container);
      --mat-chip-with-avatar-avatar-color: var(--mat-sys-on-error-container);
    }
  `]
})
export class EntityAdminActionsComponent {
  private readonly dialog = inject(MatDialog);
  private readonly providerService = inject(ProviderService);

  readonly kind = input.required<EntityKind>();
  readonly entity = input<QueueInfo | TopicInfo | SubscriptionInfo | null | undefined>();

  readonly enabled = computed(() => this.providerService.capabilities()?.supportsEntityUpdate === true);
  private readonly status = computed(() => STATUS_TEXT[this.entity()?.status as EntityStatus] ?? null);
  readonly active = computed(() => this.entity()?.status === 'Active');
  readonly statusLabel = computed(() => this.status()?.label ?? (this.entity()?.status || 'Status not known'));
  readonly statusIcon = computed(() => this.status()?.icon ?? 'help');

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
