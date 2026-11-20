import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { EMPTY, catchError, exhaustMap, filter, forkJoin, switchMap, timer } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { ConnectionGroupService, ConnectionService } from '../../core/services';
import { ConnectionGroup } from '../../core/models/connection-group.model';
import { ServiceBusConnection, getConnectionDisplayTarget } from '../../core/models/connection.model';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';
import { McpActivity, McpSettingsService } from './mcp-settings.service';

const LEVEL_LABELS: Record<string, string> = { read: 'Read', readAndSend: 'Read and send', all: 'Read, send and remove' };

/** What each level allows, as the artboard words it; a block is shown only when the API lists its level. */
const CHOICES = [
  { level: 'read', title: 'Read', who: 'Every connection listed', what: 'List the connections offered, queues, topics, subscriptions and rules; read the counts; peek the active, dead-letter, scheduled and deferred messages.', asks: 'Never asks you.' },
  { level: 'readAndSend', title: 'Send', who: 'From "Read and send" up', what: 'Send one message or many to a queue or a topic, now or scheduled.', asks: 'Asks you before each send, except on a local test broker.' },
  { level: 'all', title: 'Move and remove', who: '"Read, send and remove" only', what: 'Resubmit, move, delete, purge and cancel scheduled messages.', asks: 'Asks you every time; a delete or a purge asks for the name typed.' },
  { level: 'all', title: 'Entities', who: '"Read, send and remove" only', what: 'Create, change and delete a queue, a topic, a subscription or a rule.', asks: 'Asks you every time.' },
];

/** A stored connection as the group names it: its name, where it is, and whether its environment is production. */
interface Known {
  id: string;
  name: string;
  where: string;
  production: boolean;
}

/** Why a call failed, in words: the API's own message, or what is known of the failure. */
function reason(error: { status?: number; error?: { message?: unknown } } | undefined): string {
  const message = error?.error?.message;
  if (typeof message === 'string' && message) return message;
  return error?.status ? `the API answered ${error.status}.` : 'the API of this app did not answer.';
}

/**
 * The MCP server group of Settings: the switch, how to connect an assistant, the connections offered and their
 * levels, the logs choice, what each level allows and what assistants did. Only what the API lists is drawn.
 * A token created here lives in this component alone and is gone when it is destroyed.
 */
