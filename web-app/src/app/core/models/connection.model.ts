import { ProviderType } from './provider.model';

/**
 * Azure authentication strategy.
 * Mirrors backend AzureAuthType enum (ServiceBusExplorer.Core.Providers.Azure).
 * Determines which credential factory path is used to authenticate against
 * Azure Service Bus. Defaults to ConnectionString for backward compatibility.
 */
export type AzureAuthType =
  | 'ConnectionString'
  | 'InteractiveBrowser'
  | 'ServicePrincipal'
  | 'AzureCli'
  | 'DefaultCredential';

/**
 * Represents a messaging service connection configuration.
 * This model is provider-agnostic and supports multiple messaging providers.
 * Matches the backend ServiceBusConnection model.
 */
export interface ServiceBusConnection {
  /** Unique identifier for this connection */
  id: string;

  /** Display name for this connection */
  name: string;

  /**
   * The type of messaging provider for this connection.
   * Defaults to AzureServiceBus for backward compatibility with existing saved connections.
   */
  providerType: ProviderType;

  // =========================================================================
  // Azure Service Bus Properties
  // =========================================================================

  /**
   * Azure Service Bus connection string.
   * Used when providerType is AzureServiceBus.
   */
  connectionString: string;

  /**
   * Azure Service Bus namespace name.
   * Used when providerType is AzureServiceBus.
   */
  namespace?: string;

  /**
   * Azure authentication type. When absent, backend treats as 'ConnectionString'.
   * Used when providerType is AzureServiceBus.
   */
  authType?: AzureAuthType;

  /**
   * Fully qualified Service Bus namespace (e.g. "contoso.servicebus.windows.net").
   * Required for all Azure auth types other than ConnectionString.
   */
  fullyQualifiedNamespace?: string;

  /**
   * Azure AD tenant ID (GUID). Optional for InteractiveBrowser, required for ServicePrincipal.
   */
  tenantId?: string;

  /**
   * Service Principal (App Registration) client ID. Required when authType is ServicePrincipal.
   */
  servicePrincipalClientId?: string;

  /**
   * Service Principal client secret. Required when authType is ServicePrincipal.
   * Never persisted in plaintext on the backend outside the secure secrets store.
   */
  clientSecret?: string;

  /** Azure: AMQP over WebSockets on port 443 instead of AMQP on port 5671. */
  useWebSockets?: boolean;

  /**
   * Azure: an HTTP proxy, as http://host:port, only with WebSockets. An address only, never a user name or
   * password: the proxy is reached with the default credentials of this computer.
   */
  proxyAddress?: string;

  /**
   * Azure: the Azure resource ID of the namespace, as
   * /subscriptions/{id}/resourceGroups/{group}/providers/Microsoft.ServiceBus/namespaces/{namespace}.
   * Not a secret; the Azure Monitor metrics on Monitoring are read for it.
   */
  azureResourceId?: string;

  // =========================================================================
  // RabbitMQ Properties
  // =========================================================================

  /**
   * RabbitMQ host name.
   * Used when providerType is RabbitMQ.
   */
  hostName?: string;

  /**
   * RabbitMQ port number (default: 5672).
   * Used when providerType is RabbitMQ.
   */
  port?: number;

  /**
   * RabbitMQ username.
   * Used when providerType is RabbitMQ.
   */
  userName?: string;

  /**
   * RabbitMQ password.
   * Used when providerType is RabbitMQ.
   */
  password?: string;

  /**
   * RabbitMQ virtual host (default: "/").
   * Used when providerType is RabbitMQ.
   */
  virtualHost?: string;

  /**
   * RabbitMQ Management API port (default: 15672).
   * Used for administrative operations like listing queues.
   */
  managementPort?: number;

  /** RabbitMQ: TLS (amqps) for the AMQP connection. */
  useSsl?: boolean;

  /** RabbitMQ: TLS (https) for the Management API. */
  useManagementSsl?: boolean;

  // =========================================================================
  // Common Properties
  // =========================================================================

  /** Timestamp when this connection was created */
  createdAt: Date;

  /** Timestamp when this connection was last used */
  lastUsedAt?: Date;

  /** Indicates whether a connection is currently active */
  isConnected: boolean;

