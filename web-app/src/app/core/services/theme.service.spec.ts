import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { ThemeService } from './theme.service';

// jsdom does not implement window.matchMedia — provide a stub
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark-theme');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    service = TestBed.inject(ThemeService);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark-theme');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should default to light theme', () => {
    service.initialize();
    expect(service.isDark()).toBe(false);
    expect(service.themeLabel()).toBe('Light');
    expect(service.themeIcon()).toBe('light_mode');
  });

  it('should toggle to dark theme', () => {
    service.initialize();
    service.toggle();
    expect(service.isDark()).toBe(true);
    expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
  });

  it('should persist theme preference', () => {
    service.initialize();
    service.toggle();
    expect(localStorage.getItem('app-theme')).toBe('dark');
  });

  it('should restore saved theme', () => {
    localStorage.setItem('app-theme', 'dark');
    service.initialize();
    expect(service.isDark()).toBe(true);
  });

  it('should toggle back to light', () => {
    service.initialize();
    service.toggle();
    service.toggle();
    expect(service.isDark()).toBe(false);
    expect(document.documentElement.classList.contains('dark-theme')).toBe(false);
  });

  it('System follows this computer: dark when it is dark, and it changes when the setting changes', () => {
    const original = window.matchMedia;
    let listener: () => void = () => {};
    const media = { matches: true, addEventListener: (_: string, l: () => void) => { listener = l; } };
    (window as any).matchMedia = () => media;
    try {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'browser' }] });
      const system = TestBed.inject(ThemeService);
      system.initialize();
      expect(system.mode()).toBe('system');
      expect(system.isDark()).toBe(true);

      media.matches = false;
      listener();
      expect(system.isDark()).toBe(false);
      expect(document.documentElement.classList.contains('dark-theme')).toBe(false);

      system.setMode('dark');
      media.matches = false;
      listener();
      expect(system.isDark()).toBe(true);
      expect(localStorage.getItem('app-theme')).toBe('dark');
    } finally {
      (window as any).matchMedia = original;
    }
  });

  it('a saved System choice is restored as System', () => {
    localStorage.setItem('app-theme', 'system');
    service.initialize();
    expect(service.mode()).toBe('system');
  });
  it('an unknown saved value is read as System, never as a fixed theme', () => {
    localStorage.setItem('app-theme', 'purple');
    service.initialize();
    expect(service.mode()).toBe('system');
  });

  it('a second initialize listens to the computer setting once, not twice', () => {
    const original = window.matchMedia;
    const add = vi.fn();
    (window as any).matchMedia = () => ({ matches: false, addEventListener: add });
    try {
      service.initialize();
      service.initialize();
      expect(add).toHaveBeenCalledTimes(1);
    } finally {
      (window as any).matchMedia = original;
    }
  });
});
