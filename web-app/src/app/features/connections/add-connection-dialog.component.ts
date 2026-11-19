import { Component, DestroyRef, inject, Inject, signal, WritableSignal } from '@angular/core';
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
import { Subscription, from, of } from 'rxjs';
import { catchError, concatMap, map, mergeMap, toArray } from 'rxjs/operators';
import { AzureDirectoryAccount, AzureDirectoryAuth, AzureDirectoryService, AzureNamespace, AzureSubscription, ConnectionService } from '../../core/services';
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

/** The name of each Azure auth type, for a stored connection of any type. */
const AUTH_LABELS: Record<AzureAuthType, string> = {
  InteractiveBrowser: 'Sign in with Microsoft',
  ConnectionString: 'Connection string',
  ServicePrincipal: 'Service Principal',
  AzureCli: 'Azure CLI session',
  DefaultCredential: 'Default credential'
};

/** What a namespace list of one subscription is: loading, failed with the API's sentence, or the list. */
interface NamespaceList {
  loading?: boolean;
  error?: string;
  list?: AzureNamespace[];
}

/** One connection the sign-in path creates. */
interface PickedNamespace {
  name: string;
  fullyQualifiedNamespace: string;
  resourceId?: string;
}

/** The API's sentence of a failed call, or a fixed one when the call did not reach it. */
const failureText = (err: { error?: { message?: string } } | null | undefined) =>
  err?.error?.message || 'The request did not reach the API of this app.';

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

