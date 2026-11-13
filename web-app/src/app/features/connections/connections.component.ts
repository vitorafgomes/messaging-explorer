import {Component, OnInit, inject, WritableSignal, signal, computed, DestroyRef, ChangeDetectorRef, ApplicationRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {MatDialogModule, MatDialog} from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConnectionService, ConnectionGroupService, DevSettingsService } from '../../core/services';
import { ServiceBusConnection, ConnectionGroup, ConnectionGroupTree, getConnectionDisplayTarget, getProviderDisplayName, getProviderIcon } from '../../core/models';
import { AddConnectionDialogComponent } from './add-connection-dialog.component';
import { finalize, forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ManageGroupDialogComponent } from './manage-group-dialog.component';
import { ExportConnectionsDialogComponent, ExportConnectionsDialogResult } from './export-connections-dialog.component';

interface ConnectionSection {
  key: string;
  label: string;
  connections: ServiceBusConnection[];
  emptyText: string;
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
    MatTooltipModule
  ],
  template: `
    <div class="connections-container">
      <div class="header">
        <div class="title">
          <h2>Connections</h2>
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
        <div class="alert alert-warning debug-panel mb-4">
          <h5 class="alert-heading">
            <i class="fa fa-bug me-2"></i>
            DEBUG MODE
            <button class="btn btn-sm btn-danger float-end ms-2" (click)="clearAllData()">
              <i class="fa fa-trash me-1"></i>
              Clean All
            </button>
            <button class="btn btn-sm btn-warning float-end" (click)="refreshDebugInfo()">
              <i class="fa-solid fa-arrows-rotate me-1"></i>
              Refresh
            </button>
            <button class="btn btn-sm btn-success float-end me-2" (click)="forceReload()">
              <i class="fa-solid fa-arrows-rotate me-1"></i>
              Force Reload
            </button>
          </h5>
          <hr>
          <div class="row">
            <div class="col-md-6">
              <h6>📊 Current State:</h6>
              <ul class="small mb-2">
                <li><strong>Connections:</strong> {{ connections().length }}</li>
                <li><strong>Groups:</strong> {{ groups().length }}</li>
                <li><strong>Grouped Tree Nodes:</strong> {{ groupedTree().length }}</li>
                <li><strong>Ungrouped Connections:</strong> {{ ungroupedConnections().length }}</li>
                <li><strong>Loading:</strong> {{ loading() ? 'YES' : 'NO' }}</li>
              </ul>
            </div>
            <div class="col-md-6">
              <h6>🔍 Connections Details:</h6>
              <pre class="small mb-0" style="max-height: 200px; overflow-y: auto; background: rgba(0,0,0,0.05); padding: 8px; border-radius: 4px;">{{ connections() | json }}</pre>
            </div>
          </div>
          <div class="mt-2">
            <h6>📝 Debug Log:</h6>
            <pre class="small mb-0" style="max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.05); padding: 8px; border-radius: 4px;">{{ debugInfo() }}</pre>
          </div>
        </div>
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
          <h3>No connections configured</h3>
          <p>Nothing is saved on this computer yet, so there is no broker to explore. Start with one connection:</p>
          <ol>
            <li>Add a connection to an Azure Service Bus namespace or to a RabbitMQ broker.</li>
            <li>Test it in the dialog before you save it.</li>
            <li>Connect. The entities of the broker open, and the toolbar shows which broker you are on.</li>
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
        <div class="connections-content">
          <table class="connections-table">
            <caption>Saved connections, grouped by client and environment</caption>
            <thead>
              <tr>
                <th scope="col">Connection</th>
                <th scope="col">Broker</th>
                <th scope="col">Target</th>
                <th scope="col" class="actions-col">Actions</th>
              </tr>
            </thead>
            @for (section of sections(); track section.key) {
              <tbody>
                <tr>
                  <th colspan="4" scope="rowgroup" class="group-header">{{ section.label }}</th>
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
                    </td>
                    <td>{{ getProviderName(connection.providerType) }}</td>
                    <td class="target">{{ getConnectionTarget(connection) }}</td>
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
                    <td colspan="4" class="muted none">{{ section.emptyText }}</td>
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
    this.addDebugLog('🔄 loadData() started');

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

        this.addDebugLog(`✅ Received ${connections.length} connections, ${groups.length} groups from API`);

        if (connections.length > 0) {
          this.addDebugLog('Connection names: ' + connections.map(c => c.name).join(', '));
        } else {
          this.addDebugLog('⚠️ WARNING: API returned ZERO connections!');
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

        // Show alert with results (useful for debugging)
        if (this.debugMode()) {
          const msg = `✅ LOAD COMPLETE\n\nConnections: ${connections.length}\nGroups: ${groups.length}\n\nNames:\n${connections.map(c => '- ' + c.name).join('\n')}`;
          alert(msg);
        }
      },
      error: (err) => {
        console.error('[ConnectionsComponent] loadData() error:', err);
        this.addDebugLog('❌ ERROR loading data: ' + (err as any).message);
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

  editConnection(connection: ServiceBusConnection) {
    const dialogRef = this.dialog.open(AddConnectionDialogComponent, {
      width: '620px',
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
      error: () => {
        this.snackBar.open('Failed to connect', 'Close', { duration: 3000 });
      }
    });
  }

  delete(connection: ServiceBusConnection) {
    if (confirm(`Are you sure you want to delete "${connection.name}"?`)) {
      this.connectionService.deleteConnection(connection.id).pipe(
        takeUntilDestroyed(this.destroyRef)
      ).subscribe({
        next: () => {
          this.snackBar.open('Connection deleted', 'Close', { duration: 3000 });
          this.loadData();
        },
        error: () => {
          this.snackBar.open('Failed to delete connection', 'Close', { duration: 3000 });
        }
      });
    }
  }

  exportConfiguration() {
    console.log('[ConnectionsComponent] exportConfiguration() called - opening confirmation dialog');

    const dialogRef = this.dialog.open<
      ExportConnectionsDialogComponent,
      unknown,
      ExportConnectionsDialogResult | undefined
    >(ExportConnectionsDialogComponent, {
      width: '560px',
      autoFocus: false
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
    this.addDebugLog(`📤 Starting FULL export (connections + groups) includeSecrets=${includeSecrets}`);

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
        this.addDebugLog(`✅ Exported: ${config.connections?.length || 0} connections, ${config.groups?.length || 0} groups`);

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
        this.addDebugLog('❌ Export failed: ' + (err as any).message);
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

        if (confirm('This will import connections AND groups from the selected file. Existing items with the same ID will be updated. Continue?')) {
          console.log('[ConnectionsComponent] User confirmed import - using FULL import (connections + groups)');
          this.addDebugLog('📥 Starting FULL import (connections + groups)');
          this.connectionService.importFullConfiguration(jsonData).pipe(
            takeUntilDestroyed(this.destroyRef)
          ).subscribe({
            next: (result) => {
              console.log('='.repeat(80));
              console.log('[IMPORT] ✅ SUCCESS!');
              console.log('[IMPORT] Response:', result);
              console.log('[IMPORT] Reloading data directly (no navigation)...');
              console.log('='.repeat(80));

              this.addDebugLog('📥 IMPORT SUCCESS: ' + result.message);

              this.snackBar.open(result.message, 'Close', { duration: 3000 });

              // Wait a bit for backend to finish saving, then reload
              setTimeout(() => {
                console.log('[IMPORT] Calling loadData() now...');
                this.addDebugLog('Waiting 500ms before reload...');
                setTimeout(() => {
                  this.addDebugLog('Now calling loadData() after import');
                  this.loadData();
                }, 500);
              }, 100);
            },
            error: (err) => {
              console.error('='.repeat(80));
              console.error('[IMPORT] ❌ ERROR!');
              console.error('[IMPORT] Error:', err);
              console.error('='.repeat(80));
              this.snackBar.open(err.error?.message || 'Failed to import configuration', 'Close', { duration: 5000 });
            }
          });
        } else {
          console.log('[ConnectionsComponent] User cancelled import');
        }
      };
      reader.readAsText(file);
    };

    input.click();
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
    this.addDebugLog('🔄 FORCE RELOAD initiated by user');

    // Show alert with current state BEFORE reload
    const beforeMsg = `BEFORE RELOAD:\n\nConnections: ${this.connections().length}\nGroups: ${this.groups().length}`;
    alert(beforeMsg);

    this.loadData();

    // Show alert with state AFTER reload (with delay)
    setTimeout(() => {
      const afterMsg = `AFTER RELOAD:\n\nConnections: ${this.connections().length}\nGroups: ${this.groups().length}\n\nConnections:\n${this.connections().map(c => '- ' + c.name).join('\n')}`;
      alert(afterMsg);
      this.addDebugLog('✅ Force reload completed');
    }, 2000);
  }

  clearAllData() {
    console.log('[ConnectionsComponent] clearAllData() called');
    this.addDebugLog('🗑️ Clear All Data requested');

    const currentConnections = this.connections().length;
    const currentGroups = this.groups().length;

    if (currentConnections === 0 && currentGroups === 0) {
      this.snackBar.open('No data to clear', 'Close', { duration: 3000 });
      this.addDebugLog('⚠️ No data to clear');
      return;
    }

    const confirmMsg = `⚠️ WARNING: This will delete ALL data!\n\nCurrent data:\n- ${currentConnections} connections\n- ${currentGroups} groups\n\nThis action CANNOT be undone!\n\nContinue?`;

    if (!confirm(confirmMsg)) {
      console.log('[ConnectionsComponent] User cancelled clear all');
      this.addDebugLog('Clear all cancelled by user');
      return;
    }

    console.log('[ConnectionsComponent] User confirmed clear all - proceeding...');
    this.addDebugLog('User confirmed - clearing all data...');

    this.loading.set(true);

    this.connectionService.clearAllData().pipe(
      finalize(() => this.loading.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        console.log('[ConnectionsComponent] Clear all successful:', result);
        this.addDebugLog(`✅ Cleared: ${result.connectionsDeleted} connections, ${result.groupsDeleted} groups`);

        this.snackBar.open(result.message, 'Close', { duration: 5000 });

        // Reload data to show empty state
        setTimeout(() => {
          console.log('[ConnectionsComponent] Reloading after clear...');
          this.loadData();
        }, 500);

        // Show success alert if debug mode
        if (this.debugMode()) {
          setTimeout(() => {
            alert(`✅ ALL DATA CLEARED!\n\nDeleted:\n- ${result.connectionsDeleted} connections\n- ${result.groupsDeleted} groups`);
          }, 1000);
        }
      },
      error: (err) => {
        console.error('[ConnectionsComponent] Clear all failed:', err);
        this.addDebugLog('❌ Clear all failed: ' + (err as any).message);
        this.snackBar.open('Failed to clear data', 'Close', { duration: 5000 });
      }
    });
  }
}
