import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { diffLines, Change } from 'diff';
import { MessageInfo } from '../../core/models';

export interface MessageDiffDialogData {
  left: MessageInfo;
  right: MessageInfo;
  entityName: string;
}

export type PropertyStatus = 'same' | 'changed' | 'only-left' | 'only-right';

export interface PropertyComparison {
  name: string;
  leftValue: string;
  rightValue: string;
  status: PropertyStatus;
}

@Component({
  selector: 'app-message-diff-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule],
  template: `
    <div class="modal-header">
      <h5 class="modal-title d-flex align-items-center gap-2">
        <i class="fa fa-code-compare text-primary"></i>
        Compare Messages: {{ data.entityName }}
      </h5>
    </div>

    <div class="modal-body">
      <div class="message-labels">
        <span class="badge bg-danger-subtle text-danger-emphasis">
          Left: #{{ data.left.sequenceNumber }}
        </span>
        <span class="badge bg-success-subtle text-success-emphasis">
          Right: #{{ data.right.sequenceNumber }}
        </span>
      </div>

      <ul class="nav nav-tabs mb-3" role="tablist">
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="activeTab === 0" (click)="activeTab = 0" type="button">
            <i class="fa fa-file-lines me-2"></i>Body
          </button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="activeTab === 1" (click)="activeTab = 1" type="button">
            <i class="fa fa-list me-2"></i>Properties
          </button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="activeTab === 2" (click)="activeTab = 2" type="button">
            <i class="fa fa-tags me-2"></i>App Properties
          </button>
        </li>
      </ul>

      <!-- Body Tab -->
      @if (activeTab === 0) {
        <div class="diff-body-container">
          @if (bodyDiffs.length === 0) {
            <div class="text-center py-4 text-muted">
              <i class="fa fa-check-circle fa-2x mb-2"></i>
              <p>Bodies are identical</p>
            </div>
          } @else {
            <div class="diff-panels">
              <div class="diff-panel">
                <div class="diff-panel-header text-danger-emphasis">Left (#{{ data.left.sequenceNumber }})</div>
                <pre class="diff-content">@for (change of bodyDiffs; track $index) {<span
                  class="diff-line"
                  [class.diff-removed]="change.removed"
                  [class.diff-context]="!change.added && !change.removed"
                  [class.diff-hidden]="change.added"
                  >{{ change.value }}</span>}
                </pre>
              </div>
              <div class="diff-panel">
                <div class="diff-panel-header text-success-emphasis">Right (#{{ data.right.sequenceNumber }})</div>
                <pre class="diff-content">@for (change of bodyDiffs; track $index) {<span
                  class="diff-line"
                  [class.diff-added]="change.added"
                  [class.diff-context]="!change.added && !change.removed"
                  [class.diff-hidden]="change.removed"
                  >{{ change.value }}</span>}
                </pre>
              </div>
            </div>
          }
        </div>
      }

      <!-- Properties Tab -->
      @if (activeTab === 1) {
        <div class="comparison-table-container">
          <table class="table table-sm comparison-table">
            <thead>
              <tr>
                <th>Property</th>
                <th>Left Value</th>
                <th>Right Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (prop of propertyComparisons; track prop.name) {
                <tr [class]="getRowClass(prop.status)">
                  <td class="prop-name">{{ prop.name }}</td>
                  <td class="prop-value">{{ prop.leftValue }}</td>
                  <td class="prop-value">{{ prop.rightValue }}</td>
                  <td>
                    <span class="badge" [class]="getStatusBadgeClass(prop.status)">
                      {{ getStatusLabel(prop.status) }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <!-- App Properties Tab -->
      @if (activeTab === 2) {
        <div class="comparison-table-container">
          @if (appPropertyComparisons.length === 0) {
            <div class="text-center py-4 text-muted">
              <i class="fa fa-tags fa-2x mb-2"></i>
              <p>No application properties on either message</p>
            </div>
          } @else {
            <table class="table table-sm comparison-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Left Value</th>
                  <th>Right Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                @for (prop of appPropertyComparisons; track prop.name) {
                  <tr [class]="getRowClass(prop.status)">
                    <td class="prop-name">{{ prop.name }}</td>
                    <td class="prop-value">{{ prop.leftValue }}</td>
                    <td class="prop-value">{{ prop.rightValue }}</td>
                    <td>
                      <span class="badge" [class]="getStatusBadgeClass(prop.status)">
                        {{ getStatusLabel(prop.status) }}
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      }
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" (click)="dialogRef.close()">Close</button>
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

      i { font-size: 20px; }
    }

    .modal-body {
      padding: 24px;
      min-width: 900px;
      max-height: 70vh;
      overflow-y: auto;
    }

    .modal-footer {
      border-top: 1px solid var(--bs-border-color);
      padding: 12px 24px;
      display: flex;
      justify-content: flex-end;
    }

    .message-labels {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
    }

    /* ---- Body diff ---- */
    .diff-panels {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .diff-panel {
      border: 1px solid var(--bs-border-color);
      border-radius: 4px;
      overflow: hidden;
    }

    .diff-panel-header {
      padding: 8px 12px;
      font-size: 13px;
      font-weight: 600;
      background: var(--bs-secondary-bg);
      border-bottom: 1px solid var(--bs-border-color);
    }

    .diff-content {
      margin: 0;
      padding: 12px;
      font-size: 13px;
      background: var(--bs-body-bg);
      overflow-x: auto;
      max-height: 400px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .diff-line {
      display: inline;
    }

    .diff-added {
      background: var(--bs-success-bg-subtle);
    }

    .diff-removed {
      background: var(--bs-danger-bg-subtle);
    }

    .diff-context {
      background: transparent;
    }

    .diff-hidden {
      display: none;
    }

    /* ---- Properties table ---- */
    .comparison-table-container {
      max-height: 400px;
      overflow-y: auto;
    }

    .comparison-table {
      margin: 0;

      th {
        font-size: 12px;
        text-transform: uppercase;
        color: var(--bs-secondary-color);
        border-bottom-width: 2px;
        position: sticky;
        top: 0;
        background: var(--bs-body-bg);
        z-index: 1;
      }

      td {
        font-size: 13px;
        vertical-align: middle;
      }
    }

    .prop-name {
      font-weight: 500;
      white-space: nowrap;
    }

    .prop-value {
      font-family: monospace;
      font-size: 12px;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row-changed {
      background: var(--bs-warning-bg-subtle);
    }

    .row-only-left {
      background: var(--bs-danger-bg-subtle);
    }

    .row-only-right {
      background: var(--bs-success-bg-subtle);
    }
  `]
})
export class MessageDiffDialogComponent implements OnInit {
  data = inject<MessageDiffDialogData>(MAT_DIALOG_DATA);
  dialogRef = inject(MatDialogRef<MessageDiffDialogComponent>);

