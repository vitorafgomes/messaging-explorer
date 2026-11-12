import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidatorFn } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ErrorStateMatcher } from '@angular/material/core';
import { Observable, finalize } from 'rxjs';
import { EntityKind, QueueInfo, SubscriptionInfo, TopicInfo, TreeNode } from '../../core/models';
import { EntitySelectionService, QueueService, TopicService, TreeDataBuilderService } from '../../core/services';
import { DURATION_UNITS, DurationInput, describeSeconds, durationInput, inputSeconds, isNever, toTimeSpan } from './duration';
import { fieldError, forwardTargetError, nameError } from './entity-validation';
import { connectionContext } from './connection-context';
import { EntityChange, EntityReviewDialogComponent, EntityReviewDialogData } from './entity-review-dialog.component';

type Entity = QueueInfo | TopicInfo | SubscriptionInfo;

export interface EntityFormDialogData {
  mode: 'create' | 'edit';
  kind: EntityKind;
  /** The parent topic of a subscription. */
  topicName?: string;
  /** The entity as read, for an edit. */
  entity?: Entity;
}

type FieldType = 'duration' | 'number' | 'flag' | 'text' | 'target';
type Value = number | boolean | string | null;

interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
}

interface FieldChange extends EntityChange {
  key: string;
  wire: Value;
}

const FIELDS: Record<string, FieldSpec> = Object.fromEntries(([
  ['lockDuration', 'Lock duration', 'duration'],
  ['maxDeliveryCount', 'Max delivery count', 'number'],
  ['defaultMessageTimeToLive', 'Message time to live', 'duration'],
  ['autoDeleteOnIdle', 'Auto delete on idle', 'duration'],
  ['maxSizeInMegabytes', 'Max size in megabytes', 'number'],
  ['duplicateDetectionHistoryTimeWindow', 'Duplicate detection window', 'duration'],
  ['forwardTo', 'Forward to', 'target'],
  ['forwardDeadLetteredMessagesTo', 'Forward dead-lettered messages to', 'target'],
  ['userMetadata', 'User metadata', 'text'],
  ['requiresSession', 'Requires session', 'flag'],
  ['enablePartitioning', 'Partitioning', 'flag'],
  ['requiresDuplicateDetection', 'Duplicate detection', 'flag'],
  ['deadLetteringOnMessageExpiration', 'Dead-letter a message when it expires', 'flag'],
  ['deadLetteringOnFilterEvaluationExceptions', 'Dead-letter on a filter evaluation error', 'flag'],
  ['enableBatchedOperations', 'Batched operations', 'flag'],
  ['supportOrdering', 'Support ordering', 'flag']
] as const).map(([key, label, type]) => [key, { key, label, type }]));

/** The fields of the contract per kind: what create takes, what an update takes, what is fixed at creation. */
const LAYOUT: Record<EntityKind, { create: string[]; fixed: string[] }> = {
  queue: {
    create: ['lockDuration', 'maxDeliveryCount', 'defaultMessageTimeToLive', 'autoDeleteOnIdle', 'maxSizeInMegabytes',
      'duplicateDetectionHistoryTimeWindow', 'forwardTo', 'forwardDeadLetteredMessagesTo', 'userMetadata',
      'requiresSession', 'enablePartitioning', 'requiresDuplicateDetection', 'deadLetteringOnMessageExpiration', 'enableBatchedOperations'],
    fixed: ['requiresSession', 'enablePartitioning', 'requiresDuplicateDetection']
  },
  topic: {
    create: ['defaultMessageTimeToLive', 'autoDeleteOnIdle', 'maxSizeInMegabytes', 'duplicateDetectionHistoryTimeWindow', 'userMetadata',
      'enablePartitioning', 'requiresDuplicateDetection', 'enableBatchedOperations', 'supportOrdering'],
    fixed: ['enablePartitioning', 'requiresDuplicateDetection']
  },
  subscription: {
    create: ['lockDuration', 'maxDeliveryCount', 'defaultMessageTimeToLive', 'autoDeleteOnIdle', 'forwardTo', 'forwardDeadLetteredMessagesTo',
      'userMetadata', 'requiresSession', 'deadLetteringOnMessageExpiration', 'deadLetteringOnFilterEvaluationExceptions', 'enableBatchedOperations'],
    fixed: ['requiresSession']
  }
};