/** How many subscriptions have their namespaces read at the same time, so an account with hundreds does not ask Azure for all at once. */
const NAMESPACE_READS_AT_ONCE = 4;

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
              @if (signInPath()) {
                <div class="pick">
                  <ol class="steps" aria-label="Steps">
                    @for (s of steps(); track s.n) {
                      <li>
                        <button matButton type="button" class="step" [class.current]="s.n === step()" [attr.aria-current]="s.n === step() ? 'step' : null"
                          [disabled]="s.n > 1 && !account()" (click)="goTo(s.n)">{{ s.label }}</button>
                      </li>
                    }
                  </ol>

                  @if (step() === 1) {
                    @if (azureAuthType === 'InteractiveBrowser') {
                      <div class="field">
                        <label for="conn-tenant-id-optional-14">Tenant ID (optional)</label>
                        <mat-form-field appearance="outline" subscriptSizing="dynamic">
                        <input matInput id="conn-tenant-id-optional-14" [(ngModel)]="tenantId" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off" spellcheck="false">
                        <mat-hint>Leave empty to use the user's home tenant</mat-hint>
                      </mat-form-field>
                      </div>
                      <div class="sign-in">
                        <button matButton="tonal" type="button" (click)="signIn()" [disabled]="signInBusy()">
                          @if (signInBusy()) {
                            <mat-progress-spinner diameter="18" mode="indeterminate"></mat-progress-spinner>
                          }
                          Sign in with Microsoft
                        </button>
                        <span class="hint">Opens your browser. The namespace is picked after the sign-in, no longer typed first.</span>
                      </div>
                    } @else {
                      <p class="cli-intro">Uses your current "az login" session. Nothing is typed here.</p>
                      @if (account(); as found) {
                        <p class="hint cli-found" role="status">Session found: <strong>{{ found.account }}</strong>, tenant {{ found.tenantDomain || found.tenantId }}</p>
                      }
                      <div class="sign-in">
                        <button matButton="tonal" type="button" (click)="step.set(2)" [disabled]="!account()">Continue with this session</button>
                        <button matButton type="button" (click)="signIn()" [disabled]="signInBusy()">
                          @if (signInBusy()) {
                            <mat-progress-spinner diameter="18" mode="indeterminate"></mat-progress-spinner>
                          }
                          Check again
                        </button>
                      </div>
                      <span class="hint cli-help">No session, or another account? Run az login in a terminal, then Check again. The app asks the Azure CLI for a token and never sees a password.</span>
                    }
                    @if (signInError(); as error) {
                      <p class="pick-error" role="alert">{{ error }}</p>
                    }
                  }

                  @if (step() > 1 && account(); as signed) {
                    <p class="hint signed">{{ azureAuthType === 'AzureCli' ? 'Azure CLI session of' : 'Signed in as' }} <strong>{{ signed.account }}</strong></p>
                  }

                  @if (step() === 2) {
                    <div class="step-two">
                      <p class="hint">The client and the environment the namespaces are added to</p>
                      <div class="field">
                        <label id="conn-pick-client-label" for="conn-pick-client">Client</label>
                        <mat-form-field appearance="outline" subscriptSizing="dynamic">
                        <mat-select placeholder="No client" id="conn-pick-client" aria-labelledby="conn-pick-client-label" [(ngModel)]="clientId" (selectionChange)="onClientChange()">
                          <mat-option [value]="null">No client</mat-option>
                          @for (client of clients(); track client.id) {
                            <mat-option [value]="client.id">{{ client.name }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                      </div>
                      @if (clientId) {
                        <div class="field">
                          <label id="conn-pick-environment-label" for="conn-pick-environment">Environment</label>
                          <mat-form-field appearance="outline" subscriptSizing="dynamic">
                          <mat-select placeholder="No environment" id="conn-pick-environment" aria-labelledby="conn-pick-environment-label" [(ngModel)]="environmentId">
                            <mat-option [value]="null">No environment</mat-option>
                            @for (env of availableEnvironments(); track env.id) {
                              <mat-option [value]="env.id">{{ env.name }}</mat-option>
                            }
                          </mat-select>
                        </mat-form-field>
                        </div>
                      }
                      <div><button matButton="tonal" type="button" (click)="goTo(3)">Next: pick the namespaces</button></div>
                    </div>
                  }

                  @if (step() === 3) {
                    <p class="hint target">{{ pickTarget() }}</p>
                    @if (subscriptionsError(); as error) {
                      <div class="pick-failed" role="alert">
                        <span><strong>Azure did not list the subscriptions.</strong> {{ error }}</span>
                        <button matButton="outlined" type="button" (click)="loadSubscriptions()">Retry</button>
                      </div>
                    } @else {
                      <div class="field">
                        <label id="conn-pick-subscription-label" for="conn-pick-subscription">Azure subscription <span class="count">{{ subscriptions()?.length ?? 0 }} in this account</span></label>
                        <mat-form-field appearance="outline" subscriptSizing="dynamic">
                        <mat-select id="conn-pick-subscription" aria-labelledby="conn-pick-subscription-label" [value]="subscriptionId()" (selectionChange)="pickSubscription($event.value)">
                          @for (sub of subscriptions() ?? []; track sub.id) {
                            <mat-option [value]="sub.id">{{ subscriptionLabel(sub) }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                      </div>
                    }
                    @let current = namespaceList();
                    @if (current?.loading) {
                      <p class="hint loading" role="status">
                        <mat-progress-spinner diameter="16" mode="indeterminate" aria-hidden="true"></mat-progress-spinner>
                        Loading the namespaces of this subscription from Azure
                      </p>
                    } @else if (current?.error; as error) {
                      <div class="pick-failed" role="alert">
                        <span><strong>Azure did not list the namespaces.</strong> {{ error }} Nothing was changed. You can still add a namespace by typing it.</span>
                        <button matButton="outlined" type="button" (click)="loadNamespaces(subscriptionId())">Retry</button>
                      </div>
                    } @else if (current?.list; as list) {
                      @if (list.length) {
                        <ul class="namespaces" aria-label="Namespaces of the subscription">
                          @for (item of list; track item.fullyQualifiedNamespace) {
                            @let already = alreadyIn(item.fullyQualifiedNamespace);
                            @let on = !!already || isTicked(item);
                            <li [class.on]="on && !already">
                              <mat-checkbox [checked]="on" [disabled]="!!already" (change)="toggle(item)">
                                <span class="row">
                                  <span class="host" [class.strong]="on">{{ item.fullyQualifiedNamespace }}</span>
                                  <span class="where">{{ already ?? 'Resource group ' + item.resourceGroup + ' · ' + item.tier }}</span>
                                </span>
                              </mat-checkbox>
                            </li>
                          }
                        </ul>
                      } @else {
                        <p class="hint empty">This subscription holds no Service Bus namespace your account can read.</p>
                      }
                    }
                    <span class="hint pick-summary">{{ summary() }} Ticks are kept when the subscription is changed. Each namespace becomes one connection, named after it.</span>
                    <div><button matButton type="button" [attr.aria-expanded]="typeByHand()" (click)="typeByHand.set(!typeByHand())">A namespace that is not listed: type it</button></div>
                    @if (typeByHand()) {
                      <div class="field">
                        <label for="conn-pick-typed">Fully Qualified Namespace</label>
                        <mat-form-field appearance="outline" subscriptSizing="dynamic">
                        <input matInput id="conn-pick-typed" [ngModel]="typedNamespace()" (ngModelChange)="typedNamespace.set($event)" placeholder="mynamespace.servicebus.windows.net" autocomplete="off" spellcheck="false">
                        <mat-hint>Your Service Bus namespace host, without the scheme. Added to the same client and environment as the ticked ones.</mat-hint>
                      </mat-form-field>
                      </div>
                    }
                    @if (saveError(); as error) {
                      <p class="pick-error" role="alert">{{ error }}</p>
                    }
                  }
                </div>
              } @else if (azureAuthType === 'ConnectionString') {
                <div class="field">
                  <label for="conn-connection-string-15">Connection String</label>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <input matInput id="conn-connection-string-15" type="password" autocomplete="off" spellcheck="false" [(ngModel)]="connectionString"
                    placeholder="Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=...">
                  <mat-hint>Azure Service Bus connection string with Manage permissions. Masked as you type or paste.</mat-hint>
                </mat-form-field>
                </div>
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

      @if (!signInPath()) {
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
      }

      @if (providerType === ProviderType.RabbitMQ) {
        <ng-container *ngTemplateOutlet="tls"></ng-container>
      } @else if (!signInPath()) {
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
      <button matButton [mat-dialog-close]="savedAny()">Cancel</button>
      <button matButton="outlined" (click)="testConnection()" [disabled]="testing() || signInPath() || !isFormValid()">
        @if (testing()) {
          <mat-progress-spinner diameter="18" mode="indeterminate"></mat-progress-spinner>
        } @else {
          <mat-icon>power</mat-icon>
        }
        Test
      </button>
      <button matButton="filled" (click)="save()" [disabled]="saving() || (signInPath() ? !toCreate().length : !name || !isFormValid())">
        @if (saving()) {
          <mat-progress-spinner diameter="18" mode="indeterminate"></mat-progress-spinner>
        }
        {{ saveLabel() }}
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

  /** The Azure authentications offered when adding; a stored connection of another type still edits. */
  readonly azureAuthOptions: AzureAuthOption[] = [
    { value: 'InteractiveBrowser', label: AUTH_LABELS.InteractiveBrowser, note: 'Recommended' },
    { value: 'ConnectionString', label: AUTH_LABELS.ConnectionString },
    { value: 'AzureCli', label: AUTH_LABELS.AzureCli, note: 'advanced' }
  ];
  azureAuthType: AzureAuthType = 'InteractiveBrowser';
  fullyQualifiedNamespace = '';
  tenantId = '';
  servicePrincipalClientId = '';
  clientSecret = '';

  // Sign in, then pick: the three steps of the add dialog for a sign-in or an Azure CLI session.
  private directory = inject(AzureDirectoryService);
  readonly step = signal<1 | 2 | 3>(1);
  readonly account = signal<AzureDirectoryAccount | null>(null);
  readonly signInBusy = signal(false);
  private signInCall?: Subscription;
  private countsCall?: Subscription;
  private sessionAsked = false;
  readonly signInError = signal<string | null>(null);
  readonly subscriptions = signal<AzureSubscription[] | null>(null);
  readonly subscriptionsError = signal<string | null>(null);
  readonly subscriptionId = signal('');
  readonly namespaceLists = signal<Record<string, NamespaceList>>({});
  /** The ticked namespaces of every subscription, by host in lower case, so a tick survives a change of subscription. */
  readonly ticked = signal<Record<string, AzureNamespace>>({});
  readonly typeByHand = signal(false);
  readonly typedNamespace = signal('');
  readonly saveError = signal<string | null>(null);
  readonly savedAny = signal(false);
  /** The stored connections, read when the namespaces are opened, to tell which are already in the client and environment. */
  private readonly stored = signal<Pick<ServiceBusConnection, 'fullyQualifiedNamespace' | 'clientId' | 'environmentId'>[]>([]);
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
    inject(DestroyRef).onDestroy(() => this.leaveDirectory());

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
          return !!this.fullyQualifiedNamespace && this.fullyQualifiedNamespace.trim().length > 0;
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
    return AUTH_LABELS[this.azureAuthType] ?? this.azureAuthType;
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

  /** Add, Azure, with a sign-in or the Azure CLI session: the three steps of sign in, then pick. */
  signInPath(): boolean {
    return !this.isEditing && this.providerType === ProviderType.AzureServiceBus
      && (this.azureAuthType === 'InteractiveBrowser' || this.azureAuthType === 'AzureCli');
  }

  /** A new authentication starts the steps again; the Azure CLI is asked for its session at once. */
  /** Ends what this dialog asked of the directory: a sign-in still waiting is dropped, and the session on the API is ended. */
  private leaveDirectory(): void {
    this.signInCall?.unsubscribe();
    this.signInCall = undefined;
    this.countsCall?.unsubscribe();
    this.countsCall = undefined;
    this.signInBusy.set(false);
    if (!this.sessionAsked) return;
    this.sessionAsked = false;
    this.directory.signOut().subscribe({ error: () => undefined });
  }

  onAzureAuthTypeChange(): void {
    this.leaveDirectory();
    this.step.set(1);
    this.account.set(null);
    this.signInError.set(null);
    this.subscriptions.set(null);
    this.subscriptionsError.set(null);
    this.subscriptionId.set('');
    this.namespaceLists.set({});
    this.ticked.set({});
    this.saveError.set(null);
    if (this.signInPath() && this.azureAuthType === 'AzureCli') this.signIn();
  }

  steps(): { n: 1 | 2 | 3; label: string }[] {
    return [
      { n: 1, label: this.azureAuthType === 'AzureCli' ? '1 Azure CLI session' : '1 Sign in' },
      { n: 2, label: '2 Client and environment' },
      { n: 3, label: '3 Namespaces' }
    ];
  }

  goTo(n: 1 | 2 | 3): void {
    this.step.set(n);
    if (n !== 3) return;
    if (this.subscriptions() === null) this.loadSubscriptions();
    this.connectionService.getConnections().subscribe({ next: list => this.stored.set(list), error: () => undefined });
  }

  /** Signs in through the API: the browser opens for Microsoft, the Azure CLI is asked for a token. */
  signIn(): void {
    const auth = this.azureAuthType as AzureDirectoryAuth;
    this.signInBusy.set(true);
    this.signInError.set(null);
    this.account.set(null);
    this.signInCall?.unsubscribe();
    this.sessionAsked = true;
    this.signInCall = this.directory.signIn(auth, auth === 'InteractiveBrowser' ? this.tenantId.trim() || undefined : undefined).subscribe({
      next: account => {
        this.signInBusy.set(false);
        this.account.set(account);
        if (auth === 'InteractiveBrowser') this.step.set(2);
      },
      error: err => {
        this.signInBusy.set(false);
        this.signInError.set(failureText(err));
      }
    });
  }

  loadSubscriptions(): void {
    this.subscriptionsError.set(null);
    this.directory.subscriptions().subscribe({
      next: list => {
        this.subscriptions.set(list);
        if (list.length && !list.some(s => s.id === this.subscriptionId())) this.pickSubscription(list[0].id);
        this.countsCall?.unsubscribe();
        const rest = list.filter(s => !this.namespaceLists()[s.id]);
        this.namespaceLists.update(lists => ({ ...lists, ...Object.fromEntries(rest.map(s => [s.id, { loading: true } as NamespaceList])) }));
        this.countsCall = from(rest).pipe(
          mergeMap(s => this.directory.namespaces(s.id).pipe(
            map((found): NamespaceList => ({ list: found })),
            catchError(err => of<NamespaceList>({ error: failureText(err) })),
            map(state => ({ id: s.id, state }))), NAMESPACE_READS_AT_ONCE)
        ).subscribe(({ id, state }) => this.namespaceLists.update(lists => ({ ...lists, [id]: state })));
      },
      error: err => this.subscriptionsError.set(failureText(err))
    });
  }

  /** Shows a subscription; its namespaces are read once and kept. */
  pickSubscription(id: string): void {
    this.subscriptionId.set(id);
    if (!this.namespaceLists()[id]?.list) this.loadNamespaces(id);
  }

  loadNamespaces(id: string): void {
    const set = (state: NamespaceList) => this.namespaceLists.update(lists => ({ ...lists, [id]: state }));
    set({ loading: true });
    this.directory.namespaces(id).subscribe({
      next: list => set({ list }),
      error: err => set({ error: failureText(err) })
    });
  }

  namespaceList(): NamespaceList | undefined {
    return this.namespaceLists()[this.subscriptionId()];
  }

  /** "Contoso Production (3)" once its namespaces are read, the name alone before. */
  subscriptionLabel(subscription: AzureSubscription): string {
    const list = this.namespaceLists()[subscription.id]?.list;
    return list ? `${subscription.displayName} (${list.length})` : subscription.displayName;
  }

  pickTarget(): string {
    const name = (id: string | null) => this.data.groups.find(g => g.id === id)?.name;
    const client = name(this.clientId);
    if (!client) return 'Added with no client and no environment';
    const environment = name(this.environmentId);
    return `Added to ${client}, ${environment ?? 'with no environment'}`;
  }

  /** "Already in Production" when a stored connection in the chosen client and environment has this host, else null. */
  alreadyIn(host: string): string | null {
    const key = host.trim().toLowerCase();
    const same = (a: string | null | undefined, b: string | null) => (a || null) === b;
    const found = this.stored().some(c => c.fullyQualifiedNamespace?.toLowerCase() === key
      && same(c.clientId, this.clientId) && same(c.environmentId, this.environmentId));
    if (!found) return null;
    const where = this.data.groups.find(g => g.id === (this.environmentId ?? this.clientId))?.name;
    return where ? `Already in ${where}` : 'Already added';
  }

  isTicked(item: AzureNamespace): boolean {
    return !!this.ticked()[item.fullyQualifiedNamespace.toLowerCase()];
  }

  toggle(item: AzureNamespace): void {
    const key = item.fullyQualifiedNamespace.toLowerCase();
    this.ticked.update(ticked => {
      const next = { ...ticked };
      if (next[key]) delete next[key]; else next[key] = item;
      return next;
    });
  }

  /** The ticked namespaces not already in the client and environment. */
  private picked(): AzureNamespace[] {
    return Object.values(this.ticked()).filter(n => !this.alreadyIn(n.fullyQualifiedNamespace));
  }

  summary(): string {
    const names = this.picked().map(n => n.name);
    return names.length ? `${names.length} ticked: ${names.join(', ')}.` : 'No namespace ticked yet.';
  }

  /** One connection per ticked namespace, and the typed one when it is new. */
  toCreate(): PickedNamespace[] {
    const items: PickedNamespace[] = this.picked().map(n => ({ name: n.name, fullyQualifiedNamespace: n.fullyQualifiedNamespace, resourceId: n.resourceId }));
    const typed = this.typeByHand() ? this.typedNamespace().trim() : '';
    if (typed && !this.alreadyIn(typed) && !items.some(i => i.fullyQualifiedNamespace.toLowerCase() === typed.toLowerCase())) {
      items.push({ name: typed.split('.')[0], fullyQualifiedNamespace: typed });
    }
    return items;
  }

  saveLabel(): string {
    if (this.isEditing) return 'Update';
    const count = this.signInPath() ? this.toCreate().length : 1;
    return count > 1 ? `Add ${count} connections` : 'Save';
  }

  /** Saves the picked namespaces one at a time; one that fails is named, and the dialog stays open to retry it. */
  private saveMany(): void {
    const items = this.toCreate();
    const account = this.account();
    this.saving.set(true);
    this.saveError.set(null);
    from(items).pipe(
      concatMap(item => this.connectionService.saveConnection({
        name: item.name,
        providerType: ProviderType.AzureServiceBus,
        authType: this.azureAuthType,
        connectionString: '',
        fullyQualifiedNamespace: item.fullyQualifiedNamespace,
        tenantId: account?.tenantId || undefined,
        azureResourceId: item.resourceId && AZURE_RESOURCE_ID.test(item.resourceId) ? item.resourceId : undefined,
        clientId: this.clientId || undefined,
        environmentId: this.environmentId || undefined
      }).pipe(map(() => ({ item, saved: true })), catchError(() => of({ item, saved: false })))),
      toArray()
    ).subscribe(results => {
      const saved = results.filter(r => r.saved).map(r => r.item);
      const failed = results.filter(r => !r.saved).map(r => r.item);
      this.saving.set(false);
      if (saved.length) {
        this.savedAny.set(true);
        this.stored.update(list => [...list, ...saved.map(i => ({
          fullyQualifiedNamespace: i.fullyQualifiedNamespace, clientId: this.clientId || undefined, environmentId: this.environmentId || undefined
        }))]);
      }
      if (!failed.length) {
        this.snackBar.open(saved.length === 1 ? 'Connection saved' : `${saved.length} connections saved`, 'Close', { duration: 3000 });
        this.dialogRef.close(true);
        return;
      }
      this.connectionService.getConnections().pipe(catchError(() => of(null))).subscribe(list => {
        if (list) this.stored.update(known => [...known, ...list]);
        const left = this.toCreate().map(item => item.name);
        const lost = failed.filter(f => left.includes(f.name));
        if (!lost.length) {
          this.snackBar.open('Connections saved', 'Close', { duration: 3000 });
          this.dialogRef.close(true);
          return;
        }
        this.saveError.set(`Not saved: ${lost.map(f => f.name).join(', ')}.${saved.length ? ' The others were saved.' : ''} Save again to retry.`);
      });
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
      id: this.isEditing ? this.connectionId : undefined,
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
    if (this.signInPath()) {
      this.saveMany();
      return;
    }
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
