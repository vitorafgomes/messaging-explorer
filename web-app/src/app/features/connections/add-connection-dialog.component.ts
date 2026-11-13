import { Component, inject, Inject, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { ConnectionService } from '../../core/services';
import { ConnectionGroup, ServiceBusConnection, ProviderType, getProviderDisplayName, AzureAuthType } from '../../core/models';

/**
 * Azure authentication options rendered in the dialog. The order defines the
 * dropdown display order; the first entry is the default for new connections.
 */
interface AzureAuthOption {
  value: AzureAuthType;
  label: string;
  badge?: string;
  advanced?: boolean;
}

interface AddConnectionDialogData {
  groups: ConnectionGroup[];
  connection?: ServiceBusConnection;
}

@Component({
  selector: 'app-add-connection-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatIconModule
  ],
  template: `
    <h2 mat-dialog-title>{{ isEditing ? 'Edit' : 'Add' }} Connection</h2>

    <mat-dialog-content>
      @if (!isEditing) {
        <p class="intro">New connection, saved on this computer. Nothing is created on the broker.</p>
      }

      <div class="grid two">
        <mat-form-field appearance="outline">
          <mat-label>Connection Name</mat-label>
          <input matInput [(ngModel)]="name" placeholder="My Connection">
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Provider Type</mat-label>
          <mat-select [(ngModel)]="providerType" (selectionChange)="onProviderTypeChange()">
            @for (provider of providerOptions; track provider.value) {
              <mat-option [value]="provider.value">
                <mat-icon class="provider-icon">{{ provider.icon }}</mat-icon>
                {{ provider.label }}
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      @if (providerType === ProviderType.AzureServiceBus) {
        <div class="provider-section">
          <mat-form-field appearance="outline">
            <mat-label>Authentication</mat-label>
            <mat-select [(ngModel)]="azureAuthType" (selectionChange)="onAzureAuthTypeChange()">
              @for (opt of azureAuthOptions; track opt.value) {
                <mat-option [value]="opt.value">
                  {{ opt.label }}
                  @if (opt.badge) { <span class="auth-note">({{ opt.badge }})</span> }
                  @if (opt.advanced) { <span class="auth-note">(advanced)</span> }
                </mat-option>
              }
            </mat-select>
            <mat-hint>Choose how to authenticate against Azure Service Bus</mat-hint>
          </mat-form-field>

          @if (azureAuthType === 'InteractiveBrowser') {
            <mat-form-field appearance="outline">
              <mat-label>Fully Qualified Namespace</mat-label>
              <input matInput [(ngModel)]="fullyQualifiedNamespace"
                placeholder="mynamespace.servicebus.windows.net">
              <mat-hint>Your Service Bus namespace host (without https://)</mat-hint>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Tenant ID (optional)</mat-label>
              <input matInput [(ngModel)]="tenantId" placeholder="00000000-0000-0000-0000-000000000000">
              <mat-hint>Leave empty to use the user's home tenant</mat-hint>
            </mat-form-field>
            <div class="sign-in">
              <button matButton="tonal"
                (click)="signInWithMicrosoft()"
                [disabled]="signingIn() || !fullyQualifiedNamespace">
                @if (signingIn()) {
                  <mat-progress-spinner diameter="18" mode="indeterminate"></mat-progress-spinner>
                }
                Sign in with Microsoft
              </button>
              <span class="hint">
                @if (signingIn()) {
                  Opening browser &mdash; complete sign-in in your browser window.
                } @else {
                  Opens your browser. Enter the namespace first.
                }
              </span>
            </div>
          }

          @if (azureAuthType === 'ConnectionString') {
            <mat-form-field appearance="outline">
              <mat-label>Connection String</mat-label>
              <textarea matInput [(ngModel)]="connectionString" rows="4"
                placeholder="Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=..."></textarea>
              <mat-hint>Azure Service Bus connection string with Manage permissions</mat-hint>
            </mat-form-field>
          }

          @if (azureAuthType === 'ServicePrincipal') {
            <mat-form-field appearance="outline">
              <mat-label>Fully Qualified Namespace</mat-label>
              <input matInput [(ngModel)]="fullyQualifiedNamespace"
                placeholder="mynamespace.servicebus.windows.net">
            </mat-form-field>
            <div class="grid two">
              <mat-form-field appearance="outline">
                <mat-label>Tenant ID</mat-label>
                <input matInput [(ngModel)]="tenantId" placeholder="00000000-0000-0000-0000-000000000000">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Client ID</mat-label>
                <input matInput [(ngModel)]="servicePrincipalClientId"
                  placeholder="App registration client ID">
              </mat-form-field>
            </div>
            <mat-form-field appearance="outline">
              <mat-label>Client Secret</mat-label>
              <input matInput type="password" [(ngModel)]="clientSecret">
              <mat-hint>Stored in the secure secret store on save</mat-hint>
            </mat-form-field>
          }

          @if (azureAuthType === 'AzureCli') {
            <mat-form-field appearance="outline">
              <mat-label>Fully Qualified Namespace</mat-label>
              <input matInput [(ngModel)]="fullyQualifiedNamespace"
                placeholder="mynamespace.servicebus.windows.net">
              <mat-hint>Uses your current "az login" session</mat-hint>
            </mat-form-field>
          }
        </div>
      }

      @if (providerType === ProviderType.RabbitMQ) {
        <div class="grid four">
          <mat-form-field appearance="outline" class="span-3">
            <mat-label>Host Name</mat-label>
            <input matInput [(ngModel)]="hostName" placeholder="localhost">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Port</mat-label>
            <input matInput type="number" [(ngModel)]="port" placeholder="5672">
          </mat-form-field>
          <mat-form-field appearance="outline" class="span-2">
            <mat-label>Username</mat-label>
            <input matInput [(ngModel)]="userName" placeholder="guest">
          </mat-form-field>
          <mat-form-field appearance="outline" class="span-2">
            <mat-label>Password</mat-label>
            <input matInput type="password" [(ngModel)]="password" placeholder="guest">
          </mat-form-field>
          <mat-form-field appearance="outline" class="span-2">
            <mat-label>Virtual Host</mat-label>
            <input matInput [(ngModel)]="virtualHost" placeholder="/">
          </mat-form-field>
          <mat-form-field appearance="outline" class="span-2">
            <mat-label>Management Port</mat-label>
            <input matInput type="number" [(ngModel)]="managementPort" placeholder="15672">
            <mat-hint>HTTP API port</mat-hint>
          </mat-form-field>
        </div>
      }

      <div class="grouping-section">
        <h3>Organization (Optional)</h3>
        <p class="hint">Organize this connection by client and environment</p>

        <div class="grid two">
          <mat-form-field appearance="outline">
            <mat-label>Client</mat-label>
            <mat-select [(ngModel)]="clientId" (selectionChange)="onClientChange()">
              <mat-option [value]="null">No client</mat-option>
              @for (client of clients(); track client.id) {
                <mat-option [value]="client.id">{{ client.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          @if (clientId) {
            <mat-form-field appearance="outline">
              <mat-label>Environment</mat-label>
              <mat-select [(ngModel)]="environmentId">
                <mat-option [value]="null">No environment</mat-option>
                @for (env of availableEnvironments(); track env.id) {
                  <mat-option [value]="env.id">{{ env.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }
        </div>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Cancel</button>
      <button matButton="outlined" (click)="testConnection()" [disabled]="testing() || !isFormValid()">
        @if (testing()) {
          <mat-progress-spinner diameter="18" mode="indeterminate"></mat-progress-spinner>
        } @else {
          <mat-icon>power</mat-icon>
        }
        Test
      </button>
      <button matButton="filled" (click)="save()" [disabled]="saving() || !name || !isFormValid()">
        @if (saving()) {
          <mat-progress-spinner diameter="18" mode="indeterminate"></mat-progress-spinner>
        }
        {{ isEditing ? 'Update' : 'Save' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .intro,
    .hint {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
    }

    .intro {
      margin-bottom: 12px;
    }

    .hint {
      font: var(--mat-sys-body-small);
    }

    .grid {
      display: grid;
      gap: 0 12px;

      &.two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      &.four {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .span-2 {
        grid-column: span 2;
      }

      .span-3 {
        grid-column: span 3;
      }
    }

    .provider-section {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .provider-icon {
      margin-right: 8px;
      vertical-align: middle;
    }

    .auth-note {
      margin-left: 6px;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .sign-in {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
    }

    .grouping-section {
      margin-top: 8px;

      h3 {
        margin: 0;
        font: var(--mat-sys-title-small);
      }

      .hint {
        margin-bottom: 12px;
      }
    }
  `]
})
export class AddConnectionDialogComponent {
  private connectionService = inject(ConnectionService);
  private dialogRef = inject(MatDialogRef<AddConnectionDialogComponent>);
  private snackBar = inject(MatSnackBar);

