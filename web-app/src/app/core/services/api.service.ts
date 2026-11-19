import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, Subject, from, switchMap, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

/** A call that failed, as the Logs screen shows it. It names no body and no header. */
export interface ApiFailure {
  method: string;
  endpoint: string;
  status: number;
}

interface ElectronApi {
  getApiPort?: () => Promise<number>;
  getApiSecret?: () => Promise<string>;
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  /** Each call the API answered with an error, or did not answer: the method, the path without its query, and the status. */
  readonly failures = new Subject<ApiFailure>();
  private baseUrl = environment.apiUrl;
  private apiSecret: string | null = null;
  private ready: Promise<void> | null = null;

  constructor(private http: HttpClient) {
    // The browser app has no asynchronous bootstrap work. Keeping its requests
    // synchronous avoids an unnecessary microtask before every HTTP call.
    // Electron still waits for its dynamically assigned API port and secret.
    if (this.getElectronApi()) {
      this.ready = this.initialize();
    }
  }

  private getElectronApi(): ElectronApi | null {
    if (typeof window === 'undefined') {
      return null;
    }
    return (window as Window & typeof globalThis & { electronAPI?: ElectronApi }).electronAPI ?? null;
  }

  private async initialize(): Promise<void> {
    await Promise.all([this.initializeApiPort(), this.initializeApiSecret()]);
  }

  private async initializeApiPort(): Promise<void> {
    const electronAPI = this.getElectronApi();
    if (!electronAPI?.getApiPort) {
      return;
    }
    try {
      const port = await electronAPI.getApiPort();
      if (typeof port === 'number' && port > 0) {
        this.baseUrl = `http://localhost:${port}/api`;
      }
    } catch (e) {
      console.warn('[API SERVICE] Failed to get API port from Electron:', e);
    }
  }

  private async initializeApiSecret(): Promise<void> {
    const electronAPI = this.getElectronApi();
    if (electronAPI?.getApiSecret) {
      try {
        this.apiSecret = await electronAPI.getApiSecret();
      } catch (e) {
        console.warn('[API SERVICE] Failed to get API secret:', e);
      }
    }
  }

  private getHeaders(): { headers?: HttpHeaders } {
    if (this.apiSecret) {
      return { headers: new HttpHeaders({ 'X-Api-Key': this.apiSecret }) };
    }
    return {};
  }

  private waitForReady<T>(request: () => Observable<T>): Observable<T> {
    return this.ready ? from(this.ready).pipe(switchMap(() => request())) : request();
  }

  private noted<T>(method: string, endpoint: string, call: Observable<T>): Observable<T> {
    return call.pipe(tap({
      error: (err: { status?: number } | undefined) =>
        this.failures.next({ method, endpoint: endpoint.split('?')[0], status: typeof err?.status === 'number' ? err.status : 0 })
    }));
  }

  get<T>(endpoint: string): Observable<T> {
    const separator = endpoint.includes('?') ? '&' : '?';
    const cacheBuster = `_t=${Date.now()}`;
    return this.noted('GET', endpoint, this.waitForReady(() => {
      const url = `${this.baseUrl}/${endpoint}${separator}${cacheBuster}`;
      return this.http.get<T>(url, this.getHeaders());
    }));
  }

  post<T>(endpoint: string, data: any): Observable<T> {
    return this.noted('POST', endpoint, this.waitForReady(() => {
      const url = `${this.baseUrl}/${endpoint}`;
      return this.http.post<T>(url, data, this.getHeaders());
    }));
  }

  put<T>(endpoint: string, data: any): Observable<T> {
    return this.noted('PUT', endpoint, this.waitForReady(() => {
      const url = `${this.baseUrl}/${endpoint}`;
      return this.http.put<T>(url, data, this.getHeaders());
    }));
  }

  patch<T>(endpoint: string, data: unknown): Observable<T> {
    return this.noted('PATCH', endpoint, this.waitForReady(() => {
      const url = `${this.baseUrl}/${endpoint}`;
      return this.http.patch<T>(url, data, this.getHeaders());
    }));
  }

  delete<T>(endpoint: string): Observable<T> {
    return this.noted('DELETE', endpoint, this.waitForReady(() => {
      const url = `${this.baseUrl}/${endpoint}`;
      return this.http.delete<T>(url, this.getHeaders());
    }));
  }
}
