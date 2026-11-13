import { Component, OnDestroy, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Subscription } from 'rxjs';
import { ConnectionService, DefinitionsService, MessageExportService, countDefinitions, describeCounts } from '../../core/services';
import { connectionContext } from './connection-context';

/** The file a namespace's definitions are saved to: `<namespace>.definitions.json`. */
export function definitionsFileName(namespace: string | undefined): string {
  return `${(namespace || 'namespace').replace(/[^A-Za-z0-9._-]/g, '-')}.definitions.json`;
}

/**
 * Exports the definitions of every queue, topic, subscription and rule of the connected namespace to one JSON file.
 * Cancel while it runs abandons the request; the API stops reading when the request ends.
 */
@Component({
  selector: 'app-export-definitions-dialog',
  standalone: true,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatButtonModule, MatIconModule, MatChipsModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title>Export definitions</h2>
    <mat-dialog-content>
      <p class="context">
        <mat-chip-set aria-label="Environment"><mat-chip [disableRipple]="true">{{ context().environment }}</mat-chip></mat-chip-set>
        <span>From {{ context().connection }}</span>
      </p>
      <p>Writes every queue, topic, subscription and rule of this namespace, with its full configuration, to one versioned JSON file.</p>
      <dl class="facts">
        <div class="fact"><dt>File</dt><dd>{{ fileName }}</dd></div>
        <div class="fact"><dt>Messages</dt><dd>Not included</dd></div>
        <div class="fact"><dt>Secrets</dt><dd>None: an entity definition holds no secret</dd></div>
      </dl>
      @switch (state()) {
        @case ('exporting') {
          <p class="note">Reading every entity and the rules of every subscription. On a large namespace this takes a while.</p>
          <mat-progress-bar mode="indeterminate" aria-label="Exporting"></mat-progress-bar>
        }
        @case ('done') {
          <div class="done" role="status">
            <mat-icon aria-hidden="true">check_circle</mat-icon>
            <span>
              Saved {{ fileName }}: {{ summary() }}.
              @if (empty()) { This namespace has no queue and no topic, so the file holds none. }
            </span>
          </div>
        }
        @case ('error') {
          <div class="error" role="alert">
            <mat-icon aria-hidden="true">error</mat-icon>
            <span class="grow">{{ errorMessage() }}</span>
            <button mat-button type="button" (click)="export()">Retry</button>
          </div>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (state() === 'done') {
        <button mat-flat-button type="button" (click)="close()">Close</button>
      } @else {
        <button mat-button type="button" (click)="close()">Cancel</button>
        <button mat-flat-button type="button" [disabled]="state() === 'exporting'" (click)="export()">
          <mat-icon aria-hidden="true">download</mat-icon>
          Export to a file
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .context { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 12px; overflow-wrap: anywhere; }
    p { margin: 0 0 12px; }
    .note { color: var(--mat-sys-on-surface-variant); }
    .facts { margin: 0 0 16px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 12px; }
    .fact { display: flex; justify-content: space-between; gap: 16px; padding: 8px 16px; min-width: 0; }
    .fact + .fact { border-top: 1px solid var(--mat-sys-outline-variant); }
    dt { font-weight: normal; color: var(--mat-sys-on-surface-variant); }
    dd { margin: 0; text-align: end; overflow-wrap: anywhere; }
    .done, .error { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px; }
    .done { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .error { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .grow { flex: 1; min-width: 0; }
  `]
})
export class ExportDefinitionsDialogComponent implements OnDestroy {
  private readonly definitions = inject(DefinitionsService);
  private readonly files = inject(MessageExportService);
  private readonly dialogRef = inject(MatDialogRef<ExportDefinitionsDialogComponent>);

  readonly context = connectionContext();
  readonly fileName = definitionsFileName(inject(ConnectionService).currentTarget);
  readonly state = signal<'ready' | 'exporting' | 'done' | 'error'>('ready');
  readonly summary = signal('');
  readonly empty = signal(false);
  readonly errorMessage = signal('');
  private running?: Subscription;

  export(): void {
    this.state.set('exporting');
    this.running?.unsubscribe();
    this.running = this.definitions.export().subscribe({
      next: document => {
        const counts = countDefinitions(document);
        this.files.downloadFile(JSON.stringify(document, null, 2), this.fileName, 'application/json');
        this.summary.set(describeCounts(counts));
        this.empty.set(counts.queues === 0 && counts.topics === 0);
        this.state.set('done');
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage.set(error.status === 400 && error.error?.message
          ? error.error.message
          : 'Could not export: the API did not answer with the definitions. Nothing was saved.');
        this.state.set('error');
      }
    });
  }

  close(): void {
    this.running?.unsubscribe();
    this.dialogRef.close();
  }

  ngOnDestroy(): void {
    this.running?.unsubscribe();
  }
}
