import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTableModule } from '@angular/material/table';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import { MessageInfo, SessionDetail, SessionEntity, SessionList } from '../../core/models';
import { SessionService } from '../../core/services';
import { SessionStateDialogComponent, SessionStateDialogData } from './session-state-dialog.component';

type ListState = { status: 'loading' } | { status: 'ready'; list: SessionList } | { status: 'failed'; message: string };

type Opened =
  | { id: string; status: 'loading' }
  | { id: string; status: 'ready'; detail: SessionDetail; messages: MessageInfo[] }
  | { id: string; status: 'failed'; message: string };

const PREVIEW_LENGTH = 100;
const MESSAGE_COUNT = 100;

/**
 * The sessions of one queue or subscription. The list is read when the component is created, by a
 * passive scan that locks nothing; opening a session reads its state and its messages in one call
 * that accepts the session for a moment. A new entity resets everything and cancels what was
 * still in flight for the previous one.
 */
@Component({
  selector: 'app-entity-sessions',
  standalone: true,
  imports: [
    DatePipe, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, MatListModule, MatTableModule, MatProgressBarModule, MatTooltipModule
  ],
  template: `
    <p class="lock-notice" role="note">
      <mat-icon aria-hidden="true">lock_clock</mat-icon>
      <span>Opening a session locks it for a moment. A consumer of this session waits until it is released.</span>
    </p>

    <div class="layout">
      <section class="list" aria-label="Sessions">
        <form class="open-by-id" (submit)="$event.preventDefault(); openTyped()">
          <mat-form-field class="grow">
            <mat-label>Session id</mat-label>
            <input matInput name="sessionId" autocomplete="off" [formControl]="idControl">
            @if (idControl.invalid) {
              <mat-error>A session id is 1 to 128 characters, not only spaces.</mat-error>
            }
          </mat-form-field>
          <button mat-stroked-button type="submit" [disabled]="idControl.invalid">Open session</button>
        </form>

        @switch (list().status) {
          @case ('loading') {
            <mat-progress-bar mode="indeterminate" aria-label="Reading the sessions"></mat-progress-bar>
          }
          @case ('failed') {
            <div class="error" role="alert">
              <mat-icon aria-hidden="true">error</mat-icon>
              <span class="grow">{{ listFailure() }}</span>
              <button mat-button type="button" (click)="loadList()">Retry</button>
            </div>
          }
          @case ('ready') {
            <div class="scan-bar">
              <p class="scan-notice">{{ scanNotice() }}</p>
              <button mat-icon-button type="button" aria-label="Refresh the sessions" matTooltip="Refresh the sessions" (click)="loadList()">
                <mat-icon>refresh</mat-icon>
              </button>
            </div>
            @if (sessionList()!.sessions.length === 0) {
              <p class="empty">No session holds a message in this {{ kind() }}.</p>
            } @else {
              <mat-action-list>
                @for (session of sessionList()!.sessions; track session.sessionId) {
                  <button mat-list-item type="button" class="session" [activated]="opened()?.id === session.sessionId" (click)="open(session.sessionId)">
                    <span matListItemTitle class="mono">{{ session.sessionId }}</span>
                    <span matListItemLine>{{ session.messageCount }} {{ session.messageCount === 1 ? 'message' : 'messages' }}</span>
                  </button>
                }
              </mat-action-list>
            }
          }
        }
      </section>

      <section class="detail" aria-live="polite">
        @let current = opened();
        @if (!current) {
          <p class="empty">Open a session to read its state and its messages.</p>
        } @else if (current.status === 'loading') {
          <mat-progress-bar mode="indeterminate" [attr.aria-label]="'Opening session ' + current.id"></mat-progress-bar>
        } @else if (current.status === 'failed') {
          <div class="error" role="alert">
            <mat-icon aria-hidden="true">error</mat-icon>
            <span class="grow">{{ current.message }}</span>
            <button mat-button type="button" (click)="open(current.id)">Retry</button>
          </div>
        } @else {
          <h3 class="mono">Session {{ current.detail.sessionId }}</h3>
          <dl class="facts">
            <div class="fact"><dt>Lock held by this read until</dt><dd class="locked-until">{{ current.detail.lockedUntil | date:'medium':'UTC' }} UTC</dd></div>
          </dl>

          <div class="heading">
            <h4>State</h4>
            @if (!current.detail.stateIsBinary) {
              <button #editButton mat-stroked-button type="button" (click)="editState(current.detail)"><mat-icon>edit</mat-icon>Edit state</button>
            }
          </div>
          @if (current.detail.state === null) {
            <p class="state muted">No state</p>
          } @else if (current.detail.stateIsBinary) {
            <p class="binary muted">binary state, {{ byteCount(current.detail.state) }} bytes as base64, cannot be edited here</p>
            <pre class="state mono">{{ current.detail.state }}</pre>
          } @else {
            <pre class="state mono">{{ current.detail.state }}</pre>
          }

          <h4>Messages</h4>
          @if (current.messages.length === 0) {
            <p class="empty">No message in this session.</p>
          } @else {
            <div class="table-scroll">
              <table mat-table [dataSource]="current.messages" class="messages">
                <ng-container matColumnDef="sequenceNumber">
                  <th mat-header-cell *matHeaderCellDef>Sequence number</th>
                  <td mat-cell *matCellDef="let m">{{ m.sequenceNumber }}</td>
                </ng-container>
                <ng-container matColumnDef="messageId">
                  <th mat-header-cell *matHeaderCellDef>Message id</th>
                  <td mat-cell *matCellDef="let m" class="mono">{{ m.messageId }}</td>
                </ng-container>
                <ng-container matColumnDef="enqueuedTime">
                  <th mat-header-cell *matHeaderCellDef>Enqueued (UTC)</th>
                  <td mat-cell *matCellDef="let m">{{ m.enqueuedTime | date:'medium':'UTC' }}</td>
                </ng-container>
                <ng-container matColumnDef="state">
                  <th mat-header-cell *matHeaderCellDef>State</th>
                  <td mat-cell *matCellDef="let m">{{ m.state ?? 'Active' }}</td>
                </ng-container>
                <ng-container matColumnDef="body">
                  <th mat-header-cell *matHeaderCellDef>Body</th>
                  <td mat-cell *matCellDef="let m" class="mono">{{ preview(m.body) }}</td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="columns"></tr>
                <tr mat-row class="message-row" *matRowDef="let m; columns: columns"></tr>
              </table>
            </div>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; padding: 8px 16px; min-width: 0; }
    .lock-notice {
      display: flex; align-items: center; gap: 8px; margin: 0 0 12px; padding: 8px 12px; border-radius: 12px;
      background: var(--mat-sys-surface-container); color: var(--mat-sys-on-surface-variant);
    }
    .layout { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(0, 2fr); gap: 16px; }
    @media (max-width: 900px) { .layout { grid-template-columns: minmax(0, 1fr); } }
    .list, .detail { min-width: 0; }
    .open-by-id { display: flex; align-items: baseline; gap: 8px; }
    .grow { flex: 1; min-width: 0; }
    .scan-notice, .muted, .empty { color: var(--mat-sys-on-surface-variant); }
    .scan-bar { display: flex; align-items: center; gap: 4px; }
    .scan-notice { flex: 1; min-width: 0; font: var(--mat-sys-body-small); margin: 8px 0; }
    .empty { font: var(--mat-sys-body-medium); margin: 16px 0; }
    .mono { font-family: ui-monospace, monospace; }
    h3 { font: var(--mat-sys-title-medium); margin: 0 0 8px; overflow-wrap: anywhere; }
    h4 { font: var(--mat-sys-title-small); margin: 16px 0 8px; }
    .heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .heading h4 { margin-bottom: 0; }
    .facts { margin: 0; border: 1px solid var(--mat-sys-outline-variant); border-radius: 12px; }
    .fact { display: flex; justify-content: space-between; gap: 16px; padding: 8px 16px; min-width: 0; }
    dt { font-weight: normal; }
    dd { margin: 0; text-align: end; }
    pre { margin: 8px 0 0; padding: 8px; max-height: 240px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border-radius: 8px; background: var(--mat-sys-surface-container); }
    p.binary, p.state { margin: 8px 0 0; }
    .table-scroll { overflow-x: auto; }
    .messages { width: 100%; }
    td { overflow-wrap: anywhere; }
    .error {
      display: flex; align-items: center; gap: 12px; margin: 8px 0; padding: 12px 16px; border-radius: 12px;
      background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container);
    }
  `]
})
export class EntitySessionsComponent {
  private readonly sessions = inject(SessionService);
  private readonly dialog = inject(MatDialog);
  private readonly injector = inject(Injector);
  private readonly editButton = viewChild('editButton', { read: ElementRef<HTMLButtonElement> });

