import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Subscription } from 'rxjs';
import { DefinitionImportItem, DefinitionsImportResult, EntityDefinitionsDocument } from '../../core/models';
import { ConnectionService, DefinitionsService, EntitySelectionService, countDefinitions, describeCounts } from '../../core/services';
import { connectionContext } from './connection-context';

type Step = 'choose' | 'checking' | 'review' | 'importing' | 'done';

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Imports a definitions file into the connected namespace. The file is checked by a dry run first, which says what
 * would be created, what already exists and what exists with another configuration; only the first group is ever
 * created. The confirmation names the connection and its environment and asks for the namespace to be typed. While
 * the import runs the dialog cannot be closed, so a result is never abandoned half way.
 */
@Component({
  selector: 'app-import-definitions-dialog',
  standalone: true,
  imports: [
    MatDialogTitle, MatDialogContent, MatDialogActions, MatButtonModule, MatIconModule, MatChipsModule,
    MatFormFieldModule, MatInputModule, MatProgressBarModule
  ],
  template: `
    <h2 mat-dialog-title>Import definitions</h2>
    <mat-dialog-content>
      <p class="context">
        <mat-chip-set aria-label="Environment"><mat-chip [disableRipple]="true">{{ context().environment }}</mat-chip></mat-chip-set>
        <span>Into {{ context().connection }}</span>
      </p>
      <input #picker class="picker" type="file" accept=".json,application/json" aria-label="Definitions file" (change)="read(picker)">
      <div class="file">
        <mat-icon aria-hidden="true">description</mat-icon>
        <span class="grow">
          @if (fileName()) {
            <b>{{ fileName() }}</b><span class="muted">: {{ fileSummary() }}</span>
          } @else {
            <span class="muted">Choose a file written by Export definitions.</span>
          }
        </span>
        <button mat-button type="button" [disabled]="busy()" (click)="picker.click()">{{ fileName() ? 'Choose another file' : 'Choose a file' }}</button>
      </div>

      @if (busy()) {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="step() === 'checking' ? 'Running the dry run' : 'Importing'"></mat-progress-bar>
      }

      @if (errorMessage()) {
        <div class="error" role="alert">
          <mat-icon aria-hidden="true">error</mat-icon>
          <span class="grow">{{ errorMessage() }}</span>
          @if (document()) {
            <button mat-button type="button" (click)="check()">Run the dry run again</button>
          }
        </div>
      }

      @if (step() === 'review' && plan(); as plan) {
        <h3>Dry run</h3>
        <p class="muted">Nothing has been created yet. This is what the import would do.</p>
        @if (plan.items.length === 0) {
          <p>The file holds no queue, topic or subscription.</p>
        }
        @for (group of groups(); track group.label) {
          @if (group.items.length) {
            <section class="group" [attr.aria-label]="group.label">
              <h4>{{ group.label }} ({{ group.items.length }})</h4>
              <ul>
                @for (item of group.items; track $index) {
                  <li>
                    <b>{{ item.name }}</b>
                    <span class="muted">{{ describe(item) }}</span>
                    @if (item.differingFields) {
                      <span class="fields">Differs in: {{ item.differingFields.join(', ') }}</span>
                    }
                  </li>
                }
              </ul>
            </section>
          }
        }
        <p class="notice">
          <mat-icon aria-hidden="true">info</mat-icon>
          <span><b>Import only creates.</b> {{ createCount() }} {{ createCount() === 1 ? 'entity' : 'entities' }} would be created.
            {{ leftCount() }} already {{ leftCount() === 1 ? 'exists' : 'exist' }} and {{ leftCount() === 1 ? 'stays' : 'stay' }} exactly as {{ leftCount() === 1 ? 'it is' : 'they are' }}. Nothing is updated and nothing is deleted.</span>
        </p>
        @if (createCount() > 0) {
          <dl class="facts">
            <div class="fact"><dt>Connection</dt><dd>{{ context().connection }}</dd></div>
            <div class="fact"><dt>Environment</dt><dd>{{ context().environment }}</dd></div>
            <div class="fact"><dt>Would be created</dt><dd>{{ createCount() }}</dd></div>
          </dl>
          <mat-form-field class="typed">
            <mat-label>Type the namespace to confirm</mat-label>
            <input matInput autocomplete="off" spellcheck="false" [placeholder]="namespace" [value]="typed()" (input)="typed.set($any($event.target).value)">
            <mat-hint>The button stays disabled until the name matches exactly.</mat-hint>
          </mat-form-field>
        } @else {
          <p>Nothing to create: every entity in the file already exists here.</p>
        }
      }

      @if (step() === 'done' && result(); as result) {
        <h3>Result</h3>
        <p role="status">{{ resultSummary() }}</p>
        <ul class="results">
          @for (item of result.items; track $index) {
            <li [class.failed]="item.outcome === 'Failed'">
              <b>{{ item.name }}</b>
              <span class="muted">{{ describe(item) }}</span>
              <span>{{ outcomeText(item) }}</span>
            </li>
          }
        </ul>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (step() === 'done') {
        <button mat-flat-button type="button" (click)="close()">Close</button>
      } @else {
        <button mat-button type="button" [disabled]="step() === 'importing'" (click)="close()">Cancel</button>
        @if (step() === 'review' && createCount() > 0) {
          <button mat-flat-button type="button" [disabled]="!canCreate()" (click)="create()">
            <mat-icon aria-hidden="true">upload</mat-icon>
            Create {{ createCount() }} {{ createCount() === 1 ? 'entity' : 'entities' }}
          </button>
        }
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .context { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 12px; overflow-wrap: anywhere; }
    .picker { display: none; }
    .file { display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 16px; border-radius: 12px; background: var(--mat-sys-surface-container); margin-bottom: 12px; }
    .grow { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    h3 { margin: 16px 0 4px; font: var(--mat-sys-title-medium); }
    h4 { margin: 12px 0 4px; font: var(--mat-sys-title-small); }
    p { margin: 0 0 12px; }
    ul { margin: 0; padding: 0; list-style: none; }
    li { display: flex; flex-wrap: wrap; gap: 4px 8px; padding: 6px 0; border-bottom: 1px solid var(--mat-sys-outline-variant); overflow-wrap: anywhere; }
    .fields { flex-basis: 100%; color: var(--mat-sys-on-surface-variant); }
    .results li.failed { color: var(--mat-sys-error); }
    .notice { display: flex; gap: 12px; padding: 12px 16px; border-radius: 12px; margin-top: 16px; background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .facts { margin: 0 0 16px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 12px; }
    .fact { display: flex; justify-content: space-between; gap: 16px; padding: 8px 16px; min-width: 0; }
    .fact + .fact { border-top: 1px solid var(--mat-sys-outline-variant); }
    dt { font-weight: normal; }
    dd { margin: 0; text-align: end; overflow-wrap: anywhere; }
    .typed { width: 100%; }
    .error { display: flex; align-items: center; gap: 12px; padding: 12px 16px; margin-bottom: 12px; border-radius: 12px; background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    mat-progress-bar { margin-bottom: 12px; }
  `]
})
export class ImportDefinitionsDialogComponent implements OnDestroy {
  private readonly definitions = inject(DefinitionsService);
  private readonly selection = inject(EntitySelectionService);
  private readonly dialogRef = inject(MatDialogRef<ImportDefinitionsDialogComponent>);

