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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { ConnectionService } from '../../core/services';
import { ConnectionGroup, ServiceBusConnection, ProviderType, getProviderDisplayName, getConnectionDisplayTarget, AzureAuthType } from '../../core/models';
import { EnvironmentLineComponent, EnvironmentMark } from '../../shared/environment-line.component';

/**
 * Azure authentication options rendered in the dialog. The order defines the
 * radio order; the first entry is the default for new connections.
 */
interface AzureAuthOption {
  value: AzureAuthType;
  label: string;
  note?: string;
}

/** What the add dialog says is written in plain text, per Azure auth type, or 'RabbitMQ' for its password. */
const PLAIN_TEXT_NOTICE: Partial<Record<AzureAuthType | 'RabbitMQ', string>> = {
  ConnectionString: 'The connection string is written, unencrypted, to workspace.json in the data folder of the app on this computer. Whoever can read your files can read it.',
  ServicePrincipal: 'The client secret is written, unencrypted, to workspace.json in the data folder of the app on this computer. Whoever can read your files can read it.',
  RabbitMQ: 'The password is written, unencrypted, to workspace.json in the data folder of the app on this computer. Whoever can read your files can read it.'
};

/** What the add dialog says is saved for an Azure auth type that stores no secret. */
const NO_SECRET_NOTICE: Partial<Record<AzureAuthType, string>> = {
  InteractiveBrowser: 'Only the namespace and the tenant are written to workspace.json. The sign-in token stays in memory, so you sign in again after a restart.',
  AzureCli: 'Only the namespace is written to workspace.json. The app asks the Azure CLI for a token; run az login first.',
  DefaultCredential: 'Only the namespace is written to workspace.json. The credential comes from this computer each time.'
};

