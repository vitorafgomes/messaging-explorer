import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppLogService, LogLine } from '../../core/services/app-log.service';
import { LogsComponent } from './logs.component';

const line = (key: string, level: LogLine['level'], source: LogLine['source'], text: string, detail: [string, string][] = []): LogLine =>
  ({ key, time: new Date('2026-11-19T10:42:07Z'), level, source, text, detail });

describe('LogsComponent, as Logs.dc.html draws it', () => {
  const lines = signal<LogLine[]>([]);
  const readError = signal('');
  const clear = vi.fn();
  const words = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function render(shown: LogLine[]) {
    lines.set(shown);
    readError.set('');
    clear.mockReset();
    TestBed.configureTestingModule({
      imports: [LogsComponent],
      providers: [provideNoopAnimations(), { provide: AppLogService, useValue: { lines, readError, clear } }, { provide: MatSnackBar, useValue: { open: vi.fn() } }]
    });
    const fixture = TestBed.createComponent(LogsComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = () => Array.from(el.querySelectorAll('ul.lines li')).map(li => words(li.querySelector('.text')));
    const button = (label: string) => Array.from(el.querySelectorAll('button')).find(b => words(b) === label) as HTMLButtonElement;
    return { fixture, el, rows, button };
  }

  const sample = [
    line('b2', 'Error', 'Backend', 'GET /api/queues/orders/deadletter answered 500 in 412 ms', [['Category', 'Request'], ['Error', 'NotSupportedException']]),
    line('s1', 'Error', 'Screen', 'GET queues/orders/deadletter answered 500.', [['Status', '500']]),
    line('b1', 'Info', 'Backend', 'Connected to contoso-prod')
  ];

  it('lists each line with its time, level, source and words, counts each level, and says how many are shown', () => {
    const { el, rows } = render(sample);

    expect(rows()).toEqual(sample.map(l => l.text));
    expect(Array.from(el.querySelectorAll('mat-button-toggle')).map(words)).toEqual(['All 3', 'Errors 2', 'Warnings 0', 'Info 1']);
    expect(Array.from(el.querySelector('ul.lines li')!.querySelectorAll('.time, .level, .source')).map(words).slice(1)).toEqual(['Error', 'Backend']);
    expect(words(el.querySelector('.status'))).toBe('Following new lines. 3 of 3 lines shown.');
    expect(words(el.querySelector('.notice'))).toContain('No connection string, password, key, token or message body is ever written here.');
  });

  it('a level, a source and a search narrow the list, and a search that matches nothing says so', () => {
    const { fixture, el, rows } = render(sample);
    const component = fixture.componentInstance;

    component.level.set('Error');
    component.source.set('Backend');
    fixture.detectChanges();
    expect(rows()).toEqual(['GET /api/queues/orders/deadletter answered 500 in 412 ms']);

    component.query.set('no such words');
    fixture.detectChanges();
    expect(words(el.querySelector('[data-testid="logs-none"]'))).toBe('No line matches the level, the source and the search.');
  });

  it('the sources offered are every source, Backend, Desktop app and Screen, in the order the artboard draws, and Desktop app narrows to its lines', async () => {
    const desktop = line('d1', 'Warning', 'Desktop app', 'The release list could not be reached.');
    const { fixture, rows } = render([...sample, desktop]);
    expect(fixture.componentInstance.sources).toEqual(['Backend', 'Desktop app', 'Screen']);

    fixture.componentInstance.source.set('Desktop app');
    fixture.detectChanges();
    expect(rows()).toEqual([desktop.text]);
  });

  it('a line opens to its details, with Copy this line, and a search finds a word of the details', () => {
    const { fixture, el, rows } = render(sample);
    const first = el.querySelector('ul.lines li button.line') as HTMLButtonElement;
    expect(first.getAttribute('aria-expanded')).toBe('false');

    first.click();
    fixture.detectChanges();

    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(Array.from(el.querySelectorAll('.detail dt, .detail dd')).map(words)).toEqual(['Category', 'Request', 'Error', 'NotSupportedException']);
    expect(Array.from(el.querySelectorAll('.detail button')).map(words)).toEqual(['Copy this line']);

    fixture.componentInstance.query.set('notsupportedexception');
    fixture.detectChanges();
    expect(rows()).toEqual([sample[0].text]);
  });

  it('Pause holds the list while new lines arrive, Resume shows them, and Clear forgets them', () => {
    const { fixture, el, rows, button } = render([sample[2]]);

    button('Pause').click();
    lines.set(sample);
    fixture.detectChanges();
    expect(rows()).toEqual([sample[2].text]);
    expect(words(el.querySelector('.status'))).toBe('Paused. 1 of 1 lines shown.');

    button('Resume').click();
    fixture.detectChanges();
    expect(rows().length).toBe(3);

    button('Clear').click();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('with nothing logged it says so, and lines that could not be read are an error, never an empty list', () => {
    const { fixture, el } = render([]);
    expect(words(el.querySelector('[data-testid="logs-empty"]'))).toBe('Nothing was logged yet.');

    readError.set('The lines of the backend could not be read. The local API gave no answer.');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="logs-read-error"]')?.getAttribute('role')).toBe('alert');
  });
});
