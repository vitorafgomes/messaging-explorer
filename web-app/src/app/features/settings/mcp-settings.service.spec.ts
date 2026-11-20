import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { McpSettingsService, McpState } from './mcp-settings.service';

const STATE: McpState = {
  enabled: true,
  url: 'http://localhost:5917/mcp',
  hasToken: false,
  tokenCreatedAt: null,
  levels: ['read'],
  supports: { logs: true, appSettings: false, confirmation: false },
  logsAllowed: false,
  connections: [],
};

describe('McpSettingsService: the MCP server group reads and changes its state through ApiService only', () => {
  let service: McpSettingsService;
  let api: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    api = {
      get: vi.fn((): any => of(STATE)),
      post: vi.fn((): any => of({ token: 'tok-1', state: { ...STATE, hasToken: true } })),
      put: vi.fn((): any => of(STATE)),
      delete: vi.fn((): any => of(STATE)),
    };
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    service = TestBed.inject(McpSettingsService);
  });

  it('reaches every route of the contract through ApiService, with a connection id encoded as one path segment', () => {
    service.load().subscribe();
    service.setEnabled(false).subscribe();
    service.createToken().subscribe();
    service.setLevel('c/1 ?', 'read').subscribe();
    service.removeConnection('c/1 ?').subscribe();
    service.setLogs(true).subscribe();
    service.activity().subscribe();
    service.clearActivity().subscribe();

    expect(api.get.mock.calls, 'GET mcp and GET mcp/activity, through ApiService, which attaches the key').toStrictEqual([['mcp'], ['mcp/activity']]);
    expect(api.put.mock.calls, 'the switch, the level of a connection and the logs choice').toStrictEqual([
      ['mcp/enabled', { enabled: false }],
      ['mcp/connections/c%2F1%20%3F', { level: 'read' }],
      ['mcp/logs', { allowed: true }],
    ]);
    expect(api.post.mock.calls, 'a token is created with a POST').toStrictEqual([['mcp/token', {}]]);
    expect(api.delete.mock.calls, 'removing a connection and clearing the list').toStrictEqual([['mcp/connections/c%2F1%20%3F'], ['mcp/activity']]);
  });

  it('reaches the routes of the confirmation window through ApiService: the requests waiting, an answer, and a level with neverAsk only when given', () => {
    service.requests().subscribe();
    service.answer('r/1 ?', false).subscribe();
    service.answer('r-2', true, 'orders').subscribe();
    service.setLevel('c-1', 'readAndSend', true).subscribe();
    service.setLevel('c-1', 'readAndSend').subscribe();

    expect(api.get.mock.calls, 'GET mcp/requests').toStrictEqual([['mcp/requests']]);
    expect(api.post.mock.calls, 'an answer is POST, with the request id encoded as one path segment, and the typed word only when given').toStrictEqual([
      ['mcp/requests/r%2F1%20%3F/answer', { allow: false }],
      ['mcp/requests/r-2/answer', { allow: true, typed: 'orders' }],
    ]);
    expect(api.put.mock.calls, 'neverAsk is sent with the level when given, and left out when not').toStrictEqual([
      ['mcp/connections/c-1', { level: 'readAndSend', neverAsk: true }],
      ['mcp/connections/c-1', { level: 'readAndSend' }],
    ]);
  });

  it('keeps the state the API answered, and only that: a call that fails leaves the state as it was', () => {
    service.load().subscribe();
    expect(service.state(), 'the state GET mcp answered').toStrictEqual(STATE);

    api.put.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    let failed = false;
    service.setEnabled(false).subscribe({ error: () => (failed = true) });
    expect(failed, 'the caller hears the failure, to say it where it happened').toBe(true);
    expect(service.state()?.enabled, 'a switch the API refused is not turned off on the screen').toBe(true);

    api.put.mockReturnValueOnce(of({ ...STATE, enabled: false }));
    service.setEnabled(false).subscribe();
    expect(service.state()?.enabled, 'the switch follows the answer').toBe(false);
  });

  it('an API without the MCP server answers 404 to GET mcp: the feature is absent, with no state and no error', () => {
    api.get.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    let error: unknown = null;
    service.load().subscribe({ error: e => (error = e) });

    expect(service.absent(), 'a 404 means the API lacks the feature').toBe(true);
    expect(service.state(), 'no state to draw').toBeNull();
    expect(error, 'a 404 is not an error to show').toBeNull();
  });

  it('any other failure of GET mcp is an error the caller shows, never the feature quietly absent', () => {
    api.get.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    let error: unknown = null;
    service.load().subscribe({ error: e => (error = e) });

    expect(service.absent(), 'a 500 does not hide the group').toBe(false);
    expect((error as HttpErrorResponse)?.status, 'the caller receives the failure').toBe(500);
  });

  it('creating a token answers the token to the caller and keeps only the new state, never the token', () => {
    let token = '';
    service.createToken().subscribe(t => (token = t));

    expect(token, 'the token goes to the caller, to be shown once').toBe('tok-1');
    expect(service.state()?.hasToken, 'the state the API answered with the token').toBe(true);
    expect(JSON.stringify(service.state()), 'the root service keeps no token').not.toContain('tok-1');
  });
});