/** Why a proxy address is refused, in the words the dialog shows under the field. */
export const PROXY_FORMAT = 'Enter the proxy as http://host:port.';
export const PROXY_USER_INFO = 'Leave the user name and password out of the proxy address: none is stored, and the proxy is reached with the credentials of this computer.';
export const PROXY_NEEDS_WEBSOCKETS = 'A proxy needs AMQP over WebSockets: AMQP on port 5671 does not go through an HTTP proxy.';
export const RESOURCE_ID_FORMAT = 'Enter the resource ID as /subscriptions/{subscription id}/resourceGroups/{resource group}/providers/Microsoft.ServiceBus/namespaces/{namespace}.';
/** The format the API accepts for a namespace's Azure resource ID. */
export const AZURE_RESOURCE_ID = /^\/subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/resourceGroups\/[-\w.()]{1,90}\/providers\/Microsoft\.ServiceBus\/namespaces\/[a-z0-9-]{1,50}$/i;

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
    MatIconModule,
    MatCheckboxModule,
    MatRadioModule,
    EnvironmentLineComponent
  ],
  template: `
    <h2 mat-dialog-title>{{ isEditing ? 'Edit' : 'Add' }} Connection</h2>

    <mat-dialog-content>
      @if (isEditing && data.connection; as stored) {
        <app-environment-line [mark]="environmentMark()"><b>{{ stored.name }}</b> to {{ target(stored) }}</app-environment-line>
      } @else {
        <app-environment-line [mark]="environmentMark()">New connection, saved on this computer. Nothing is created on the broker.</app-environment-line>
      }

      @if (isEditing) {
        <div class="grid two read-only">
          <div class="fact">
            <span class="fact-label">Provider Type</span>
            <span class="fact-value">{{ providerLabel() }}</span>
          </div>
          <div class="fact">
            <span class="fact-label">Authentication</span>
            <span class="fact-value">{{ authLabel() }}</span>
          </div>
        </div>
        <div class="grid two edit-fields">
          <div class="field full">
            <label for="conn-connection-name-1">Connection Name</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <input matInput id="conn-connection-name-1" [(ngModel)]="name" placeholder="My Connection">
          </mat-form-field>
          </div>
          @if (providerType === ProviderType.RabbitMQ) {
            <div class="field">
              <label for="conn-host-name-2">Host Name</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput id="conn-host-name-2" [(ngModel)]="hostName" placeholder="localhost">
            </mat-form-field>
            </div>
            <div class="field">
              <label for="conn-port-3">Port</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput id="conn-port-3" type="number" [(ngModel)]="port" placeholder="5672">
            </mat-form-field>
            </div>
            <div class="field">
              <label for="conn-username-4">Username</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput id="conn-username-4" [(ngModel)]="userName">
            </mat-form-field>
            </div>
            <div class="field">
              <label for="conn-virtual-host-5">Virtual Host</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput id="conn-virtual-host-5" [(ngModel)]="virtualHost" placeholder="/">
            </mat-form-field>
            </div>
            <div class="field">
              <label for="conn-management-port-6">Management Port</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput id="conn-management-port-6" type="number" [(ngModel)]="managementPort" placeholder="15672">
            </mat-form-field>
            </div>
          } @else if (azureAuthType !== 'ConnectionString') {
            <div class="field">
              <label for="conn-fully-qualified-namespace-7">Fully Qualified Namespace</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput id="conn-fully-qualified-namespace-7" [(ngModel)]="fullyQualifiedNamespace" placeholder="mynamespace.servicebus.windows.net">
            </mat-form-field>
            </div>
            @if (azureAuthType === 'InteractiveBrowser') {
              <div class="field">
                <label for="conn-tenant-id-optional-8">Tenant ID (optional)</label>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <input matInput id="conn-tenant-id-optional-8" [(ngModel)]="tenantId" placeholder="00000000-0000-0000-0000-000000000000">
              </mat-form-field>
              </div>
            }
            @if (azureAuthType === 'ServicePrincipal') {
              <div class="field">
                <label for="conn-tenant-id-9">Tenant ID</label>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <input matInput id="conn-tenant-id-9" [(ngModel)]="tenantId" placeholder="00000000-0000-0000-0000-000000000000">
              </mat-form-field>
              </div>
              <div class="field">
                <label for="conn-client-id-10">Client ID</label>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <input matInput id="conn-client-id-10" [(ngModel)]="servicePrincipalClientId" placeholder="App registration client ID">
              </mat-form-field>
              </div>
            }
          }
        </div>
      } @else {
        <div class="grid two">
          <div class="field">
            <label for="conn-connection-name-11">Connection Name</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <input matInput id="conn-connection-name-11" [(ngModel)]="name" placeholder="My Connection">
          </mat-form-field>
          </div>

          <div class="field">
            <label id="conn-provider-type-12-label" for="conn-provider-type-12">Provider Type</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-select id="conn-provider-type-12" aria-labelledby="conn-provider-type-12-label" [(ngModel)]="providerType" (selectionChange)="onProviderTypeChange()">
              @for (provider of providerOptions; track provider.value) {
                <mat-option [value]="provider.value">{{ provider.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          </div>
        </div>

        @if (providerType === ProviderType.AzureServiceBus) {
          <div class="auth-layout">
            <fieldset class="auth">
              <legend id="auth-legend">Authentication</legend>
              <mat-radio-group aria-labelledby="auth-legend" [(ngModel)]="azureAuthType" (change)="onAzureAuthTypeChange()">
                @for (opt of azureAuthOptions; track opt.value) {
                  <mat-radio-button [value]="opt.value" [class.selected]="opt.value === azureAuthType">
                    <span class="auth-label">{{ opt.label }}</span>
                    @if (opt.note) { <span class="auth-note">{{ opt.note }}</span> }
                  </mat-radio-button>
                }
              </mat-radio-group>
              <span class="hint">Choose how to authenticate against Azure Service Bus</span>
            </fieldset>

            <div class="auth-fields">
              @switch (azureAuthType) {
                @case ('InteractiveBrowser') {
                  <div class="field">
                    <label for="conn-fully-qualified-namespace-13">Fully Qualified Namespace</label>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <input matInput id="conn-fully-qualified-namespace-13" [(ngModel)]="fullyQualifiedNamespace" placeholder="mynamespace.servicebus.windows.net">
                    <mat-hint>Your Service Bus namespace host, without the scheme</mat-hint>
                  </mat-form-field>
                  </div>
                  <div class="field">
                    <label for="conn-tenant-id-optional-14">Tenant ID (optional)</label>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <input matInput id="conn-tenant-id-optional-14" [(ngModel)]="tenantId" placeholder="00000000-0000-0000-0000-000000000000">
                    <mat-hint>Leave empty to use the user's home tenant</mat-hint>
                  </mat-form-field>
                  </div>
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
                @case ('ConnectionString') {
                  <div class="field">
                    <label for="conn-connection-string-15">Connection String</label>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <input matInput id="conn-connection-string-15" type="password" autocomplete="off" spellcheck="false" [(ngModel)]="connectionString"
                      placeholder="Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=...">
                    <mat-hint>Azure Service Bus connection string with Manage permissions. Masked as you type or paste.</mat-hint>
                  </mat-form-field>
                  </div>
                }
                @case ('ServicePrincipal') {
                  <div class="field">
                    <label for="conn-fully-qualified-namespace-16">Fully Qualified Namespace</label>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <input matInput id="conn-fully-qualified-namespace-16" [(ngModel)]="fullyQualifiedNamespace" placeholder="mynamespace.servicebus.windows.net">
                    <mat-hint>Your Service Bus namespace host, without the scheme</mat-hint>
                  </mat-form-field>
                  </div>
                  <div class="grid two">
                    <div class="field">
                      <label for="conn-tenant-id-17">Tenant ID</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <input matInput id="conn-tenant-id-17" [(ngModel)]="tenantId" placeholder="00000000-0000-0000-0000-000000000000">
                    </mat-form-field>
                    </div>
                    <div class="field">
                      <label for="conn-client-id-18">Client ID</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <input matInput id="conn-client-id-18" [(ngModel)]="servicePrincipalClientId" placeholder="App registration client ID">
                    </mat-form-field>
                    </div>
                  </div>
                  <div class="field">
                    <label for="conn-client-secret-19">Client Secret</label>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <input matInput id="conn-client-secret-19" type="password" autocomplete="new-password" [(ngModel)]="clientSecret">
                  </mat-form-field>
                  </div>
                }
                @case ('AzureCli') {
                  <div class="field">
                    <label for="conn-fully-qualified-namespace-20">Fully Qualified Namespace</label>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <input matInput id="conn-fully-qualified-namespace-20" [(ngModel)]="fullyQualifiedNamespace" placeholder="mynamespace.servicebus.windows.net">
                    <mat-hint>Uses your current "az login" session</mat-hint>
                  </mat-form-field>
                  </div>
                }
                @case ('DefaultCredential') {
                  <div class="field">
                    <label for="conn-fully-qualified-namespace-21">Fully Qualified Namespace</label>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <input matInput id="conn-fully-qualified-namespace-21" [(ngModel)]="fullyQualifiedNamespace" placeholder="mynamespace.servicebus.windows.net">
                    <mat-hint>Uses the default credential chain of this computer, without managed identity</mat-hint>
                  </mat-form-field>
                  </div>
                  <p class="dev-note">For development: the app takes whichever sign-in this computer already has.</p>
                }
              }
            </div>
          </div>
        }

        @if (providerType === ProviderType.RabbitMQ) {
          <div class="grid four">
            <div class="field span-3">
              <label for="conn-host-name-22">Host Name</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput id="conn-host-name-22" [(ngModel)]="hostName" placeholder="localhost">
            </mat-form-field>
            </div>
            <div class="field">
              <label for="conn-port-23">Port</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput id="conn-port-23" type="number" [(ngModel)]="port" placeholder="5672">
            </mat-form-field>
            </div>
            <div class="field span-2">
              <label for="conn-username-24">Username</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput id="conn-username-24" [(ngModel)]="userName">
            </mat-form-field>
            </div>
            <div class="field span-2">
              <label for="conn-password-25">Password</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput id="conn-password-25" type="password" autocomplete="new-password" [(ngModel)]="password">
              <mat-hint>Starts empty and is never prefilled.</mat-hint>
            </mat-form-field>
            </div>
            <div class="field span-3">
              <label for="conn-virtual-host-26">Virtual Host</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput id="conn-virtual-host-26" [(ngModel)]="virtualHost" placeholder="/">
            </mat-form-field>
            </div>
            <div class="field">
              <label for="conn-management-port-27">Management Port</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput id="conn-management-port-27" type="number" [(ngModel)]="managementPort" placeholder="15672">
              <mat-hint>HTTP API port</mat-hint>
            </mat-form-field>
            </div>
          </div>
        }
      }

      <ng-template #network>
        <fieldset class="network">
          <legend id="transport-legend">Transport</legend>
          <mat-radio-group aria-labelledby="transport-legend" [(ngModel)]="useWebSockets">
            <mat-radio-button [value]="false">AMQP (port 5671)</mat-radio-button>
            <mat-radio-button [value]="true">AMQP over WebSockets (port 443)</mat-radio-button>
          </mat-radio-group>
          <div class="field">
            <label for="conn-proxy-address-optional-28">Proxy address (optional)</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <input matInput id="conn-proxy-address-optional-28" [(ngModel)]="proxyAddress" placeholder="http://proxy.example:8080" autocomplete="off" spellcheck="false">
            <mat-hint>Only with AMQP over WebSockets. The address only: the proxy is reached with the default credentials of this computer, and no proxy user name or password is stored.</mat-hint>
          </mat-form-field>
          </div>
          @if (proxyError(); as error) {
            <p class="field-error" role="alert">{{ error }}</p>
          }
        </fieldset>
        <div class="field full-width">
          <label for="conn-azure-resource-id-optional-29">Azure resource ID (optional)</label>
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <input matInput id="conn-azure-resource-id-optional-29" [(ngModel)]="azureResourceId" placeholder="/subscriptions/{id}/resourceGroups/{group}/providers/Microsoft.ServiceBus/namespaces/{namespace}" autocomplete="off" spellcheck="false">
          <mat-hint>For the Azure Monitor metrics on Monitoring, read with an Entra ID sign-in. Not a secret, and not needed to connect.</mat-hint>
        </mat-form-field>
        </div>
        @if (resourceIdError(); as error) {
          <p class="field-error" role="alert">{{ error }}</p>
        }
      </ng-template>

      <ng-template #tls>
        <div class="tls">
          <mat-checkbox [(ngModel)]="useSsl">Use TLS for AMQP (amqps)</mat-checkbox>
          <mat-checkbox [(ngModel)]="useManagementSsl">Use TLS for the management API (https)</mat-checkbox>
        </div>
      </ng-template>

      @if (isEditing) {
        @if (!secretLabel()) {
          <p class="no-secret">
            <mat-icon aria-hidden="true">info</mat-icon>
            <span><strong>No secret is stored.</strong> {{ noSecretText() }}</span>
          </p>
        } @else if (secretStored && !replacingSecret()) {
          <div class="secret-stored">
            <mat-icon aria-hidden="true">lock</mat-icon>
            <div class="secret-text">
              <span class="fact-label">{{ secretLabel() }}</span>
              <span><strong>Stored</strong>. It is never shown again and never sent back to this screen. Saving keeps it as it is.</span>
            </div>
            <button matButton="outlined" (click)="replacingSecret.set(true)">Replace</button>
          </div>
        } @else {
          <div class="secret-replace">
            <div class="field">
              <label for="conn-new-x-30">New {{ secretLabel() }}</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput id="conn-new-x-30" type="password" autocomplete="new-password" [(ngModel)]="newSecret">
              <mat-hint>Replaces the stored value when you choose Update. Saved in plain text in workspace.json on this computer.</mat-hint>
            </mat-form-field>
            </div>
            @if (secretStored) {
              <button matButton (click)="keepStoredSecret()">Keep the stored value</button>
            }
          </div>
        }
      }

      <div class="grouping-section">
        <h3>Organization (Optional)</h3>
        <p class="hint">Organize this connection by client and environment</p>

        <div class="grid two">
          <div class="field">
            <label id="conn-client-31-label" for="conn-client-31">Client</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-select placeholder="No client" id="conn-client-31" aria-labelledby="conn-client-31-label" [(ngModel)]="clientId" (selectionChange)="onClientChange()">
              <mat-option [value]="null">No client</mat-option>
              @for (client of clients(); track client.id) {
                <mat-option [value]="client.id">{{ client.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          </div>

          @if (clientId) {
            <div class="field">
              <label id="conn-environment-32-label" for="conn-environment-32">Environment</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-select placeholder="No environment" id="conn-environment-32" aria-labelledby="conn-environment-32-label" [(ngModel)]="environmentId">
                <mat-option [value]="null">No environment</mat-option>
                @for (env of availableEnvironments(); track env.id) {
                  <mat-option [value]="env.id">{{ env.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            </div>
          }
        </div>
      </div>

      @if (providerType === ProviderType.RabbitMQ) {
        <ng-container *ngTemplateOutlet="tls"></ng-container>
      } @else {
        <ng-container *ngTemplateOutlet="network"></ng-container>
      }

      @if (!isEditing) {
        @let notice = storeNotice();
        <p class="store-notice" [class.plain]="notice.plain" [class.none]="!notice.plain">
          <mat-icon aria-hidden="true">{{ notice.plain ? 'warning' : 'info' }}</mat-icon>
          <span><strong>{{ notice.plain ? 'Saved in plain text.' : 'No secret is saved.' }}</strong> {{ notice.text }}</span>
        </p>
      }
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
  styleUrl: './add-connection-dialog.component.scss',
})
export class AddConnectionDialogComponent {
  private connectionService = inject(ConnectionService);
  private dialogRef = inject(MatDialogRef<AddConnectionDialogComponent>);
  private snackBar = inject(MatSnackBar);

  // Expose ProviderType enum to template
  readonly ProviderType = ProviderType;

  // Provider selection options
  readonly providerOptions = [
    { value: ProviderType.AzureServiceBus, label: 'Azure Service Bus' },
    { value: ProviderType.RabbitMQ, label: 'RabbitMQ' }
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
    { value: 'InteractiveBrowser', label: 'Sign in with Microsoft', note: 'Recommended' },
    { value: 'ConnectionString', label: 'Connection string' },
    { value: 'ServicePrincipal', label: 'Service Principal', note: 'advanced' },
    { value: 'AzureCli', label: 'Azure CLI session', note: 'advanced' },
    { value: 'DefaultCredential', label: 'Default credential' }
  ];
  azureAuthType: AzureAuthType = 'InteractiveBrowser';
  fullyQualifiedNamespace = '';
  tenantId = '';
  servicePrincipalClientId = '';
  clientSecret = '';
  signingIn = signal(false);
  signedIn = signal(false);
  useWebSockets = false;
  proxyAddress = '';
  azureResourceId = '';

  // RabbitMQ fields
  hostName = '';
  port = 5672;
  userName = '';
  password = '';
  virtualHost = '/';
  managementPort = 15672;
  useSsl = false;
  useManagementSsl = false;

  /** Edit only: the connection arrived with its secret masked, so a secret is stored on the server. */
  secretStored = false;
  /** Edit only: the user chose Replace; the new value is sent, otherwise the mask is. */
  replacingSecret = signal(false);

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
        const raw: unknown = data.connection.providerType;
        this.providerType = raw === ProviderType.RabbitMQ || raw === 'RabbitMQ' ? ProviderType.RabbitMQ : ProviderType.AzureServiceBus;
      }

      this.clientId = data.connection.clientId || null;
      this.environmentId = data.connection.environmentId || null;

      // Load provider-specific fields
      if (this.providerType === ProviderType.AzureServiceBus) {
        // Restore Azure auth configuration. When absent, fall back to
        // ConnectionString so legacy connections keep their existing editor.
        this.azureAuthType = data.connection.authType
          ?? (data.connection.connectionString ? 'ConnectionString' : 'InteractiveBrowser');
        this.fullyQualifiedNamespace = data.connection.fullyQualifiedNamespace || '';
        this.tenantId = data.connection.tenantId || '';
        this.servicePrincipalClientId = data.connection.servicePrincipalClientId || '';
        this.useWebSockets = !!data.connection.useWebSockets;
        this.proxyAddress = data.connection.proxyAddress || '';
        this.azureResourceId = data.connection.azureResourceId || '';
        this.secretStored = this.azureAuthType === 'ConnectionString' ? !!data.connection.connectionString
          : this.azureAuthType === 'ServicePrincipal' && !!data.connection.clientSecret;
        this.connectionString = '';
        this.clientSecret = '';
      } else if (this.providerType === ProviderType.RabbitMQ) {
        this.hostName = data.connection.hostName || 'localhost';
        this.port = data.connection.port || 5672;
        this.userName = data.connection.userName || 'guest';
        this.virtualHost = data.connection.virtualHost || '/';
        this.managementPort = data.connection.managementPort || 15672;
        this.useSsl = !!data.connection.useSsl;
        this.useManagementSsl = !!data.connection.useManagementSsl;
        this.secretStored = !!data.connection.password;
        this.password = '';
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
      // Reset to RabbitMQ defaults if not already set; host, username and password start empty
      if (!this.port) this.port = 5672;
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
      if (this.proxyError() || this.resourceIdError()) return false;
      switch (this.azureAuthType) {
        case 'ConnectionString':
          return this.keepsStoredSecret() || (!!this.connectionString && this.connectionString.trim().length > 0);
        case 'InteractiveBrowser':
          return !!this.fullyQualifiedNamespace
            && this.fullyQualifiedNamespace.trim().length > 0
            && (this.isEditing || this.signedIn());
        case 'ServicePrincipal':
          return !!this.fullyQualifiedNamespace?.trim()
            && !!this.tenantId?.trim()
            && !!this.servicePrincipalClientId?.trim()
            && (this.keepsStoredSecret() || !!this.clientSecret?.trim());
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

  /** Why the proxy address cannot be used, or null when it is empty or usable. */
  proxyError(): string | null {
    const address = this.proxyAddress.trim();
    if (!address) return null;
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return PROXY_FORMAT;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return PROXY_FORMAT;
    if (url.username || url.password) return PROXY_USER_INFO;
    return this.useWebSockets ? null : PROXY_NEEDS_WEBSOCKETS;
  }

  /** Why the Azure resource ID cannot be stored, or null when it is empty or in the namespace format. */
  resourceIdError(): string | null {
    const id = this.azureResourceId.trim();
    return !id || AZURE_RESOURCE_ID.test(id) ? null : RESOURCE_ID_FORMAT;
  }

  /** The transport, proxy and resource ID every Azure request carries; an empty value is left out. */
  private azureNetwork(): Pick<ServiceBusConnection, 'useWebSockets' | 'proxyAddress' | 'azureResourceId'> {
    return { useWebSockets: this.useWebSockets, proxyAddress: this.proxyAddress.trim() || undefined, azureResourceId: this.azureResourceId.trim() || undefined };
  }

  /** Edit with a stored secret and no Replace: the save keeps the stored value. */
  keepsStoredSecret(): boolean {
    return this.isEditing && this.secretStored && !this.replacingSecret();
  }

  /** What goes in the payload for a secret field: the mask when the stored value is kept, otherwise what was typed. */
  private secretValue(typed: string): string {
    return this.keepsStoredSecret() ? '***' : typed;
  }

  /** The label of the secret this connection stores, or null when it signs in without one. */
  secretLabel(): string | null {
    if (this.providerType === ProviderType.RabbitMQ) return 'Password';
    if (this.azureAuthType === 'ConnectionString') return 'Connection String';
    if (this.azureAuthType === 'ServicePrincipal') return 'Client Secret';
    return null;
  }

  /** The field Replace types into: the secret field of the provider and authentication. */
  get newSecret(): string {
    if (this.providerType === ProviderType.RabbitMQ) return this.password;
    return this.azureAuthType === 'ServicePrincipal' ? this.clientSecret : this.connectionString;
  }

  set newSecret(value: string) {
    if (this.providerType === ProviderType.RabbitMQ) this.password = value;
    else if (this.azureAuthType === 'ServicePrincipal') this.clientSecret = value;
    else this.connectionString = value;
  }

  keepStoredSecret(): void {
    this.newSecret = '';
    this.replacingSecret.set(false);
  }

  /** The chip of the environment chosen in the form, NO ENVIRONMENT when none is. */
  environmentMark(): EnvironmentMark {
    const environment = this.data.groups.find(g => g.id === this.environmentId);
    return { name: environment?.name ?? null, isProduction: !!environment?.isProduction };
  }

  /** The namespace or host:port of the stored connection, read with the provider the form resolved. */
  target(connection: ServiceBusConnection): string {
    return getConnectionDisplayTarget({ ...connection, providerType: this.providerType });
  }

  providerLabel(): string {
    return getProviderDisplayName(this.providerType);
  }

  authLabel(): string {
    if (this.providerType === ProviderType.RabbitMQ) return `Username and password, virtual host ${this.virtualHost}`;
    return this.azureAuthOptions.find(o => o.value === this.azureAuthType)?.label ?? this.azureAuthType;
  }

  /** Add only: whether the chosen provider and authentication write a secret in plain text, and what the notice says. */
  storeNotice(): { plain: boolean; text: string } {
    const key = this.providerType === ProviderType.RabbitMQ ? 'RabbitMQ' : this.azureAuthType;
    const plain = PLAIN_TEXT_NOTICE[key];
    return plain ? { plain: true, text: plain } : { plain: false, text: NO_SECRET_NOTICE[this.azureAuthType] ?? '' };
  }

  noSecretText(): string {
    switch (this.azureAuthType) {
      case 'AzureCli':
        return 'Only the namespace is written to workspace.json. The app asks the Azure CLI for a token; run az login first.';
      case 'DefaultCredential':
        return 'Only the namespace is written to workspace.json. The credential comes from this computer each time.';
      default:
        return 'This connection signs in with Microsoft; the token stays in memory.';
    }
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
      tenantId: this.tenantId || undefined,
      ...this.azureNetwork()
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
        password: this.secretValue(this.password),
        virtualHost: this.virtualHost,
        managementPort: this.managementPort,
        useSsl: this.useSsl,
        useManagementSsl: this.useManagementSsl
      };
    }

    // Azure Service Bus. The payload shape varies with the selected auth type
    // so the backend can pick the correct credential factory path.
    const azureBase: any = {
      ...baseRequest,
      authType: this.azureAuthType,
      ...this.azureNetwork()
    };

    switch (this.azureAuthType) {
      case 'ConnectionString':
        return { ...azureBase, connectionString: this.secretValue(this.connectionString) };
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
          clientSecret: this.secretValue(this.clientSecret)
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
      Object.assign(connectionData, this.azureNetwork());

      // Connection string is only meaningful for the legacy auth path. Other
      // auth types rely on the fullyQualifiedNamespace + credential factory.
      if (this.azureAuthType === 'ConnectionString') {
        connectionData.connectionString = this.secretValue(this.connectionString);
      } else {
        connectionData.connectionString = '';
        connectionData.fullyQualifiedNamespace = this.fullyQualifiedNamespace;
        if (this.tenantId) {
          connectionData.tenantId = this.tenantId;
        }
        if (this.azureAuthType === 'ServicePrincipal') {
          connectionData.servicePrincipalClientId = this.servicePrincipalClientId;
          connectionData.clientSecret = this.secretValue(this.clientSecret);
        }
      }
    } else if (this.providerType === ProviderType.RabbitMQ) {
      connectionData.connectionString = ''; // Empty for RabbitMQ
      connectionData.hostName = this.hostName;
      connectionData.port = this.port;
      connectionData.userName = this.userName;
      connectionData.password = this.secretValue(this.password);
      connectionData.virtualHost = this.virtualHost;
      connectionData.managementPort = this.managementPort;
      connectionData.useSsl = this.useSsl;
      connectionData.useManagementSsl = this.useManagementSsl;
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
