import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { ConnectionGroup, ConnectionGroupTree, ServiceBusConnection } from '../models';

@Injectable({
  providedIn: 'root'
})
export class ConnectionGroupService {
  constructor(private api: ApiService) {}

  getGroups(): Observable<ConnectionGroup[]> {
    return this.api.get<ConnectionGroup[]>('connectiongroups');
  }

  getGroup(id: string): Observable<ConnectionGroup> {
    return this.api.get<ConnectionGroup>(`connectiongroups/${id}`);
  }

  createGroup(group: Partial<ConnectionGroup>): Observable<ConnectionGroup> {
    return this.api.post<ConnectionGroup>('connectiongroups', group);
  }

  updateGroup(id: string, group: Partial<ConnectionGroup>): Observable<ConnectionGroup> {
    return this.api.put<ConnectionGroup>(`connectiongroups/${id}`, group);
  }

  deleteGroup(id: string): Observable<void> {
    return this.api.delete<void>(`connectiongroups/${id}`);
  }

  buildGroupTree(groups: ConnectionGroup[], connections: ServiceBusConnection[]): ConnectionGroupTree[] {
    const clients = groups.filter(g => g.type === 'client').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const environments = groups.filter(g => g.type === 'environment');

    return clients.map(client => {
      const clientEnvironments = environments
        .filter(env => env.parentId === client.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      const children: ConnectionGroupTree[] = clientEnvironments.map(env => ({
        group: env,
        children: [],
        connections: connections.filter(c => c.environmentId === env.id),
        expanded: false
      }));

      const ungroupedConnections = connections.filter(
        c => c.clientId === client.id && !c.environmentId
      );

      return {
        group: client,
        children,
        connections: ungroupedConnections,
        expanded: false
      };
    });
  }

  getUngroupedConnections(connections: ServiceBusConnection[]): ServiceBusConnection[] {
    return connections.filter(c => !c.clientId && !c.environmentId);
  }
}
