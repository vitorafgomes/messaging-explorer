import { Component, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Observable, finalize } from 'rxjs';
import { ENTITY_STATUSES, EntityKind, EntityStatus, QueueInfo, SubscriptionInfo, TopicInfo } from '../../core/models';
import { EntitySelectionService, QueueService, TopicService } from '../../core/services';
import { connectionContext } from './connection-context';

export interface EntityStatusDialogData {
  kind: EntityKind;
  entityName: string;
  /** The parent topic of a subscription. */
  topicName?: string;
  /** The status as read. */
  status: string;
}

/** How each status reads on screen: its name, its icon, what it stops, and the words of its confirmation. */
export const STATUS_TEXT: Record<EntityStatus, { label: string; icon: string; effect: string; question: (name: string) => string; action: string }> = {
  Active: {
    label: 'Active', icon: 'check_circle', effect: 'Senders and receivers work.',
    question: name => `Set ${name} back to Active?`, action: 'Set Active'
  },
  SendDisabled: {
    label: 'Send disabled', icon: 'cancel_schedule_send', effect: 'Senders are refused. Receivers keep draining the messages already there.',
    question: name => `Disable sending to ${name}?`, action: 'Disable sending'
  },
  ReceiveDisabled: {
    label: 'Receive disabled', icon: 'do_not_disturb_on', effect: 'Receivers are refused, in this app too. Senders keep adding messages.',
    question: name => `Disable receiving from ${name}?`, action: 'Disable receiving'
  },
  Disabled: {
    label: 'Disabled', icon: 'block', effect: 'Nothing is sent or received: senders and receivers are both refused. Messages stay where they are.',
    question: name => `Disable ${name}?`, action: 'Disable'
  }
};

/**
 * Changes the status of an entity: the values the kind allows, each with what it stops. A value other
 * than Active asks for the entity name to be typed; Active asks once. Sends `{ status }` only.
 */
