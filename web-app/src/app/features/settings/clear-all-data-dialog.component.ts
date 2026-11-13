import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ConnectionService, ConnectionGroupService } from '../../core/services';

export const CLEAR_ALL_WORDS = 'clear all data';

export interface ClearAllDataResult {
  message: string;
  connectionsDeleted: number;
  groupsDeleted: number;
}

/** Names what clearing all data destroys and clears it only after the words are typed. */
@Component({
  selector: 'app-clear-all-data-dialog',
  standalone: true,
  imports: [AsyncPipe, MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon class="danger" aria-hidden="true">warning</mat-icon>
      Clear all data?
    </h2>
    <mat-dialog-content class="content">
      @if (connectionService.connectionStatus$ | async; as status) {
        @if (status.connected) {
          <p class="muted">Connected now to <strong>{{ status.namespace }}</strong>; the app disconnects first.</p>
        }
      }
      <p>This deletes every saved connection, client and environment from this computer, with the secrets stored in them. No broker is touched. It cannot be undone.</p>

      @switch (countsState()) {
        @case ('loading') {
          <p class="loading-row" role="status"><mat-spinner diameter="20" />Reading what is saved...</p>
        }
        @case ('error') {
          <div class="error" role="alert">
            <span>Could not read what is saved, so nothing can be cleared yet.</span>
            <button mat-stroked-button type="button" (click)="loadCounts()">Retry</button>
          </div>
        }
        @case ('ready') {
          <dl class="facts">
            <div><dt>Connections</dt><dd>{{ connectionCount() }}, read now</dd></div>
            <div><dt>Clients and environments</dt><dd>{{ groupCount() }}</dd></div>
            <div><dt>File</dt><dd class="mono">data/workspace.json</dd></div>
          </dl>
        }
      }

      <mat-form-field appearance="outline" class="typed">
        <mat-label>Type {{ words }} to confirm</mat-label>
        <input matInput autocomplete="off" spellcheck="false" [value]="typed()"
               (input)="typed.set($any($event.target).value)" [disabled]="clearing()">
        <mat-hint>The button stays disabled until the words match exactly.</mat-hint>
      </mat-form-field>

      @if (clearError()) {
        <p class="error" role="alert">{{ clearError() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [disabled]="clearing()" (click)="dialogRef.close()">Cancel</button>
      <button mat-flat-button type="button" class="danger-button" [disabled]="!canClear()" (click)="clear()">
        <mat-icon>delete_forever</mat-icon>
        Clear all data
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .title { display: flex; align-items: center; gap: 8px; }
    .danger { color: var(--mat-sys-error); }
    .content { display: flex; flex-direction: column; gap: 12px; }
    .content p { margin: 0; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    .loading-row { display: flex; align-items: center; gap: 8px; }
    .facts { margin: 0; border-top: 1px solid var(--mat-sys-outline-variant); }
    .facts div { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .facts dt { flex: 0 0 40%; color: var(--mat-sys-on-surface-variant); }
    .facts dd { flex: 1; min-width: 0; margin: 0; }
    .mono { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; }
    .typed { width: 100%; }
    .error { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 8px;
      background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .danger-button:not([disabled]) { background: var(--mat-sys-error); color: var(--mat-sys-on-error); }
  `]
})
export class ClearAllDataDialogComponent implements OnInit {
  readonly dialogRef = inject(MatDialogRef<ClearAllDataDialogComponent, ClearAllDataResult>);
  readonly connectionService = inject(ConnectionService);
  private readonly groupService = inject(ConnectionGroupService);
  private readonly destroyRef = inject(DestroyRef);

  readonly words = CLEAR_ALL_WORDS;
  readonly typed = signal('');
  readonly countsState = signal<'loading' | 'error' | 'ready'>('loading');
  readonly connectionCount = signal(0);
  readonly groupCount = signal(0);
  readonly clearing = signal(false);
  readonly clearError = signal('');
  readonly canClear = computed(() =>
    this.countsState() === 'ready' && !this.clearing() && this.typed().trim() === CLEAR_ALL_WORDS);

  ngOnInit(): void {
    this.loadCounts();
  }

  loadCounts(): void {
    this.countsState.set('loading');
    forkJoin({ connections: this.connectionService.getConnections(), groups: this.groupService.getGroups() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ connections, groups }) => {
          this.connectionCount.set(connections.length);
          this.groupCount.set(groups.length);
          this.countsState.set('ready');
        },
        error: () => this.countsState.set('error'),
      });
  }

  clear(): void {
    if (!this.canClear()) return;
    this.clearing.set(true);
    this.clearError.set('');
    this.dialogRef.disableClose = true;
    this.connectionService.clearAllData()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => this.dialogRef.close(result),
        error: () => {
          this.clearing.set(false);
          this.dialogRef.disableClose = false;
          this.clearError.set('The data was not cleared: the local API answered with an error. Read the Connections screen before you try again.');
        },
      });
  }
}
