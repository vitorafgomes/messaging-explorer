import {Component, OnInit, inject, WritableSignal, signal, DestroyRef, ChangeDetectorRef, ApplicationRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {MatDialogModule, MatDialog} from '@angular/material/dialog';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTreeModule } from '@angular/material/tree';
import { MatMenuModule } from '@angular/material/menu';
import { ConnectionService, ConnectionGroupService, DevSettingsService } from '../../core/services';
import { ServiceBusConnection, ConnectionGroup, ConnectionGroupTree, getConnectionDisplayTarget, getProviderDisplayName, getProviderIcon } from '../../core/models';
import { AddConnectionDialogComponent } from './add-connection-dialog.component';
import { finalize, forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ManageGroupDialogComponent } from './manage-group-dialog.component';
import { ExportConnectionsDialogComponent, ExportConnectionsDialogResult } from './export-connections-dialog.component';

@Component({
  selector: 'app-connections',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDialogModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTreeModule,
    MatMenuModule
  ],
  template: `
    <div class="connections-container">
      <div class="header d-flex justify-content-between align-items-center mb-4">
        <h2 class="mb-0">Connections</h2>
        <div class="d-flex gap-2">
          @if (devSettingsService.devMode()) {
            <button
              class="btn btn-outline-warning"
              (click)="toggleDebugMode()"
              title="Toggle Debug Mode (F9)">
              <i class="fa fa-bug me-2"></i>
              {{ debugMode() ? 'Hide Debug' : 'Debug' }}
            </button>
          }
          <button class="btn btn-outline-secondary" (click)="importConfiguration()">
            <i class="fa fa-upload me-2"></i>
            Import
          </button>
          <button class="btn btn-outline-secondary" (click)="exportConfiguration()">
            <i class="fa fa-download me-2"></i>
            Export
          </button>
          <button class="btn btn-secondary" (click)="openManageGroupDialog()">
            <i class="fa fa-folder me-2"></i>
            Manage Groups
          </button>
          <button class="btn btn-primary" (click)="openAddDialog()">
            <i class="fa fa-plus me-2"></i>
            Add Connection
          </button>
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
        <div class="text-center py-5">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
        </div>
      } @else {
        <div class="connections-content">
          <!-- Grouped Connections -->
          @if (groupedTree().length > 0) {
            <div class="grouped-section">
              <h3 class="text-muted mb-3">Organized Connections</h3>
              @for (clientNode of groupedTree(); track clientNode.group.id) {
                <div class="card group-card client-card mb-3">
                  <div class="card-header cursor-pointer user-select-none" (click)="toggleNode(clientNode)">
                    <div class="d-flex align-items-center">
                      <i class="fa fa-building text-primary fa-2x me-3"></i>
                      <div class="flex-grow-1">
                        <h5 class="mb-0 d-flex align-items-center">
                          <i class="fa me-2" [class.fa-chevron-down]="clientNode.expanded" [class.fa-chevron-right]="!clientNode.expanded"></i>
                          {{ clientNode.group.name }}
                        </h5>
                        @if (clientNode.group.description) {
                          <p class="text-muted mb-0 small">{{ clientNode.group.description }}</p>
                        }
                      </div>
                    </div>
                  </div>

                  @if (clientNode.expanded) {
                    <div class="card-body">
                      <!-- Environments -->
                      @for (envNode of clientNode.children; track envNode.group.id) {
                        <div class="card group-card environment-card ms-4 mb-2">
                          <div class="card-header cursor-pointer user-select-none" (click)="toggleNode(envNode)">
                            <div class="d-flex align-items-center">
                              <i class="fa fa-server text-success fa-lg me-3"></i>
                              <div class="flex-grow-1">
                                <h6 class="mb-0 d-flex align-items-center">
                                  <i class="fa me-2" [class.fa-chevron-down]="envNode.expanded" [class.fa-chevron-right]="!envNode.expanded"></i>
                                  {{ envNode.group.name }}
                                </h6>
                                @if (envNode.group.description) {
                                  <p class="text-muted mb-0 small">{{ envNode.group.description }}</p>
                                }
                              </div>
                            </div>
                          </div>

                          @if (envNode.expanded) {
                            <div class="card-body">
                              @if (envNode.connections.length > 0) {
                                @for (connection of envNode.connections; track connection.id) {
                                  <div class="card connection-card ms-5 mb-2">
                                    <div class="card-body">
                                      <div class="d-flex align-items-center justify-content-between">
                                        <div class="d-flex align-items-center">
                                          <i class="fa fa-{{ getProviderIcon(connection.providerType) }} text-warning fa-lg me-3"></i>
                                          <div>
                                            <h6 class="mb-0">{{ connection.name }}</h6>
                                            <small class="text-muted d-block">{{ getProviderName(connection.providerType) }}</small>
                                            <small class="text-muted">{{ getConnectionTarget(connection) }}</small>
                                          </div>
                                        </div>
                                        <div class="d-flex align-items-center gap-2">
                                          @if (connection.isConnected) {
                                            <span class="badge bg-success pulse-badge">
                                              <i class="fa fa-circle-dot me-1"></i>
                                              Connected
                                            </span>
                                          }
                                          <div class="btn-group">
                                            <button
                                              [class]="connection.isConnected ? 'btn btn-sm btn-success' : 'btn btn-sm btn-primary'"
                                              (click)="connect(connection)"
                                              [disabled]="connecting() || connection.isConnected">
                                              <i [class]="connection.isConnected ? 'fa fa-check me-1' : 'fa fa-plug me-1'"></i>
                                              {{ connection.isConnected ? 'Connected' : 'Connect' }}
                                            </button>
                                            <button class="btn btn-sm btn-outline-secondary" (click)="editConnection(connection)">
                                              <i class="fa fa-edit"></i>
                                            </button>
                                            <button class="btn btn-sm btn-outline-danger" (click)="delete(connection)">
                                              <i class="fa fa-trash"></i>
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                }
                              } @else {
                                <p class="text-muted text-center fst-italic py-3">No connections in this environment</p>
                              }
                            </div>
                          }
                        </div>
                      }

                      <!-- Connections directly under client (no environment) -->
                      @if (clientNode.connections.length > 0) {
                        @for (connection of clientNode.connections; track connection.id) {
                          <div class="card connection-card ms-5 mb-2">
                            <div class="card-body">
                              <div class="d-flex align-items-center justify-content-between">
                                <div class="d-flex align-items-center">
                                  <i class="fa fa-{{ getProviderIcon(connection.providerType) }} text-warning fa-lg me-3"></i>
                                  <div>
                                    <h6 class="mb-0">{{ connection.name }}</h6>
                                    <small class="text-muted d-block">{{ getProviderName(connection.providerType) }}</small>
                                    <small class="text-muted">{{ getConnectionTarget(connection) }}</small>
                                  </div>
                                </div>
                                <div class="d-flex align-items-center gap-2">
                                  @if (connection.isConnected) {
                                    <span class="badge bg-success pulse-badge">
                                      <i class="fa fa-circle-dot me-1"></i>
                                      Connected
                                    </span>
                                  }
                                  <div class="btn-group">
                                    <button
                                      [class]="connection.isConnected ? 'btn btn-sm btn-success' : 'btn btn-sm btn-primary'"
                                      (click)="connect(connection)"
                                      [disabled]="connecting() || connection.isConnected">
                                      <i [class]="connection.isConnected ? 'fa fa-check me-1' : 'fa fa-plug me-1'"></i>
                                      {{ connection.isConnected ? 'Connected' : 'Connect' }}
                                    </button>
                                    <button class="btn btn-sm btn-outline-secondary" (click)="editConnection(connection)">
                                      <i class="fa fa-edit"></i>
                                    </button>
                                    <button class="btn btn-sm btn-outline-danger" (click)="delete(connection)">
                                      <i class="fa fa-trash"></i>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        }
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }

          <!-- Ungrouped Connections -->
          @if (ungroupedConnections().length > 0) {
            <div class="ungrouped-section">
              <h3 class="text-muted mb-3">Ungrouped Connections</h3>
              @for (connection of ungroupedConnections(); track connection.id) {
                <div class="card connection-card mb-2">
                  <div class="card-body">
                    <div class="d-flex align-items-center justify-content-between">
                      <div class="d-flex align-items-center">
                        <i class="fa fa-{{ getProviderIcon(connection.providerType) }} text-warning fa-lg me-3"></i>
                        <div>
                          <h6 class="mb-0">{{ connection.name }}</h6>
                          <small class="text-muted d-block">{{ getProviderName(connection.providerType) }}</small>
                          <small class="text-muted">{{ getConnectionTarget(connection) }}</small>
                        </div>
                      </div>
                      <div class="d-flex align-items-center gap-2">
                        @if (connection.isConnected) {
                          <span class="badge bg-success pulse-badge">
                            <i class="fa fa-circle-dot me-1"></i>
                            Connected
                          </span>
                        }
                        <div class="btn-group">
                          <button
                            [class]="connection.isConnected ? 'btn btn-sm btn-success' : 'btn btn-sm btn-primary'"
                            (click)="connect(connection)"
                            [disabled]="connecting() || connection.isConnected">
                            <i [class]="connection.isConnected ? 'fa fa-check me-1' : 'fa fa-plug me-1'"></i>
                            {{ connection.isConnected ? 'Connected' : 'Connect' }}
                          </button>
                          <button class="btn btn-sm btn-outline-secondary" (click)="editConnection(connection)">
                            <i class="fa fa-edit"></i>
                          </button>
                          <button class="btn btn-sm btn-outline-danger" (click)="delete(connection)">
                            <i class="fa fa-trash"></i>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>
          }

          @if (groupedTree().length === 0 && ungroupedConnections().length === 0) {
            <div class="card empty-state text-center py-5">
              <div class="card-body">
                <i class="fa fa-link-slash fa-4x text-secondary mb-3"></i>
                <p class="mb-1">No connections configured</p>
                <p class="text-muted small">Click "Add Connection" to get started</p>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .connections-container {
      max-width: 1000px;
      margin: 0 auto;
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 12px;
    }

    .connections-content {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .cursor-pointer {
      cursor: pointer;
    }

    .user-select-none {
      user-select: none;
    }

    .border-dashed {
      border-style: dashed !important;
    }

    .client-card {
      border-left: 4px solid var(--bs-primary);
    }

    .environment-card {
      border-left: 4px solid var(--bs-success);
    }

    .card-header:hover {
      background-color: rgba(0, 0, 0, 0.02);
    }

    .pulse-badge {
      animation: pulse 2s ease-in-out infinite;
      position: relative;
      display: inline-flex;
      align-items: center;
      padding: 0.35em 0.65em;
      font-weight: 600;
    }

    .pulse-badge i {
      animation: pulse-dot 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% {
        box-shadow: 0 0 0 0 rgba(25, 135, 84, 0.4);
      }
      50% {
        box-shadow: 0 0 0 5px rgba(25, 135, 84, 0);
      }
    }

    @keyframes pulse-dot {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.5;
      }
    }
  `]
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
  connecting = signal(false);
  debugMode = signal(false);
  debugInfo = signal('');

  // Helper methods for template
  getConnectionTarget = getConnectionDisplayTarget;
  getProviderName = getProviderDisplayName;
  getProviderIcon = getProviderIcon;

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

    // Listen for IPC messages from Electron — only execute when devMode is enabled
    if ((window as any).electron) {
      (window as any).electron.on('clear-all-data', () => {
        if (!this.devSettingsService.devMode()) return;
        console.log('[IPC] Received clear-all-data message from Electron menu');
        this.clearAllData();
      });
    }

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

    // Expand all nodes to show connections
    tree.forEach(clientNode => {
      clientNode.expanded = true; // Expand client
      clientNode.children.forEach(envNode => {
        envNode.expanded = true; // Expand all environments
      });
    });

    console.log('[buildTree] All nodes expanded automatically');

    this.groupedTree.set(tree);
    this.ungroupedConnections.set(ungrouped);

    console.log('[buildTree] Tree updated in signals');
  }

  toggleNode(node: ConnectionGroupTree) {
    node.expanded = !node.expanded;
    this.groupedTree.set([...this.groupedTree()]);
  }

  openAddDialog() {
    const dialogRef = this.dialog.open(AddConnectionDialogComponent, {
      width: '600px',
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
      width: '700px',
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
      width: '600px',
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
      width: '520px',
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