  // Expose ProviderType enum to template
  readonly ProviderType = ProviderType;

  // Provider selection options
  readonly providerOptions = [
    { value: ProviderType.AzureServiceBus, label: 'Azure Service Bus', icon: 'cloud' },
    { value: ProviderType.RabbitMQ, label: 'RabbitMQ', icon: 'dns' }
  ];

  clients: WritableSignal<ConnectionGroup[]> = signal<ConnectionGroup[]>([]);
  availableEnvironments: WritableSignal<ConnectionGroup[]> = signal<ConnectionGroup[]>([]);

  // Common fields
  name = '';
  providerType: ProviderType = ProviderType.AzureServiceBus;
  clientId: string | null = null;
  environmentId: string | null = null;
  testing = signal(false);
  saving = signal(false);
  isEditing = false;
  connectionId?: string;

  // Azure Service Bus fields
  connectionString = '';

  // Azure identity-based auth fields (Phase 2 Azure auth UI)
  readonly azureAuthOptions: AzureAuthOption[] = [
    { value: 'InteractiveBrowser', label: 'Sign in with Microsoft', badge: 'Recommended' },
    { value: 'ConnectionString', label: 'Connection string' },
    { value: 'ServicePrincipal', label: 'Service Principal', advanced: true },
    { value: 'AzureCli', label: 'Azure CLI session', advanced: true }
  ];
  azureAuthType: AzureAuthType = 'InteractiveBrowser';
  fullyQualifiedNamespace = '';
  tenantId = '';
  servicePrincipalClientId = '';
  clientSecret = '';
  signingIn = signal(false);
  signedIn = signal(false);

