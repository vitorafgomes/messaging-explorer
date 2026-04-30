import { Injectable, signal, computed, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private readonly STORAGE_KEY = 'app-theme';
  private readonly isBrowser: boolean;

  private readonly _isDark = signal<boolean>(false);

  readonly isDark = this._isDark.asReadonly();
  readonly themeLabel = computed(() => this._isDark() ? 'Dark' : 'Light');
  readonly themeIcon = computed(() => this._isDark() ? 'dark_mode' : 'light_mode');

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  initialize(): void {
    if (!this.isBrowser) return;

    const saved = localStorage.getItem(this.STORAGE_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = saved ? saved === 'dark' : prefersDark;

    this._isDark.set(isDark);
    this.applyTheme(isDark);
  }

  toggle(): void {
    const newValue = !this._isDark();
    this._isDark.set(newValue);
    this.applyTheme(newValue);

    if (this.isBrowser) {
      localStorage.setItem(this.STORAGE_KEY, newValue ? 'dark' : 'light');
    }
  }

  private applyTheme(isDark: boolean): void {
    if (!this.isBrowser) return;
    document.documentElement.classList.toggle('dark-theme', isDark);
    // Keep data-bs-theme for Bootstrap compatibility during migration
    document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
  }
}
