import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { App } from './app';
import { ConnectionService, ThemeService, EntitySelectionService } from './core/services';
import { DeadLetterNotificationService } from './core/services/dead-letter-notification.service';

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
        provideRouter([]),
        { provide: ConnectionService, useValue: mockConnectionService },
        { provide: ThemeService, useValue: mockThemeService },
        { provide: EntitySelectionService, useValue: mockEntitySelectionService },
        { provide: DeadLetterNotificationService, useValue: mockDlqService },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should have navigation items', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app.navItems.length).toBeGreaterThan(0);
  });

  it('should toggle sidebar', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app.sidebarOpen()).toBe(true);
    app.toggleSidebar();
    expect(app.sidebarOpen()).toBe(false);
  });

  it('should initialize theme on init', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(mockThemeService.initialize).toHaveBeenCalled();
  });
});