  // RabbitMQ fields
  hostName = 'localhost';
  port = 5672;
  userName = 'guest';
  password = 'guest';
  virtualHost = '/';
  managementPort = 15672;

  constructor(@Inject(MAT_DIALOG_DATA) public data: AddConnectionDialogData) {
    this.clients.set(data.groups.filter(g => g.type === 'client'));

    if (data.connection) {
      this.isEditing = true;
      this.connectionId = data.connection.id;
      this.name = data.connection.name;

      // Auto-detect provider type if not set (for legacy connections)
      if (!data.connection.providerType) {
        // Check if it has RabbitMQ-specific fields
        if (data.connection.hostName || data.connection.managementPort) {
          console.log('[AddConnectionDialog] Auto-detected RabbitMQ connection (legacy)');
          this.providerType = ProviderType.RabbitMQ;
        } else {
          console.log('[AddConnectionDialog] Defaulting to Azure Service Bus');
          this.providerType = ProviderType.AzureServiceBus;
        }
      } else {
        this.providerType = data.connection.providerType;
      }

      this.clientId = data.connection.clientId || null;
      this.environmentId = data.connection.environmentId || null;

      // Load provider-specific fields
      if (this.providerType === ProviderType.AzureServiceBus) {
        this.connectionString = data.connection.connectionString || '';
        // Restore Azure auth configuration. When absent, fall back to
        // ConnectionString so legacy connections keep their existing editor.
        this.azureAuthType = data.connection.authType
          ?? (data.connection.connectionString ? 'ConnectionString' : 'InteractiveBrowser');
        this.fullyQualifiedNamespace = data.connection.fullyQualifiedNamespace || '';
        this.tenantId = data.connection.tenantId || '';
        this.servicePrincipalClientId = data.connection.servicePrincipalClientId || '';
        this.clientSecret = data.connection.clientSecret || '';
      } else if (this.providerType === ProviderType.RabbitMQ) {
        this.hostName = data.connection.hostName || 'localhost';
        this.port = data.connection.port || 5672;
        this.userName = data.connection.userName || 'guest';
        this.password = data.connection.password || 'guest';
        this.virtualHost = data.connection.virtualHost || '/';
        this.managementPort = data.connection.managementPort || 15672;
      }

      if (this.clientId) {
        this.updateAvailableEnvironments();
      }
    }
  }

