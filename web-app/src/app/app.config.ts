import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { routes } from './app.routes';

// Detect Electron environment
const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Use hash location for Electron to support file:// protocol
    isElectron ? provideRouter(routes, withHashLocation()) : provideRouter(routes),
    provideHttpClient(),
    provideAnimationsAsync()
  ]
};