  readonly context = connectionContext();
  /** The namespace the user types to confirm, exactly as the connection names it. */
  readonly namespace = inject(ConnectionService).currentTarget ?? '';

  readonly step = signal<Step>('choose');
  readonly fileName = signal('');
  readonly fileSummary = signal('');
  readonly document = signal<EntityDefinitionsDocument | null>(null);
  readonly plan = signal<DefinitionsImportResult | null>(null);
  readonly result = signal<DefinitionsImportResult | null>(null);
  readonly typed = signal('');
  readonly errorMessage = signal('');
  private running?: Subscription;

  readonly busy = computed(() => this.step() === 'checking' || this.step() === 'importing');
  readonly createCount = computed(() => this.plan()?.items.filter(i => i.outcome === 'Create').length ?? 0);
  readonly leftCount = computed(() => (this.plan()?.items.length ?? 0) - this.createCount());
  readonly canCreate = computed(() => this.step() === 'review' && this.createCount() > 0 && this.namespace !== '' && this.typed() === this.namespace);
  readonly groups = computed(() => {
    const items = this.plan()?.items ?? [];
    return [
      { label: 'Would be created', items: items.filter(i => i.outcome === 'Create') },
      { label: 'Already exist', items: items.filter(i => i.outcome === 'Exists') },
      { label: 'Exist and differ', items: items.filter(i => i.outcome === 'Differs') }
    ];
  });
  readonly resultSummary = computed(() => {
    const items = this.result()?.items ?? [];
    const count = (outcome: string) => items.filter(i => i.outcome === outcome).length;
    return `${count('Created')} created, ${count('Exists') + count('Differs')} left as they are, ${count('Failed')} failed.`;
  });

