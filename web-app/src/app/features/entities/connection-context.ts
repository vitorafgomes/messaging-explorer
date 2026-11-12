import { Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { ConnectionGroupService, ConnectionService } from '../../core/services';

/** What a confirmation says about where a change lands. */
export interface ConnectionContext {
  connection: string;
  environment: string;
}

const NOT_KNOWN = 'Environment not known';

/**
 * The active connection and its client and environment group, read when called (in an injection
 * context). The environment is named only for the stored connection this app connected, never
 * guessed; a failed read leaves it "not known".
 */
export function connectionContext(): Signal<ConnectionContext> {
  const connections = inject(ConnectionService);
  const groupService = inject(ConnectionGroupService);
  const target = connections.currentTarget ?? 'No connection';
  const id = connections.currentConnectionId;
  const unknown: ConnectionContext = { connection: target, environment: NOT_KNOWN };

  const context$: Observable<ConnectionContext> = !id
    ? of(unknown)
    : forkJoin([connections.getConnections(), groupService.getGroups()]).pipe(
      map(([all, groups]) => {
        const active = all.find(c => c.id === id);
        if (!active) return unknown;
        const names = [active.clientId, active.environmentId]
          .map(groupId => groups.find(g => g.id === groupId)?.name)
          .filter((name): name is string => !!name);
        return { connection: `${active.name} (${target})`, environment: names.length ? names.join(' / ') : 'No environment' };
      }),
      catchError(() => of(unknown))
    );

  return toSignal(context$, { initialValue: { connection: target, environment: 'Reading environment' } });
}
