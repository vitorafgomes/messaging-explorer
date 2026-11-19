import { Component, computed, inject, signal, OnDestroy } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { isDuplicateRefusal, NEW_MESSAGE_ID_OPTION } from '../../core/services/bulk-operations.service';
import { Subscription, firstValueFrom } from 'rxjs';
import {
  LeftBehind,
  MatchCount,
  MessageExportService,
  QueueService,
  ResubmitRun,
  ResubmitRunFilter,
  ResubmitRunService,
  ResubmitRunTarget,
  TopicService,
  formatDuration,
  isPossibleDuplicate
} from '../../core/services';
import { ProviderService } from '../../core/services/provider.service';
import { BatchOperationResult } from '../../core/models';
import { connectionContext } from '../entities/connection-context';
import { EnvironmentLineComponent } from '../../shared/environment-line.component';
import { messageCallFailure } from './message-call-failure';
import type { ViewMessagesDialogData } from './view-messages-dialog.component';

export interface ContinuousResubmitDialogData {
  entityType: 'queue' | 'subscription';
  entityName: string;
  topicName?: string;
  deadLetterMessageCount?: number;
  /** Whether the queue, or the topic of the subscription, detects duplicates; absent when the opener does not know. */
  targetDetectsDuplicates?: boolean;
}

export interface ContinuousResubmitResult {
  totalProcessed: number;
  totalSuccess: number;
  totalFailure: number;
  stopped: boolean;
  completed: boolean;
}

type DialogState = 'config' | 'running' | 'finished';

/** The sentence every state of the dialog shows. */
export const AT_LEAST_ONCE = 'This operation is at-least-once: a message sent but not removed from the dead-letter queue may be delivered twice.';

const SHOWN_LEFT_BEHIND = 100;

/** The value of the Other option of the reason select. */
const OTHER_REASON = 'other';

