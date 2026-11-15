import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ConnectionService } from '../../core/services';
import { ImportPreview } from '../../core/models';

/** The file the user picked, read on this computer and not yet sent for import. */
export interface ImportConnectionsDialogData {
  fileName: string;
  json: string;
}

/** The secret fields an export masks, in the words of the import preview. */
const MASKED_FIELDS: ReadonlyArray<[string, string]> = [['connectionString', 'connection string'], ['password', 'password'], ['clientSecret', 'client secret']];

/** A property of a file entry, in camelCase or PascalCase. */
const field = (entry: unknown, key: string): unknown => {
  if (!entry || typeof entry !== 'object') return undefined;
  const record = entry as Record<string, unknown>;
  return record[key] ?? record[key[0].toUpperCase() + key.slice(1)];
};

/**
 * Shows what an import of a file would add and update, as the API previews it without writing anything,
 * then imports it. Closes with the API's message after an import, and with nothing on Cancel.
 */
@Component({
  selector: 'app-import-connections-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <h2 mat-dialog-title>Import connections</h2>

    <mat-dialog-content>
      <p class="file-line">
        <span class="file-name">{{ data.fileName }}</span>
        <span>read on this computer and not yet applied.</span>
      </p>
      <p>This will import connections and groups from the selected file. Existing items with the same ID will be updated.</p>

      @if (previewError()) {
        <section class="error" aria-label="Error">
          <mat-icon aria-hidden="true">error</mat-icon>
          <span><strong>The file could not be previewed.</strong> {{ previewError() }} Nothing was imported.</span>
        </section>
      } @else if (preview(); as p) {
        <table class="preview">
          <caption>What the file holds and what happens to each item</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Kind</th>
              <th scope="col">Target</th>
              <th scope="col">On import</th>
            </tr>
          </thead>
          <tbody>
            @for (item of p.items; track $index) {
              <tr [class.added]="!item.exists">
                <td class="item">{{ item.name }}</td>
                <td>{{ item.kind }}</td>
                @if (item.target) {
                  <td class="target">{{ item.target }}</td>
                } @else {
                  <td class="muted">Not applicable</td>
                }
                <td>
                  @if (item.exists) {
                    Already exists, updated.{{ item.keepsStoredSecret ? ' The stored ' + keptSecret($index) + ' kept.' : '' }}
                  } @else {
                    <strong>New, added</strong>{{ item.placement ? ' to ' + item.placement : '' }}
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>

        @if (p.secretsMasked) {
          <p class="masked">
            <mat-icon aria-hidden="true">info</mat-icon>
            <span><strong>The secrets in this file are masked.</strong> {{ maskedDetail(p) }}</span>
          </p>
        }
      } @else {
        <div class="loading">
          <mat-progress-spinner mode="indeterminate" diameter="32" aria-label="Reading the file"></mat-progress-spinner>
        </div>
      }

      @if (importError()) {
        <section class="error" aria-label="Error">
          <mat-icon aria-hidden="true">error</mat-icon>
          <span><strong>The import failed.</strong> {{ importError() }}</span>
        </section>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Cancel</button>
      @if (preview(); as p) {
        <button matButton="filled" (click)="import()" [disabled]="importing()">
          @if (importing()) {
            <mat-progress-spinner diameter="18" mode="indeterminate"></mat-progress-spinner>
          } @else {
            <mat-icon>upload</mat-icon>
          }
          Import: add {{ p.add }}, update {{ p.update }}
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    p {
      margin: 0;
    }

    .file-line {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: var(--mat-sys-on-surface-variant);
    }

    .file-name,
    .target {
      font-family: ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace;
      overflow-wrap: anywhere;
      color: var(--mat-sys-on-surface);
    }

    .preview {
      width: 100%;
      border-collapse: collapse;

      caption {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }

      th {
        padding: 8px 12px;
        border-bottom: 1px solid var(--mat-sys-outline);
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
        text-align: left;
      }

      td {
        padding: 8px 12px;
        border-bottom: 1px solid var(--mat-sys-outline-variant);
      }

      th:first-child,
      td:first-child {
        padding-left: 0;
      }

      tr.added {
        background: var(--mat-sys-surface-container-low);
      }

      .item {
        font-weight: 500;
      }
    }

    .muted {
      color: var(--mat-sys-on-surface-variant);
    }

    .masked,
    .error {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 8px;
    }

    .masked {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }

    .error {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: 16px;
    }
  `]
})
export class ImportConnectionsDialogComponent implements OnInit {
  readonly data = inject<ImportConnectionsDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ImportConnectionsDialogComponent>);
  private readonly connectionService = inject(ConnectionService);
  private readonly destroyRef = inject(DestroyRef);

  readonly preview = signal<ImportPreview | null>(null);
  readonly previewError = signal<string | null>(null);
  readonly importError = signal<string | null>(null);
  readonly importing = signal(false);

  ngOnInit(): void {
    this.connectionService.previewImport(this.data.json).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: preview => this.preview.set(preview),
      error: err => this.previewError.set(err?.error?.message || 'The app\'s API did not answer.')
    });
  }

  /**
   * What a stored connection keeps, read from the masked fields of its entry in the file: the API lists
   * the file's groups first, then its connections in file order. Says "secret is" when the file cannot
   * be read that way.
   */
  keptSecret(index: number): string {
    const file = this.fileConnections;
    const preview = this.preview();
    const entry = file && preview ? file.connections[index - (preview.items.length - file.connections.length)] : undefined;
    const masked = entry ? MASKED_FIELDS.filter(([key]) => field(entry, key) === '***').map(([, label]) => label) : [];
    return masked.length === 0 ? 'secret is' : `${masked.join(' and ')} ${masked.length === 1 ? 'is' : 'are'}`;
  }

  /** The connections of the file, whatever the case of its keys; null when it cannot be read. */
  private readonly fileConnections = (() => {
    try {
      const connections = field(JSON.parse(this.data.json), 'connections');
      return Array.isArray(connections) ? { connections } : null;
    } catch {
      return null;
    }
  })();

  /** The rest of the masked notice: how many stored connections keep their secret, and what the import leaves. */
  maskedDetail(p: ImportPreview): string {
    const kept = p.items.filter(i => i.keepsStoredSecret).length;
    const keeps = kept === 1 ? 'the 1 existing connection keeps its' : `the ${kept} existing connections keep theirs`;
    const left = p.notInFile.length === 0
      ? 'Nothing is removed.'
      : p.notInFile.length === 1
        ? `Nothing is removed: the connection ${p.notInFile[0]} is not in the file and stays.`
        : `Nothing is removed: the connections ${p.notInFile.join(', ')} are not in the file and stay.`;
    return `A masked value never overwrites a stored secret, so ${keeps}. ${left}`;
  }

  import(): void {
    this.importing.set(true);
    this.importError.set(null);
    this.connectionService.importFullConfiguration(this.data.json).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => this.dialogRef.close(result.message || 'Configuration imported'),
      error: err => {
        this.importing.set(false);
        this.importError.set(err?.error?.message || 'The app\'s API did not answer.');
      }
    });
  }
}
