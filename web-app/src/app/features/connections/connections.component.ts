import {Component, OnInit, inject, WritableSignal, signal, computed, DestroyRef, ChangeDetectorRef, ApplicationRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {MatDialogModule, MatDialog} from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConnectionService, ConnectionGroupService, DevSettingsService } from '../../core/services';
import { ServiceBusConnection, ConnectionGroup, ConnectionGroupTree, getConnectionAuthLabel, getConnectionDisplayTarget, getConnectionSecretLabel, getProviderDisplayName, getProviderIcon } from '../../core/models';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';
import { AddConnectionDialogComponent } from './add-connection-dialog.component';
import { EMPTY, Observable, finalize, forkJoin, of, skip, switchMap, take } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ManageGroupDialogComponent } from './manage-group-dialog.component';
import { ExportConnectionsDialogComponent, ExportConnectionsDialogResult } from './export-connections-dialog.component';
import { ImportConnectionsDialogComponent, ImportConnectionsDialogData } from './import-connections-dialog.component';
import { EnvironmentChipComponent } from '../../shared/environment-chip.component';

interface ConnectionSection {
  key: string;
  label: string;
  connections: ServiceBusConnection[];
  emptyText: string;
}

/** The sentence for the reason code the connect route answers, with the target; the general line when it gave none. */
function connectFailureSentence(code: unknown, target: string): string {
  switch (code) {
    case 'connection-refused': return `The broker at ${target} refused the connection. Check the host name and the port.`;
    case 'host-not-found': return `The host of ${target} was not found. Check the host name.`;
    case 'timeout': return `The broker at ${target} did not answer in time. Check the host name, the port and the network.`;
    case 'tls': return `The TLS handshake with ${target} failed. Check the TLS setting and the port.`;
    default: return 'Check the target, the credentials and the port of this connection.';
  }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

@Component({
  selector: 'app-connections',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
    EnvironmentChipComponent
  ],
  template: `
    <div class="connections-container">
      <div class="header">
        <div class="title">
          <h1>Connections</h1>
          @if (hasData()) {
            <p class="summary">{{ summary() }}</p>
          }
        </div>
        <div class="actions">
          @if (devSettingsService.devMode()) {
            <button matButton (click)="toggleDebugMode()" matTooltip="Toggle Debug Mode (F9)">
              <mat-icon>bug_report</mat-icon>
              {{ debugMode() ? 'Hide Debug' : 'Debug' }}
            </button>
          }
          @if (!isEmpty()) {
            <button matButton="outlined" (click)="importConfiguration()">
              <mat-icon>upload</mat-icon>
              Import
            </button>
            <button matButton="outlined" (click)="exportConfiguration()">
              <mat-icon>download</mat-icon>
              Export
            </button>
            <button matButton="tonal" (click)="openManageGroupDialog()">
              <mat-icon>folder</mat-icon>
              Manage Groups
            </button>
            <button matButton="filled" (click)="openAddDialog()">
              <mat-icon>add</mat-icon>
              Add Connection
            </button>
          }
        </div>
      </div>

      @if (debugMode()) {
        <section class="debug-panel" aria-label="Debug mode">
          <div class="debug-header">
            <mat-icon fontIcon="bug_report" aria-hidden="true"></mat-icon>
            <h2>Debug mode</h2>
            <button matButton="outlined" (click)="refreshDebugInfo()">
              <mat-icon fontIcon="refresh" aria-hidden="true"></mat-icon>
              Refresh
            </button>
            <button matButton="tonal" (click)="forceReload()">
              <mat-icon fontIcon="refresh" aria-hidden="true"></mat-icon>
              Force Reload
            </button>
          </div>
          <div class="debug-columns">
            <div>
              <h3>Current state</h3>
              <ul>
                <li><strong>Connections:</strong> {{ connections().length }}</li>
                <li><strong>Groups:</strong> {{ groups().length }}</li>
                <li><strong>Grouped Tree Nodes:</strong> {{ groupedTree().length }}</li>
                <li><strong>Ungrouped Connections:</strong> {{ ungroupedConnections().length }}</li>
                <li><strong>Loading:</strong> {{ loading() ? 'YES' : 'NO' }}</li>
              </ul>
            </div>
            <div>
              <h3>Connections details</h3>
              <pre class="debug-pre">{{ connections() | json }}</pre>
            </div>
          </div>
          <h3>Debug log</h3>
          <pre class="debug-pre debug-log">{{ debugInfo() }}</pre>
        </section>
      }

      @if (loading()) {
        <div class="state">
          <mat-progress-spinner mode="indeterminate" diameter="40" aria-label="Loading connections"></mat-progress-spinner>
        </div>
      } @else if (loadError()) {
        <section class="load-error" aria-label="Error">
          <mat-icon aria-hidden="true">error</mat-icon>
          <div class="load-error-body">
            <h3>Could not load the connections</h3>
            <p>The saved connections and groups could not be read from the app's API. Nothing was changed.</p>
            <button matButton="outlined" (click)="loadData()">
              <mat-icon>refresh</mat-icon>
              Retry
            </button>
          </div>
        </section>
      } @else if (isEmpty()) {
        <div class="empty-state">
          <mat-icon class="empty-icon" aria-hidden="true">power</mat-icon>
          <h2>No connections configured</h2>
          <p>Nothing is saved on this computer yet, so there is no broker to explore. Start with one connection:</p>
          <ol>
            <li>Add a connection to an Azure Service Bus namespace or to a RabbitMQ broker.</li>
            <li>Test it in the dialog before you save it.</li>
            <li>Connect. The entities of the broker open, and the toolbar shows which environment you are on.</li>
          </ol>
          <div class="empty-actions">
            <button matButton="filled" (click)="openAddDialog()">
              <mat-icon>add</mat-icon>
              Add Connection
            </button>
            <button matButton (click)="importConfiguration()">
              <mat-icon>upload</mat-icon>
              Import
            </button>
          </div>
          <p class="footnote">Import reads a file exported from this app on another computer: its connections, clients and environments.</p>
        </div>
      } @else {
        @if (connectError(); as failed) {
          <section class="connect-error" aria-label="Error" role="alert" data-testid="connect-error">
            <h2><mat-icon aria-hidden="true">warning</mat-icon>Could not connect to {{ failed.connection.name }}</h2>
            <p class="reason">{{ failed.reason }}</p>
            @if (failed.keeps) {
              <p>{{ failed.keeps }}</p>
            }
            <div class="error-actions">
              <button matButton="outlined" type="button" (click)="connect(failed.connection)" [disabled]="connecting()"><mat-icon aria-hidden="true">refresh</mat-icon>Retry</button>
              <button matButton type="button" (click)="editConnection(failed.connection)"><mat-icon aria-hidden="true">edit</mat-icon>Edit the connection</button>
            </div>
          </section>
        }
        <div class="connections-content">
          <table class="connections-table">
            <caption>Saved connections, grouped by client and environment</caption>
            <thead>
              <tr>
                <th scope="col">Connection</th>
                <th scope="col">Broker</th>
                <th scope="col">Target</th>
                <th scope="col">Environment</th>
                <th scope="col">Last used</th>
                <th scope="col" class="actions-col">Actions</th>
              </tr>
            </thead>
            @for (section of sections(); track section.key) {
              <tbody>
                <tr>
                  <th colspan="6" scope="rowgroup" class="group-header">{{ section.label }}</th>
                </tr>
                @for (connection of section.connections; track connection.id) {
                  <tr class="connection-card" [class.active]="connection.isConnected">
                    <td>
                      <div class="name-line">
                        <h3 class="connection-name">{{ connection.name }}</h3>
                        @if (connection.isConnected) {
                          <span class="badge connected-chip">
                            <mat-icon aria-hidden="true">check_circle</mat-icon>
                            Connected
                          </span>
                        }
                      </div>
                      <div class="auth-line">{{ getAuthLabel(connection) }}</div>
                    </td>
                    <td>{{ getProviderName(connection.providerType) }}</td>
                    <td class="target">{{ getConnectionTarget(connection) }}</td>
                    <td>
                      <app-environment-chip [name]="environmentOf(connection)?.name" [isProduction]="!!environmentOf(connection)?.isProduction" />
                    </td>
                    <td class="last-used muted">{{ connection.lastUsedAt ? (connection.lastUsedAt | date:'medium') : 'Never' }}</td>
                    <td class="actions-col">
                      <div class="row-actions">
                        @if (connection.isConnected) {
                          <a matButton="outlined" routerLink="/entities">Open entities</a>
                        } @else {
                          <button
                            matButton="filled"
                            [attr.aria-label]="'Connect to ' + connection.name"
                            (click)="connect(connection)"
                            [disabled]="connecting()">
                            <mat-icon>power</mat-icon>
                            Connect
                          </button>
                        }
                        <button
                          matIconButton
                          [attr.aria-label]="'Edit ' + connection.name"
                          [matTooltip]="'Edit ' + connection.name"
                          (click)="editConnection(connection)">
                          <mat-icon>edit</mat-icon>
                        </button>
                        <span class="divider" aria-hidden="true"></span>
                        <button
                          matButton
                          class="delete"
                          [attr.aria-label]="'Delete ' + connection.name"
                          (click)="delete(connection)">
                          <mat-icon>delete</mat-icon>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="muted none">{{ section.emptyText }}</td>
                  </tr>
                }
              </tbody>
            }
          </table>
        </div>
      }
    </div>
  `,
  styleUrl: './connections.component.scss'
})
export class ConnectionsComponent implements OnInit {
  private connectionService = inject(ConnectionService);
  private groupService = inject(ConnectionGroupService);
  readonly devSettingsService = inject(DevSettingsService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private appRef = inject(ApplicationRef);


  connections: WritableSignal<ServiceBusConnection[]> = signal<ServiceBusConnection[]>([]);
  groups: WritableSignal<ConnectionGroup[]> = signal<ConnectionGroup[]>([]);
  groupedTree: WritableSignal<ConnectionGroupTree[]> = signal<ConnectionGroupTree[]>([]);
  ungroupedConnections: WritableSignal<ServiceBusConnection[]> = signal<ServiceBusConnection[]>([]);
  loading: WritableSignal<boolean> = signal<boolean>(false);
  loadError = signal(false);
  connecting = signal(false);
  debugMode = signal(false);
  debugInfo = signal('');

  // Helper methods for template
  getConnectionTarget = getConnectionDisplayTarget;
  getProviderName = getProviderDisplayName;
  getProviderIcon = getProviderIcon;
  getAuthLabel = getConnectionAuthLabel;

  /** The last connect that failed, with what stayed as it was; cleared by the next connect. */
  readonly connectError = signal<{ connection: ServiceBusConnection; reason: string; keeps: string } | null>(null);

  readonly hasData = computed(() => this.groupedTree().length > 0 || this.ungroupedConnections().length > 0);
  readonly isEmpty = computed(() => !this.loading() && !this.loadError() && !this.hasData());

  readonly summary = computed(() => {
    const clients = this.groups().filter(g => g.type === 'client').length;
    const environments = this.groups().filter(g => g.type === 'environment').length;
    return `${plural(this.connections().length, 'connection', 'connections')}, ${plural(clients, 'client', 'clients')}, `
      + `${plural(environments, 'environment', 'environments')}. One connection is active at a time.`;
  });

  /** The client and environment tree flattened into the row groups of the table, ungrouped connections last. */
  readonly sections = computed<ConnectionSection[]>(() => {
    const sections: ConnectionSection[] = [];
    for (const client of this.groupedTree()) {
      for (const env of client.children) {
        sections.push({
          key: env.group.id,
          label: `${client.group.name}, ${env.group.name}`,
          connections: env.connections,
          emptyText: 'No connections in this environment'
        });
      }
      if (client.connections.length > 0 || client.children.length === 0) {
        sections.push({
          key: client.group.id,
          label: client.group.name,
          connections: client.connections,
          emptyText: 'No connections in this client'
        });
      }
    }
    if (this.ungroupedConnections().length > 0) {
      sections.push({ key: 'ungrouped', label: 'Ungrouped Connections', connections: this.ungroupedConnections(), emptyText: '' });
    }
    return sections;
  });

  /** The environment group a connection is placed in, if any. */
  environmentOf(connection: ServiceBusConnection): ConnectionGroup | undefined {
    return connection.environmentId ? this.groups().find(g => g.id === connection.environmentId) : undefined;
  }

  ngOnInit() {
    console.log('╔' + '═'.repeat(78) + '╗');
    console.log('║ ConnectionsComponent ngOnInit() - Component Initialized');
    console.log('╚' + '═'.repeat(78) + '╝');

    this.addDebugLog('Component initialized');

    // Add keyboard shortcut for debug mode (F9) — only when devMode is enabled
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F9' && this.devSettingsService.devMode()) {
        e.preventDefault();
        this.toggleDebugMode();
      }
    });

    this.loadData();
  }

  loadData() {
    console.log('[ConnectionsComponent] loadData() called');
    this.addDebugLog('loadData() started');

    // Reset signals to force UI update
    this.connections.set([]);
    this.groups.set([]);
    this.groupedTree.set([]);
    this.ungroupedConnections.set([]);
    this.loadError.set(false);
    this.loading.set(true);

    this.addDebugLog('Signals reset, loading set to true');

    // Force change detection
    this.cdr.detectChanges();

    forkJoin({
      connections: this.connectionService.getConnections(),
      groups: this.groupService.getGroups()
    }).pipe(
      finalize(() => {
        console.log('[ConnectionsComponent] loadData() finalized');
        this.loading.set(false);
        this.cdr.detectChanges();
        this.addDebugLog('Loading completed');
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: ({ connections, groups }) => {
        console.log(`[ConnectionsComponent] loadData() success - ${connections.length} connections, ${groups.length} groups`);
        console.log('[ConnectionsComponent] Connections:', connections);

        this.addDebugLog(`Received ${connections.length} connections, ${groups.length} groups from API`);

        if (connections.length > 0) {
          this.addDebugLog('Connection names: ' + connections.map(c => c.name).join(', '));
        } else {
          this.addDebugLog('WARNING: API returned ZERO connections!');
        }

        // Update signals
        this.connections.set([...connections]); // Create new array to trigger change
        this.groups.set([...groups]);

        this.addDebugLog('Signals updated with new data');

        // Build tree (with auto-expand)
        this.buildTree();

        // Force change detection and tick
        this.cdr.detectChanges();
        this.appRef.tick();

        this.addDebugLog('UI update and change detection completed');
        console.log('[ConnectionsComponent] UI update complete');

        if (this.debugMode()) {
          this.showDebugCounts('Load complete');
        }
      },
      error: (err) => {
        console.error('[ConnectionsComponent] loadData() error:', err);
        this.addDebugLog('ERROR loading data: ' + (err as any).message);
        this.loadError.set(true);
        this.snackBar.open('Failed to load data', 'Close', { duration: 3000 });
      }
    });
  }

  buildTree() {
    console.log('[buildTree] Building tree...');
    console.log('[buildTree] Input - connections:', this.connections().length, this.connections());
    console.log('[buildTree] Input - groups:', this.groups().length, this.groups());

    const tree = this.groupService.buildGroupTree(this.groups(), this.connections());
    const ungrouped = this.groupService.getUngroupedConnections(this.connections());

    console.log('[buildTree] Output - tree nodes:', tree.length, tree);
    console.log('[buildTree] Output - ungrouped:', ungrouped.length, ungrouped);

    this.groupedTree.set(tree);
    this.ungroupedConnections.set(ungrouped);

    console.log('[buildTree] Tree updated in signals');
  }

  openAddDialog() {
    const dialogRef = this.dialog.open(AddConnectionDialogComponent, {
      width: '780px',
      maxWidth: '95vw',
      data: { groups: this.groups() }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.loadData();
      }
    });
  }

  openManageGroupDialog() {
    const dialogRef = this.dialog.open(ManageGroupDialogComponent, {
      width: '680px',
      maxWidth: '95vw',
      data: { groups: this.groups(), connections: this.connections() }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.loadData();
      }
    });
  }

  editConnection(connection: ServiceBusConnection) {
    const dialogRef = this.dialog.open(AddConnectionDialogComponent, {
      width: '620px',
      maxWidth: '95vw',
      data: {
        connection,
        groups: this.groups()
      }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result) {
        this.loadData();
      }
    });
  }

  connect(connection: ServiceBusConnection) {
    const wasActive = this.connectionService.isConnected ? this.connectionService.currentNamespace : undefined;
    this.connectError.set(null);
    this.connecting.set(true);
    this.connectionService.connect(connection.id).pipe(
      finalize(() => this.connecting.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (status) => {
        // Update connection status in the UI
        connection.isConnected = true;
        // Mark all other connections as disconnected
        this.connections().forEach(conn => {
          if (conn.id !== connection.id) {
            conn.isConnected = false;
          }
        });

        this.snackBar.open(`Connected to ${status.namespace}`, 'Close', { duration: 3000 });
        // Navigate to entities view automatically after successful connection
        this.router.navigate(['/entities']);
      },
      error: (error: unknown) => {
        const reason = connectFailureSentence((error as HttpErrorResponse | undefined)?.error?.code, getConnectionDisplayTarget(connection));
        this.connectError.set({ connection, reason, keeps: '' });
        this.connectionService.connectionStatus$.pipe(skip(1), take(1), takeUntilDestroyed(this.destroyRef)).subscribe(status => {
          if (this.connectError()?.connection !== connection) return;
          const keeps = !status.connected
            ? 'No connection is active. Nothing was changed on the broker.'
            : status.namespace === wasActive
              ? `The connection that was active stays active: ${status.namespace}. Nothing was changed on either broker.`
              : `The active connection is now ${status.namespace}. Nothing was changed on either broker.`;
          this.connectError.set({ connection, reason, keeps });
        });
      }
    });
  }

  delete(connection: ServiceBusConnection) {
    const active = this.isActive(connection);
    const target = getConnectionDisplayTarget(connection);
    const secret = getConnectionSecretLabel(connection);
    const data: ConfirmDialogData = {
      title: 'Delete connection?',
      icon: 'warning',
      message: `This removes the saved connection from this computer${secret ? `, with its stored ${secret}` : ''}. `
        + 'Nothing on the broker is changed. It cannot be undone, except by adding the connection again.',
      notice: active
        ? `This is the active connection. The app disconnects from ${target} first, and the Entities and Monitoring screens go empty.`
        : undefined,
      facts: [
        { label: 'Connection', value: connection.name },
        { label: 'Broker', value: getProviderDisplayName(connection.providerType) },
        { label: 'Target', value: target },
        { label: 'Client and environment', value: this.groupLabel(connection) },
      ],
      confirmText: 'Delete connection',
      context: {
        subject: connection.name,
        where: `to ${target}`,
        mark: { name: this.environmentOf(connection)?.name ?? null, isProduction: !!this.environmentOf(connection)?.isProduction }
      },
    };
    this.dialog.open(ConfirmDialogComponent, { width: '560px', data }).afterClosed().pipe(
      switchMap(confirmed => {
        if (!confirmed) return EMPTY;
        const first: Observable<unknown> = active ? this.connectionService.disconnect() : of(null);
        return first.pipe(switchMap(() => this.connectionService.deleteConnection(connection.id)));
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        if (this.connectError()?.connection.id === connection.id) this.connectError.set(null);
        this.snackBar.open('Connection deleted', 'Close', { duration: 3000 });
        this.loadData();
      },
      error: () => {
        this.snackBar.open('The connection was not deleted: the local API answered with an error.', 'Close', { duration: 5000 });
      }
    });
  }

  /** The client and environment of a connection, as the delete confirmation of Connections.dc.html names it. */
  private groupLabel(connection: ServiceBusConnection): string {
    const section = this.sections().find(s => s.connections.includes(connection));
    return !section || section.key === 'ungrouped' ? 'Ungrouped, no environment' : section.label;
  }

  /** Active by what the service knows now: the id it connected, or the target the API reports. */
  private isActive(connection: ServiceBusConnection): boolean {
    const service = this.connectionService;
    return service.currentConnectionId === connection.id
      || (service.isConnected && service.currentNamespace === getConnectionDisplayTarget(connection));
  }

  exportConfiguration() {
    console.log('[ConnectionsComponent] exportConfiguration() called - opening confirmation dialog');

    const dialogRef = this.dialog.open<
      ExportConnectionsDialogComponent,
      unknown,
      ExportConnectionsDialogResult | undefined
    >(ExportConnectionsDialogComponent, {
      width: '560px',
      autoFocus: false,
      data: { connections: this.connections(), groups: this.groups() }
    });

    dialogRef.afterClosed().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((result) => {
      if (!result) {
        console.log('[ConnectionsComponent] Export cancelled by user');
        return;
      }
      this.runFullExport(result.includeSecrets);
    });
  }

  private runFullExport(includeSecrets: boolean) {
    console.log('[ConnectionsComponent] Running FULL export (connections + groups), includeSecrets=', includeSecrets);
    this.addDebugLog(`Starting FULL export (connections + groups) includeSecrets=${includeSecrets}`);

    this.connectionService.exportFullConfiguration(includeSecrets).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (data) => {
        // HttpClient returns parsed object, convert back to formatted JSON string
        const jsonString = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        const config = typeof data === 'string' ? JSON.parse(data) : data;

        console.log('[ConnectionsComponent] Export successful:', {
          connections: config.connections?.length || 0,
          groups: config.groups?.length || 0,
          includeSecrets
        });
        this.addDebugLog(`Exported: ${config.connections?.length || 0} connections, ${config.groups?.length || 0} groups`);

        // Create a downloadable file
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `servicebus-full-config-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        window.URL.revokeObjectURL(url);

        if (includeSecrets) {
          this.snackBar.open(
            'Export saved. File contains plaintext credentials — store securely.',
            'Close',
            { duration: 6000 }
          );
        } else {
          this.snackBar.open(
            'Full configuration exported successfully (connections + groups, secrets masked)',
            'Close',
            { duration: 3000 }
          );
        }
      },
      error: (err) => {
        console.error('[ConnectionsComponent] Export failed:', err);
        this.addDebugLog('Export failed: ' + (err as any).message);
        this.snackBar.open('Failed to export configuration', 'Close', { duration: 3000 });
      }
    });
  }

  importConfiguration() {
    console.log('[ConnectionsComponent] importConfiguration() called');
    // Create file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (event: any) => {
      const file = event.target.files[0];
      if (!file) {
        console.log('[ConnectionsComponent] No file selected');
        return;
      }

      console.log('[ConnectionsComponent] File selected:', file.name, 'size:', file.size);
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const jsonData = e.target.result;
        console.log('[ConnectionsComponent] File read, data length:', jsonData?.length);

        this.openImportDialog({ fileName: file.name, json: jsonData });
      };
      reader.readAsText(file);
    };

    input.click();
  }

  /** Shows the API's preview of a read file; the dialog imports it, and a completed import reloads the list. */
  openImportDialog(data: ImportConnectionsDialogData) {
    this.dialog.open(ImportConnectionsDialogComponent, { width: '760px', maxWidth: '95vw', data })
      .afterClosed().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(message => {
        if (message) {
          this.snackBar.open(message, 'Close', { duration: 3000 });
          this.loadData();
        }
      });
  }

  toggleDebugMode() {
    this.debugMode.update(v => !v);
    const mode = this.debugMode() ? 'ENABLED' : 'DISABLED';
    console.log(`[DEBUG MODE] ${mode}`);
    this.addDebugLog(`Debug mode ${mode}`);
    if (this.debugMode()) {
      this.refreshDebugInfo();
    }
  }

  addDebugLog(message: string) {
    const timestamp = new Date().toISOString().split('T')[1].substring(0, 12);
    const log = `[${timestamp}] ${message}\n`;
    this.debugInfo.update(v => log + v);
  }

  refreshDebugInfo() {
    this.addDebugLog('=== DEBUG INFO REFRESHED ===');
    this.addDebugLog(`Connections: ${this.connections().length}`);
    this.addDebugLog(`Groups: ${this.groups().length}`);
    this.addDebugLog(`Grouped tree: ${this.groupedTree().length}`);
    this.addDebugLog(`Ungrouped: ${this.ungroupedConnections().length}`);

    if (this.connections().length > 0) {
      this.addDebugLog('Connection names: ' + this.connections().map(c => c.name).join(', '));
    }
  }

  forceReload() {
    console.log('[DEBUG] Force reload requested');
    this.addDebugLog('FORCE RELOAD initiated by user');
    this.showDebugCounts('Before reload');

    this.loadData();

    setTimeout(() => {
      this.showDebugCounts('After reload');
      this.addDebugLog('Force reload completed');
    }, 2000);
  }

  /** Shows the connection and group counts in the snack bar, for the debug panel. */
  private showDebugCounts(label: string) {
    const message = `${label}: ${plural(this.connections().length, 'connection', 'connections')}, ${plural(this.groups().length, 'group', 'groups')}`;
    this.snackBar.open(message, 'Close', { duration: 5000 });
  }
}