const EMPTY_REQUIRED = 'Enter a value; an empty field cannot be saved.';

/**
 * Creates a queue, a topic or a subscription, or edits one. Create sends only the options the user
 * set; edit sends only the fields that differ from the entity as read, after a review step. A refused
 * or failed call keeps the dialog open with the input.
 */
@Component({
  selector: 'app-entity-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatChipsModule, MatProgressBarModule
  ],
  templateUrl: './entity-form-dialog.component.html',
  styleUrl: './entity-form-dialog.component.scss'
})
export class EntityFormDialogComponent {
  readonly data = inject<EntityFormDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<EntityFormDialogComponent>);
  private readonly dialog = inject(MatDialog);
  private readonly queues = inject(QueueService);
  private readonly topics = inject(TopicService);
  private readonly selection = inject(EntitySelectionService);
  private readonly tree = inject(TreeDataBuilderService);

  readonly context = connectionContext();
  readonly kind = this.data.kind;
  readonly kindLabel = this.kind[0].toUpperCase() + this.kind.slice(1);
  readonly creating = this.data.mode === 'create';
  private readonly entity = (this.data.entity ?? {}) as Record<string, unknown>;
  readonly entityName = (this.entity['name'] as string | undefined) ?? '';
  readonly topicName = this.data.topicName ?? (this.entity['topicName'] as string | undefined);

  readonly units = DURATION_UNITS;
  readonly fields: FieldSpec[] = LAYOUT[this.kind].create
    .filter(key => this.creating || !LAYOUT[this.kind].fixed.includes(key))
    .map(key => FIELDS[key]);
  readonly valueFields = this.fields.filter(f => f.type !== 'flag');
  readonly flagFields = this.fields.filter(f => f.type === 'flag');
  readonly fixedFacts = this.creating ? [] : LAYOUT[this.kind].fixed.map(key => ({
    label: FIELDS[key].label,
    value: this.entity[key] === true ? 'Yes' : this.entity[key] === false ? 'No' : 'Not set'
  }));

  /** The queues and topics loaded in the tree, never the entity itself; a current target the tree lacks stays choosable. */
  readonly targets: string[] = this.forwardTargets();

  readonly form = new FormGroup<Record<string, AbstractControl>>(this.controls());
  private readonly initial = this.values();
  private readonly formValue = toSignal(this.form.valueChanges);

  readonly changes = computed<FieldChange[]>(() => {
    this.formValue();
    const current = this.values();
    return this.fields
      .filter(f => current[f.key] !== this.initial[f.key])
      .map(f => ({
        key: f.key,
        label: f.label,
        from: this.describe(f, this.initial[f.key], true),
        to: this.describe(f, current[f.key], false),
        wire: f.type === 'duration' ? toTimeSpan(current[f.key] as number) : current[f.key]
      }));
  });

  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly notFound = signal(false);

  readonly showErrors: ErrorStateMatcher = {
    isErrorState: control => !!control && control.invalid && (control.dirty || control.touched)
  };

  canSave(): boolean {
    return !this.saving() && this.form.valid && (this.creating || this.changes().length > 0);
  }

  saveLabel(): string {
    if (this.creating) return `Create ${this.kind}`;
    const n = this.changes().length;
    return n === 0 ? 'Save' : `Save ${n} ${n === 1 ? 'change' : 'changes'}`;
  }

  errorOf(path: string): string {
    return this.form.get(path)?.errors?.['message'] ?? '';
  }

  /** A flag with no value to start from keeps "Broker default" (create) or "Not set" (edit) as a choice. */
  startsUnset(key: string): boolean {
    return this.initial[key] === null;
  }

  neverHint(key: string): boolean {
    return !this.creating && isNever(this.entity[key] as string | undefined);
  }

  save(): void {
    if (!this.canSave()) return;
    const changes = this.changes();
    const body = Object.fromEntries(changes.map(c => [c.key, c.wire]));
    if (this.creating) {
      const name = this.form.get('name')!.value as string;
      this.send(this.create(name, changes.length ? body : undefined), () => {
        this.selection.refreshTree();
        this.selection.select(this.nodeFor(name));
        this.dialogRef.close(name);
      });
      return;
    }
    const review: EntityReviewDialogData = {
      kind: this.kind,
      entityName: this.entityName,
      topicName: this.kind === 'subscription' ? this.topicName : undefined,
      context: this.context,
      changes: changes.map(({ label, from, to }) => ({ label, from, to }))
    };
    this.dialog.open(EntityReviewDialogComponent, { data: review, width: '640px', maxWidth: '95vw' })
      .afterClosed()
      .subscribe(confirmed => {
        if (confirmed) {
          this.send(this.update(body), updated => {
            this.selection.showEntity(updated as Entity);
            this.dialogRef.close(updated);
          });
        }
      });
  }

  undoAll(): void {
    this.form.reset();
  }

  /** After a 404: reloads the tree and closes; an edited entity that is gone is no longer shown. */
  refresh(): void {
    this.selection.refreshTree();
    if (!this.creating) this.selection.clearSelection();
    this.dialogRef.close();
  }

  private send<T>(call: Observable<T>, onSuccess: (result: T) => void): void {
    this.errorMessage.set(null);
    this.notFound.set(false);
    this.saving.set(true);
    call.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: onSuccess,
      error: (error: HttpErrorResponse) => this.fail(error)
    });
  }

  private fail(error: HttpErrorResponse): void {
    if (error.status === 409 && this.creating) {
      const name = this.form.get('name')!;
      name.setErrors({ message: `A ${this.kind} named ${name.value} already exists in this namespace.` });
      name.markAsTouched();
      return;
    }
    if (error.status === 400) {
      this.errorMessage.set(error.error?.message ?? 'The API refused this configuration.');
    } else if (error.status === 404 && (!this.creating || this.kind === 'subscription')) {
      this.notFound.set(true);
      const gone = this.creating ? `The topic ${this.topicName} no longer exists.` : `This ${this.kind} no longer exists.`;
      this.errorMessage.set(`${gone} Refresh to see the entities as they are now.`);
    } else {
      this.errorMessage.set(this.creating
        ? `Could not create the ${this.kind}: the API did not confirm it. Try again.`
        : 'Could not save the changes: the API did not confirm them. Try again.');
    }
  }

  private create(name: string, options: Record<string, Value> | undefined): Observable<unknown> {
    switch (this.kind) {
      case 'queue': return this.queues.createQueue(name, options);
      case 'topic': return this.topics.createTopic(name, options);
      default: return this.topics.createSubscription(this.topicName!, name, options);
    }
  }

  private update(body: Record<string, Value>): Observable<Entity> {
    switch (this.kind) {
      case 'queue': return this.queues.updateQueue(this.entityName, body);
      case 'topic': return this.topics.updateTopic(this.entityName, body);
      default: return this.topics.updateSubscription(this.topicName!, this.entityName, body);
    }
  }

  private nodeFor(name: string): TreeNode {
    const base = { name, icon: this.kind, expandable: false };
    if (this.kind === 'subscription') {
      return { ...base, id: `subscription-${this.topicName}-${name}`, type: 'subscription', level: 2, data: { topicName: this.topicName! } as never };
    }
    return { ...base, id: `${this.kind}-${name}`, type: this.kind, level: 1 };
  }

  private forwardTargets(): string[] {
    const { queues, topics } = this.tree.loadedNames();
    const self = !this.creating && this.kind === 'queue' ? this.entityName : null;
    const list = [...queues, ...topics].filter(name => name !== self);
    for (const key of ['forwardTo', 'forwardDeadLetteredMessagesTo']) {
      const current = this.entity[key] as string | null | undefined;
      if (current && !list.includes(current)) list.push(current);
    }
    return list;
  }

  private controls(): Record<string, AbstractControl> {
    const controls: Record<string, AbstractControl> = {};
    if (this.creating) {
      controls['name'] = new FormControl('', { nonNullable: true, validators: control => message(nameError(this.kind, control.value)) });
    }
    const self = !this.creating && this.kind === 'queue' ? this.entityName : null;
    for (const f of this.fields) {
      const read = this.entity[f.key];
      switch (f.type) {
        case 'duration': {
          const start = this.creating ? { amount: null, unit: 'minutes' as const } : durationInput(read as string | undefined);
          const group = new FormGroup({
            amount: new FormControl<number | null>(start.amount, { nonNullable: true, validators: durationValidator(f.key, start.amount !== null) }),
            unit: new FormControl(start.unit, { nonNullable: true })
          });
          group.controls.unit.valueChanges.subscribe(() => group.controls.amount.updateValueAndValidity());
          group.controls.amount.updateValueAndValidity();
          controls[f.key] = group;
          break;
        }
        case 'number': {
          const start = this.creating ? null : (read as number | null | undefined) ?? null;
          controls[f.key] = new FormControl<number | null>(start, {
            nonNullable: true,
            validators: control => emptyValue(control.value)
              ? (start !== null ? { message: EMPTY_REQUIRED } : null)
              : message(fieldError(f.key, control.value))
          });
          break;
        }
        case 'flag':
          controls[f.key] = new FormControl<boolean | null>(this.creating ? null : (read as boolean | null | undefined) ?? null, { nonNullable: true });
          break;
        case 'text':
          controls[f.key] = new FormControl(this.creating ? '' : (read as string | null | undefined) ?? '', {
            nonNullable: true, validators: control => message(fieldError(f.key, control.value))
          });
          break;
        case 'target':
          controls[f.key] = new FormControl(this.creating ? '' : (read as string | null | undefined) ?? '', {
            nonNullable: true, validators: control => message(forwardTargetError(control.value, this.targets, self))
          });
          break;
      }
    }
    return controls;
  }

  /** Each field's value in one comparable form: seconds, a number, a flag or a string. */
  private values(): Record<string, Value> {
    return Object.fromEntries(this.fields.map(f => {
      const raw = this.form.get(f.key)!.value;
      switch (f.type) {
        case 'duration': return [f.key, inputSeconds(raw as DurationInput)];
        case 'number': return [f.key, emptyValue(raw) ? null : Number(raw)];
        case 'flag': return [f.key, raw ?? null];
        default: return [f.key, raw ?? ''];
      }
    }));
  }

  private describe(f: FieldSpec, value: Value, isInitial: boolean): string {
    switch (f.type) {
      case 'duration': return isInitial && this.neverHint(f.key) ? 'Never' : describeSeconds(value as number | null);
      case 'number': return value === null ? 'Not set' : String(value);
      case 'flag': return value === null ? (this.creating ? 'Broker default' : 'Not set') : value ? 'On' : 'Off';
      case 'target': return (value as string) || 'None';
      default: return (value as string) || 'Empty';
    }
  }
}

function emptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function message(error: string | null) {
  return error ? { message: error } : null;
}

/** Validates a duration amount in the unit beside it; an amount that had a value cannot be emptied. */
function durationValidator(key: string, required: boolean): ValidatorFn {
  return control => {
    if (emptyValue(control.value)) return required ? { message: EMPTY_REQUIRED } : null;
    const unit = control.parent?.get('unit')?.value ?? 'minutes';
    return message(fieldError(key, inputSeconds({ amount: control.value, unit })));
  };
}
