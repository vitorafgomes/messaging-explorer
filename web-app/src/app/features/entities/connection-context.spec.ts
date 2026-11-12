import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ConnectionGroupService, ConnectionService } from '../../core/services';
import { connectionContext } from './connection-context';

describe('connectionContext names the active connection and its environment and group', () => {
  const groups = [
    { id: 'g-client', name: 'Contoso', type: 'client' },
    { id: 'g-env', name: 'Production', type: 'environment', parentId: 'g-client' }
  ];

  function read(connectionId: string | null, connections: () => unknown, getGroups: () => unknown = () => of(groups)) {
    TestBed.configureTestingModule({
      providers: [
        { provide: ConnectionService, useValue: { currentTarget: 'ns.example.net', currentConnectionId: connectionId, getConnections: connections } },
        { provide: ConnectionGroupService, useValue: { getGroups } }
      ]
    });
    return TestBed.runInInjectionContext(() => connectionContext())();
  }

  it('a connection in a client and an environment: its name, its target, and "client / environment"', () => {
    const context = read('c-1', () => of([{ id: 'c-1', name: 'contoso-prod', clientId: 'g-client', environmentId: 'g-env' }]));

    expect(context).toStrictEqual({ connection: 'contoso-prod (ns.example.net)', environment: 'Contoso / Production' });
  });

  it('a connection in no group says so', () => {
    const context = read('c-1', () => of([{ id: 'c-1', name: 'local' }]));

    expect(context).toStrictEqual({ connection: 'local (ns.example.net)', environment: 'No environment' });
  });

  it('when the app does not know which stored connection is active, it never guesses the environment', () => {
    const connections = vi.fn(() => of([]));
    const context = read(null, connections);

    expect(context).toStrictEqual({ connection: 'ns.example.net', environment: 'Environment not known' });
    expect(connections).not.toHaveBeenCalled();
  });

  it('when reading the connections fails with a 500, the target is still named and the environment is not guessed', () => {
    const context = read('c-1', () => throwError(() => new HttpErrorResponse({ status: 500 })));

    expect(context).toStrictEqual({ connection: 'ns.example.net', environment: 'Environment not known' });
  });
});
