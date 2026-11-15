import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { diffLines, Change } from 'diff';
import { MessageInfo } from '../../core/models';
import { connectionContext } from '../entities/connection-context';
import { EnvironmentLineComponent } from '../../shared/environment-line.component';

export interface MessageDiffDialogData {
  left: MessageInfo;
  right: MessageInfo;
  entityName: string;
}

/** One line of a body side: its mark ("-", "+" or a space), its text, and what a screen reader hears after it. */
export interface DiffLine {
  mark: string;
  text: string;
  say: string;
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
  imports: [EnvironmentLineComponent, CommonModule, MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon fontIcon="compare" aria-hidden="true"></mat-icon>
      <span>Compare Messages: {{ data.entityName }}</span>
    </h2>

    <mat-dialog-content class="content">
      <app-environment-line [mark]="context().mark"><b>{{ data.entityName }}</b> on {{ context().where }}</app-environment-line>
      <div class="message-labels">
        <span class="label left">Left: #{{ data.left.sequenceNumber }}</span>
        <span class="label right">Right: #{{ data.right.sequenceNumber }}</span>
      </div>

      <nav class="sections" aria-label="What to compare">
        <button mat-button type="button" class="section-tab" [class.current]="activeTab === 0" [attr.aria-current]="activeTab === 0 ? 'true' : null" (click)="activeTab = 0">Body</button>
        <button mat-button type="button" class="section-tab" [class.current]="activeTab === 1" [attr.aria-current]="activeTab === 1 ? 'true' : null" (click)="activeTab = 1">Properties</button>
        <button mat-button type="button" class="section-tab" [class.current]="activeTab === 2" [attr.aria-current]="activeTab === 2 ? 'true' : null" (click)="activeTab = 2">App Properties</button>
      </nav>

      @if (activeTab === 0) {
        <div class="diff-body-container">
          @if (bodyDiffs.length === 0) {
            <p class="empty">
              <mat-icon fontIcon="check_circle" aria-hidden="true"></mat-icon>
              <span>Bodies are identical</span>
            </p>
          } @else {
            <div class="diff-panels">
              <div class="diff-panel">
                <div class="diff-panel-header left">Left (#{{ data.left.sequenceNumber }})</div>
                <div class="diff-content">
                  @for (line of leftLines; track $index) {
                    <div class="diff-line" [class.diff-removed]="line.mark === '-'"><span class="mark">{{ line.mark }}</span><span class="line-text">{{ line.text }}</span>@if (line.say) {<span class="visually-hidden">{{ line.say }}</span>}</div>
                  }
                </div>
              </div>
              <div class="diff-panel">
                <div class="diff-panel-header right">Right (#{{ data.right.sequenceNumber }})</div>
                <div class="diff-content">
                  @for (line of rightLines; track $index) {
                    <div class="diff-line" [class.diff-added]="line.mark === '+'"><span class="mark">{{ line.mark }}</span><span class="line-text">{{ line.text }}</span>@if (line.say) {<span class="visually-hidden">{{ line.say }}</span>}</div>
                  }
                </div>
              </div>
            </div>
          }
        </div>
      }

      @if (activeTab === 1) {
        <div class="comparison-table-container">
          <table class="comparison-table">
            <thead>
              <tr>
                <th scope="col">Property</th>
                <th scope="col">Left Value</th>
                <th scope="col">Right Value</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (prop of propertyComparisons; track prop.name) {
                <tr [class]="getRowClass(prop.status)">
                  <td class="prop-name">{{ prop.name }}</td>
                  <td class="prop-value" [class.empty-value]="prop.leftValue === ''">{{ prop.leftValue === '' ? 'Empty' : prop.leftValue }}</td>
                  <td class="prop-value" [class.empty-value]="prop.rightValue === ''">{{ prop.rightValue === '' ? 'Empty' : prop.rightValue }}</td>
                  <td>
                    <span class="status" [class]="getStatusBadgeClass(prop.status)">
                      {{ getStatusLabel(prop.status) }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (activeTab === 2) {
        <div class="comparison-table-container">
          @if (appPropertyComparisons.length === 0) {
            <p class="empty">
              <mat-icon fontIcon="sell" aria-hidden="true"></mat-icon>
              <span>No application properties on either message</span>
            </p>
          } @else {
            <table class="comparison-table">
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Left Value</th>
                  <th scope="col">Right Value</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                @for (prop of appPropertyComparisons; track prop.name) {
                  <tr [class]="getRowClass(prop.status)">
                    <td class="prop-name">{{ prop.name }}</td>
                    <td class="prop-value" [class.empty-value]="prop.leftValue === ''">{{ prop.leftValue === '' ? 'Empty' : prop.leftValue }}</td>
                    <td class="prop-value" [class.empty-value]="prop.rightValue === ''">{{ prop.rightValue === '' ? 'Empty' : prop.rightValue }}</td>
                    <td>
                      <span class="status" [class]="getStatusBadgeClass(prop.status)">
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
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" (click)="dialogRef.close()">Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .title { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
    .title mat-icon { flex: none; color: var(--mat-sys-primary); }
    .content { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .message-labels { display: flex; flex-wrap: wrap; gap: 12px; }
    .label { padding: 2px 10px; border-radius: 999px; font: var(--mat-sys-label-large); font-variant-numeric: tabular-nums; }
    .left { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .right { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    .sections { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .section-tab {
      --mat-button-text-container-shape: 0;
      --mat-button-text-container-height: 44px;
      --mat-button-text-label-text-color: var(--mat-sys-on-surface-variant);
      margin-bottom: -1px;
      border-bottom: 3px solid transparent;
    }
    .section-tab.current { --mat-button-text-label-text-color: var(--mat-sys-primary); border-bottom-color: var(--mat-sys-primary); }
    .empty { display: flex; align-items: center; gap: 8px; margin: 0; padding: 24px 0; color: var(--mat-sys-on-surface-variant); }
    .diff-panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .diff-panel { min-width: 0; border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; overflow: hidden; }
    .diff-panel-header { padding: 8px 12px; font: var(--mat-sys-label-large); }
    .diff-content {
      margin: 0;
      max-height: 400px;
      padding: 12px;
      overflow: auto;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);
      font-family: ui-monospace, monospace;
      font-size: var(--mat-sys-body-small-size);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .diff-line { display: flex; gap: 8px; min-height: 20px; padding: 0 4px; }
    .mark { flex: 0 0 12px; font-weight: 700; white-space: pre; }
    .line-text { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .diff-added { background: var(--app-success-container); color: var(--app-on-success-container); }
    .diff-removed { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .empty-value { color: var(--mat-sys-on-surface-variant); }
    .comparison-table-container { max-height: 400px; overflow: auto; }
    .comparison-table { width: 100%; border-collapse: collapse; font: var(--mat-sys-body-small); }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 8px;
      border-bottom: 1px solid var(--mat-sys-outline);
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
      text-align: start;
    }
    td { padding: 8px; border-bottom: 1px solid var(--mat-sys-outline-variant); vertical-align: middle; }
    .prop-name { font-weight: 500; white-space: nowrap; }
    .prop-value { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, monospace; }
    .row-changed { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
    .row-only-left { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .row-only-right { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    .status { padding: 2px 8px; border-radius: 999px; font: var(--mat-sys-label-small); }
    .status-same { background: var(--mat-sys-surface-container-highest); color: var(--mat-sys-on-surface-variant); }
    .status-changed { background: var(--mat-sys-tertiary); color: var(--mat-sys-on-tertiary); }
    .status-only-left { background: var(--mat-sys-error); color: var(--mat-sys-on-error); }
    .status-only-right { background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); }
  `]
})
export class MessageDiffDialogComponent implements OnInit {
  /** The active connection and its environment, for the line under the title. */
  readonly context = connectionContext();
  data = inject<MessageDiffDialogData>(MAT_DIALOG_DATA);
  dialogRef = inject(MatDialogRef<MessageDiffDialogComponent>);

  activeTab = 0;

  bodyDiffs: Change[] = [];
  /** The left body line by line: a removed line marked "-" and said ", removed" to a screen reader. */
  leftLines: DiffLine[] = [];
  /** The right body line by line: an added line marked "+" and said ", added" to a screen reader. */
  rightLines: DiffLine[] = [];
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
    const lines = (change: Change, mark: string, say: string) =>
      change.value.replace(/\n$/, '').split('\n').map(text => ({ mark, text, say }));
    this.leftLines = this.bodyDiffs.filter(c => !c.added).flatMap(c => c.removed ? lines(c, '-', ', removed') : lines(c, ' ', ''));
    this.rightLines = this.bodyDiffs.filter(c => !c.removed).flatMap(c => c.added ? lines(c, '+', ', added') : lines(c, ' ', ''));
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
      case 'same': return 'status status-same';
      case 'changed': return 'status status-changed';
      case 'only-left': return 'status status-only-left';
      case 'only-right': return 'status status-only-right';
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