@Component({
  selector: 'app-entity-status-dialog',
  standalone: true,
  imports: [
    MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule, MatIconModule, MatRadioModule,
    MatFormFieldModule, MatInputModule, MatChipsModule, MatProgressBarModule
  ],
  template: `
    @if (step() === 'choose') {
      <h2 mat-dialog-title>Change status</h2>
      <mat-dialog-content>
        <p class="context">
          <mat-chip-set aria-label="Environment"><mat-chip [disableRipple]="true">{{ context().environment }}</mat-chip></mat-chip-set>
          <span>{{ kindLabel }} <b>{{ data.entityName }}</b>, now {{ currentLabel }}</span>
        </p>
        <mat-radio-group class="options" aria-label="Status" [value]="choice()" (change)="choice.set($event.value)">
          @for (status of statuses; track status) {
            <mat-radio-button [value]="status">
              <span class="option"><b>{{ text[status].label }}</b><span class="effect">{{ text[status].effect }}</span></span>
            </mat-radio-button>
          }
        </mat-radio-group>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button mat-dialog-close>Cancel</button>
        <button mat-flat-button [disabled]="!choice() || choice() === current" (click)="toConfirm()">Continue</button>
      </mat-dialog-actions>
    } @else {
      <h2 mat-dialog-title class="title">
        <mat-icon class="warn" aria-hidden="true">warning</mat-icon>
        {{ chosen().question(data.entityName) }}
      </h2>
      <mat-dialog-content>
        <p class="consequence">{{ consequence() }}</p>
        <dl class="facts">
          <div class="fact"><dt>{{ kindLabel }}</dt><dd>{{ data.entityName }}</dd></div>
          @if (data.topicName) {
            <div class="fact"><dt>Topic</dt><dd>{{ data.topicName }}</dd></div>
          }
          <div class="fact"><dt>Connection</dt><dd>{{ context().connection }}</dd></div>
          <div class="fact"><dt>Environment</dt><dd>{{ context().environment }}</dd></div>
          <div class="fact"><dt>Status</dt><dd>{{ currentLabel }} to {{ chosen().label }}</dd></div>
        </dl>
        @if (needsTypedName()) {
          <mat-form-field class="typed">
            <mat-label>Type the {{ data.kind }} name to confirm</mat-label>
            <input #typedInput matInput autocomplete="off" [placeholder]="data.entityName" [value]="typed()" (input)="typed.set($any($event.target).value)">
          </mat-form-field>
        }
        @if (errorMessage()) {
          <div class="error" role="alert">
            <mat-icon aria-hidden="true">error</mat-icon>
            <span class="grow">{{ errorMessage() }}</span>
            @if (notFound()) {
              <button mat-button type="button" (click)="refresh()">Refresh</button>
            }
          </div>
        }
        @if (saving()) {
          <mat-progress-bar mode="indeterminate" aria-label="Saving"></mat-progress-bar>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button #backButton mat-button (click)="back()">Back</button>
        <button mat-flat-button [class.danger]="needsTypedName()" [disabled]="!canApply()" (click)="apply()">{{ chosen().action }}</button>
      </mat-dialog-actions>
    }
  `,
  styles: [`
    .context { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 12px; overflow-wrap: anywhere; }
    .options { display: flex; flex-direction: column; gap: 8px; }
    .option { display: flex; flex-direction: column; }
    .effect { color: var(--mat-sys-on-surface-variant); }
    .title { display: flex; align-items: center; gap: 8px; }
    .warn { color: var(--mat-sys-error); }
    .consequence { margin: 0 0 12px; }
    .facts { margin: 0 0 16px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 12px; }
    .fact { display: flex; justify-content: space-between; gap: 16px; padding: 8px 16px; min-width: 0; }
    .fact + .fact { border-top: 1px solid var(--mat-sys-outline-variant); }
    dt { font-weight: normal; }
    dd { margin: 0; text-align: end; overflow-wrap: anywhere; }
    .typed { width: 100%; }
    .error {
      display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px;
      background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container);
    }
    .grow { flex: 1; min-width: 0; }
    .danger {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
    mat-progress-bar { margin-top: 12px; }
  `]
})
export class EntityStatusDialogComponent {
  readonly data = inject<EntityStatusDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<EntityStatusDialogComponent>);
  private readonly queues = inject(QueueService);
  private readonly topics = inject(TopicService);
  private readonly selection = inject(EntitySelectionService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly context = connectionContext();
  readonly text = STATUS_TEXT;
  readonly statuses = ENTITY_STATUSES[this.data.kind];
  readonly kindLabel = this.data.kind[0].toUpperCase() + this.data.kind.slice(1);
  readonly current = this.statuses.find(s => s === this.data.status) ?? null;
  readonly currentLabel = this.current ? STATUS_TEXT[this.current].label : 'not known';

  readonly step = signal<'choose' | 'confirm'>('choose');
  readonly choice = signal<EntityStatus | null>(this.current);
  readonly typed = signal('');
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly notFound = signal(false);

  readonly chosen = computed(() => STATUS_TEXT[this.choice() ?? 'Active']);
  readonly needsTypedName = computed(() => this.choice() !== 'Active');
  readonly consequence = computed(() => this.choice() === 'Active'
    ? 'Senders and receivers work again at once.'
    : `${this.chosen().effect} It lasts until the status is set back to Active.`);

  private readonly typedInput = viewChild<ElementRef<HTMLInputElement>>('typedInput');
  private readonly backButton = viewChild('backButton', { read: ElementRef });

  canApply(): boolean {
    return !this.saving() && (!this.needsTypedName() || this.typed() === this.data.entityName);
  }

  toConfirm(): void {
    this.typed.set('');
    this.errorMessage.set(null);
    this.step.set('confirm');
    afterNextRender(() => (this.typedInput() ?? this.backButton())?.nativeElement.focus(), { injector: this.injector });
  }

  back(): void {
    this.step.set('choose');
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('mat-radio-group input:checked')?.focus(), { injector: this.injector });
  }

  apply(): void {
    const status = this.choice();
    if (!status || !this.canApply()) return;
    this.errorMessage.set(null);
    this.notFound.set(false);
    this.saving.set(true);
    this.update({ status }).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: updated => {
        this.selection.showEntity(updated);
        this.dialogRef.close(updated);
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 400) {
          this.errorMessage.set(error.error?.message ?? 'The API refused this status.');
        } else if (error.status === 404) {
          this.notFound.set(true);
          this.errorMessage.set(`This ${this.data.kind} no longer exists. Refresh to see the entities as they are now.`);
        } else {
          this.errorMessage.set('Could not change the status: the API did not confirm it. Try again.');
        }
      }
    });
  }

  refresh(): void {
    this.selection.refreshTree();
    this.selection.clearSelection();
    this.dialogRef.close();
  }

  private update(body: { status: EntityStatus }): Observable<QueueInfo | TopicInfo | SubscriptionInfo> {
    switch (this.data.kind) {
      case 'queue': return this.queues.updateQueue(this.data.entityName, body);
      case 'topic': return this.topics.updateTopic(this.data.entityName, body);
      default: return this.topics.updateSubscription(this.data.topicName!, this.data.entityName, body);
    }
  }
}