  async read(picker: HTMLInputElement): Promise<void> {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;
    this.reset();
    this.fileName.set(file.name);
    let document: EntityDefinitionsDocument;
    try {
      document = JSON.parse(await readText(file));
    } catch {
      this.errorMessage.set('This file is not JSON. Choose a file written by Export definitions.');
      return;
    }
    if (!document || typeof document !== 'object') {
      this.errorMessage.set('This file is not a definitions document. Choose a file written by Export definitions.');
      return;
    }
    this.document.set(document);
    this.fileSummary.set(describeCounts(countDefinitions(document)));
    this.check();
  }

  check(): void {
    const document = this.document();
    if (!document) return;
    this.errorMessage.set('');
    this.typed.set('');
    this.plan.set(null);
    this.step.set('checking');
    this.running?.unsubscribe();
    this.running = this.definitions.dryRun(document).subscribe({
      next: plan => {
        this.plan.set(plan);
        this.step.set('review');
      },
      error: (error: HttpErrorResponse) => {
        this.step.set('choose');
        this.errorMessage.set(this.refusal(error) ?? 'The API did not answer the dry run. Nothing was created. Try again.');
      }
    });
  }

  create(): void {
    const document = this.document();
    if (!document || !this.canCreate()) return;
    this.errorMessage.set('');
    this.step.set('importing');
    this.dialogRef.disableClose = true;
    this.running?.unsubscribe();
    this.running = this.definitions.import(document).subscribe({
      next: result => {
        this.dialogRef.disableClose = false;
        this.result.set(result);
        this.step.set('done');
        this.selection.refreshTree();
      },
      error: (error: HttpErrorResponse) => {
        this.dialogRef.disableClose = false;
        this.step.set('review');
        this.errorMessage.set(this.refusal(error)
          ?? 'The API did not confirm the import. Some entities may have been created: run the dry run again to see what exists now.');
      }
    });
  }

  describe(item: DefinitionImportItem): string {
    return item.topic ? `${item.kind.toLowerCase()} in ${item.topic}` : item.kind.toLowerCase();
  }

  outcomeText(item: DefinitionImportItem): string {
    switch (item.outcome) {
      case 'Created': return 'Created';
      case 'Exists': return item.reason ?? 'Already existed. Left as it is.';
      case 'Differs': return `Exists with another configuration (${item.differingFields?.join(', ')}). Left as it is.`;
      case 'Failed': return `Failed: ${item.reason ?? 'the API gave no reason.'}`;
      default: return item.outcome;
    }
  }

  close(): void {
    this.running?.unsubscribe();
    this.dialogRef.close(this.result());
  }

  ngOnDestroy(): void {
    this.running?.unsubscribe();
  }

  private reset(): void {
    this.running?.unsubscribe();
    this.step.set('choose');
    this.document.set(null);
    this.plan.set(null);
    this.result.set(null);
    this.typed.set('');
    this.errorMessage.set('');
    this.fileSummary.set('');
  }

  /** The API's own words for a 400 (a refused document names its field) or a 413; null for any other failure. */
  private refusal(error: HttpErrorResponse): string | null {
    return (error.status === 400 || error.status === 413) && typeof error.error?.message === 'string' ? error.error.message : null;
  }
}
