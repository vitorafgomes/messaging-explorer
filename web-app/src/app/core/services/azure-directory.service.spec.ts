import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AzureDirectoryService } from './azure-directory.service';
import { ApiService } from './api.service';

describe('AzureDirectoryService: sign in, list the subscriptions and namespaces, sign out, through ApiService only', () => {
  let service: AzureDirectoryService;
  let get: ReturnType<typeof vi.fn>;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    get = vi.fn(() => of([]));
    post = vi.fn(() => of({}));
    TestBed.configureTestingModule({ providers: [AzureDirectoryService, { provide: ApiService, useValue: { get, post } }] });
    service = TestBed.inject(AzureDirectoryService);
  });

  it('signs in and out with POSTs to azure-directory, sending the authentication and the tenant typed, nothing else', () => {
    service.signIn('InteractiveBrowser', '00000000-0000-0000-0000-0000000000c1').subscribe();
    service.signIn('AzureCli').subscribe();
    service.signOut().subscribe();

    expect(post.mock.calls, 'the four routes are reached through ApiService, which attaches the key').toStrictEqual([
      ['azure-directory/sign-in', { authType: 'InteractiveBrowser', tenantId: '00000000-0000-0000-0000-0000000000c1' }],
      ['azure-directory/sign-in', { authType: 'AzureCli', tenantId: undefined }],
      ['azure-directory/sign-out', {}]
    ]);
  });

  it('lists the subscriptions, and the namespaces of one with its ID encoded as one path segment', () => {
    service.subscriptions().subscribe();
    service.namespaces('00000000-0000-0000-0000-00000000000a').subscribe();
    service.namespaces('a/../b').subscribe();

    expect(get.mock.calls).toStrictEqual([
      ['azure-directory/subscriptions'],
      ['azure-directory/subscriptions/00000000-0000-0000-0000-00000000000a/namespaces'],
      ['azure-directory/subscriptions/a%2F..%2Fb/namespaces']
    ]);
  });
});
