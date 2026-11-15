import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ErrorStateMatcher } from '@angular/material/core';
import { Subscription, catchError, defer, from, map, mergeMap, of, takeUntil, timer } from 'rxjs';
import { MessageInfo, SessionDetail, SessionEntity, SessionList } from '../../core/models';
import { SessionService } from '../../core/services';
import { SessionStateDialogComponent, SessionStateDialogData, SessionStateDialogResult } from './session-state-dialog.component';

type ListState = { status: 'loading' } | { status: 'ready'; list: SessionList; at: Date } | { status: 'failed'; message: string };

/** What accepting one listed session found. */
type LockRead =
  | { status: 'reading' }
  | { status: 'unlocked'; hasState: boolean }
  | { status: 'locked' }
  | { status: 'failed'; message: string }
  | { status: 'cut' };

type Opened =
  | { id: string; status: 'loading' }
  | { id: string; status: 'ready'; detail: SessionDetail; messages: MessageInfo[] }
  | { id: string; status: 'failed'; message: string; locked: boolean };

const MESSAGE_COUNT = 100;
const MAX_STATE_BYTES = 262144;
/** Sessions accepted at once by the listing. */
const LOCK_CONCURRENCY = 4;
/** The listing stops accepting sessions after this long, as the notice says. */
const LISTING_LIMIT_MS = 10_000;

/** Said when opening a session meets the listing's own accept of it, which holds it for a moment. */
const LISTING_HOLDS_IT = 'The listing is reading this session right now. Try again in a moment.';

/**
 * The sessions of one queue or subscription. A passive scan finds the session ids; then each one
 * is accepted once, four at a time and for at most 10 seconds, to read whether another receiver
 * holds it and whether it has a state. Opening a session reads its state and its messages in one
 * accept. The state is edited inline and written only after a confirmation that carries the state
 * as read. A new entity, or List again, cancels what was still in flight.
 */
