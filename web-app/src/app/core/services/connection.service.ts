import { Injectable, inject } from '@angular/core';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import { ServiceBusConnection, ConnectionStatus, AzureAuthType } from '../models';
import { ProviderType, ProviderInfo, ProviderCapabilities } from '../models/provider.model';


/**
 * Request payload for testing a connection.
 * Supports both Azure Service Bus (connectionString) and RabbitMQ (host-based) configurations.
 */
export interface TestConnectionRequest {
  /** Azure Service Bus connection string (for Azure provider) */
  connectionString?: string;

  /** Provider type to determine which connection method to use */
  providerType?: ProviderType;

  /** RabbitMQ host name */
  hostName?: string;

  /** RabbitMQ port (default: 5672) */
  port?: number;

  /** RabbitMQ username */
  userName?: string;

  /** RabbitMQ password */
  password?: string;

  /** RabbitMQ virtual host (default: "/") */
  virtualHost?: string;

  /** RabbitMQ management API port (default: 15672) */
  managementPort?: number;

  // Azure identity-based auth fields. Optional for backward compatibility.

  /** Azure authentication strategy. Defaults to 'ConnectionString' on the backend. */
  authType?: AzureAuthType;

  /** Fully qualified Service Bus namespace (e.g. "contoso.servicebus.windows.net"). */
  fullyQualifiedNamespace?: string;

  /** Azure AD tenant ID. */
  tenantId?: string;

  /** Service Principal client ID (required when authType is 'ServicePrincipal'). */
  servicePrincipalClientId?: string;

