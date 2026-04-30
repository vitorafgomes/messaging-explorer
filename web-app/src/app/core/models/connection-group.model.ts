export interface ConnectionGroup {
  id: string;
  name: string;
  type: 'client' | 'environment';
  parentId?: string;
  description?: string;
  createdAt: Date;
  order?: number;
}

export interface ConnectionGroupHierarchy {
  client: ConnectionGroup;
  environments: ConnectionGroup[];
}

export interface GroupedConnection {
  clientId?: string;
  environmentId?: string;
  connection: ServiceBusConnection;
}

export interface ConnectionGroupTree {
  group: ConnectionGroup;
  children: ConnectionGroupTree[];
  connections: ServiceBusConnection[];
  expanded?: boolean;
}

import { ServiceBusConnection } from './connection.model';