@Component({
  selector: 'app-entity-sessions',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, MatTableModule, MatProgressBarModule
  ],
  template: `
    <p class="lock-notice" role="note">
      <mat-icon aria-hidden="true">warning</mat-icon>
      <span><strong>Listing sessions locks each one briefly.</strong> The broker cannot list sessions without accepting them: each one is locked, read and released at once, and a consumer that wants it waits for that moment. The listing stops after 10 seconds and shows only the sessions it could lock.</span>
    </p>

    <div class="layout">
      <section class="list" aria-label="Sessions">
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
            @let ready = sessionList()!;
            <div class="scan-bar">
              <span class="listed">{{ ready.sessions.length }} {{ ready.sessions.length === 1 ? 'session' : 'sessions' }} listed at {{ listedAt() | date:'HH:mm:ss' }}</span>
              <button mat-stroked-button type="button" (click)="loadList()"><mat-icon>refresh</mat-icon>List again</button>
            </div>
            @if (ready.truncated) {
              <p class="scan-notice">Listed from the first {{ ready.scannedMessages }} messages. Sessions further back, or holding only a state, are not shown; open one by its id.</p>
            } @else {
              <p class="scan-notice">Sessions holding only a state are not shown; open one by its id.</p>
            }
            @if (ready.sessions.length === 0) {
              <p class="empty">No session holds a message in this {{ kind() }}.</p>
            } @else {
              <table class="sessions">
                <thead>
                  <tr><th scope="col">Session ID</th><th scope="col">Lock Status</th><th scope="col">State</th></tr>
                </thead>
                <tbody>
                  @for (session of ready.sessions; track session.sessionId) {
                    @let read = reads().get(session.sessionId);
                    <tr class="session-row">
                      <td>
                        <button mat-button type="button" class="session mono" [attr.aria-current]="opened()?.id === session.sessionId" (click)="open(session.sessionId)">{{ session.sessionId }}</button>
                      </td>
                      <td class="lock">{{ lockText(read) }}</td>
                      <td class="has-state">{{ stateText(read) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          }
        }

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
      </section>

      <section class="detail" aria-label="Selected session" aria-live="polite">
        @let current = opened();
        @if (!current) {
          <p class="empty">Open a session to read its state and its messages.</p>
        } @else {
          <dl class="facts">
            <div class="fact"><dt>Session ID</dt><dd class="mono">{{ current.id }}</dd></div>
            @if (current.status === 'ready' || (current.status === 'failed' && current.locked)) {
              <div class="fact"><dt>Lock Status</dt><dd class="lock-status">{{ current.status === 'ready' ? 'Unlocked' : 'Locked' }}</dd></div>
            }
          </dl>
          @if (current.status === 'loading') {
            <mat-progress-bar mode="indeterminate" [attr.aria-label]="'Opening session ' + current.id"></mat-progress-bar>
          } @else if (current.status === 'failed') {
            <div class="error" role="alert">
              <mat-icon aria-hidden="true">error</mat-icon>
              <span class="grow">{{ current.message }}</span>
              <button mat-button type="button" (click)="open(current.id)">Retry</button>
            </div>
          } @else {
            <div class="heading">
              <h3>Session State</h3>
              @if (!current.detail.stateIsBinary && !editing()) {
                <button #editButton mat-stroked-button type="button" (click)="startEdit(current.detail)"><mat-icon>edit</mat-icon>Edit state</button>
              }
            </div>
            @if (current.detail.state === null) {
              <p class="state muted">No state data</p>
            } @else if (current.detail.stateIsBinary) {
              <p class="binary muted">binary state, {{ byteCount(current.detail.state) }} bytes as base64, cannot be edited here</p>
              <pre class="state mono">{{ current.detail.state }}</pre>
            } @else {
              <pre class="state mono">{{ current.detail.state }}</pre>
            }

            @if (editing()) {
              <div class="editor">
                <mat-form-field class="field">
                  <mat-label>New state</mat-label>
                  <textarea matInput name="sessionState" rows="6" spellcheck="false" class="mono" [formControl]="stateControl" [errorStateMatcher]="sizeMatcher"></textarea>
                  <mat-hint>The consuming application reads this the next time it accepts the session.</mat-hint>
                  @if (tooLarge()) {
                    <mat-error>The state is {{ draftBytes() }} bytes as UTF-8; the limit is {{ maxBytes }}.</mat-error>
                  }
                </mat-form-field>
                @if (stale()) {
                  <div class="error" role="alert">
                    <mat-icon aria-hidden="true">error</mat-icon>
                    <span class="grow">The state changed since it was read. Reload the session before writing.</span>
                    <button mat-button type="button" (click)="open(current.id, true)">Reload</button>
                  </div>
                }
                <div class="editor-actions">
                  <button mat-button type="button" (click)="cancelEdit()">Cancel</button>
                  <button mat-flat-button type="button" [disabled]="!canReview(current.detail)"
                    [attr.title]="unchanged(current.detail) ? 'The new state is the same as the current one' : null"
                    (click)="review(current.detail)">Review change</button>
                </div>
              </div>
            }

            <h3>Messages of this session</h3>
            @if (current.messages.length === 0) {
              <p class="empty">No message in this session.</p>
            } @else {
              <div class="table-scroll">
                <table mat-table [dataSource]="current.messages" class="messages">
                  <ng-container matColumnDef="sequenceNumber">
                    <th mat-header-cell *matHeaderCellDef>Sequence</th>
                    <td mat-cell *matCellDef="let m">{{ m.sequenceNumber }}</td>
                  </ng-container>
                  <ng-container matColumnDef="messageId">
                    <th mat-header-cell *matHeaderCellDef>Message ID</th>
                    <td mat-cell *matCellDef="let m" class="mono">{{ m.messageId }}</td>
                  </ng-container>
                  <ng-container matColumnDef="enqueuedTime">
                    <th mat-header-cell *matHeaderCellDef>Enqueued (UTC)</th>
                    <td mat-cell *matCellDef="let m">{{ m.enqueuedTime | date:'medium':'UTC' }}</td>
                  </ng-container>
                  <ng-container matColumnDef="size">
                    <th mat-header-cell *matHeaderCellDef>Size</th>
                    <td mat-cell *matCellDef="let m">{{ m.sizeInBytes == null ? '' : (m.sizeInBytes | number) + ' B' }}</td>
                  </ng-container>
                  <tr mat-header-row *matHeaderRowDef="columns"></tr>
                  <tr mat-row class="message-row" *matRowDef="let m; columns: columns"></tr>
                </table>
              </div>
            }
            <p class="footnote">Peeked, not received: nothing leaves the queue, and the session lock taken to read is released at once.</p>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; padding: 8px 16px; min-width: 0; }
    .lock-notice {
      display: flex; align-items: flex-start; gap: 8px; margin: 0 0 12px; padding: 8px 12px; border-radius: 12px;
      background: var(--mat-sys-surface-container); color: var(--mat-sys-on-surface-variant);
    }
    .lock-notice strong { font-weight: 600; }
    .layout { display: flex; flex-wrap: wrap; gap: 24px; }
    .list { display: flex; flex-direction: column; gap: 8px; flex: 1 1 380px; min-width: 0; }
    .detail { display: flex; flex-direction: column; gap: 8px; flex: 1.4 1 440px; min-width: 0; }
    .open-by-id { display: flex; align-items: baseline; gap: 8px; margin-top: 8px; }
    .grow { flex: 1; min-width: 0; }
    .listed, .scan-notice, .muted, .empty, .footnote { color: var(--mat-sys-on-surface-variant); }
    .scan-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .listed { flex: 1; min-width: 160px; font-variant-numeric: tabular-nums; }
    .scan-notice, .footnote { font: var(--mat-sys-body-small); margin: 0; }
    .empty { font: var(--mat-sys-body-medium); margin: 16px 0; }
    .mono { font-family: ui-monospace, monospace; }
    h3 { font: var(--mat-sys-title-medium); margin: 16px 0 8px; }
    .heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .heading h3 { margin-bottom: 0; }
    .sessions { width: 100%; border-collapse: collapse; }
    .sessions th { font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); text-align: start; padding: 8px 12px; border-bottom: 1px solid var(--mat-sys-outline); }
    .sessions td { padding: 4px 12px; border-bottom: 1px solid var(--mat-sys-outline-variant); overflow-wrap: anywhere; }
    .session[aria-current="true"] { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); font-weight: 700; }
    .facts { margin: 0; }
    .fact { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--mat-sys-outline-variant); min-width: 0; }
    dt { flex: 0 0 40%; font-weight: normal; color: var(--mat-sys-on-surface-variant); }
    dd { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; }
    pre { margin: 8px 0 0; padding: 8px; max-height: 240px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border-radius: 8px; background: var(--mat-sys-surface-container); }
    p.binary, p.state { margin: 8px 0 0; }
    .editor { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .field { width: 100%; }
    .editor-actions { display: flex; justify-content: flex-end; gap: 8px; }
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
  /** What accepting each listed session found, by session id. */
  readonly reads = signal(new Map<string, LockRead>());
  readonly opened = signal<Opened | null>(null);
  readonly columns = ['sequenceNumber', 'messageId', 'enqueuedTime', 'size'];

  readonly editing = signal(false);
  /** The confirmation was refused because the state changed since it was read. */
  readonly stale = signal(false);
  readonly maxBytes = MAX_STATE_BYTES;
  readonly stateControl = new FormControl('', { nonNullable: true });
  readonly draft = toSignal(this.stateControl.valueChanges, { initialValue: this.stateControl.value });
  readonly draftBytes = computed(() => new TextEncoder().encode(this.draft()).length);
  readonly tooLarge = computed(() => this.draftBytes() > MAX_STATE_BYTES);
  readonly sizeMatcher: ErrorStateMatcher = { isErrorState: () => this.tooLarge() };

  readonly kind = computed(() => 'queueName' in this.entity() ? 'queue' : 'subscription');
  readonly sessionList = computed(() => { const list = this.list(); return list.status === 'ready' ? list.list : null; });
  readonly listedAt = computed(() => { const list = this.list(); return list.status === 'ready' ? list.at : null; });
  readonly listFailure = computed(() => { const list = this.list(); return list.status === 'failed' ? list.message : ''; });

  private listCall?: Subscription;
  private lockCall?: Subscription;
  private openCall?: Subscription;

  constructor() {
    effect(onCleanup => {
      this.entity();
      untracked(() => {
        this.opened.set(null);
        this.editing.set(false);
        this.idControl.reset();
        this.loadList();
      });
      onCleanup(() => {
        this.listCall?.unsubscribe();
        this.lockCall?.unsubscribe();
        this.openCall?.unsubscribe();
      });
    });
  }

  /** Scans for the session ids, then accepts each one to read its lock and whether it has a state. */
  loadList(): void {
    const entity = this.entity();
    this.listCall?.unsubscribe();
    this.lockCall?.unsubscribe();
    this.list.set({ status: 'loading' });
    this.reads.set(new Map());
    this.listCall = this.sessions.list(entity).subscribe({
      next: list => {
        this.list.set({ status: 'ready', list, at: new Date() });
        this.readLocks(entity, list.sessions.map(s => s.sessionId));
      },
      error: (error: HttpErrorResponse) => this.list.set({ status: 'failed', message: failure(error, 'Could not read the sessions: the API did not answer.') })
    });
  }

  private readLocks(entity: SessionEntity, ids: string[]): void {
    this.reads.set(new Map(ids.map(id => [id, { status: 'reading' } as LockRead])));
    this.lockCall = from(ids).pipe(
      mergeMap(id => defer(() => this.sessions.get(entity, id, 0)).pipe(
        map((detail): LockRead => ({ status: 'unlocked', hasState: detail.state !== null })),
        catchError((error: HttpErrorResponse) => of<LockRead>(inUse(error)
          ? { status: 'locked' }
          : { status: 'failed', message: failure(error, 'The API did not answer.') })),
        map(read => [id, read] as const)
      ), LOCK_CONCURRENCY),
      takeUntil(timer(LISTING_LIMIT_MS))
    ).subscribe({
      next: ([id, read]) => { if (!this.openedReady(id)) this.setRead(id, read); },
      complete: () => this.reads.update(reads => new Map([...reads].map(([id, read]) => [id, read.status === 'reading' ? { status: 'cut' } : read])))
    });
  }

  /** Whether this session was opened and read after the listing asked for it, so the open is the fresher answer. */
  private openedReady(id: string): boolean {
    const opened = this.opened();
    return opened?.id === id && opened.status === 'ready';
  }

  private setRead(id: string, read: LockRead): void {
    if (this.reads().has(id)) this.reads.update(reads => new Map(reads).set(id, read));
  }

  lockText(read: LockRead | undefined): string {
    switch (read?.status) {
      case 'unlocked': return 'Unlocked';
      case 'locked': return 'Locked';
      case 'failed': case 'cut': return 'Not read';
      default: return 'Reading...';
    }
  }

  stateText(read: LockRead | undefined): string {
    switch (read?.status) {
      case 'unlocked': return read.hasState ? 'Has state' : 'No state';
      case 'locked': return 'Not read: another receiver holds it';
      case 'failed': return read.message;
      case 'cut': return 'Not read: the listing stopped after 10 seconds';
      default: return 'Reading...';
    }
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
    this.editing.set(false);
    this.stale.set(false);
    this.opened.set({ id, status: 'loading' });
    this.openCall = this.sessions.get(entity, id, MESSAGE_COUNT).subscribe({
      next: detail => {
        this.opened.set({ id, status: 'ready', detail, messages: detail.messages ?? [] });
        this.setRead(id, { status: 'unlocked', hasState: detail.state !== null });
        if (focusEdit) afterNextRender(() => this.editButton()?.nativeElement.focus(), { injector: this.injector });
      },
      error: (error: HttpErrorResponse) => {
        const listing = inUse(error) && this.reads().get(id)?.status === 'reading';
        const locked = inUse(error) && !listing;
        const message = listing ? LISTING_HOLDS_IT : failure(error, 'Could not open the session: the API did not answer.');
        this.opened.set({ id, status: 'failed', locked, message });
        if (locked) this.setRead(id, { status: 'locked' });
      }
    });
  }

  startEdit(detail: SessionDetail): void {
    this.stateControl.setValue(detail.state ?? '');
    this.stale.set(false);
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.stale.set(false);
  }

  unchanged(detail: SessionDetail): boolean {
    return this.draft() === (detail.state ?? '');
  }

  canReview(detail: SessionDetail): boolean {
    return !this.stale() && !this.tooLarge() && !this.unchanged(detail);
  }

  /** Opens the confirmation; nothing is written before it. */
  review(detail: SessionDetail): void {
    if (!this.canReview(detail)) return;
    const entity = this.entity();
    const text = this.draft();
    const data: SessionStateDialogData = { entity, sessionId: detail.sessionId, state: detail.state, newState: text === '' ? null : text };
    this.dialog.open(SessionStateDialogComponent, { data, width: '720px', maxWidth: '95vw' })
      .afterClosed().subscribe((result: SessionStateDialogResult) => {
        const current = this.opened();
        if (!result || this.entity() !== entity || current?.status !== 'ready' || current.id !== detail.sessionId) return;
        if (result === 'reload') this.open(detail.sessionId, true);
        else if (result === 'stale') this.stale.set(true);
        else {
          this.opened.set({ ...current, detail: result });
          this.editing.set(false);
          this.setRead(detail.sessionId, { status: 'unlocked', hasState: result.state !== null });
        }
      });
  }

  byteCount(base64: string): number {
    return atob(base64).length;
  }
}

/** Another receiver holds the session, or its accept waited too long: the API's 409 with code SessionInUse. */
function inUse(error: HttpErrorResponse): boolean {
  return error.status === 409 && error.error?.code === 'SessionInUse';
}

function failure(error: HttpErrorResponse, fallback: string): string {
  const message: string | undefined = error.error?.message;
  return [400, 404, 409].includes(error.status) && message ? message : fallback;
}
