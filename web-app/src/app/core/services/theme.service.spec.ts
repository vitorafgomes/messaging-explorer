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
    document.documentElement.removeAttribute('data-bs-theme');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    service = TestBed.inject(ThemeService);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark-theme');
    document.documentElement.removeAttribute('data-bs-theme');
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
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
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
});