  readonly entity = input.required<SessionEntity>();

  readonly idControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(128), Validators.pattern(/\S/)] });
  readonly list = signal<ListState>({ status: 'loading' });
  readonly opened = signal<Opened | null>(null);
  readonly columns = ['sequenceNumber', 'messageId', 'enqueuedTime', 'state', 'body'];

  readonly kind = computed(() => 'queueName' in this.entity() ? 'queue' : 'subscription');
  readonly sessionList = computed(() => { const list = this.list(); return list.status === 'ready' ? list.list : null; });
  readonly listFailure = computed(() => { const list = this.list(); return list.status === 'failed' ? list.message : ''; });
  readonly scanNotice = computed(() => {
    const list = this.sessionList();
    return list?.truncated
      ? `Listed from the first ${list.scannedMessages} messages. Sessions further back, or holding only a state, are not shown; open one by its id.`
      : 'Sessions holding only a state are not shown; open one by its id.';
  });

  private listCall?: Subscription;
  private openCall?: Subscription;

  constructor() {
    effect(onCleanup => {
      this.entity();
      untracked(() => {
        this.opened.set(null);
        this.idControl.reset();
        this.loadList();
      });
      onCleanup(() => {
        this.listCall?.unsubscribe();
        this.openCall?.unsubscribe();
      });
    });
  }

  loadList(): void {
    this.listCall?.unsubscribe();
    this.list.set({ status: 'loading' });
    this.listCall = this.sessions.list(this.entity()).subscribe({
      next: list => this.list.set({ status: 'ready', list }),
      error: (error: HttpErrorResponse) => this.list.set({ status: 'failed', message: failure(error, 'Could not read the sessions: the API did not answer.') })
    });
  }

  openTyped(): void {
    if (this.idControl.invalid) {
      this.idControl.markAsTouched();
      return;
    }
    this.open(this.idControl.value);
  }

  open(id: string, focusEdit = false): void {
    const entity = this.entity();
    this.openCall?.unsubscribe();
    this.opened.set({ id, status: 'loading' });
    this.openCall = this.sessions.get(entity, id, MESSAGE_COUNT).subscribe({
      next: detail => {
        this.opened.set({ id, status: 'ready', detail, messages: detail.messages ?? [] });
        if (focusEdit) afterNextRender(() => this.editButton()?.nativeElement.focus(), { injector: this.injector });
      },
      error: (error: HttpErrorResponse) => this.opened.set({ id, status: 'failed', message: failure(error, 'Could not open the session: the API did not answer.') })
    });
  }

  editState(detail: SessionDetail): void {
    const entity = this.entity();
    const data: SessionStateDialogData = { entity, sessionId: detail.sessionId, state: detail.state };
    this.dialog.open(SessionStateDialogComponent, { data, width: '720px', maxWidth: '95vw' })
      .afterClosed().subscribe((result: SessionDetail | 'reload' | undefined) => {
        const current = this.opened();
        if (!result || this.entity() !== entity || current?.status !== 'ready' || current.id !== detail.sessionId) return;
        if (result === 'reload') this.open(detail.sessionId, true);
        else this.opened.set({ ...current, detail: result });
      });
  }

  byteCount(base64: string): number {
    return atob(base64).length;
  }

  preview(body: string | null | undefined): string {
    const text = body ?? '';
    return text.length > PREVIEW_LENGTH ? text.slice(0, PREVIEW_LENGTH - 3) + '...' : text;
  }
}

function failure(error: HttpErrorResponse, fallback: string): string {
  const message: string | undefined = error.error?.message;
  return [400, 404, 409].includes(error.status) && message ? message : fallback;
}
