import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { Observable, firstValueFrom, isObservable, of, throwError } from 'rxjs';
import { ConnectionService } from './connection.service';
import { requireConnection } from './require-connection.guard';

describe('requireConnection: Entities and Monitoring open only with a connection', () => {
  function run(connected: boolean, read: () => Observable<{ connected: boolean }>) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ConnectionService, useValue: { isConnected: connected, readStatus: read } }]
    });
    return TestBed.runInInjectionContext(() => requireConnection({} as never, {} as never));
  }
  const settle = async (result: unknown) => (isObservable(result) ? firstValueFrom(result) : result);
  const url = (result: unknown) => TestBed.inject(Router).serializeUrl(result as UrlTree);

  it('a connected app opens the screen without asking the API again', async () => {
    const read = vi.fn();
    expect(await settle(run(true, read))).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it('with no connection, after the status is read again, the screen sends the user to Connections', async () => {
    expect(url(await settle(run(false, () => of({ connected: false }))))).toBe('/connections');
  });

  it('a status that says connected, as on a start where the app has not read it yet, opens the screen', async () => {
    expect(await settle(run(false, () => of({ connected: true })))).toBe(true);
  });

  it('a status read that fails sends the user to Connections, never into a screen with no broker', async () => {
    expect(url(await settle(run(false, () => throwError(() => new Error('503')))))).toBe('/connections');
  });
});
