import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Subscription } from 'rxjs';
import { DefinitionImportItem, DefinitionsImportResult, EntityDefinitionsDocument } from '../../core/models';
import { ConnectionService, DefinitionsService, EntitySelectionService, countDefinitions, describeCounts } from '../../core/services';
import { connectionContext } from './connection-context';
import { EnvironmentLineComponent } from '../../shared/environment-line.component';

type Step = 'choose' | 'checking' | 'review' | 'importing' | 'done';

/** An entity of a definitions file as the dry run detail reads it. */
interface FileEntity {
  name?: string;
  subscriptions?: (FileEntity | null)[] | null;
  rules?: unknown[] | null;
}

/** The settings a dry run compares, in the words of the entity form. */
const FIELD_LABELS: Record<string, string> = {
  defaultMessageTimeToLive: 'Message time to live',
  lockDuration: 'Lock duration',
  maxDeliveryCount: 'Max delivery count',
  requiresSession: 'Requires session',
  enablePartitioning: 'Partitioning',
  deadLetteringOnMessageExpiration: 'Dead-letter a message when it expires',
  deadLetteringOnFilterEvaluationExceptions: 'Dead-letter on a filter evaluation error',
  requiresDuplicateDetection: 'Duplicate detection',
  duplicateDetectionHistoryTimeWindow: 'Duplicate detection window',
  maxSizeInMegabytes: 'Max size in megabytes',
  autoDeleteOnIdle: 'Auto delete on idle',
  enableBatchedOperations: 'Batched operations',
  supportOrdering: 'Support ordering',
  forwardTo: 'Forward to',
  forwardDeadLetteredMessagesTo: 'Forward dead-lettered messages to',
  userMetadata: 'User metadata',
  status: 'Status',
  rules: 'Rules'
};

