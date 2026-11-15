import { Injectable, signal, computed, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Light, dark, or whatever this computer is set to. */
export type ThemeMode = 'system' | 'light' | 'dark';

const MODES: ThemeMode[] = ['system', 'light', 'dark'];

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private readonly STORAGE_KEY = 'app-theme';
  private readonly isBrowser: boolean;

  private readonly _isDark = signal<boolean>(false);
  private readonly _mode = signal<ThemeMode>('system');
  private media: MediaQueryList | null = null;

  readonly mode = this._mode.asReadonly();

  readonly isDark = this._isDark.asReadonly();
  readonly themeLabel = computed(() => this._isDark() ? 'Dark' : 'Light');
  readonly themeIcon = computed(() => this._isDark() ? 'dark_mode' : 'light_mode');

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  initialize(): void {
    if (!this.isBrowser || this.media) return;

    const saved = localStorage.getItem(this.STORAGE_KEY) as ThemeMode | null;
    this._mode.set(saved && MODES.includes(saved) ? saved : 'system');
    this.media = window.matchMedia('(prefers-color-scheme: dark)');
    this.media.addEventListener?.('change', () => {
      if (this._mode() === 'system') this.apply();
    });
    this.apply();
  }

  /** Sets the theme and remembers it; System follows this computer's setting as it changes. */
  setMode(mode: ThemeMode): void {
    this._mode.set(mode);
    if (this.isBrowser) localStorage.setItem(this.STORAGE_KEY, mode);
    this.apply();
  }

  toggle(): void {
    this.setMode(this._isDark() ? 'light' : 'dark');
  }

  private apply(): void {
    const mode = this._mode();
    const isDark = mode === 'system' ? !!this.media?.matches : mode === 'dark';
    this._isDark.set(isDark);
    this.applyTheme(isDark);
  }

  private applyTheme(isDark: boolean): void {
    if (!this.isBrowser) return;
    document.documentElement.classList.toggle('dark-theme', isDark);
  }
}