  /** Service Principal client secret (required when authType is 'ServicePrincipal'). */
  clientSecret?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ConnectionService {
  private api = inject(ApiService);
  private connectionStatusSubject = new BehaviorSubject<ConnectionStatus>({ connected: false });
  connectionStatus$ = this.connectionStatusSubject.asObservable();

  constructor() {
    this.refreshStatus();
  }

  getConnections(): Observable<ServiceBusConnection[]> {
    return this.api.get<ServiceBusConnection[]>('connections');
  }

  getConnection(id: string): Observable<ServiceBusConnection> {
    return this.api.get<ServiceBusConnection>(`connections/${id}`);
  }

  saveConnection(connection: Partial<ServiceBusConnection>): Observable<ServiceBusConnection> {
    return this.api.post<ServiceBusConnection>('connections', connection);
  }

  /**
   * Tests a connection with provider-specific configuration.
   * Supports both Azure Service Bus (connectionString) and RabbitMQ (host-based) configurations.
   *
   * @param request - The connection test request containing provider-specific configuration
   * @returns Observable with test result
   */
  testConnection(request: TestConnectionRequest): Observable<{ success: boolean }>;

  /**
   * Tests a connection using a connection string (Azure Service Bus).
   * @deprecated Use testConnection(TestConnectionRequest) for multi-provider support
   * @param connectionString - The Azure Service Bus connection string
   * @returns Observable with test result
   */
  testConnection(connectionString: string): Observable<{ success: boolean }>;

  /**
   * Tests a connection using either a request object or connection string.
   */
  testConnection(requestOrConnectionString: TestConnectionRequest | string): Observable<{ success: boolean }> {
    // Handle legacy string-based connection test for backward compatibility
    if (typeof requestOrConnectionString === 'string') {
      return this.api.post<{ success: boolean }>('connections/test', {
        connectionString: requestOrConnectionString,
        providerType: ProviderType.AzureServiceBus
      });
    }

    // Handle provider-specific connection test
    return this.api.post<{ success: boolean }>('connections/test', requestOrConnectionString);
  }

  /**
   * Tests a connection using a full ServiceBusConnection object.
   * Extracts the appropriate provider-specific configuration from the connection.
   *
   * @param connection - The connection to test
   * @returns Observable with test result
   */
  testConnectionFromConfig(connection: Partial<ServiceBusConnection>): Observable<{ success: boolean }> {
    const request: TestConnectionRequest = {
      providerType: connection.providerType ?? ProviderType.AzureServiceBus
    };

    if (connection.providerType === ProviderType.RabbitMQ) {
      request.hostName = connection.hostName;
      request.port = connection.port;
      request.userName = connection.userName;
      request.password = connection.password;
      request.virtualHost = connection.virtualHost;
      request.managementPort = connection.managementPort;
    } else {
      request.connectionString = connection.connectionString;
    }

    return this.testConnection(request);
  }

  connect(id: string): Observable<ConnectionStatus> {
    return this.api.post<ConnectionStatus>(`connections/${id}/connect`, {}).pipe(
      tap(status => this.connectionStatusSubject.next(status))
    );
  }

  disconnect(): Observable<ConnectionStatus> {
    return this.api.post<ConnectionStatus>('connections/disconnect', {}).pipe(
      tap(status => this.connectionStatusSubject.next(status))
    );
  }

  deleteConnection(id: string): Observable<void> {
    return this.api.delete<void>(`connections/${id}`);
  }

  refreshStatus(): void {
    this.api.get<ConnectionStatus>('connections/status').subscribe(
      status => this.connectionStatusSubject.next(status)
    );
  }

  /**
   * Gets whether there is currently an active connection.
   */
  get isConnected(): boolean {
    return this.connectionStatusSubject.value.connected;
  }

  /**
   * Gets the current connection target identifier.
   * Returns namespace for Azure Service Bus, or host for RabbitMQ.
   */
  get currentNamespace(): string | undefined {
    return this.connectionStatusSubject.value.namespace;
  }

  /**
   * Gets the provider type of the current active connection.
   * Returns undefined if no connection is active.
   */
  get currentProviderType(): ProviderType | undefined {
    return this.connectionStatusSubject.value.providerType;
  }

  /**
   * Gets the current connection target display string.
   * Returns namespace for Azure Service Bus, or host:port for RabbitMQ.
   */
  get currentTarget(): string | undefined {
    return this.connectionStatusSubject.value.namespace;
  }

  // =========================================================================
  // Provider Discovery Methods
  // =========================================================================

  /**
   * Gets the list of available messaging providers from the API.
   * Note: For reactive provider state management, prefer using ProviderService.
   */
  getProviders(): Observable<ProviderInfo[]> {
    return this.api.get<ProviderInfo[]>('connections/providers');
  }

  /**
   * Gets the capabilities for a specific provider type.
   * Note: For cached capability access, prefer using ProviderService.
   *
   * @param providerType - The provider type to get capabilities for
   */
  getProviderCapabilities(providerType: ProviderType): Observable<ProviderCapabilities> {
    return this.api.get<ProviderCapabilities>(`connections/providers/${providerType}/capabilities`);
  }

  exportConfiguration(includeSecrets: boolean = false): Observable<any> {
    const endpoint = includeSecrets ? 'connections/export?includeSecrets=true' : 'connections/export';
    return this.api.post<any>(endpoint, null);
  }

  importConfiguration(jsonData: string): Observable<{ message: string }> {
    return this.api.post<{ message: string }>('connections/import', { configurationJson: jsonData });
  }

  exportFullConfiguration(includeSecrets: boolean = false): Observable<any> {
    const endpoint = includeSecrets ? 'connections/export-full?includeSecrets=true' : 'connections/export-full';
    return this.api.post<any>(endpoint, null);
  }

  importFullConfiguration(jsonData: string): Observable<{ message: string }> {
    return this.api.post<{ message: string }>('connections/import-full', { configurationJson: jsonData });
  }

  clearAllData(): Observable<{ message: string; connectionsDeleted: number; groupsDeleted: number }> {
    return this.api.delete<{ message: string; connectionsDeleted: number; groupsDeleted: number }>('connections/clear-all');
  }
}
