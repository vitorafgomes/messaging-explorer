import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { apiPath } from './api-path';

/** The account and tenant of the last sign-in; the token itself stays in the API. */
export interface AzureDirectoryAccount {
  account: string;
  tenantId: string;
  /** The default domain of the tenant; absent or empty when Azure did not give it. */
  tenantDomain?: string;
}

/** An Azure subscription the signed-in account can read. */
export interface AzureSubscription {
  id: string;
  displayName: string;
}

/** A Service Bus namespace of a subscription, as Azure Resource Manager lists it. */
export interface AzureNamespace {
  name: string;
  fullyQualifiedNamespace: string;
  resourceGroup: string;
  tier: string;
  resourceId: string;
}

/** The authentications the API signs in to the Azure directory with. */
export type AzureDirectoryAuth = 'InteractiveBrowser' | 'AzureCli';

/**
 * Sign in, then pick: the API signs in to Azure, with Microsoft or the Azure CLI session, and lists the subscriptions
 * of the account and the Service Bus namespaces of one. The token never reaches the app.
 */
@Injectable({
  providedIn: 'root'
})
export class AzureDirectoryService {
  private api = inject(ApiService);

  /** Signs in; with Microsoft the API opens the browser, with the Azure CLI it asks the CLI for a token. */
  signIn(authType: AzureDirectoryAuth, tenantId?: string): Observable<AzureDirectoryAccount> {
    return this.api.post<AzureDirectoryAccount>('azure-directory/sign-in', { authType, tenantId });
  }

  subscriptions(): Observable<AzureSubscription[]> {
    return this.api.get<AzureSubscription[]>('azure-directory/subscriptions');
  }

  namespaces(subscriptionId: string): Observable<AzureNamespace[]> {
    return this.api.get<AzureNamespace[]>(apiPath`azure-directory/subscriptions/${subscriptionId}/namespaces`);
  }

  /** Drops the session the API keeps. */
  signOut(): Observable<void> {
    return this.api.post<void>('azure-directory/sign-out', {});
  }
}