  /** Client identifier for tracking purposes */
  clientId?: string;

  /** Environment identifier for organizing connections */
  environmentId?: string;
}

/**
 * Represents the current connection status.
 * Includes provider-specific target information.
 */
export interface ConnectionStatus {
  /** Whether a connection is currently established */
  connected: boolean;

  /** The connected target identifier (namespace for Azure, host for RabbitMQ) */
  namespace?: string;

  /** The provider type of the current connection (if any) */
  providerType?: ProviderType;

  /** The id of the stored connection that is active, when the API knows it */
  connectionId?: string;
}

/** One item of an import file, as the import preview of the API answers it. It carries no secret. */
export interface ImportPreviewItem {
  name: string;
  /** "Client", "Environment of {client}", or the broker of a connection. */
  kind: string;
  /** The namespace or host:port of a connection; null for a group. */
  target: string | null;
  /** The client and environment a connection goes into; null when ungrouped and for a group. */
  placement: string | null;
  /** True when the id is stored, so the import updates it. */
  exists: boolean;
  /** True when a stored connection arrives with a masked secret, so the stored secret is kept. */
  keepsStoredSecret: boolean;
}

/** What an import-full of a file would add and update, computed by the API without writing anything. */
export interface ImportPreview {
  items: ImportPreviewItem[];
  add: number;
  update: number;
  secretsMasked: boolean;
  /** Names of stored connections the file does not hold; the import leaves them. */
  notInFile: string[];
}

/**
 * Default connection values for creating new Azure Service Bus connections.
 */
export const DEFAULT_AZURE_CONNECTION: Partial<ServiceBusConnection> = {
  providerType: ProviderType.AzureServiceBus,
  connectionString: '',
  isConnected: false
};

/**
 * Default connection values for creating new RabbitMQ connections.
 */
export const DEFAULT_RABBITMQ_CONNECTION: Partial<ServiceBusConnection> = {
  providerType: ProviderType.RabbitMQ,
  connectionString: '',
  hostName: 'localhost',
  port: 5672,
  userName: 'guest',
  password: 'guest',
  virtualHost: '/',
  managementPort: 15672,
  isConnected: false
};

/**
 * Helper function to get the display target for a connection.
 * Returns namespace for Azure, or host:port for RabbitMQ.
 */
export function getConnectionDisplayTarget(connection: ServiceBusConnection): string {
  if (connection.providerType === ProviderType.RabbitMQ) {
    return `${connection.hostName || 'localhost'}:${connection.port || 5672}`;
  }
  return connection.namespace || connection.fullyQualifiedNamespace || 'Unknown';
}

const AZURE_AUTH_LABELS: Record<AzureAuthType, string> = {
  ConnectionString: 'Connection string',
  InteractiveBrowser: 'Sign in with Microsoft',
  ServicePrincipal: 'Service principal',
  AzureCli: 'Azure CLI session',
  DefaultCredential: 'Default credential',
};

/** How a connection signs in, in words: "Sign in with Microsoft", "Username and password, virtual host /". */
export function getConnectionAuthLabel(connection: ServiceBusConnection): string {
  if (connection.providerType === ProviderType.RabbitMQ) {
    return `Username and password, virtual host ${connection.virtualHost || '/'}`;
  }
  return AZURE_AUTH_LABELS[connection.authType ?? 'ConnectionString'] ?? 'Connection string';
}

/** The secret a connection stores, in lower case ("connection string"), or null when it stores none. */
export function getConnectionSecretLabel(connection: ServiceBusConnection): string | null {
  if (connection.providerType === ProviderType.RabbitMQ) return 'password';
  switch (connection.authType ?? 'ConnectionString') {
    case 'ConnectionString': return 'connection string';
    case 'ServicePrincipal': return 'client secret';
    default: return null;
  }
}

/**
 * Helper function to check if a connection has valid configuration.
 */
export function isConnectionValid(connection: ServiceBusConnection): boolean {
  if (connection.providerType === ProviderType.AzureServiceBus) {
    return !!connection.connectionString && connection.connectionString.length > 0;
  }
  if (connection.providerType === ProviderType.RabbitMQ) {
    return !!connection.hostName && connection.hostName.length > 0;
  }
  return false;
}
