import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogConfig, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { McpRequest, McpSettingsService } from './mcp-settings.service';

/** How a request dialog ended: allowed or denied by the user, or no longer waiting. */
export type McpRequestOutcome = 'allowed' | 'denied' | 'gone';

/** The kinds of request this version of the app can allow. */
const KNOWN_KINDS = ['read', 'send', 'connect', 'deadLetter', 'resubmit', 'move', 'delete', 'purge', 'cancelScheduled', 'createEntity', 'updateEntity', 'deleteEntity'];

/**
 * The window that asks the user about one request of an assistant, as Settings.dc.html draws `mcp.ask`.
 * Only Deny and the allow button answer it; Escape and a click outside do nothing, and every text from the API
 * is shown as text. A request that asks for a word typed cannot be allowed until the word is typed exactly.
 */
@Component({
  selector: 'app-mcp-request-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule],
  templateUrl: './mcp-request-dialog.component.html',
  styleUrl: './mcp-request-dialog.component.scss',
})
export class McpRequestDialogComponent {
  /** How the dialog is opened: it closes only by an answer or by the request going away, with focus on Deny. */
  static readonly config: MatDialogConfig = { disableClose: true, autoFocus: 'button.deny', width: '560px' };

  readonly request = inject<McpRequest>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<McpRequestDialogComponent, McpRequestOutcome>>(MatDialogRef);
  private readonly mcp = inject(McpSettingsService);

  readonly canAllow = KNOWN_KINDS.includes(this.request.kind);
  /** Whether allowing removes or moves messages; an older API leaves it out, which is read as false. */
  readonly danger = !!this.request.danger;
  /** The word to type before allowing, or null; an older API leaves it out. */
  readonly typed = this.request.typed ?? null;
  /** What the user typed in the field. */
  readonly value = signal('');
  /** Whether the request can be allowed: no word asked, or the word typed exactly, case included and nothing trimmed. */
  readonly matches = computed(() => !this.typed || this.value() === this.typed.word);
  readonly error = signal('');
  readonly sending = signal(false);

  answer(allow: boolean): void {
    if (this.sending() || (allow && !this.matches())) return;
    this.sending.set(true);
    this.error.set('');
    const call = allow && this.typed ? this.mcp.answer(this.request.id, true, this.value()) : this.mcp.answer(this.request.id, allow);
    call.subscribe({
      next: () => this.ref.close(allow ? 'allowed' : 'denied'),
      error: (error: { status?: number; error?: { message?: unknown } }) => {
        if (error?.status === 404) { this.ref.close('gone'); return; }
        this.sending.set(false);
        const message = typeof error?.error?.message === 'string' ? error.error.message : '';
        if (error?.status === 400 && message) { this.error.set(message); return; }
        this.error.set(`Your answer was not sent: ${message
          || (error?.status ? `the API answered ${error.status}.` : 'the API of this app did not answer.')}`);
      },
    });
  }
}
