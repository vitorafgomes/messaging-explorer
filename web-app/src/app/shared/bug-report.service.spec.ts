import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { BugReportService, redact } from './bug-report.service';

describe('redact', () => {
  it('takes every address and host out of an error line, so the issue names no connection, namespace or entity', () => {
    expect(redact('2026-11-14T00:00:00.000Z - HTTP 500 Internal Server Error - http://localhost:41234/api/queues/orders/messages/search'))
      .toBe('2026-11-14T00:00:00.000Z - HTTP 500 Internal Server Error - [address]');
    expect(redact('Failed: Endpoint=sb://contoso-prod.servicebus.windows.net/;SharedAccessKeyName=x'))
      .toBe('Failed: Endpoint=[address]');
    expect(redact('could not reach rabbit.contoso.internal:5672 in time')).toBe('could not reach [host] in time');
    expect(redact('Cannot read properties of null (main.js:7)')).toBe('Cannot read properties of null (main.js:7)');
  });
});

describe('BugReportService', () => {
  it('keeps a caught error with its addresses taken out, before the report ever sees it', () => {
    const dialog = { open: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: MatDialog, useValue: dialog }] });
    const service = TestBed.inject(BugReportService);
    service.startCapture();

    window.dispatchEvent(new ErrorEvent('error', { message: 'Request to http://localhost:4100/api/queues/orders failed', filename: 'main.js', lineno: 3 }));
    service.open('bug');

    const errors: string[] = dialog.open.mock.calls[0][1].data.errors;
    expect(errors.some(e => e.includes('Request to [address] failed'))).toBe(true);
    expect(errors.join('\n')).not.toContain('orders');
  });
});
