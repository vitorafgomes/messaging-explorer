import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ConnectionService } from './connection.service';
import { ApiService } from './api.service';

describe('ConnectionService knows which stored connection is active', () => {
  let post: ReturnType<typeof vi.fn>;
  let service: ConnectionService;

  beforeEach(() => {
    post = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: { get: vi.fn(() => of({ connected: false })), post } }]
    });
    service = TestBed.inject(ConnectionService);
  });

  it('no connection is known at startup, when the status came from the API alone', () => {
    expect(service.currentConnectionId).toBeNull();
  });

  it('a successful connect remembers the id; a disconnect forgets it', () => {
    post.mockReturnValueOnce(of({ connected: true, namespace: 'ns.example.net' }));
    service.connect('c-1').subscribe();
    expect(service.currentConnectionId).toBe('c-1');

    post.mockReturnValueOnce(of({ connected: false }));
    service.disconnect().subscribe();
    expect(service.currentConnectionId).toBeNull();
  });

  it('a connect that fails keeps no id', () => {
    post.mockReturnValueOnce(throwError(() => new Error('500')));
    service.connect('c-2').subscribe({ error: () => undefined });

    expect(service.currentConnectionId).toBeNull();
  });
});
