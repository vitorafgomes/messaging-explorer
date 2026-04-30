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
  private secretReady: Promise<void>;

  constructor(private http: HttpClient) {
    this.secretReady = this.initializeApiSecret();
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

  private waitForSecret<T>(request: () => Observable<T>): Observable<T> {
    return from(this.secretReady).pipe(switchMap(() => request()));
  }

  get<T>(endpoint: string): Observable<T> {
    const separator = endpoint.includes('?') ? '&' : '?';
    const cacheBuster = `_t=${Date.now()}`;
    const url = `${this.baseUrl}/${endpoint}${separator}${cacheBuster}`;
    return this.waitForSecret(() => this.http.get<T>(url, this.getHeaders()));
  }

  post<T>(endpoint: string, data: any): Observable<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    return this.waitForSecret(() => this.http.post<T>(url, data, this.getHeaders()));
  }

  put<T>(endpoint: string, data: any): Observable<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    return this.waitForSecret(() => this.http.put<T>(url, data, this.getHeaders()));
  }

  delete<T>(endpoint: string): Observable<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    return this.waitForSecret(() => this.http.delete<T>(url, this.getHeaders()));
  }
}