  onProviderTypeChange() {
    // Reset provider-specific fields when switching providers
    if (this.providerType === ProviderType.AzureServiceBus) {
      // Reset to Azure defaults - keep connection string if already entered
    } else if (this.providerType === ProviderType.RabbitMQ) {
      // Reset to RabbitMQ defaults if not already set
      if (!this.hostName) this.hostName = 'localhost';
      if (!this.port) this.port = 5672;
      if (!this.userName) this.userName = 'guest';
      if (!this.password) this.password = 'guest';
      if (!this.virtualHost) this.virtualHost = '/';
      if (!this.managementPort) this.managementPort = 15672;
    }
  }

  onClientChange() {
    this.environmentId = null;
    this.updateAvailableEnvironments();
  }

  updateAvailableEnvironments() {
    if (this.clientId) {
      const envs = this.data.groups.filter(
        g => g.type === 'environment' && g.parentId === this.clientId
      );
      this.availableEnvironments.set(envs);
    } else {
      this.availableEnvironments.set([]);
    }
  }

  /**
   * Validates the dialog form for the currently selected provider and Azure
   * auth strategy. For InteractiveBrowser, the Save button is only enabled
   * after a successful sign-in round-trip.
   */
  isFormValid(): boolean {
    if (this.providerType === ProviderType.AzureServiceBus) {
      switch (this.azureAuthType) {
        case 'ConnectionString':
          return !!this.connectionString && this.connectionString.trim().length > 0;
        case 'InteractiveBrowser':
          return !!this.fullyQualifiedNamespace
            && this.fullyQualifiedNamespace.trim().length > 0
            && this.signedIn();
        case 'ServicePrincipal':
          return !!this.fullyQualifiedNamespace?.trim()
            && !!this.tenantId?.trim()
            && !!this.servicePrincipalClientId?.trim()
            && !!this.clientSecret?.trim();
        case 'AzureCli':
          return !!this.fullyQualifiedNamespace && this.fullyQualifiedNamespace.trim().length > 0;
        case 'DefaultCredential':
          return !!this.fullyQualifiedNamespace && this.fullyQualifiedNamespace.trim().length > 0;
      }
      return false;
    } else if (this.providerType === ProviderType.RabbitMQ) {
      return !!this.hostName && this.hostName.trim().length > 0;
    }
    return false;
  }

  /**
   * Resets auth-specific UI state when the user switches between Azure auth
   * strategies. Sign-in state is invalidated so the user must re-verify.
   */
  onAzureAuthTypeChange(): void {
    this.signedIn.set(false);
  }

  /**
   * Initiates interactive browser sign-in. The backend credential factory
   * launches the system browser via InteractiveBrowserCredential and returns
   * once the user completes the flow.
   */
  signInWithMicrosoft(): void {
    if (!this.fullyQualifiedNamespace) {
      return;
    }
    this.signingIn.set(true);
    const request = {
      name: this.name || 'Sign-in Test',
      providerType: this.providerType,
      authType: 'InteractiveBrowser' as AzureAuthType,
      fullyQualifiedNamespace: this.fullyQualifiedNamespace,
      tenantId: this.tenantId || undefined
    };

    this.connectionService.testConnection(request).subscribe({
      next: (result: any) => {
        this.signingIn.set(false);
        if (result.success) {
          this.signedIn.set(true);
          this.snackBar.open('Signed in and connection verified', 'Close', { duration: 3000 });
        } else {
          this.signedIn.set(false);
          this.snackBar.open(result.error || 'Sign-in failed', 'Close', { duration: 6000 });
        }
      },
      error: (err) => {
        this.signingIn.set(false);
        this.signedIn.set(false);
        this.snackBar.open(
          'Sign-in failed: ' + (err.error?.message || err.message || 'Unknown error'),
          'Close',
          { duration: 6000 }
        );
      }
    });
  }

