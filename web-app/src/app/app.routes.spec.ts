import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { routes } from './app.routes';
import { ConnectionService } from './core/services';

@Component({ template: '' })
class Screen {}

describe('the routes that show a broker open only with a connection', () => {
  async function navigateDisconnected(path: string): Promise<string> {
    const stubbed: Routes = routes.map(({ loadComponent, ...route }) => (route.redirectTo ? route : { ...route, component: Screen }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter(stubbed),
        { provide: ConnectionService, useValue: { isConnected: false, readStatus: () => of({ connected: false }) } }
      ]
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(path);
    return router.url;
  }

  it.each(['/entities', '/queues', '/topics', '/monitoring'])('%s with no connection ends on Connections', async path => {
    expect(await navigateDisconnected(path)).toBe('/connections');
  });

  it.each(['/connections', '/settings'])('%s opens with no connection', async path => {
    expect(await navigateDisconnected(path)).toBe(path);
  });
});
