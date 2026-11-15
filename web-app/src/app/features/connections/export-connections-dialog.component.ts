import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ConnectionGroup, ServiceBusConnection } from '../../core/models';

/** What the export dialog counts: the saved connections and the clients and environments that group them. */
export interface ExportConnectionsDialogData {
  connections: ServiceBusConnection[];
  groups: ConnectionGroup[];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Result returned by the export connections dialog when the user confirms.
 * A `null`/`undefined` dialog result means the user cancelled.
 */
export interface ExportConnectionsDialogResult {
  includeSecrets: boolean;
}

/**
 * Confirmation dialog for exporting connection configuration.
 * Defaults to masked export; user can opt-in to include plaintext secrets.
 */
@Component({
  selector: 'app-export-connections-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title>Export connections</h2>

    <mat-dialog-content>
      <p class="summary">{{ summary }}</p>
      <p>
        By default, exports are <strong>masked</strong>: connection strings,
        passwords and client secrets are replaced with <code>***</code>.
        A masked file can be shared; whoever imports it types the secrets again.
      </p>

      <mat-checkbox
        [checked]="includeSecrets()"
        (change)="includeSecrets.set($event.checked)">
        Include plaintext secrets in export
      </mat-checkbox>

      @if (includeSecrets()) {
        <div class="warning-box" role="alert">
          <mat-icon aria-hidden="true">warning</mat-icon>
          <span>
            <strong>The file will hold real secrets.</strong>
            The exported file will contain real connection strings, passwords,
            and client secrets, unencrypted. Anyone who opens it can connect to these brokers{{ productionClause }}.
            Store it securely and delete it when it has served.
          </span>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton (click)="cancel()">Cancel</button>
      <button
        matButton="filled"
        [class.danger]="includeSecrets()"
        (click)="confirm()">
        <mat-icon>download</mat-icon>
        {{ includeSecrets() ? 'Export with secrets' : 'Export' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      overflow: visible;

      p {
        margin: 0 0 12px;
      }

      .summary {
        color: var(--mat-sys-on-surface-variant);
        font-variant-numeric: tabular-nums;
      }

      code {
        padding: 1px 4px;
        border-radius: 4px;
        background-color: var(--mat-sys-surface-container-high);
      }
    }

    .warning-box {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-top: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      background-color: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);

      mat-icon {
        flex-shrink: 0;
      }
    }

    .danger {
      background-color: var(--mat-sys-error);
      color: var(--mat-sys-on-error);
    }
  `]
})
export class ExportConnectionsDialogComponent {
  // Opt-in flag driven by a signal, as required by project conventions.
  readonly includeSecrets = signal(false);
  private readonly data = inject<ExportConnectionsDialogData>(MAT_DIALOG_DATA);

  /** How many connections, clients and environments the file holds. */
  readonly summary = `${plural(this.data.connections.length, 'connection', 'connections')}, `
    + `${plural(this.data.groups.filter(g => g.type === 'client').length, 'client', 'clients')} and `
    + `${plural(this.data.groups.filter(g => g.type === 'environment').length, 'environment', 'environments')} `
    + 'go into one JSON file that you choose where to save.';

  /** Names the connections in an environment marked production, when there are any. */
  readonly productionClause = (() => {
    const production = new Set(this.data.groups.filter(g => g.isProduction).map(g => g.id));
    const count = this.data.connections.filter(c => c.environmentId && production.has(c.environmentId)).length;
    return count === 0 ? '' : count === 1 ? ', the one marked Production included' : `, the ${count} marked Production included`;
  })();

  constructor(private dialogRef: MatDialogRef<ExportConnectionsDialogComponent, ExportConnectionsDialogResult>) {}

  confirm(): void {
    this.dialogRef.close({ includeSecrets: this.includeSecrets() });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
