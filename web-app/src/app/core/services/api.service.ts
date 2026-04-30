import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = environment.apiUrl;
  private apiSecret: string | null = null;
  private ready: Promise<void>;

  constructor(private http: HttpClient) {
    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    await Promise.all([this.initializeApiPort(), this.initializeApiSecret()]);
  }

  private async initializeApiPort(): Promise<void> {
    const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null;
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
    if (typeof window !== 'undefined' && (window as any).electronAPI?.getApiSecret) {
      try {
        this.apiSecret = await (window as any).electronAPI.getApiSecret();
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
    return from(this.ready).pipe(switchMap(() => request()));
  }

  get<T>(endpoint: string): Observable<T> {
    const separator = endpoint.includes('?') ? '&' : '?';
    const cacheBuster = `_t=${Date.now()}`;
    return this.waitForReady(() => {
      const url = `${this.baseUrl}/${endpoint}${separator}${cacheBuster}`;
      return this.http.get<T>(url, this.getHeaders());
    });
  }

  post<T>(endpoint: string, data: any): Observable<T> {
    return this.waitForReady(() => {
      const url = `${this.baseUrl}/${endpoint}`;
      return this.http.post<T>(url, data, this.getHeaders());
    });
  }

  put<T>(endpoint: string, data: any): Observable<T> {
    return this.waitForReady(() => {
      const url = `${this.baseUrl}/${endpoint}`;
      return this.http.put<T>(url, data, this.getHeaders());
    });
  }

  delete<T>(endpoint: string): Observable<T> {
    return this.waitForReady(() => {
      const url = `${this.baseUrl}/${endpoint}`;
      return this.http.delete<T>(url, this.getHeaders());
    });
  }
}
