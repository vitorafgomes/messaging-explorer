import { Component, signal } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';

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
            and client secrets, unencrypted. Store it securely.
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
      max-width: 520px;

      p {
        margin: 0 0 12px;
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

  constructor(private dialogRef: MatDialogRef<ExportConnectionsDialogComponent, ExportConnectionsDialogResult>) {}

  confirm(): void {
    this.dialogRef.close({ includeSecrets: this.includeSecrets() });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
