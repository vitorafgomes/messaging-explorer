import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';

export interface ExportMessagesDialogData {
  messageCount: number;
  entityName: string;
  entityType: 'queue' | 'topic';
  isDeadLetter: boolean;
}

export interface ExportOptions {
  format: 'json' | 'csv' | 'xlsx';
  includeApplicationProperties: boolean;
  prettyPrint: boolean;
}

@Component({
  selector: 'app-export-messages-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatIconModule,
    MatRadioModule
  ],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon fontIcon="download" aria-hidden="true"></mat-icon>
      <span>Export {{ data.messageCount }} {{ data.messageCount === 1 ? 'Message' : 'Messages' }}</span>
    </h2>

    <mat-dialog-content class="content">
      <p>
        Export
        <strong>{{ data.messageCount }}</strong>
        {{ data.messageCount === 1 ? 'message' : 'messages' }}
        from
        <strong>{{ data.entityName }}</strong>
        {{ data.isDeadLetter ? '(Dead Letter)' : '' }}
      </p>

      <fieldset class="group">
        <legend>Export Format</legend>
        <mat-radio-group name="format" [(ngModel)]="exportOptions.format" class="formats" aria-label="Export Format">
          <mat-radio-button value="json" class="format">
            <strong>JSON</strong> <span class="hint">Structured data format, suitable for re-import</span>
          </mat-radio-button>
          <mat-radio-button value="csv" class="format">
            <strong>CSV</strong> <span class="hint">Tabular format, suitable for Excel/spreadsheets</span>
          </mat-radio-button>
          <mat-radio-button value="xlsx" class="format">
            <strong>Excel (XLSX)</strong> <span class="hint">Native Excel format with formatted headers and multi-sheet support</span>
          </mat-radio-button>
        </mat-radio-group>
      </fieldset>

      <fieldset class="group">
        <legend>Export Options</legend>
        <mat-checkbox name="includeAppProps" [(ngModel)]="exportOptions.includeApplicationProperties">
          Include application properties
          <span class="hint block">Include custom application properties in the export</span>
        </mat-checkbox>
        @if (exportOptions.format === 'json') {
          <mat-checkbox name="prettyPrint" [(ngModel)]="exportOptions.prettyPrint">
            Pretty-print JSON
            <span class="hint block">Format JSON with indentation for better readability</span>
          </mat-checkbox>
        }
      </fieldset>

      <p class="note" role="note">
        <mat-icon fontIcon="info" aria-hidden="true"></mat-icon>
        <span><strong>Note:</strong> The file will be downloaded to your browser's default download location.</span>
      </p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>
        Cancel
      </button>
      <button
        mat-flat-button
        type="button"
        [mat-dialog-close]="exportOptions">
        <mat-icon fontIcon="download" aria-hidden="true"></mat-icon>
        Export
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .title { display: flex; align-items: center; gap: 8px; }
    .title mat-icon { flex: none; color: var(--mat-sys-primary); }
    .content { display: flex; flex-direction: column; gap: 16px; min-width: 0; overflow-wrap: anywhere; }
    p { margin: 0; }
    .group { display: flex; flex-direction: column; gap: 4px; min-width: 0; margin: 0; padding: 0; border: 0; }
    legend { padding: 0 0 4px; font: var(--mat-sys-title-small); }
    .formats { display: flex; flex-direction: column; gap: 8px; }
    .format { padding: 4px 8px 4px 0; border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; }
    .format.mat-mdc-radio-checked { border-color: var(--mat-sys-primary); background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .hint { font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }
    .block { display: block; }
    .note { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: 8px; background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .note mat-icon { flex: none; }
  `]
})
export class ExportMessagesDialogComponent {
  data = inject<ExportMessagesDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<ExportMessagesDialogComponent>);

  exportOptions: ExportOptions = {
    format: 'json',
    includeApplicationProperties: true,
    prettyPrint: true
  };
}
