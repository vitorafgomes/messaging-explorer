import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { Component, signal } from '@angular/core';
import { App } from './app';
import { routes } from './app.routes';
import { ConnectionService, ThemeService, EntitySelectionService, DevSettingsService } from './core/services';
import { DeadLetterNotificationService } from './core/services/dead-letter-notification.service';

@Component({ template: '' })
class StubScreen {}

const routePaths = routes.map(r => r.path).filter((p): p is string => !!p);

describe('App', () => {
  const mockConnectionService = {
    connectionStatus$: of({ connected: false }),
    connect: () => of(null),
  };

  const mockThemeService = {
    isDark: signal(false),
    themeLabel: signal('Light'),
    themeIcon: signal('light_mode'),
    initialize: vi.fn(),
    toggle: vi.fn(),
  };

  const mockEntitySelectionService = {
    navigateToSubscription: vi.fn(),
  };

  const mockDlqService = {
    alerts: signal([]),
    alertCount: signal(0),
    hasAlerts: signal(false),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideNoopAnimations(),
        provideRouter(routePaths.map(path => ({ path, component: StubScreen }))),
        { provide: ConnectionService, useValue: mockConnectionService },
        { provide: ThemeService, useValue: mockThemeService },
        { provide: EntitySelectionService, useValue: mockEntitySelectionService },
        { provide: DeadLetterNotificationService, useValue: mockDlqService },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronAPI;
    localStorage.removeItem('dev-mode');
  });

  it('should initialize theme on init', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(mockThemeService.initialize).toHaveBeenCalled();
  });

  describe('in Electron mode', () => {
    beforeEach(() => {
      (window as any).electronAPI = {
        platform: 'darwin',
        getAppVersion: () => Promise.resolve('2.4.1'),
        getUpdateChannel: () => Promise.resolve('latest'),
        onUpdateStatus: () => {},
        onNavigate: () => {},
        onChangeConnection: () => {},
      };
    });

    it('every screen reachable without the menu: the toolbar links to the five routes', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const links: HTMLAnchorElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('mat-toolbar nav[aria-label="Main"] a'));

      expect(routePaths).toEqual(['connections', 'entities', 'queues', 'topics', 'monitoring']);
      expect(links.map(a => a.getAttribute('href'))).toEqual(routePaths.map(p => `/${p}`));
      expect(links.map(a => a.textContent?.trim())).toEqual(['Connections', 'Entities', 'Queues', 'Topics', 'Monitoring']);
    });

    it('the toolbar marks the active route', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await TestBed.inject(Router).navigateByUrl('/queues');
      fixture.detectChanges();
      await fixture.whenStable();

      const current = Array.from(fixture.nativeElement.querySelectorAll('mat-toolbar nav a[aria-current="page"]'))
        .map(a => (a as HTMLElement).textContent?.trim());
      expect(current).toEqual(['Queues']);
    });
  });

  it('in the browser the toolbar links to the same five routes', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const hrefs = Array.from(fixture.nativeElement.querySelectorAll('mat-toolbar nav[aria-label="Main"] a'))
      .map(a => (a as HTMLAnchorElement).getAttribute('href'));
    expect(hrefs).toEqual(routePaths.map(p => `/${p}`));
  });

  it('developer mode shortcut on a Mac: Cmd+Shift+D toggles developer mode', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const devSettings = TestBed.inject(DevSettingsService);
    expect(devSettings.devMode()).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', metaKey: true, shiftKey: true }));
    expect(devSettings.devMode()).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, shiftKey: true }));
    expect(devSettings.devMode()).toBe(false);
  });

  it('Cmd+D without Shift leaves developer mode alone', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const devSettings = TestBed.inject(DevSettingsService);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true }));
    expect(devSettings.devMode()).toBe(false);
  });
});
