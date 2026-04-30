import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

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
    MatDialogModule
  ],
  host: {
    '[class.dark-mode-dialog]': 'isDarkMode()'
  },
  template: `
    <div class="modal-header" [class.bg-dark]="isDarkMode()" [class.text-light]="isDarkMode()">
      <h5 class="modal-title d-flex align-items-center gap-2" [class.text-light]="isDarkMode()">
        <i class="fa fa-download text-info"></i>
        Export {{ data.messageCount }} {{ data.messageCount === 1 ? 'Message' : 'Messages' }}
      </h5>
    </div>

    <div class="modal-body" [class.bg-dark]="isDarkMode()" [class.text-light]="isDarkMode()">
      <div class="mb-4">
        <p class="mb-0" [class.text-light]="isDarkMode()">
          Export
          <strong>{{ data.messageCount }}</strong>
          {{ data.messageCount === 1 ? 'message' : 'messages' }}
          from
          <strong>{{ data.entityName }}</strong>
          {{ data.isDeadLetter ? '(Dead Letter)' : '' }}
        </p>
      </div>

      <div class="mb-4">
        <label class="form-label fw-semibold">Export Format</label>
        <div class="format-options">
          <div class="form-check">
            <input
              class="form-check-input"
              type="radio"
              id="formatJson"
              name="format"
              value="json"
              [(ngModel)]="exportOptions.format">
            <label class="form-check-label" for="formatJson">
              <i class="fa fa-file-code-o me-2"></i>
              <strong>JSON</strong>
              <span class="text-muted ms-2">- Structured data format, suitable for re-import</span>
            </label>
          </div>
          <div class="form-check">
            <input
              class="form-check-input"
              type="radio"
              id="formatCsv"
              name="format"
              value="csv"
              [(ngModel)]="exportOptions.format">
            <label class="form-check-label" for="formatCsv">
              <i class="fa fa-file-excel-o me-2"></i>
              <strong>CSV</strong>
              <span class="text-muted ms-2">- Tabular format, suitable for Excel/spreadsheets</span>
            </label>
          </div>
          <div class="form-check">
            <input
              class="form-check-input"
              type="radio"
              id="formatXlsx"
              name="format"
              value="xlsx"
              [(ngModel)]="exportOptions.format">
            <label class="form-check-label" for="formatXlsx">
              <i class="fa fa-file-excel-o me-2"></i>
              <strong>Excel (XLSX)</strong>
              <span class="text-muted ms-2">- Native Excel format with formatted headers and multi-sheet support</span>
            </label>
          </div>
        </div>
      </div>

      <div class="mb-3">
        <label class="form-label fw-semibold">Export Options</label>

        <div class="form-check mb-2">
          <input
            class="form-check-input"
            type="checkbox"
            id="includeAppProps"
            [(ngModel)]="exportOptions.includeApplicationProperties">
          <label class="form-check-label" for="includeAppProps">
            Include application properties
          </label>
          <div class="form-text">
            Include custom application properties in the export
          </div>
        </div>

        @if (exportOptions.format === 'json') {
          <div class="form-check">
            <input
              class="form-check-input"
              type="checkbox"
              id="prettyPrint"
              [(ngModel)]="exportOptions.prettyPrint">
            <label class="form-check-label" for="prettyPrint">
              Pretty-print JSON
            </label>
            <div class="form-text">
              Format JSON with indentation for better readability
            </div>
          </div>
        }
      </div>

      <div class="alert alert-info mb-0" role="alert">
        <i class="fa fa-info-circle me-2"></i>
        <strong>Note:</strong> The file will be downloaded to your browser's default download location.
      </div>
    </div>

    <div class="modal-footer" [class.bg-dark]="isDarkMode()">
      <button class="btn btn-secondary" mat-dialog-close>
        Cancel
      </button>
      <button
        class="btn btn-info"
        [mat-dialog-close]="exportOptions">
        <i class="fa fa-download me-2"></i>
        Export
      </button>
    </div>
  `,
  styles: [`
    .modal-header {
      border-bottom: 1px solid var(--bs-border-color);
      padding: 16px 24px;
    }

    .modal-title {
      margin: 0;
      font-size: 18px;
      font-weight: 500;
      color: var(--bs-body-color);

      i {
        font-size: 20px;
      }
    }

    .modal-body {
      padding: 24px;
      min-width: 500px;

      p {
        color: var(--bs-secondary-color);
      }
    }

    .modal-footer {
      border-top: 1px solid var(--bs-border-color);
      padding: 16px 24px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .format-options {
      .form-check {
        padding: 12px;
        border-radius: 6px;
        border: 1px solid var(--bs-border-color);
        margin-bottom: 12px;
        transition: all 0.2s;

        &:hover {
          background-color: var(--bs-light);
          border-color: var(--bs-info);
        }

        &:has(input:checked) {
          background-color: var(--bs-info-bg-subtle);
          border-color: var(--bs-info);
        }
      }

      .form-check-label {
        cursor: pointer;
        margin-left: 4px;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
      }
    }

    .alert {
      border-radius: 6px;
    }

    .form-text {
      margin-top: 4px;
      margin-left: 24px;
      font-size: 0.875rem;
    }
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

  isDarkMode(): boolean {
    if (typeof document === 'undefined') return false;
    const bsTheme = document.documentElement.getAttribute('data-bs-theme');
    const hasThemeDark = document.body.classList.contains('theme-dark');
    return bsTheme === 'dark' || hasThemeDark;
  }
}