  testConnection() {
    this.testing.set(true);

    const testRequest = this.buildTestRequest();

    this.connectionService.testConnection(testRequest).subscribe({
      next: (result: any) => {
        if (result.success) {
          this.snackBar.open('Connection successful!', 'Close', { duration: 3000 });
        } else {
          const errorMsg = result.error || 'Connection test failed';
          this.snackBar.open(errorMsg, 'Close', { duration: 8000 });
        }
        this.testing.set(false);
      },
      error: (err) => {
        console.error('[TestConnection] HTTP Error:', err);
        this.snackBar.open('Connection failed: ' + (err.error?.message || err.message || 'Network error'), 'Close', { duration: 5000 });
        this.testing.set(false);
      }
    });
  }

  private buildTestRequest() {
    const baseRequest = {
      name: this.name || 'Test Connection',
      providerType: this.providerType,
      clientId: this.clientId || undefined,
      environmentId: this.environmentId || undefined
    };

    if (this.providerType === ProviderType.RabbitMQ) {
      return {
        ...baseRequest,
        connectionString: '', // Empty for RabbitMQ
        hostName: this.hostName,
        port: this.port,
        userName: this.userName,
        password: this.password,
        virtualHost: this.virtualHost,
        managementPort: this.managementPort
      };
    }

    // Azure Service Bus. The payload shape varies with the selected auth type
    // so the backend can pick the correct credential factory path.
    const azureBase: any = {
      ...baseRequest,
      authType: this.azureAuthType
    };

    switch (this.azureAuthType) {
      case 'ConnectionString':
        return { ...azureBase, connectionString: this.connectionString };
      case 'InteractiveBrowser':
      case 'AzureCli':
      case 'DefaultCredential':
        return {
          ...azureBase,
          fullyQualifiedNamespace: this.fullyQualifiedNamespace,
          tenantId: this.tenantId || undefined
        };
      case 'ServicePrincipal':
        return {
          ...azureBase,
          fullyQualifiedNamespace: this.fullyQualifiedNamespace,
          tenantId: this.tenantId,
          servicePrincipalClientId: this.servicePrincipalClientId,
          clientSecret: this.clientSecret
        };
    }

    return { ...azureBase, connectionString: this.connectionString };
  }

  save() {
    this.saving.set(true);

    const connectionData: Partial<ServiceBusConnection> = {
      name: this.name,
      providerType: this.providerType,
      clientId: this.clientId || undefined,
      environmentId: this.environmentId || undefined
    };

    // Add provider-specific fields
    if (this.providerType === ProviderType.AzureServiceBus) {
      connectionData.authType = this.azureAuthType;

      // Connection string is only meaningful for the legacy auth path. Other
      // auth types rely on the fullyQualifiedNamespace + credential factory.
      if (this.azureAuthType === 'ConnectionString') {
        connectionData.connectionString = this.connectionString;
      } else {
        connectionData.connectionString = '';
        connectionData.fullyQualifiedNamespace = this.fullyQualifiedNamespace;
        if (this.tenantId) {
          connectionData.tenantId = this.tenantId;
        }
        if (this.azureAuthType === 'ServicePrincipal') {
          connectionData.servicePrincipalClientId = this.servicePrincipalClientId;
          connectionData.clientSecret = this.clientSecret;
        }
      }
    } else if (this.providerType === ProviderType.RabbitMQ) {
      connectionData.connectionString = ''; // Empty for RabbitMQ
      connectionData.hostName = this.hostName;
      connectionData.port = this.port;
      connectionData.userName = this.userName;
      connectionData.password = this.password;
      connectionData.virtualHost = this.virtualHost;
      connectionData.managementPort = this.managementPort;
    }

    const operation = this.isEditing && this.connectionId
      ? this.connectionService.saveConnection({ ...connectionData, id: this.connectionId })
      : this.connectionService.saveConnection(connectionData);

    operation.subscribe({
      next: () => {
        const providerName = getProviderDisplayName(this.providerType);
        this.snackBar.open(
          `${providerName} connection ${this.isEditing ? 'updated' : 'saved'}!`,
          'Close',
          { duration: 3000 }
        );
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Failed to save connection', 'Close', { duration: 3000 });
        this.saving.set(false);
      }
    });
  }
}
