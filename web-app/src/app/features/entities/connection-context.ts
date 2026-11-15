import { Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, defer, forkJoin, map, of } from 'rxjs';
import { ConnectionGroupService, ConnectionService } from '../../core/services';
import { EnvironmentMark } from '../../shared/environment-line.component';

/** What a confirmation says about where a change lands. */
export interface ConnectionContext {
  connection: string;
  /** Where a change lands, as the environment line says it: the client, or the connection when it has none, and the target. */
  where: string;
  environment: string;
  /** The environment of the stored connection this app connected; absent while it is not known. */
  mark?: EnvironmentMark;
}

const NOT_KNOWN = 'Environment not known';

/**
 * The active connection and its client and environment group, read on subscribe. The environment
 * is named only for the stored connection this app connected, never guessed; a failed read leaves
 * it "not known".
 */
export function readConnectionContext(connections: ConnectionService, groupService: ConnectionGroupService): Observable<ConnectionContext> {
  return defer(() => {
    const target = connections.currentTarget ?? 'No connection';
    const id = connections.currentConnectionId;
    const unknown: ConnectionContext = { connection: target, where: target, environment: NOT_KNOWN };
    if (!id) return of(unknown);
    return forkJoin([connections.getConnections(), groupService.getGroups()]).pipe(
      map(([all, groups]): ConnectionContext => {
        const active = all.find(c => c.id === id);
        if (!active) return unknown;
        const names = [active.clientId, active.environmentId]
          .map(groupId => groups.find(g => g.id === groupId)?.name)
          .filter((name): name is string => !!name);
        const environment = groups.find(g => g.id === active.environmentId);
        const client = groups.find(g => g.id === active.clientId);
        return {
          connection: `${active.name} (${target})`,
          where: `${client?.name ?? active.name} (${target})`,
          environment: names.length ? names.join(' / ') : 'No environment',
          mark: { name: environment?.name ?? null, isProduction: !!environment?.isProduction }
        };
      }),
      catchError(() => of(unknown))
    );
  });
}

/** {@link readConnectionContext} once, as a signal; call it in an injection context. */
export function connectionContext(): Signal<ConnectionContext> {
  const connections = inject(ConnectionService);
  const target = connections.currentTarget ?? 'No connection';
  return toSignal(readConnectionContext(connections, inject(ConnectionGroupService)),
    { initialValue: { connection: target, where: target, environment: 'Reading environment' } });
}
