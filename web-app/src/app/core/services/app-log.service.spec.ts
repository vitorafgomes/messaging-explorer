import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { ApiFailure, ApiService } from './api.service';
import { AppLogService } from './app-log.service';
import { DevSettingsService } from './dev-settings.service';

describe('AppLogService', () => {
  let failures: Subject<ApiFailure>;
  let api: { failures: Subject<ApiFailure>; get: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  const devMode = signal(false);

  const backendLine = (id: number, level: string, text: string, extra: object = {}) =>
    ({ id, time: `2026-11-19T10:42:0${id}Z`, level, source: 'Backend', category: 'QueuesController', text, ...extra });

  beforeEach(() => {
    failures = new Subject<ApiFailure>();
    api = { failures, get: vi.fn(() => of([])), delete: vi.fn(() => of(undefined)) };
    devMode.set(false);
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, { provide: DevSettingsService, useValue: { devMode } }]
    });
  });

  it('with Developer mode off nothing is read from the backend and a failed call is not kept', () => {
    const log = TestBed.inject(AppLogService);
    TestBed.tick();
    failures.next({ method: 'GET', endpoint: 'queues/orders/deadletter', status: 0 });

    expect(api.get).not.toHaveBeenCalled();
    expect(log.lines()).toEqual([]);
  });

  it('with Developer mode on it reads the lines of the backend, asks next only for what came after, and counts the errors', () => {
    devMode.set(true);
    api.get.mockReturnValueOnce(of([backendLine(1, 'Information', 'Connected'), backendLine(2, 'Error', 'Peek of orders failed', { errorType: 'NotSupportedException', where: 'AzureServiceBusProvider.MapToMessageInfo' })]));
    const log = TestBed.inject(AppLogService);
    TestBed.tick();

    expect(api.get).toHaveBeenCalledWith('logs?after=0');
    expect(log.lines().map(l => [l.level, l.source, l.text])).toEqual([['Error', 'Backend', 'Peek of orders failed'], ['Info', 'Backend', 'Connected']]);
    expect(log.lines()[0].detail).toEqual([['Category', 'QueuesController'], ['Error', 'NotSupportedException'], ['Where', 'AzureServiceBusProvider.MapToMessageInfo']]);
    expect(log.errorCount()).toBe(1);

    log.refresh();
    expect(api.get).toHaveBeenLastCalledWith('logs?after=2');
  });

  it('a call that got no answer, or that the key check refused, is a line of the screen; one the backend answered is not, because the backend logged it', () => {
    devMode.set(true);
    const log = TestBed.inject(AppLogService);
    TestBed.tick();

    failures.next({ method: 'GET', endpoint: 'queues/orders/deadletter', status: 502 });
    failures.next({ method: 'GET', endpoint: 'queues/orders', status: 404 });
    failures.next({ method: 'POST', endpoint: 'connections/c1/connect', status: 0 });
    failures.next({ method: 'GET', endpoint: 'logs', status: 0 });
    failures.next({ method: 'GET', endpoint: 'queues', status: 401 });

    expect(log.lines().map(l => [l.level, l.source, l.text, l.detail]).sort()).toEqual([
      ['Error', 'Screen', 'GET queues was refused before the backend logged it (401).', [['Call', 'GET queues'], ['Status', '401']]],
      ['Error', 'Screen', 'POST connections/c1/connect got no answer.', [['Call', 'POST connections/c1/connect'], ['Status', 'no answer']]]
    ]);
    expect(log.errorCount()).toBe(2);
  });

  describe('in the desktop app', () => {
    let getShellLogs: ReturnType<typeof vi.fn>;
    let clearShellLogs: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      getShellLogs = vi.fn(async () => []);
      clearShellLogs = vi.fn(async () => undefined);
      (window as any).electronAPI = { getShellLogs, clearShellLogs };
    });
    afterEach(() => delete (window as any).electronAPI);

    it('with Developer mode off the lines of the desktop app are not read', () => {
      TestBed.inject(AppLogService);
      TestBed.tick();
      expect(getShellLogs).not.toHaveBeenCalled();
    });

    it('reads the lines of the desktop app as the source Desktop app, asks next only for what came after, and Clear forgets them there too', async () => {
      devMode.set(true);
      getShellLogs.mockResolvedValueOnce([
        { id: 4, time: '2026-11-19T10:40:11.000Z', level: 'Info', category: 'startApi', text: 'API process spawned with PID: 4242' },
        { id: 5, time: '2026-11-19T10:41:02.000Z', level: 'Warning', category: '', text: 'config.json not found' }
      ]);
      const log = TestBed.inject(AppLogService);
      TestBed.tick();
      await Promise.resolve();
      await Promise.resolve();

      expect(getShellLogs).toHaveBeenCalledWith(0);
      expect(log.lines().map(l => [l.level, l.source, l.text, l.detail])).toEqual([
        ['Warning', 'Desktop app', 'config.json not found', []],
        ['Info', 'Desktop app', 'API process spawned with PID: 4242', [['Category', 'startApi']]]
      ]);

      log.refresh();
      expect(getShellLogs).toHaveBeenLastCalledWith(5);

      log.clear();
      expect(log.lines()).toEqual([]);
      expect(clearShellLogs).toHaveBeenCalledTimes(1);
    });

    it('a desktop app that does not answer leaves the other lines as they are', async () => {
      devMode.set(true);
      getShellLogs.mockRejectedValue(new Error('no channel'));
      api.get.mockReturnValueOnce(of([backendLine(1, 'Information', 'Connected')]));
      const log = TestBed.inject(AppLogService);
      TestBed.tick();
      await Promise.resolve();
      await Promise.resolve();

      expect(log.lines().map(l => l.text)).toEqual(['Connected']);
      expect(log.readError()).toBe('');
    });
  });

  it('lines of the backend that cannot be read say so, and Clear forgets every line here and on the backend', () => {
    devMode.set(true);
    api.get.mockReturnValueOnce(throwError(() => ({ status: 0 })));
    const log = TestBed.inject(AppLogService);
    TestBed.tick();
    expect(log.readError()).toBe('The lines of the backend could not be read. The local API gave no answer.');

    failures.next({ method: 'GET', endpoint: 'queues', status: 0 });
    log.clear();

    expect(log.lines()).toEqual([]);
    expect(api.delete).toHaveBeenCalledWith('logs');
  });
});
