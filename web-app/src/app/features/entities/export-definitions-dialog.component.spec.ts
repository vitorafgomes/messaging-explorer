import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { MatDialogRef } from '@angular/material/dialog';
import { ConnectionGroupService, ConnectionService, DefinitionsService, MessageExportService } from '../../core/services';
import { EntityDefinitionsDocument } from '../../core/models';
import { ExportDefinitionsDialogComponent, definitionsFileName } from './export-definitions-dialog.component';

describe('ExportDefinitionsDialogComponent: the definitions of the namespace to one file', () => {
  let fixture: ComponentFixture<ExportDefinitionsDialogComponent>;
  let el: HTMLElement;
  let exportFn: ReturnType<typeof vi.fn>;
  let downloadFile: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  const DOCUMENT: EntityDefinitionsDocument = {
    version: 1,
    exportedAt: '2026-11-13T10:00:00+00:00',
    entities: {
      queues: [{ name: 'orders' }, { name: 'billing' }],
      topics: [{ name: 'events', subscriptions: [{ name: 'audit', rules: [{ name: '$Default' }] }] }]
    }
  };

  function open(answer: () => unknown) {
    exportFn = vi.fn(answer);
    downloadFile = vi.fn();
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [ExportDefinitionsDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close } },
        { provide: DefinitionsService, useValue: { export: exportFn } },
        { provide: MessageExportService, useValue: { downloadFile } },
        {
          provide: ConnectionService,
          useValue: { currentTarget: 'contoso-prod', currentConnectionId: 'c-1', getConnections: () => of([{ id: 'c-1', name: 'contoso', environmentId: 'g-env' }]) }
        },
        { provide: ConnectionGroupService, useValue: { getGroups: () => of([{ id: 'g-env', name: 'Production', type: 'environment' }]) } }
      ]
    });
    fixture = TestBed.createComponent(ExportDefinitionsDialogComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const button = (label: string) => Array.from(el.querySelectorAll('button')).find(b => text(b).endsWith(label)) as HTMLButtonElement | undefined;
  const click = (label: string) => {
    button(label)!.click();
    fixture.detectChanges();
  };

  it('names the connection and its environment, says messages and secrets are not in the file, and reads nothing until asked', () => {
    open(() => of(DOCUMENT));

    expect([text(el.querySelector('.context mat-chip')), text(el.querySelector('.context > span'))]).toStrictEqual(['Production', 'From contoso (contoso-prod)']);
    expect(Array.from(el.querySelectorAll('.fact')).map(f => `${text(f.querySelector('dt'))}: ${text(f.querySelector('dd'))}`)).toStrictEqual([
      'File: contoso-prod.definitions.json',
      'Messages: Not included',
      'Secrets: None: an entity definition holds no secret'
    ]);
    expect(exportFn).not.toHaveBeenCalled();
  });

  it('Export downloads the document as <namespace>.definitions.json and says what it holds', () => {
    open(() => of(DOCUMENT));

    click('Export to a file');

    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [content, fileName, mimeType] = downloadFile.mock.calls[0];
    expect([fileName, mimeType]).toStrictEqual(['contoso-prod.definitions.json', 'application/json']);
    expect(JSON.parse(content)).toStrictEqual(DOCUMENT);
    expect(text(el.querySelector('[role="status"] span'))).toBe('Saved contoso-prod.definitions.json: 2 queues, 1 topic, 1 subscription, 1 rule.');
  });

  it('an empty namespace still saves the file and says it holds no entity', () => {
    open(() => of({ version: 1, entities: { queues: [], topics: [] } }));

    click('Export to a file');

    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(text(el.querySelector('[role="status"]'))).toContain('This namespace has no queue and no topic, so the file holds none.');
  });

  it('while it runs the button is disabled and a progress bar is named; Cancel abandons the request', () => {
    const pending = new Subject<EntityDefinitionsDocument>();
    open(() => pending);

    click('Export to a file');

    expect(button('Export to a file')!.disabled).toBe(true);
    expect(el.querySelector('mat-progress-bar')?.getAttribute('aria-label')).toBe('Exporting');
    click('Cancel');
    expect(pending.observed).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('a failure says nothing was saved and offers Retry; a 400 is shown in the API words', () => {
    open(() => throwError(() => new HttpErrorResponse({ status: 500 })));

    click('Export to a file');

    expect(text(el.querySelector('[role="alert"] .grow'))).toBe('Could not export: the API did not answer with the definitions. Nothing was saved.');
    expect(downloadFile).not.toHaveBeenCalled();

    exportFn.mockImplementation(() => throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'This provider does not support entity definitions.' } })));
    click('Retry');
    expect(text(el.querySelector('[role="alert"] .grow'))).toBe('This provider does not support entity definitions.');
    expect(exportFn).toHaveBeenCalledTimes(2);
  });

  it('the file name keeps only letters, digits, dot, dash and underscore', () => {
    expect(definitionsFileName('orders.example')).toBe('orders.example.definitions.json');
    expect(definitionsFileName('a/b c')).toBe('a-b-c.definitions.json');
    expect(definitionsFileName(undefined)).toBe('namespace.definitions.json');
  });
});
