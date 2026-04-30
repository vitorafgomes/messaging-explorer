import { Injectable, signal, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root',
})
export class DevSettingsService {
  private readonly STORAGE_KEY = 'dev-mode';
  private readonly isBrowser: boolean;

  private readonly _devMode = signal<boolean>(false);

  readonly devMode = this._devMode.asReadonly();

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  initialize(): void {
    if (!this.isBrowser) return;

    const saved = localStorage.getItem(this.STORAGE_KEY);
    this._devMode.set(saved === 'true');
  }

  toggle(): void {
    const newValue = !this._devMode();
    this._devMode.set(newValue);

    if (this.isBrowser) {
      localStorage.setItem(this.STORAGE_KEY, String(newValue));
    }
  }
}
