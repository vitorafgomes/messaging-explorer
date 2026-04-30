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
  return connection.namespace || 'Unknown';
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