/** "2", "2 and 3", "1, 2 and 3". */
function listed(numbers: number[]): string {
  return numbers.length < 2 ? numbers.join('') : `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}

/** One CSV cell: quoted, quotes doubled, and a leading =, +, - or @ kept from running as a formula. */
function csvCell(value: string | number): string {
  const text = String(value);
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
}

interface LeftRow extends LeftBehind {
  duplicate: boolean;
}

/**
 * Auto resubmit of a dead-letter queue. Where the API reads the dead-letter queue from a position,
 * the dialog configures, shows and reports a run kept by ResubmitRunService, which goes on when the
 * dialog closes; otherwise it runs the head-of-queue loop that stops on the first failure.
 */
@Component({
  selector: 'app-continuous-resubmit-dialog',
  standalone: true,
  imports: [EnvironmentLineComponent, 
    DatePipe, DecimalPipe, FormsModule, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatProgressBarModule, MatProgressSpinnerModule, MatRadioModule, MatTableModule, MatCheckboxModule
  ],
  template: `
    <h2 mat-dialog-title class="title">
      @if (run(); as run) {
        {{ run.isActive() ? 'Resubmit running' : 'Resubmit finished' }}
      } @else if (positional) {
        Auto resubmit dead-letter
      } @else {
        <mat-icon class="title-icon" aria-hidden="true">refresh</mat-icon>Auto Resubmit Dead Letters
      }
    </h2>

    <mat-dialog-content class="content">
      <app-environment-line class="target" [mark]="context().mark">
        <b>{{ data.entityName }}</b>
        @if (data.topicName) { in topic {{ data.topicName }}, on {{ context().where }} } @else { on {{ context().where }} }
      </app-environment-line>
      <p class="note" role="note">
        <mat-icon aria-hidden="true">info</mat-icon>
        <span>{{ atLeastOnce }}</span>
      </p>
      @if (data.topicName) {
        <p class="topic-resubmit-note" role="note">
          <mat-icon fontIcon="warning" aria-hidden="true" />
          <span><strong>Resubmit publishes to the topic {{ data.topicName }}.</strong> Every subscription of {{ data.topicName }} receives these messages again, not only {{ data.entityName }}, and a filter on {{ data.entityName }} may keep them from coming back to it.</span>
        </p>
      }

      @if (run(); as run) {
        @let p = run.progress();
        <p class="hint">Run on {{ run.connection ?? 'an unnamed connection' }}, started {{ run.startedAt | date: 'medium' }}.</p>
        @if (!run.isActive() && p.failed > 0 && !canRetry(run)) {
          <p class="hint">The connection changed since this run, so its failed messages cannot be retried from here.</p>
        }
        <div class="stats">
          <div class="stat"><span class="label">Read</span><span class="value">{{ p.read | number }}</span></div>
          @if (hasFilter(run.options)) {
            <div class="stat"><span class="label">Matched so far</span><span class="value">{{ p.matched | number }}</span></div>
            <div class="stat"><span class="label">Left by the filter</span><span class="value">{{ p.leftByFilter | number }}</span></div>
          }
          <div class="stat"><span class="label">Resubmitted</span><span class="value success">{{ p.resubmitted | number }}</span></div>
          <div class="stat"><span class="label">Failed, not sent</span><span class="value error">{{ p.failed | number }}</span></div>
          <div class="stat"><span class="label">Possible duplicate</span><span class="value error">{{ p.possibleDuplicates | number }}</span></div>
        </div>
        <div class="read-of">
          <span><strong>{{ p.read | number }}</strong> of {{ p.total | number }} read</span>
          @if (p.total > 0) { <span>{{ percent(p.read, p.total) }}%</span> }
        </div>
        <mat-progress-bar
          [mode]="p.total > 0 ? 'determinate' : 'indeterminate'"
          [value]="p.total > 0 ? (p.read * 100) / p.total : 0"
          [attr.aria-label]="'Read ' + p.read + ' of ' + p.total" />
        <p class="timing">
          <span>Elapsed <strong>{{ duration(p.elapsedMs) }}</strong></span>
          @if (p.ratePerSecond !== null) {
            <span>Rate <strong>{{ p.ratePerSecond | number: '1.0-1' }} messages per second</strong>, {{ p.elapsedMs >= rateWindowMs ? 'last 5 minutes' : 'since the start' }}</span>
          }
          @if (p.remainingMs !== null) {
            <span>About <strong>{{ duration(p.remainingMs) }}</strong> left</span>
          }
        </p>
        <p class="status" [class]="'tone-' + tone[p.status]" aria-live="polite">
          @if (p.status === 'running') {
            <mat-progress-spinner mode="indeterminate" diameter="18" aria-hidden="true"></mat-progress-spinner>
          } @else {
            <mat-icon aria-hidden="true">{{ statusIcon[p.status] }}</mat-icon>
          }
          <span>{{ statusLabel[p.status] }}. {{ p.message }}</span>
        </p>
        @if (run.isActive()) {
          <p class="hint">Pause starts nothing new once the request in flight has answered. Stop cancels the request in flight; its messages are then reported as possible duplicates.</p>
        } @else {
          <p class="report-line">{{ p.batch | number }} {{ p.batch === 1 ? 'cycle' : 'cycles' }} in {{ duration(p.elapsedMs, true) }}@if (p.elapsedMs > 0) {, {{ (p.read * 1000) / p.elapsedMs | number: '1.0-1' }} messages per second on average}. Started {{ run.startedAt | date: 'medium' }}, finished {{ run.startedAt + p.elapsedMs | date: finishFormat(run.startedAt, p.elapsedMs) }}.</p>
        }
        @if (!run.isActive() && byReason().length > 0) {
          <table mat-table [dataSource]="byReason()" class="results reasons">
            <caption>By dead-letter reason</caption>
            <ng-container matColumnDef="reason">
              <th mat-header-cell *matHeaderCellDef>Reason</th>
              <td mat-cell *matCellDef="let row">{{ row.reason }}</td>
            </ng-container>
            <ng-container matColumnDef="read">
              <th mat-header-cell *matHeaderCellDef>Read</th>
              <td mat-cell *matCellDef="let row">{{ row.read | number }}</td>
            </ng-container>
            <ng-container matColumnDef="resubmitted">
              <th mat-header-cell *matHeaderCellDef>Resubmitted</th>
              <td mat-cell *matCellDef="let row">{{ row.resubmitted | number }}</td>
            </ng-container>
            <ng-container matColumnDef="failed">
              <th mat-header-cell *matHeaderCellDef>Failed</th>
              <td mat-cell *matCellDef="let row">{{ row.failed | number }}</td>
            </ng-container>
            <ng-container matColumnDef="possibleDuplicates">
              <th mat-header-cell *matHeaderCellDef>Possible duplicate</th>
              <td mat-cell *matCellDef="let row">{{ row.possibleDuplicates | number }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="reasonColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: reasonColumns" [class.total]="row.total"></tr>
          </table>
        }
        @if (leftBehind().length > 0) {
          <table mat-table [dataSource]="leftBehind()" [trackBy]="trackLeftBehind" class="results left">
            <caption>
              @if (run.isActive()) {
                Left behind so far: {{ p.failed + p.possibleDuplicates | number }}, each by sequence number. Newest first, {{ leftBehind().length }} shown.
              } @else {
                Left in dead-letter: {{ p.failed + p.possibleDuplicates | number }}, by sequence number. {{ leftBehind().length }} shown, all {{ p.failed + p.possibleDuplicates | number }} in the file.
              }
            </caption>
            <ng-container matColumnDef="sequenceNumber">
              <th mat-header-cell *matHeaderCellDef>Sequence Number</th>
              <td mat-cell *matCellDef="let row" class="mono">{{ row.sequenceNumber }}</td>
            </ng-container>
            <ng-container matColumnDef="batch">
              <th mat-header-cell *matHeaderCellDef>Batch</th>
              <td mat-cell *matCellDef="let row">{{ row.batch | number }}</td>
            </ng-container>
            <ng-container matColumnDef="reason">
              <th mat-header-cell *matHeaderCellDef>Reason</th>
              <td mat-cell *matCellDef="let row">{{ row.deadLetterReason }}</td>
            </ng-container>
            <ng-container matColumnDef="result">
              <th mat-header-cell *matHeaderCellDef>Result</th>
              <td mat-cell *matCellDef="let row"><strong [class.error]="row.duplicate">{{ resultOf(row) }}</strong> {{ row.error }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="run.isActive() ? runningColumns : leftColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: run.isActive() ? runningColumns : leftColumns"></tr>
          </table>
        }
      } @else if (state() === 'config') {
        @if (startRefused()) {
          <p class="note warn" role="alert">
            <mat-icon aria-hidden="true">error</mat-icon>
            <span>The connection is changing, so no run was started. Start it again once the connection shows its new state.</span>
          </p>
        }
        @if (!positional) {
          <p class="intro">This will continuously resubmit dead letter messages in batches until the queue is empty or you stop the process.</p>
        }
        @if (positional) {
          <fieldset class="group scope">
            <legend>Which messages</legend>
            <mat-radio-group aria-label="Which messages" name="scope" [(ngModel)]="onlyMatching" (ngModelChange)="filterChanged()" class="radios">
              <mat-radio-button [value]="false">All {{ knownCount() !== null ? (knownCount() | number) + ' ' : '' }}dead-letter messages</mat-radio-button>
              <mat-radio-button [value]="true">Only the messages that match</mat-radio-button>
            </mat-radio-group>
            @if (onlyMatching) {
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>Dead-letter reason</mat-label>
                <select matNativeControl name="reason" [ngModel]="reasonChoice" (ngModelChange)="chooseReason($event)">
                  <option value="">Any reason</option>
                  @for (reason of namedReasons; track reason) {
                    <option [value]="reason">{{ reason }}</option>
                  }
                  <option [value]="other">Other</option>
                </select>
              </mat-form-field>
              @if (otherReason) {
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Other reason</mat-label>
                  <input matInput name="reasonOther" [(ngModel)]="reasonFilter" (ngModelChange)="filterChanged()" autocomplete="off" required>
                  <mat-hint>The whole reason, as the broker wrote it</mat-hint>
                </mat-form-field>
              }
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>Text in the subject or body</mat-label>
                <input matInput name="text" [(ngModel)]="textFilter" (ngModelChange)="filterChanged()" autocomplete="off">
                <mat-hint>Applied to each batch as it is read; the run counts what matched so far</mat-hint>
              </mat-form-field>
              <div class="dates">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Enqueued from</mat-label>
                  <input matInput type="datetime-local" name="enqueuedFrom" [(ngModel)]="enqueuedFrom" (ngModelChange)="filterChanged()">
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Enqueued to</mat-label>
                  <input matInput type="datetime-local" name="enqueuedTo" [(ngModel)]="enqueuedTo" (ngModelChange)="filterChanged()">
                </mat-form-field>
              </div>
              @if (!datesValid()) {
                <p class="dates-invalid" role="alert">Enqueued to is before Enqueued from.</p>
              }
              <div class="match-count" aria-live="polite">
                @if (matchCount(); as count) {
                  @if (count.done) {
                    <span class="counted"><span><strong>{{ count.matched | number }}</strong> of {{ count.capped ? 'the first ' : '' }}{{ count.read | number }} match</span> <span class="hint">{{ countNote(count) }}</span></span>
                  } @else {
                    <span>Counting: {{ count.read | number }} read, {{ count.matched | number }} match so far.</span>
                  }
                } @else if (countError(); as error) {
                  <span class="error" role="alert">{{ error }}</span>
                }
                <button mat-button type="button" (click)="countMatching()" [disabled]="!datesValid() || !reasonGiven()"><mat-icon aria-hidden="true">refresh</mat-icon>{{ matchCount()?.done || countError() ? 'Count again' : 'Count' }}</button>
              </div>
              @if (hasFilter(filter())) {
                <p class="note warn" role="note">
                  <mat-icon aria-hidden="true">warning</mat-icon>
                  <span>A filter leaves the messages it skips at the head of the queue; the server can reach only a few hundred messages past them, so a filtered run may stop early.</span>
                </p>
              }
            }
          </fieldset>
          <fieldset class="group">
            <legend>When a message fails</legend>
            <mat-radio-group aria-label="When a message fails" name="failureMode" [(ngModel)]="stopAtFirstFailure" class="radios">
              <mat-radio-button [value]="false">Skip it, continue, and report it at the end</mat-radio-button>
              <mat-radio-button [value]="true">Stop at the first failure</mat-radio-button>
            </mat-radio-group>
            <p class="hint">Continuing applies to a message the broker refused and to a possible duplicate. A message the server cannot find is tried again once its lock is released, and then stops the run.</p>
          </fieldset>
        }
        @if (data.targetDetectsDuplicates) {
          <mat-checkbox class="new-message-id" [checked]="newMessageId()" (change)="newMessageId.set($event.checked)">{{ newMessageIdOption.label }}</mat-checkbox>
          <p class="hint">{{ newMessageIdOption.hint }}</p>
        }
        <div class="field batch">
        <label for="resubmit-batch-size">Batch Size</label>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <input matInput id="resubmit-batch-size" type="number" name="batchSize" [(ngModel)]="batchSize" min="1" max="500" [attr.aria-invalid]="!batchSizeValid()">
          <mat-hint [class.invalid]="!batchSizeValid()">{{ batchHint() }}</mat-hint>
        </mat-form-field>
        </div>
        @if (!positional) {
          @if (knownCount(); as count) {
            <p class="note count" role="note">
              <mat-icon aria-hidden="true">info</mat-icon>
              <span>Approximately <strong>{{ count | number }}</strong> dead letter messages in queue.</span>
            </p>
          }
          <div class="cost">
            <strong>What this run costs as the app is today</strong>
            <dl>
              <div>
                <dt>Cycles</dt>
                <dd>
                  @if (cycles(); as cycles) {
                    <strong>{{ cycles | number }}</strong> {{ cycles === 1 ? 'cycle' : 'cycles' }} of {{ batchSize | number }}, for {{ knownCount() | number }} messages
                  } @else {
                    <strong>Not known</strong> until the batch size is a number from 1 to 500
                  }
                </dd>
              </div>
              <div>
                <dt>Requests to the broker</dt>
                <dd><strong>{{ cycles() ? (cycles()! * 2 | number) : 'Not known' }}</strong>: one peek, then one resubmit, per cycle, one after the other</dd>
              </div>
              <div>
                <dt>While it runs</dt>
                <dd>The loop lives in this dialog. It stays open for every cycle and cannot be closed; quitting the app ends the run.</dd>
              </div>
              <div>
                <dt>If one message fails</dt>
                <dd>The run stops at that batch and names the sequence numbers. Read the dead-letter queue again before another run: what that batch did is not known.</dd>
              </div>
            </dl>
            <span class="cost-note" data-testid="loop-guarantee">Each message is sent first and removed from the dead-letter queue only once the broker confirmed it. A batch whose call fails has an unknown outcome, and a message can arrive twice: read the dead-letter queue again before you retry.</span>
          </div>
        }
      } @else {
        <div class="stats">
          <div class="stat"><span class="label">Batch</span><span class="value">{{ currentBatch() | number }}</span></div>
          <div class="stat"><span class="label">Processed</span><span class="value primary">{{ totalProcessed() | number }}</span></div>
          <div class="stat"><span class="label">Success</span><span class="value success">{{ totalSuccess() | number }}</span></div>
          <div class="stat"><span class="label">Failed</span><span class="value" [class.error]="totalFailure() > 0" [class.muted]="totalFailure() === 0">{{ totalFailure() | number }}</span></div>
        </div>
        @if (data.deadLetterMessageCount != null && data.deadLetterMessageCount > 0) {
          <div class="overall"><span>Overall Progress</span><span class="pct">{{ getOverallPercentage() }}%</span></div>
          <mat-progress-bar mode="determinate" [class]="'tone-' + loopTone()" [value]="getOverallPercentage()" [attr.aria-label]="'Overall progress ' + getOverallPercentage() + '%'" />
        }
        @if (batchLog().length > 0) {
          <p class="timing loop-timing">
            <span>Elapsed <strong>{{ duration(loopElapsedMs()) }}</strong></span>
            @if (loopElapsedMs() > 0) {
              <span>Rate <strong>{{ (totalProcessed() * 1000) / loopElapsedMs() | number: '1.0-1' }} messages per second</strong></span>
            }
          </p>
        }
        <p class="status" [class]="'tone-' + loopTone()" aria-live="polite">
          @if (state() === 'running') {
            <mat-progress-spinner mode="indeterminate" diameter="18" aria-hidden="true"></mat-progress-spinner><span>{{ statusMessage() }}</span>
          } @else if (stoppedByUser()) {
            <mat-icon aria-hidden="true">stop_circle</mat-icon><span>Stopped by user</span>
          } @else if (stoppedByError()) {
            <mat-icon aria-hidden="true">error</mat-icon><span>{{ statusMessage() }}</span>
          } @else {
            <mat-icon aria-hidden="true">check_circle</mat-icon><span>Completed - Dead letter queue is empty</span>
          }
        </p>
        @if (batchLog().length > 0) {
          <span class="log-label" id="batch-log-label">Batch Log</span>
          <ul class="log" aria-labelledby="batch-log-label">
            @for (entry of batchLog(); track entry.batch) {
              <li><span class="batch-number">#{{ entry.batch }}</span> <span>{{ entry.peeked | number }} peeked, {{ entry.successCount | number }} ok@if (entry.failureCount > 0) {<span class="error">, {{ entry.failureCount | number }} failed</span>}</span></li>
            }
          </ul>
        }
        @if (state() === 'finished' && (failedNumbers().length > 0 || duplicateNumbers().length > 0)) {
          <div class="next">
            <strong>What you can do next</strong>
            <ul>
              @if (failedNumbers().length > 0) {
                @if (failedNumbers().length === 1) {
                  <li><span class="mono">{{ failedNumbers()[0] }}</span> failed and was not sent. It is still in dead-letter and can be resubmitted from the message list.</li>
                } @else {
                  <li><span class="mono">{{ listed(failedNumbers()) }}</span> failed and were not sent. They are still in dead-letter and can be resubmitted from the message list.</li>
                }
              }
              @if (duplicateNumbers().length > 0) {
                @if (duplicateNumbers().length === 1) {
                  <li><span class="mono">{{ duplicateNumbers()[0] }}</span> was sent to {{ sentTo }} and could not be removed from dead-letter. Do not resubmit it: check that it arrived, then delete it from dead-letter.</li>
                } @else {
                  <li><span class="mono">{{ listed(duplicateNumbers()) }}</span> were sent to {{ sentTo }} and could not be removed from dead-letter. Do not resubmit them: check that they arrived, then delete them from dead-letter.</li>
                }
                <li>Starting again reads from the head of the dead-letter queue, where these {{ failedNumbers().length + duplicateNumbers().length }} still are, and would send <span class="mono">{{ listed(duplicateNumbers()) }}</span> a second time. Deal with the {{ failedNumbers().length + duplicateNumbers().length }} first.</li>
              }
            </ul>
            <button mat-stroked-button type="button" class="view" (click)="viewDeadLetter()"><mat-icon aria-hidden="true">visibility</mat-icon>View dead-letter messages</button>
          </div>
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (run(); as run) {
        @if (run.isActive()) {
          <button mat-button (click)="close()">Close, keep running</button>
          @if (run.progress().status === 'paused') {
            <button mat-button (click)="run.resume()"><mat-icon aria-hidden="true">play_arrow</mat-icon>Resume</button>
          } @else {
            <button mat-button (click)="run.pause()"><mat-icon aria-hidden="true">pause</mat-icon>Pause</button>
          }
          <button matButton="tonal" (click)="run.stop()"><mat-icon aria-hidden="true">stop</mat-icon>Stop</button>
        } @else {
          <button mat-button (click)="saveReport(run)"><mat-icon aria-hidden="true">download</mat-icon>Save report, JSON</button>
          <button mat-button (click)="saveReportCsv(run)"><mat-icon aria-hidden="true">download</mat-icon>Save report, CSV</button>
          <span class="spacer"></span>
          @if (canRetry(run) && refusedAsDuplicate(run)) {
          <mat-checkbox class="new-message-id" [checked]="newMessageId()" (change)="newMessageId.set($event.checked)">{{ newMessageIdOption.label }}</mat-checkbox>
          <p class="hint">{{ newMessageIdOption.hint }}</p>
          }
          @if (canRetry(run)) {
            <button mat-button (click)="retryFailed(run)"><mat-icon aria-hidden="true">replay</mat-icon>Retry the {{ run.progress().failed }} failed</button>
          }
          <button mat-button (click)="newRun()">New run</button>
          <button matButton="tonal" (click)="close()">Close</button>
        }
      } @else if (state() === 'config') {
        <button mat-button mat-dialog-close>Cancel</button>
        <button mat-flat-button (click)="start()" [disabled]="!batchSizeValid() || !datesValid() || !reasonGiven()"><mat-icon aria-hidden="true">play_arrow</mat-icon>{{ startLabel() }}</button>
      } @else if (state() === 'running') {
        <button matButton="tonal" (click)="stop()"><mat-icon aria-hidden="true">stop</mat-icon>Stop</button>
      } @else {
        <button mat-flat-button (click)="close()">Close</button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .title { display: flex; align-items: center; gap: 10px; }
    .title-icon { color: var(--mat-sys-primary); }
    .content { display: flex; flex-direction: column; gap: 12px; min-width: 0; overflow-wrap: anywhere; }
    p { margin: 0; }
    .target { overflow-wrap: anywhere; }
    .intro { color: var(--mat-sys-on-surface-variant); }
    .note { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: 8px; background: var(--mat-sys-surface-container-high); color: var(--mat-sys-on-surface-variant); }
    .note mat-icon { flex: none; }
    .topic-resubmit-note { display: flex; align-items: flex-start; gap: 12px; margin: 0; padding: 12px 16px; border-radius: 8px; background: var(--app-warning-container); color: var(--app-on-warning-container); }
    .topic-resubmit-note mat-icon { flex: none; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field > label { font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    .note.warn { background: var(--app-warning-container); color: var(--app-on-warning-container); }
    .note.count { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
    .stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 8px 12px; border-radius: 8px; background: var(--mat-sys-surface); }
    .label { font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    .value { font: var(--mat-sys-title-medium); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .primary { color: var(--mat-sys-primary); }
    .success { color: var(--app-success); }
    .muted { color: var(--mat-sys-on-surface-variant); }
    .error { color: var(--mat-sys-error); }
    .overall, .read-of { display: flex; justify-content: space-between; gap: 8px; font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); font-variant-numeric: tabular-nums; }
    .pct { color: var(--mat-sys-on-surface); }
    mat-progress-bar.tone-success { --mat-progress-bar-active-indicator-color: var(--app-success); }
    mat-progress-bar.tone-stopped { --mat-progress-bar-active-indicator-color: var(--mat-sys-outline); }
    mat-progress-bar.tone-failed { --mat-progress-bar-active-indicator-color: var(--mat-sys-error); }
    .timing { display: flex; flex-wrap: wrap; gap: 16px; font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); font-variant-numeric: tabular-nums; }
    .status { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: 8px; background: var(--mat-sys-surface); color: var(--mat-sys-on-surface); }
    .status.tone-success { background: var(--app-success-container); color: var(--app-on-success-container); }
    .status.tone-stopped { background: var(--app-warning-container); color: var(--app-on-warning-container); }
    .status.tone-failed { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .hint { font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }
    mat-hint.invalid { color: var(--mat-sys-error); }
    .group { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; border: 0; min-width: 0; }
    legend { padding: 0 0 4px; font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    .radios { display: flex; flex-direction: column; }
    .batch { max-width: 360px; }
    .cost { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; }
    .cost dl { display: flex; flex-direction: column; gap: 6px; margin: 0; }
    .cost dl > div { display: grid; grid-template-columns: minmax(0, 180px) minmax(0, 1fr); gap: 12px; padding-top: 6px; border-top: 1px solid var(--mat-sys-outline-variant); }
    .cost dt { font-weight: 400; color: var(--mat-sys-on-surface-variant); }
    .cost dd { margin: 0; }
    .cost-note { font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }
    .results { width: 100%; }
    tr.total td { font-weight: 700; }
    caption { text-align: start; padding: 0 0 4px; font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    .mono { font-family: ui-monospace, monospace; }
    .log-label { font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    .log { max-height: 200px; overflow-y: auto; margin: 0; padding: 0; list-style: none; border-radius: 8px; background: var(--mat-sys-surface); font: var(--mat-sys-body-small); font-variant-numeric: tabular-nums; }
    .log li { display: flex; gap: 12px; padding: 4px 12px; }
    .log li:nth-child(odd) { background: var(--mat-sys-surface-container-low); }
    .batch-number { min-width: 56px; font-family: ui-monospace, monospace; }
    .next { display: flex; flex-direction: column; gap: 8px; }
    .next ul { margin: 0; padding-left: 20px; }
    .spacer { flex: 1; }
    .dates { display: flex; flex-wrap: wrap; gap: 12px; }
    .dates mat-form-field { flex: 1; min-width: 200px; }
    .dates-invalid { font: var(--mat-sys-body-small); color: var(--mat-sys-error); }
    .match-count { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-radius: 8px; background: var(--mat-sys-surface); }
    .counted { display: flex; flex-direction: column; gap: 2px; }
    .report-line { font: var(--mat-sys-body-medium); color: var(--mat-sys-on-surface-variant); }
    .view { align-self: flex-start; }
  `]
})
export class ContinuousResubmitDialogComponent implements OnDestroy {
  /** The active connection and its environment, for the line under the title. */
  readonly context = connectionContext();
  data = inject<ContinuousResubmitDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<ContinuousResubmitDialogComponent>);
  private queueService = inject(QueueService);
  private topicService = inject(TopicService);
  private runs = inject(ResubmitRunService);
  private exporter = inject(MessageExportService);
  private dialog = inject(MatDialog);

  /** The API's own answer says the dead-letter queue can be read from a sequence number. */
  readonly positional = inject(ProviderService).capabilities()?.supportsPeekFromSequenceNumber === true;
  readonly target: ResubmitRunTarget = {
    entityType: this.data.entityType,
    entityName: this.data.entityName,
    topicName: this.data.topicName,
    subQueue: 'deadletter'
  };
  readonly run = signal<ResubmitRun | undefined>(this.runs.find(this.target));
  readonly atLeastOnce = AT_LEAST_ONCE;
  readonly duration = formatDuration;
  readonly listed = listed;
  /** Where a resubmit sends a message: the queue, or the topic of a subscription. */
  readonly sentTo = this.data.topicName ?? this.data.entityName;
  readonly reasonColumns = ['reason', 'read', 'resubmitted', 'failed', 'possibleDuplicates'];
  readonly leftColumns = ['sequenceNumber', 'reason', 'result'];
  readonly runningColumns = ['sequenceNumber', 'batch', 'result'];
  /** The window the run measures its rate over. */
  readonly rateWindowMs = 300_000;
  readonly trackLeftBehind = (_: number, row: { sequenceNumber: number; duplicate: boolean }) => `${row.duplicate}:${row.sequenceNumber}`;
  readonly statusLabel = { running: 'Running', paused: 'Paused', completed: 'Finished', stopped: 'Stopped', failed: 'Ended on a failure' } as const;
  readonly statusIcon = { running: 'sync', paused: 'pause_circle', completed: 'check_circle', stopped: 'stop_circle', failed: 'error' } as const;
  readonly tone = { running: 'running', paused: 'running', completed: 'success', stopped: 'stopped', failed: 'failed' } as const;

  /** The counts per dead-letter reason, then their total. */
  readonly byReason = computed(() => {
    const run = this.run();
    run?.progress();
    const rows = run ? run.byReason() : [];
    if (rows.length === 0) return [];
    const sum = (key: 'read' | 'resubmitted' | 'failed' | 'possibleDuplicates') => rows.reduce((total, row) => total + row[key], 0);
    return [
      ...rows.map(row => ({ ...row, total: false })),
      { reason: 'Total', read: sum('read'), resubmitted: sum('resubmitted'), failed: sum('failed'), possibleDuplicates: sum('possibleDuplicates'), total: true }
    ];
  });

  /**
   * The left-behind messages by sequence number: newest first while the run goes on, lowest first
   * once it ended; at most 100 on screen, the saved report holds all of them.
   */
  readonly leftBehind = computed<LeftRow[]>(() => {
    const run = this.run();
    run?.progress();
    if (!run) return [];
    const newestFirst = run.isActive();
    const pick = (entries: LeftBehind[]) => newestFirst ? entries.slice(-SHOWN_LEFT_BEHIND) : entries.slice(0, SHOWN_LEFT_BEHIND);
    return [
      ...pick(run.failed).map(entry => ({ ...entry, duplicate: false })),
      ...pick(run.possibleDuplicates).map(entry => ({ ...entry, duplicate: true }))
    ]
      .sort((a, b) => newestFirst ? b.sequenceNumber - a.sequenceNumber : a.sequenceNumber - b.sequenceNumber)
      .slice(0, SHOWN_LEFT_BEHIND);
  });

  /** The server receives 250 messages per scan, so a run asks for as many; the head-of-queue loop keeps 10. */
  batchSize = this.positional ? 250 : 10;
  stopAtFirstFailure = false;
  readonly newMessageIdOption = NEW_MESSAGE_ID_OPTION;
  /** Whether every batch sends each copy with a new message id; off until the user ticks it. */
  readonly newMessageId = signal(false);
  /** False: every dead-letter message; true: only those that match the reason and the text. */
  onlyMatching = false;
  /** The dead-letter reason a message must equal; empty is any reason. */
  reasonFilter = '';
  /** The reasons the select names; "Other" takes any reason the broker wrote. */
  readonly namedReasons = ['MaxDeliveryCountExceeded', 'TTLExpiredException', 'HeaderSizeExceeded'];
  readonly other = OTHER_REASON;
  /** True when the reason is typed in the Other field rather than chosen. */
  otherReason = false;
  textFilter = '';
  /** A datetime-local value, read as local time; empty is no bound. */
  enqueuedFrom = '';
  enqueuedTo = '';
  /** The count of the matching messages, made by peeking when asked; dropped when the filter changes. */
  matchCount = signal<MatchCount | null>(null);
  countError = signal<string | null>(null);
  private counting?: Subscription;
  now = () => Date.now();
  /** How long the head-of-queue loop has run, read after each batch. */
  loopElapsedMs = signal(0);
  private loopStartedAt = 0;

  state = signal<DialogState>('config');
  /** The run was not started because the connection is changing. */
  startRefused = signal(false);
  currentBatch = signal(0);
  totalProcessed = signal(0);
  totalSuccess = signal(0);
  totalFailure = signal(0);
  statusMessage = signal('Starting...');
  stoppedByUser = signal(false);
  stoppedByError = signal(false);
  /** The sequence numbers of the batch that stopped the head-of-queue loop. */
  failedNumbers = signal<number[]>([]);
  duplicateNumbers = signal<number[]>([]);

  batchLog = signal<Array<{
    batch: number;
    peeked: number;
    successCount: number;
    failureCount: number;
  }>>([]);

  private shouldStop = false;

  ngOnDestroy(): void {
    this.shouldStop = true;
    this.counting?.unsubscribe();
  }

  /** What the run will select by: nothing for All, else the reason, the text and the enqueued range. */
  filter(): ResubmitRunFilter {
    if (!this.onlyMatching) return {};
    const time = (value: string) => value ? new Date(value).getTime() : undefined;
    return {
      reason: this.reasonFilter.trim() || undefined,
      text: this.textFilter.trim() || undefined,
      enqueuedFrom: time(this.enqueuedFrom),
      enqueuedTo: time(this.enqueuedTo)
    };
  }

  hasFilter(filter: ResubmitRunFilter): boolean {
    return !!(filter.reason || filter.text || Number.isFinite(filter.enqueuedFrom) || Number.isFinite(filter.enqueuedTo));
  }

  /** What the reason select shows: Other, or the chosen reason, empty for any. */
  get reasonChoice(): string {
    return this.otherReason ? OTHER_REASON : this.reasonFilter;
  }

  /** Sets the reason from the select; Other empties it until a reason is typed. */
  chooseReason(choice: string): void {
    this.otherReason = choice === OTHER_REASON;
    this.reasonFilter = this.otherReason ? '' : choice;
    this.filterChanged();
  }

  /** False while Other is chosen with no reason typed, which would otherwise take every reason. */
  reasonGiven(): boolean {
    return !(this.onlyMatching && this.otherReason && !this.reasonFilter.trim());
  }

  /** False when the enqueued range ends before it starts. */
  datesValid(): boolean {
    const { enqueuedFrom, enqueuedTo } = this.filter();
    return !(Number.isFinite(enqueuedFrom) && Number.isFinite(enqueuedTo) && enqueuedFrom! > enqueuedTo!);
  }

  /** Cancels a count in flight and drops the count, which no longer describes the filter. */
  filterChanged(): void {
    this.counting?.unsubscribe();
    this.matchCount.set(null);
    this.countError.set(null);
  }

  /** Counts the matching messages by peeking the dead-letter queue; nothing is received or changed. */
  countMatching(): void {
    this.filterChanged();
    this.counting = this.runs.countMatching(this.target, this.filter()).subscribe({
      next: count => this.matchCount.set(count),
      error: error => {
        this.matchCount.set(null);
        this.countError.set(`${messageCallFailure(error, 'The count failed')}. Nothing was changed.`);
      }
    });
  }

  countNote(count: MatchCount): string {
    const peeks = `${count.peeks.toLocaleString('en-US')} ${count.peeks === 1 ? 'peek' : 'peeks'} of 500`;
    return count.capped
      ? `Counted in the first ${count.read.toLocaleString('en-US')} messages only: ${peeks}; the rest was not read. Nothing was changed.`
      : `Counted by reading the dead-letter queue once: ${peeks}. Nothing was changed.`;
  }

  /** The finished count of a filter that read the whole queue; a capped or running count is not a number to resubmit. */
  private exactCount(): MatchCount | null {
    const count = this.matchCount();
    return this.onlyMatching && count?.done && !count.capped ? count : null;
  }

  /** The finish time alone on the day the run started, with its date otherwise. */
  finishFormat(startedAt: number, elapsedMs: number): string {
    return new Date(startedAt).toDateString() === new Date(startedAt + elapsedMs).toDateString() ? 'mediumTime' : 'medium';
  }

  /** Opens the messages of this entity on the dead-letter tab, loaded on demand. */
  async viewDeadLetter(): Promise<void> {
    const { ViewMessagesDialogComponent } = await import('./view-messages-dialog.component');
    const data: ViewMessagesDialogData = {
      entityType: this.data.entityType,
      entityName: this.data.entityName,
      topicName: this.data.topicName,
      deadLetterMessageCount: this.data.deadLetterMessageCount,
      initialTab: 1
    };
    this.dialog.open(ViewMessagesDialogComponent, { width: '95vw', maxWidth: '1400px', height: '90vh', data });
  }

  batchSizeValid(): boolean {
    return Number.isInteger(this.batchSize) && this.batchSize >= 1 && this.batchSize <= 500;
  }

  /** The dead-letter count the dialog was opened with, when it is known and above zero. */
  knownCount(): number | null {
    const count = this.data.deadLetterMessageCount;
    return count != null && count > 0 ? count : null;
  }

  /** The cycles a run of every counted message takes at this batch size; null when not known. */
  cycles(): number | null {
    const count = this.knownCount();
    return count !== null && this.batchSizeValid() ? Math.ceil(count / this.batchSize) : null;
  }

  batchHint(): string {
    if (!this.batchSizeValid()) return 'Enter a whole number from 1 to 500. Start stays disabled until then.';
    if (!this.positional) return 'Number of messages to process per cycle (1 to 500). The app starts at 10.';
    const exact = this.exactCount();
    if (exact) {
      const cycles = Math.ceil(exact.read / this.batchSize);
      return `1 to 500 messages per cycle: ${cycles.toLocaleString('en-US')} ${cycles === 1 ? 'cycle' : 'cycles'} for ${exact.read.toLocaleString('en-US')}, ${exact.matched.toLocaleString('en-US')} of them matching.`;
    }
    const cycles = this.cycles();
    return cycles !== null && !this.onlyMatching
      ? `1 to 500 messages per cycle: ${cycles.toLocaleString('en-US')} ${cycles === 1 ? 'cycle' : 'cycles'} for ${this.knownCount()!.toLocaleString('en-US')}.`
      : '1 to 500 messages per cycle.';
  }

  startLabel(): string {
    const count = this.onlyMatching ? this.exactCount()?.matched ?? null : this.knownCount();
    return this.positional && count !== null ? `Start: resubmit ${count.toLocaleString('en-US')}` : 'Start';
  }

  percent(part: number, whole: number): number {
    return whole > 0 ? Math.min(100, Math.round((part * 100) / whole)) : 0;
  }

  resultOf(row: LeftRow): string {
    return row.duplicate ? 'Possible duplicate, do not retry.' : 'Failed, not sent.';
  }

  /** The tone of the head-of-queue loop's status: running, completed, stopped by the user or stopped on a failure. */
  loopTone(): 'running' | 'success' | 'stopped' | 'failed' {
    if (this.state() === 'running') return 'running';
    if (this.stoppedByUser()) return 'stopped';
    return this.stoppedByError() ? 'failed' : 'success';
  }

  getOverallPercentage(): number {
    const total = this.data.deadLetterMessageCount;
    if (!total || total === 0) return 0;
    return Math.min(100, Math.round((this.totalSuccess() / total) * 100));
  }

  async start(): Promise<void> {
    if (this.positional) {
      this.counting?.unsubscribe();
      const run = this.runs.start(this.target, {
        batchSize: this.batchSize,
        stopAtFirstFailure: this.stopAtFirstFailure,
        newMessageIdOnDuplicateDetection: this.newMessageId(),
        reason: undefined,
        text: undefined,
        ...this.filter()
      });
      this.run.set(run);
      this.startRefused.set(!run);
      return;
    }

    this.state.set('running');
    this.dialogRef.disableClose = true;
    this.shouldStop = false;
    this.loopStartedAt = this.now();

    try {
      await this.runLoop();
    } catch (err) {
      console.error('Continuous resubmit error:', err);
      this.statusMessage.set('Unexpected error occurred');
      this.stoppedByError.set(true);
    }

    this.state.set('finished');
    this.dialogRef.disableClose = false;
  }

  stop(): void {
    this.shouldStop = true;
    this.stoppedByUser.set(true);
    this.statusMessage.set('Stopping...');
  }

  canRetry(run: ResubmitRun): boolean {
    return this.runs.canRetry(run);
  }

  /** True when a target that detects duplicates refused messages of the run, so a retry may ask for new ids. */
  refusedAsDuplicate(run: ResubmitRun): boolean {
    return run.failed.some(isDuplicateRefusal);
  }

  retryFailed(run: ResubmitRun): void {
    this.run.set(this.runs.retry(run, run.options.newMessageIdOnDuplicateDetection === true || this.newMessageId()));
  }

  newRun(): void {
    this.runs.clear(this.target);
    this.run.set(undefined);
  }

  saveReport(run: ResubmitRun): void {
    const report = run.report();
    this.exporter.downloadFile(JSON.stringify(report, null, 2), `${this.reportName(report.startedAt)}.json`, 'application/json');
  }

  /** Every message the run left behind, one line each, by sequence number. */
  saveReportCsv(run: ResubmitRun): void {
    const report = run.report();
    const rows: LeftRow[] = [
      ...report.failedMessages.map(entry => ({ ...entry, duplicate: false })),
      ...report.possibleDuplicateMessages.map(entry => ({ ...entry, duplicate: true }))
    ].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const lines = [
      ['Sequence Number', 'Reason', 'Result', 'Detail'],
      ...rows.map(row => [row.sequenceNumber, row.deadLetterReason, this.resultOf(row), row.error])
    ].map(cells => cells.map(csvCell).join(','));
    this.exporter.downloadFile(lines.join('\r\n'), `${this.reportName(report.startedAt)}.csv`, 'text/csv');
  }

  close(): void {
    const run = this.run();
    if (run) {
      const p = run.progress();
      this.dialogRef.close(run.isActive() ? undefined : {
        totalProcessed: p.read,
        totalSuccess: p.resubmitted,
        totalFailure: p.failed + p.possibleDuplicates,
        stopped: p.status === 'stopped',
        completed: p.status === 'completed'
      } satisfies ContinuousResubmitResult);
      return;
    }
    const result: ContinuousResubmitResult = {
      totalProcessed: this.totalProcessed(),
      totalSuccess: this.totalSuccess(),
      totalFailure: this.totalFailure(),
      stopped: this.stoppedByUser(),
      completed: !this.stoppedByUser() && !this.stoppedByError()
    };
    this.dialogRef.close(result);
  }

  private reportName(startedAt: string): string {
    const name = [this.data.topicName, this.data.entityName].filter(Boolean).join('-').replace(/[^A-Za-z0-9._-]+/g, '_');
    return `resubmit-report-${name}-${startedAt.replace(/[:.]/g, '-')}`;
  }

  private async runLoop(): Promise<void> {
    let batchNum = 0;

    while (!this.shouldStop) {
      batchNum++;
      this.currentBatch.set(batchNum);
      this.statusMessage.set(`Batch #${batchNum}: Peeking messages...`);

      // 1. Peek dead letter messages
      let messages;
      try {
        messages = await this.peekDeadLetterMessages(this.batchSize);
      } catch (err) {
        console.error('Failed to peek dead letter messages:', err);
        this.statusMessage.set('Failed to peek messages');
        this.stoppedByError.set(true);
        break;
      }

      if (messages.length === 0) {
        this.statusMessage.set('Dead letter queue is empty');
        break;
      }

      if (this.shouldStop) break;

      // 2. Resubmit batch
      this.statusMessage.set(`Batch #${batchNum}: Resubmitting ${messages.length} messages...`);
      const sequenceNumbers = messages.map(m => m.sequenceNumber);

      let result: BatchOperationResult;
      try {
        result = await this.resubmitBatch(sequenceNumbers);
      } catch (err) {
        console.error('Failed to resubmit batch:', err);
        this.statusMessage.set('Failed to resubmit batch');
        this.stoppedByError.set(true);
        break;
      }

      // 3. Update counters
      this.totalProcessed.update(v => v + messages.length);
      this.totalSuccess.update(v => v + result.successCount);
      this.totalFailure.update(v => v + result.failureCount);

      // 4. Log batch
      this.batchLog.update(log => [...log, {
        batch: batchNum,
        peeked: messages.length,
        successCount: result.successCount,
        failureCount: result.failureCount
      }]);
      this.loopElapsedMs.set(this.now() - this.loopStartedAt);

      // 5. Stop on the first failure or possible duplicate
      if (result.failureCount > 0) {
        this.statusMessage.set(this.stopReason(batchNum, result));
        this.stoppedByError.set(true);
        break;
      }

      // 6. If we got fewer messages than batch size, queue might be empty
      if (messages.length < this.batchSize) {
        this.statusMessage.set('Dead letter queue is empty');
        break;
      }
    }
  }

  private stopReason(batchNum: number, result: BatchOperationResult): string {
    const duplicates = result.failures.filter(f => isPossibleDuplicate(f)).map(f => f.sequenceNumber);
    const failed = result.failures.filter(f => !isPossibleDuplicate(f)).map(f => f.sequenceNumber);
    this.failedNumbers.set(failed);
    this.duplicateNumbers.set(duplicates);
    const named = [
      failed.length > 0 ? `failed: ${failed.join(', ')}` : '',
      duplicates.length > 0 ? `possible duplicate - do not retry: ${duplicates.join(', ')}` : ''
    ].filter(part => part !== '').join('; ');
    return `Stopped: batch #${batchNum} reported ${result.failureCount} failure(s); they are not resubmitted again`
      + (named ? ` (${named})` : '');
  }

  private peekDeadLetterMessages(count: number): Promise<any[]> {
    const obs = this.data.entityType === 'queue'
      ? this.queueService.peekDeadLetterMessages(this.data.entityName, count)
      : this.topicService.peekDeadLetterMessages(this.data.topicName!, this.data.entityName, count);
    return firstValueFrom(obs);
  }

  private resubmitBatch(sequenceNumbers: number[]): Promise<BatchOperationResult> {
    const obs = this.data.entityType === 'queue'
      ? this.queueService.resubmitDeadLetterMessages(this.data.entityName, sequenceNumbers, this.newMessageId())
      : this.topicService.resubmitDeadLetterMessages(this.data.topicName!, this.data.entityName, sequenceNumbers, this.newMessageId());
    return firstValueFrom(obs);
  }
}