  activeTab = 0;

  bodyDiffs: Change[] = [];
  propertyComparisons: PropertyComparison[] = [];
  appPropertyComparisons: PropertyComparison[] = [];

  ngOnInit(): void {
    this.computeBodyDiff();
    this.computePropertyComparisons();
    this.computeAppPropertyComparisons();
  }

  // --- Body diff ---

  computeBodyDiff(): void {
    const leftBody = this.formatBody(this.data.left.body);
    const rightBody = this.formatBody(this.data.right.body);
    this.bodyDiffs = diffLines(leftBody, rightBody);
  }

  // --- Properties comparison ---

  computePropertyComparisons(): void {
    const fields: { label: string; key: keyof MessageInfo }[] = [
      { label: 'Message ID', key: 'messageId' },
      { label: 'Correlation ID', key: 'correlationId' },
      { label: 'Session ID', key: 'sessionId' },
      { label: 'Subject', key: 'subject' },
      { label: 'Content Type', key: 'contentType' },
      { label: 'Partition Key', key: 'partitionKey' },
      { label: 'Delivery Count', key: 'deliveryCount' },
      { label: 'Enqueued Time', key: 'enqueuedTime' },
      { label: 'Time To Live', key: 'timeToLive' },
    ];

    this.propertyComparisons = fields.map(f => {
      const left = this.stringify(this.data.left[f.key]);
      const right = this.stringify(this.data.right[f.key]);
      return {
        name: f.label,
        leftValue: left,
        rightValue: right,
        status: this.resolveStatus(left, right),
      };
    });
  }

  // --- App properties comparison ---

  computeAppPropertyComparisons(): void {
    const leftProps = this.data.left.applicationProperties ?? {};
    const rightProps = this.data.right.applicationProperties ?? {};
    const allKeys = new Set([...Object.keys(leftProps), ...Object.keys(rightProps)]);

    this.appPropertyComparisons = Array.from(allKeys)
      .sort()
      .map(key => {
        const hasLeft = key in leftProps;
        const hasRight = key in rightProps;
        const left = hasLeft ? this.stringify(leftProps[key]) : '';
        const right = hasRight ? this.stringify(rightProps[key]) : '';

        let status: PropertyStatus;
        if (hasLeft && hasRight) {
          status = left === right ? 'same' : 'changed';
        } else if (hasLeft) {
          status = 'only-left';
        } else {
          status = 'only-right';
        }

        return { name: key, leftValue: left, rightValue: right, status };
      });
  }

  // --- Helpers ---

  getRowClass(status: PropertyStatus): string {
    switch (status) {
      case 'changed': return 'row-changed';
      case 'only-left': return 'row-only-left';
      case 'only-right': return 'row-only-right';
      default: return '';
    }
  }

  getStatusBadgeClass(status: PropertyStatus): string {
    switch (status) {
      case 'same': return 'bg-secondary-subtle text-secondary-emphasis';
      case 'changed': return 'bg-warning-subtle text-warning-emphasis';
      case 'only-left': return 'bg-danger-subtle text-danger-emphasis';
      case 'only-right': return 'bg-success-subtle text-success-emphasis';
    }
  }

  getStatusLabel(status: PropertyStatus): string {
    switch (status) {
      case 'same': return 'Same';
      case 'changed': return 'Changed';
      case 'only-left': return 'Only Left';
      case 'only-right': return 'Only Right';
    }
  }

  private formatBody(body: string): string {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body ?? '';
    }
  }

  private stringify(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  private resolveStatus(left: string, right: string): PropertyStatus {
    const hasLeft = left !== '';
    const hasRight = right !== '';
    if (hasLeft && hasRight) return left === right ? 'same' : 'changed';
    if (hasLeft) return 'only-left';
    if (hasRight) return 'only-right';
    return 'same'; // both empty
  }
}
