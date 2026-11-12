import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiService } from './api.service';
import { environment } from '../../../environments/environment';

describe('ApiService.patch', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends a PATCH to the endpoint with the body as given and returns the answer', () => {
    let answer: unknown;
    api.patch<{ name: string }>('queues/orders', { lockDuration: '00:05:00' }).subscribe(a => (answer = a));

    const request = http.expectOne(`${environment.apiUrl}/queues/orders`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toStrictEqual({ lockDuration: '00:05:00' });
    request.flush({ name: 'orders' });

    expect(answer).toEqual({ name: 'orders' });
  });

  it('a PATCH the API refuses reaches the caller as an error with the status and the body', () => {
    let status: number | undefined;
    let body: unknown;
    api.patch('queues/orders', { maxDeliveryCount: 0 }).subscribe({
      error: e => {
        status = e.status;
        body = e.error;
      }
    });

    http.expectOne(`${environment.apiUrl}/queues/orders`).flush(
      { message: 'maxDeliveryCount must be between 1 and 2000.' },
      { status: 400, statusText: 'Bad Request' }
    );

    expect(status).toBe(400);
    expect(body).toEqual({ message: 'maxDeliveryCount must be between 1 and 2000.' });
  });
});