/** A value of a dry run difference as the Detail says it; an empty one is "not set". */
function shown(value: unknown): string {
  return value === undefined || value === null || value === '' ? 'not set' : String(value);
}

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
    MatDialogTitle, MatDialogContent, MatDialogActions, MatButtonModule, MatIconModule, EnvironmentLineComponent,
    MatFormFieldModule, MatInputModule, MatProgressBarModule
  ],
  template: `
    <h2 mat-dialog-title>Import definitions</h2>
    <mat-dialog-content>
      <app-environment-line [mark]="context().mark">Into {{ context().where }}</app-environment-line>
      <input #picker class="picker" type="file" accept=".json,application/json" aria-label="Definitions file" (change)="read(picker)">
      <div class="file">
        <mat-icon aria-hidden="true">description</mat-icon>
        <span class="grow">
          @if (fileName()) {
            <b>{{ fileName() }}</b><span class="muted">{{ fileSummary() }}</span>
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
        @if (plan.items.length) {
          <table class="dry-run">
            <thead>
              <tr><th scope="col">Entity</th><th scope="col">Kind</th><th scope="col">Result</th><th scope="col">Detail</th></tr>
            </thead>
            <tbody>
              @for (item of plan.items; track $index) {
                <tr>
                  <td><b>{{ item.name }}</b>@if (item.topic) {<span class="muted"> in {{ item.topic }}</span>}</td>
                  <td>{{ item.kind }}</td>
                  <td>
                    @switch (item.outcome) {
                      @case ('Create') { <span class="chip create"><mat-icon aria-hidden="true">add</mat-icon> Would be created</span> }
                      @case ('Differs') { <span class="chip differs"><mat-icon aria-hidden="true">warning</mat-icon> Exists and differs</span> }
                      @default { <span class="chip exists"><mat-icon aria-hidden="true">check_circle</mat-icon> Already exists</span> }
                    }
                  </td>
                  <td class="muted">{{ detail(item) }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
        <p class="notice">
          <mat-icon aria-hidden="true">info</mat-icon>
          <span><b>Import only creates.</b> {{ createCount() }} {{ createCount() === 1 ? 'entity' : 'entities' }} would be created. {{ leftSentence() }} Nothing is updated and nothing is deleted.</span>
        </p>
        @if (createCount() > 0) {
          <dl class="facts">
            <div class="fact"><dt>Connection</dt><dd>{{ context().connection }}</dd></div>
            <div class="fact"><dt>Environment</dt><dd>{{ context().environment }}</dd></div>
            <div class="fact"><dt>Would be created</dt><dd>{{ wouldBeCreated() }}</dd></div>
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
    p { margin: 0 0 12px; }
    ul { margin: 0; padding: 0; list-style: none; }
    li { display: flex; flex-wrap: wrap; gap: 4px 8px; padding: 6px 0; border-bottom: 1px solid var(--mat-sys-outline-variant); overflow-wrap: anywhere; }
    .dry-run { width: 100%; border-collapse: collapse; font: var(--mat-sys-body-medium); }
    .dry-run th { padding: 8px 12px; border-bottom: 1px solid var(--mat-sys-outline); color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-label-medium); text-align: start; }
    .dry-run td { padding: 8px 12px; border-bottom: 1px solid var(--mat-sys-outline-variant); overflow-wrap: anywhere; }
    .dry-run th:first-child, .dry-run td:first-child { padding-inline-start: 0; }
    .chip { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 8px 0 6px; border-radius: 999px; font: var(--mat-sys-label-small); font-weight: 700; white-space: nowrap; }
    .chip mat-icon { width: 14px; height: 14px; font-size: 14px; }
    .chip.exists { padding: 0; color: var(--mat-sys-on-surface-variant); }
    .chip.differs { background: var(--app-warning-container); color: var(--app-on-warning-container); }
    .chip.create { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
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
  /** "2 already exist and 1 exists and differs: these 3 stay exactly as they are.", or nothing when all are new. */
  readonly leftSentence = computed(() => {
    const items = this.plan()?.items ?? [];
    const exists = items.filter(i => i.outcome === 'Exists').length;
    const differs = items.filter(i => i.outcome === 'Differs').length;
    const parts = [
      exists ? `${exists} already ${exists === 1 ? 'exists' : 'exist'}` : '',
      differs ? `${differs} ${differs === 1 ? 'exists and differs' : 'exist and differ'}` : ''
    ].filter(p => p);
    if (!parts.length) return '';
    const left = exists + differs;
    return `${parts.join(' and ')}: ${left === 1 ? 'it stays exactly as it is' : `these ${left} stay exactly as they are`}.`;
  });
  /** "Queue orders-archive, subscription warehouse in order-events with 2 rules". */
  readonly wouldBeCreated = computed(() => {
    const text = (this.plan()?.items ?? []).filter(i => i.outcome === 'Create').map(item => {
      const rules = item.kind === 'Subscription' ? this.fileRules(item) : 0;
      return `${item.kind.toLowerCase()} ${item.name}${item.topic ? ` in ${item.topic}` : ''}${rules ? ` with ${rules} rule${rules === 1 ? '' : 's'}` : ''}`;
    }).join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  });
  readonly canCreate = computed(() => this.step() === 'review' && this.createCount() > 0 && this.namespace !== '' && this.typed() === this.namespace);
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
    const source = typeof document.source === 'string' ? document.source.trim() : '';
    this.fileSummary.set(`${source ? ` exported from ${source}` : ''}: ${describeCounts(countDefinitions(document))}`);
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

  /** The Detail of a dry run row as the artboard draws it; a difference gives its value here and in the file. */
  detail(item: DefinitionImportItem): string {
    const rules = item.kind === 'Subscription' ? this.fileRules(item) : 0;
    switch (item.outcome) {
      case 'Create':
        return rules ? `With its ${rules} rule${rules === 1 ? '' : 's'}.` : 'With the configuration in the file.';
      case 'Differs': {
        const differences = item.differences ?? (item.differingFields ?? []).map(field => ({ field, current: undefined, inFile: undefined }));
        const fields = differences.map(({ field, current, inFile }) => {
          if (field === 'rules') return 'The rules differ here.';
          const label = FIELD_LABELS[field] ?? field;
          return item.differences ? `${label} is ${shown(current)} here and ${shown(inFile)} in the file.` : `${label} differs here.`;
        });
        return [...fields, 'Left as it is.'].join(' ');
      }
      default:
        return rules ? `Same definition and the same rule${rules === 1 ? '' : 's'}. Left as it is.` : 'Same definition. Left as it is.';
    }
  }

  describe(item: DefinitionImportItem): string {
    return item.topic ? `${item.kind.toLowerCase()} in ${item.topic}` : item.kind.toLowerCase();
  }

  outcomeText(item: DefinitionImportItem): string {
    switch (item.outcome) {
      case 'Created': return 'Created';
      case 'Exists': return item.reason ?? 'Already existed. Left as it is.';
      case 'Differs': return `Exists with another configuration (${(item.differingFields ?? []).map(f => FIELD_LABELS[f] ?? f).join(', ')}). Left as it is.`;
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

  /** The entity of the file a dry run item names, read loosely: the file is untrusted and every member may be missing. */
  private fileEntity(item: DefinitionImportItem): FileEntity | undefined {
    const entities = this.document()?.entities as { queues?: (FileEntity | null)[] | null; topics?: (FileEntity | null)[] | null } | null | undefined;
    const named = (list: (FileEntity | null)[] | null | undefined, name: string | null) => (list ?? []).find(e => e?.name === name) ?? undefined;
    switch (item.kind) {
      case 'Queue': return named(entities?.queues, item.name);
      case 'Topic': return named(entities?.topics, item.name);
      default: return named(named(entities?.topics, item.topic)?.subscriptions, item.name);
    }
  }

  private fileRules(item: DefinitionImportItem): number {
    return this.fileEntity(item)?.rules?.length ?? 0;
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