@Component({
  selector: 'app-settings-mcp',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatButtonToggleModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTableModule],
  templateUrl: './settings-mcp.component.html',
  styleUrl: './settings-mcp.component.scss',
})
export class SettingsMcpComponent {
  private readonly mcp = inject(McpSettingsService);
  private readonly connectionService = inject(ConnectionService);
  private readonly groupService = inject(ConnectionGroupService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  readonly state = this.mcp.state;
  readonly absent = this.mcp.absent;
  readonly loadError = signal('');
  /** Where a call failed, by the row it belongs to, and what to say there. */
  readonly errors = signal<Record<string, string>>({});
  /** The token created in this visit; never stored anywhere else, never logged. */
  readonly token = signal('');
  readonly offering = signal(false);
  readonly query = signal('');
  readonly activity = signal<McpActivity[] | null>(null);
  readonly activityError = signal('');
  /** The stored connections by id; null until read, and when they could not be read. */
  readonly known = signal<Map<string, Known> | null>(null);
  readonly columns = ['time', 'assistant', 'asked', 'where', 'outcome'];

  readonly levels = computed(() => (this.state()?.levels ?? []).filter(level => level in LEVEL_LABELS).map(level => ({ level, label: LEVEL_LABELS[level] })));
  readonly choices = computed(() => CHOICES.filter(choice => this.state()?.levels.includes(choice.level)));
  /** Bulk operations come with sending; reading alone has none. */
  readonly beyondRead = computed(() => this.levels().some(l => l.level !== 'read'));
  readonly summary = computed(() => {
    const levels = this.state()?.levels ?? [];
    if (levels.includes('all')) return 'An assistant such as Claude Code reads the brokers, sends messages and acts on them through this app.';
    if (levels.includes('readAndSend')) return 'An assistant such as Claude Code reads the brokers and sends messages through this app.';
    return 'An assistant such as Claude Code reads the brokers through this app.';
  });

  /** Whether the app can ask the user before an operation; an older API does not say, which is read as no. */
  readonly canAsk = computed(() => !!this.state()?.supports?.confirmation);

  readonly offered = computed(() => {
    const known = this.known();
    const canAsk = this.canAsk();
    return (this.state()?.connections ?? []).map(c => {
      const found = known?.get(c.connectionId);
      return {
        id: c.connectionId,
        level: c.level,
        found,
        production: !!c.production,
        canNeverAsk: !!c.canNeverAsk,
        neverAsk: !!c.neverAsk,
        name: found?.name ?? (known ? 'A connection that no longer exists' : c.connectionId),
        asks: !canAsk ? 'Reads without asking you.'
          : c.production ? 'Asks you before every operation, a read included.'
          : c.canNeverAsk && c.neverAsk ? 'A local test broker: never asks you.'
          : c.level === 'read' ? 'Reads without asking you.'
          : c.level === 'readAndSend' ? 'Reads without asking; asks you before each send.'
          : 'Reads without asking; asks you before each send, move or removal.',
      };
    });
  });

  readonly candidates = computed(() => {
    const taken = new Set((this.state()?.connections ?? []).map(c => c.connectionId));
    const query = this.query().trim().toLowerCase();
    return Array.from(this.known()?.values() ?? [])
      .filter(c => !taken.has(c.id) && `${c.name} ${c.where}`.toLowerCase().includes(query));
  });

  readonly configuration = computed(() => JSON.stringify({
    mcpServers: { 'messaging-explorer': { type: 'http', url: this.state()?.url ?? '', headers: { Authorization: `Bearer ${this.token() || '<your token>'}` } } },
  }, null, 2));

  /** Reads the group, then reads what assistants did again every 5 seconds while the server is enabled. */
  constructor() {
    this.load();
    toObservable(computed(() => !!this.state()?.enabled)).pipe(
      switchMap(enabled => enabled ? timer(5000, 5000) : EMPTY),
      filter(() => this.activity() !== null),
      exhaustMap(() => this.mcp.activity().pipe(catchError(() => EMPTY))),
      takeUntilDestroyed(),
    ).subscribe(list => {
      if (JSON.stringify(list) !== JSON.stringify(this.activity())) this.activity.set(list);
    });
  }

  load(): void {
    this.loadError.set('');
    this.mcp.load().subscribe({
      next: state => {
        if (!state) return;
        this.readConnections();
        this.readActivity();
      },
      error: error => this.loadError.set(`The MCP server settings could not be read: ${reason(error)}`),
    });
  }

  readConnections(): void {
    this.fail('names', '');
    forkJoin([this.connectionService.getConnections(), this.groupService.getGroups()]).subscribe({
      next: ([connections, groups]) => this.known.set(new Map(connections.map(c => [c.id, this.describe(c, groups)]))),
      error: error => this.fail('names', `The names of the connections could not be read: ${reason(error)}`),
    });
  }

  readActivity(): void {
    this.activityError.set('');
    this.mcp.activity().subscribe({
      next: list => this.activity.set(list),
      error: error => { this.activity.set(null); this.activityError.set(`What assistants did could not be read: ${reason(error)}`); },
    });
  }

  toggle(): void {
    const enabled = !this.state()?.enabled;
    this.fail('server', '');
    this.mcp.setEnabled(enabled).subscribe({
      error: error => this.fail('server', `The server was not turned ${enabled ? 'on' : 'off'}: ${reason(error)}`),
    });
  }

  createToken(): void {
    this.fail('token', '');
    this.mcp.createToken().subscribe({
      next: token => this.token.set(token),
      error: error => this.fail('token', `No token was created: ${reason(error)}`),
    });
  }

  setLevel(id: string, name: string, level: string): void {
    this.fail('connections', '');
    this.mcp.setLevel(id, level).subscribe({
      error: error => this.fail('connections', `The level of ${name} was not changed: ${reason(error)}`),
    });
  }

  /** Offers a connection at "Read"; a production one only after the user confirms it in the shared dialog. */
  offer(candidate: Known): void {
    if (!candidate.production) { this.send(candidate); return; }
    const data: ConfirmDialogData = {
      title: 'Offer a production connection?',
      message: `${candidate.name} is in a production environment. An assistant will be able to read it, and each operation will ask you first, a read included.`,
      confirmText: 'Offer',
      cancelText: 'Cancel',
      confirmColor: 'primary',
    };
    this.dialog.open(ConfirmDialogComponent, { width: '560px', data }).afterClosed().subscribe(confirmed => {
      if (confirmed === true) this.send(candidate);
    });
  }

  /** Changes whether an offered local test broker asks before a send, at the level the row has. */
  setNeverAsk(id: string, name: string, level: string, change: MatCheckboxChange): void {
    this.fail('connections', '');
    this.mcp.setLevel(id, level, change.checked).subscribe({
      error: error => {
        change.source.checked = !change.checked;
        this.fail('connections', `The choice for ${name} was not saved: ${reason(error)}`);
      },
    });
  }

  private send(candidate: Known): void {
    this.fail('connections', '');
    this.mcp.setLevel(candidate.id, 'read').subscribe({
      error: error => this.fail('connections', `${candidate.name} was not offered: ${reason(error)}`),
    });
  }

  remove(id: string, name: string): void {
    this.fail('connections', '');
    this.mcp.removeConnection(id).subscribe({
      error: error => this.fail('connections', `${name} was not removed: ${reason(error)}`),
    });
  }

  setLogs(change: MatCheckboxChange): void {
    this.fail('logs', '');
    this.mcp.setLogs(change.checked).subscribe({
      error: error => {
        change.source.checked = !!this.state()?.logsAllowed;
        this.fail('logs', `The choice for the logs was not saved: ${reason(error)}`);
      },
    });
  }

  clearActivity(): void {
    this.fail('activity', '');
    this.mcp.clearActivity().subscribe({
      next: () => this.activity.set([]),
      error: error => this.fail('activity', `The list was not cleared: ${reason(error)}`),
    });
  }

  copy(text: string, what: string): void {
    void navigator.clipboard.writeText(text).then(
      () => this.snackBar.open(`${what} copied`, 'Close', { duration: 3000 }),
      () => this.snackBar.open(`${what} was not copied: the clipboard refused.`, 'Close', { duration: 6000 }));
  }

  private fail(place: string, text: string): void {
    this.errors.update(errors => ({ ...errors, [place]: text }));
  }

  private describe(connection: ServiceBusConnection, groups: ConnectionGroup[]): Known {
    const environment = groups.find(g => g.id === connection.environmentId);
    const place = [groups.find(g => g.id === connection.clientId)?.name, environment?.name].filter(Boolean).join(', ');
    const target = getConnectionDisplayTarget(connection);
    return { id: connection.id, name: connection.name, where: place ? `${place}. ${target}` : target, production: !!environment?.isProduction };
  }
}
