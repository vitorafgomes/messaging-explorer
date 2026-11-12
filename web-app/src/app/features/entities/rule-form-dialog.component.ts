import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ErrorStateMatcher } from '@angular/material/core';
import { finalize } from 'rxjs';
import { RuleFilterType, RulePropertyType, SubscriptionRuleInfo } from '../../core/models';
import { TopicService } from '../../core/services';
import { connectionContext } from './connection-context';
import { PROPERTY_TYPES, RuleDraft, SYSTEM_FIELDS, SystemField, describeFilter, emptyDraft, fromRule, ruleErrors, toWire } from './rule-validation';

export interface RuleFormDialogData {
  mode: 'create' | 'edit';
  topicName: string;
  subscriptionName: string;
  /** The rule as read, for an edit. */
  rule?: SubscriptionRuleInfo;
}

const FILTER_KINDS: readonly { value: RuleFilterType; label: string }[] = [
  { value: 'Sql', label: 'SQL filter' },
  { value: 'Correlation', label: 'Correlation filter' },
  { value: 'True', label: 'True (every message)' },
  { value: 'False', label: 'False (no message)' }
];

const NAME_TAKEN = 'A rule with this name already exists in this subscription.';

type PropertyGroup = FormGroup<{ name: FormControl<string>; type: FormControl<RulePropertyType>; value: FormControl<string> }>;

/**
 * Adds a rule to a subscription, or replaces one under the same name. Errors come from the contract's
 * limits; Save is disabled until the rule is valid and, on edit, differs from the rule as read. A rule
 * holding a property of type `Other` is shown read-only. A refused or failed call keeps the dialog open.
 */
@Component({
  selector: 'app-rule-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatButtonToggleModule, MatIconModule, MatChipsModule, MatTooltipModule, MatProgressBarModule
  ],
  templateUrl: './rule-form-dialog.component.html',
  styleUrls: ['./entity-form-dialog.component.scss', './rule-form-dialog.component.scss']
})
export class RuleFormDialogComponent {
  readonly data = inject<RuleFormDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<RuleFormDialogComponent>);
  private readonly topics = inject(TopicService);

  readonly context = connectionContext();
  readonly creating = this.data.mode === 'create';
  readonly kinds = FILTER_KINDS;
  readonly systemFields = SYSTEM_FIELDS;
  readonly propertyTypes = PROPERTY_TYPES;
  /** A stored property type this app cannot write makes the whole rule read-only. */
  readonly readOnly = !!this.data.rule?.correlation?.applicationProperties?.some(p => p.type === 'Other');

  readonly form = this.buildForm(this.data.rule ? fromRule(this.data.rule) : emptyDraft());
  private readonly formValue = toSignal(this.form.valueChanges);
  readonly draft = computed<RuleDraft>(() => (this.formValue(), this.form.getRawValue()));
  private readonly initialWire = JSON.stringify(toWire(this.draft()));

  private readonly conflictName = signal<string | null>(null);
  readonly errors = computed(() => {
    const errors = ruleErrors(this.draft());
    if (this.creating && this.draft().name === this.conflictName()) errors['name'] = NAME_TAKEN;
    return errors;
  });

  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly notFound = signal(false);

  private readonly matchers = new Map<string, ErrorStateMatcher>();

  /** Read-only facts of a rule this app cannot edit. */
  readonly facts = this.data.rule ? [
    { label: 'Rule', value: this.data.rule.name },
    { label: 'Filter', value: this.data.rule.filterType },
    { label: 'Expression', value: describeFilter(this.data.rule) },
    ...(this.data.rule.correlation?.applicationProperties ?? []).map(p => ({ label: 'Property', value: `${p.name} = ${p.value} (${p.type})` })),
    { label: 'Action', value: this.data.rule.sqlAction || 'None' }
  ] : [];

  get properties(): FormArray<PropertyGroup> {
    return this.form.controls.properties;
  }

  canSave(): boolean {
    if (this.readOnly || this.saving() || Object.keys(this.errors()).length) return false;
    return this.creating || JSON.stringify(toWire(this.draft())) !== this.initialWire;
  }

  /** Shows a field's error once the field was touched or changed. */
  matcher(path: string): ErrorStateMatcher {
    let matcher = this.matchers.get(path);
    if (!matcher) {
      matcher = { isErrorState: control => !!this.errors()[path] && !!control && (control.dirty || control.touched) };
      this.matchers.set(path, matcher);
    }
    return matcher;
  }

  addProperty(): void {
    this.properties.push(property({ name: '', type: 'String', value: '' }));
  }

  removeProperty(index: number): void {
    this.properties.removeAt(index);
  }

  save(): void {
    if (!this.canSave()) return;
    const name = this.creating ? this.draft().name : this.data.rule!.name;
    const rule = toWire({ ...this.draft(), name });
    const call = this.creating
      ? this.topics.createRule(this.data.topicName, this.data.subscriptionName, rule)
      : this.topics.replaceRule(this.data.topicName, this.data.subscriptionName, name, rule);
    this.errorMessage.set(null);
    this.notFound.set(false);
    this.saving.set(true);
    call.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: stored => this.dialogRef.close(stored ?? true),
      error: (error: HttpErrorResponse) => this.fail(error, name)
    });
  }

  refresh(): void {
    this.dialogRef.close('refresh');
  }

  private fail(error: HttpErrorResponse, name: string): void {
    if (error.status === 409 && this.creating) {
      this.conflictName.set(name);
      this.form.controls.name.markAsTouched();
    } else if (error.status === 400) {
      this.errorMessage.set(error.error?.message ?? 'The API refused this rule.');
    } else if (error.status === 404) {
      this.notFound.set(true);
      this.errorMessage.set(`${error.error?.message ?? 'The rule or its subscription no longer exists.'} Refresh to see the rules as they are now.`);
    } else {
      this.errorMessage.set(`Could not ${this.creating ? 'add' : 'save'} the rule: the API did not confirm it. Try again.`);
    }
  }

  private buildForm(draft: RuleDraft) {
    return new FormGroup({
      name: new FormControl(draft.name, { nonNullable: true }),
      filterType: new FormControl<RuleFilterType>(draft.filterType, { nonNullable: true }),
      sqlExpression: new FormControl(draft.sqlExpression, { nonNullable: true }),
      sqlAction: new FormControl(draft.sqlAction, { nonNullable: true }),
      correlation: new FormGroup(
        Object.fromEntries(SYSTEM_FIELDS.map(f => [f.key, new FormControl(draft.correlation[f.key], { nonNullable: true })])) as Record<SystemField, FormControl<string>>
      ),
      properties: new FormArray<PropertyGroup>(draft.properties.map(property))
    });
  }
}

function property(p: RuleDraft['properties'][number]): PropertyGroup {
  return new FormGroup({
    name: new FormControl(p.name, { nonNullable: true }),
    type: new FormControl<RulePropertyType>(p.type, { nonNullable: true }),
    value: new FormControl(p.value, { nonNullable: true })
  });
}
