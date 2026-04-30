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
    <h2 mat-dialog-title class="dialog-title">
      <mat-icon color="primary">download</mat-icon>
      Export connections
    </h2>

    <mat-dialog-content>
      <p class="mb-3">
        By default, exports are <strong>masked</strong>: connection strings,
        passwords and client secrets are replaced with <code>***</code>.
      </p>

      <mat-checkbox
        [checked]="includeSecrets()"
        (change)="includeSecrets.set($event.checked)">
        Include plaintext secrets in export
      </mat-checkbox>

      @if (includeSecrets()) {
        <div class="warning-box mt-3" role="alert">
          <mat-icon color="warn">warning</mat-icon>
          <span>
            The exported file will contain real connection strings, passwords,
            and client secrets. Store it securely.
          </span>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-stroked-button (click)="cancel()">Cancel</button>
      <button
        mat-flat-button
        [color]="includeSecrets() ? 'warn' : 'primary'"
        (click)="confirm()">
        Export
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
    }

    mat-dialog-content {
      min-width: 420px;
      max-width: 520px;

      p {
        margin: 0 0 12px;
      }

      code {
        padding: 1px 4px;
        border-radius: 3px;
        background-color: var(--bs-secondary-bg, #f1f3f5);
      }
    }

    .mb-3 { margin-bottom: 12px; }
    .mt-3 { margin-top: 12px; }

    .warning-box {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid var(--bs-warning-border-subtle, #f5c2c7);
      background-color: var(--bs-warning-bg-subtle, #fff3cd);
      color: var(--bs-body-color);

      mat-icon {
        flex-shrink: 0;
      }
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
