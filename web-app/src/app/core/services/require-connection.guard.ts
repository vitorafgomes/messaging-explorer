import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ConnectionService } from './connection.service';

/**
 * Opens a screen that needs a broker only while a connection is active. Without one, the status is read
 * again, since the app may not have read it yet, and the user is sent to Connections when it is not connected.
 */
export const requireConnection: CanActivateFn = () => {
  const connections = inject(ConnectionService);
  const toConnections = inject(Router).parseUrl('/connections');
  if (connections.isConnected) return true;
  return connections.readStatus().pipe(
    map(status => status.connected || toConnections),
    catchError(() => of(toConnections))
  );
};
