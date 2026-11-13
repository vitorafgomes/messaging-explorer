import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { MatDialogRef } from '@angular/material/dialog';
import { ConnectionGroupService, ConnectionService, DefinitionsService, EntitySelectionService } from '../../core/services';
import { DefinitionsImportResult } from '../../core/models';
import { ImportDefinitionsDialogComponent } from './import-definitions-dialog.component';

describe('ImportDefinitionsDialogComponent: a dry run first, then create only what does not exist, confirmed by the namespace', () => {
  let fixture: ComponentFixture<ImportDefinitionsDialogComponent>;
  let el: HTMLElement;
  let dryRun: ReturnType<typeof vi.fn>;
  let importFn: ReturnType<typeof vi.fn>;
  let refreshTree: ReturnType<typeof vi.fn>;
  let dialogRef: { close: ReturnType<typeof vi.fn>; disableClose?: boolean };

  const DOCUMENT = {
    version: 1,
    entities: {
      queues: [{ name: 'orders' }, { name: 'billing' }, { name: 'orders-archive' }],
      topics: [{ name: 'events', subscriptions: [{ name: 'warehouse', rules: [{ name: 'a' }, { name: 'b' }] }] }]
    }
  };

  const PLAN: DefinitionsImportResult = {
    dryRun: true,
    items: [
      { kind: 'Queue', name: 'orders', topic: null, outcome: 'Exists', differingFields: null, reason: null },
      { kind: 'Queue', name: 'billing', topic: null, outcome: 'Differs', differingFields: ['maxDeliveryCount', 'lockDuration'], reason: null },
      { kind: 'Queue', name: 'orders-archive', topic: null, outcome: 'Create', differingFields: null, reason: null },
      { kind: 'Topic', name: 'events', topic: null, outcome: 'Exists', differingFields: null, reason: null },
      { kind: 'Subscription', name: 'warehouse', topic: 'events', outcome: 'Create', differingFields: null, reason: null }
    ]
  };

  const RESULT: DefinitionsImportResult = {
    dryRun: false,
    items: [
      { kind: 'Queue', name: 'orders', topic: null, outcome: 'Exists', differingFields: null, reason: null },
      { kind: 'Queue', name: 'billing', topic: null, outcome: 'Differs', differingFields: ['maxDeliveryCount'], reason: null },
      { kind: 'Queue', name: 'orders-archive', topic: null, outcome: 'Created', differingFields: null, reason: null },
      { kind: 'Topic', name: 'events', topic: null, outcome: 'Exists', differingFields: null, reason: null },
      { kind: 'Subscription', name: 'warehouse', topic: 'events', outcome: 'Failed', differingFields: null, reason: 'The broker did not create it.' }
    ]
  };

  function open(plan: () => unknown = () => of(PLAN), result: () => unknown = () => of(RESULT)) {
    dryRun = vi.fn(plan);
    importFn = vi.fn(result);
    refreshTree = vi.fn();
    dialogRef = { close: vi.fn() };
    TestBed.configureTestingModule({
      imports: [ImportDefinitionsDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: DefinitionsService, useValue: { dryRun, import: importFn } },
        { provide: EntitySelectionService, useValue: { refreshTree } },
        {
          provide: ConnectionService,
          useValue: { currentTarget: 'contoso-prod', currentConnectionId: 'c-1', getConnections: () => of([{ id: 'c-1', name: 'contoso', clientId: 'g-client', environmentId: 'g-env' }]) }
        },
        {
          provide: ConnectionGroupService,
          useValue: { getGroups: () => of([{ id: 'g-client', name: 'Contoso', type: 'client' }, { id: 'g-env', name: 'Production', type: 'environment' }]) }
        }
      ]
    });
    fixture = TestBed.createComponent(ImportDefinitionsDialogComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  async function choose(content: string, name = 'contoso-dev.definitions.json') {
    const picker = { files: [new File([content], name, { type: 'application/json' })], value: name } as unknown as HTMLInputElement;
    await fixture.componentInstance.read(picker);
    fixture.detectChanges();
  }

  const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const button = (label: string) => Array.from(el.querySelectorAll('button')).find(b => text(b).endsWith(label)) as HTMLButtonElement | undefined;
  const create = () => Array.from(el.querySelectorAll('button')).find(b => text(b).includes('Create ')) as HTMLButtonElement | undefined;
  const typeNamespace = (value: string) => {
    const input = el.querySelector('input[matInput]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const row = (li: Element) => Array.from(li.children).map(text).join(' ');
  const group = (label: string) => Array.from(el.querySelectorAll(`section[aria-label="${label}"] li`)).map(row);
  const facts = () => Array.from(el.querySelectorAll('.fact')).map(f => `${text(f.querySelector('dt'))}: ${text(f.querySelector('dd'))}`);

  it('runs the dry run on the file as read and shows what would be created, what exists and what differs, with the fields', async () => {
    open();

    await choose(JSON.stringify(DOCUMENT));

    expect(dryRun).toHaveBeenCalledExactlyOnceWith(DOCUMENT);
    expect(importFn).not.toHaveBeenCalled();
    expect(text(el.querySelector('.file .grow'))).toBe('contoso-dev.definitions.json: 3 queues, 1 topic, 1 subscription, 2 rules');
    expect(group('Would be created')).toStrictEqual(['orders-archive queue', 'warehouse subscription in events']);
    expect(group('Already exist')).toStrictEqual(['orders queue', 'events topic']);
    expect(group('Exist and differ')).toStrictEqual(['billing queue Differs in: maxDeliveryCount, lockDuration']);
    expect(text(el.querySelector('.notice span'))).toBe(
      'Import only creates. 2 entities would be created. 3 already exist and stay exactly as they are. Nothing is updated and nothing is deleted.');
  });

  it('the confirmation names the target connection and environment, and Create stays disabled until the namespace is typed exactly', async () => {
    open();
    await choose(JSON.stringify(DOCUMENT));

    expect(facts()).toStrictEqual(['Connection: contoso (contoso-prod)', 'Environment: Contoso / Production', 'Would be created: 2']);
    expect(text(create())).toBe('upload Create 2 entities');
    expect(create()!.disabled).toBe(true);

    for (const wrong of ['contoso-pro', 'Contoso-prod', 'contoso-prod ', 'contoso-dev']) {
      typeNamespace(wrong);
      expect(create()!.disabled, wrong).toBe(true);
    }
    create()!.click();
    expect(importFn).not.toHaveBeenCalled();

    typeNamespace('contoso-prod');
    expect(create()!.disabled).toBe(false);
  });

  it('Create sends the same document for the import and shows the result of each entity, then reloads the tree', async () => {
    open();
    await choose(JSON.stringify(DOCUMENT));
    typeNamespace('contoso-prod');

    create()!.click();
    fixture.detectChanges();

    expect(importFn).toHaveBeenCalledExactlyOnceWith(DOCUMENT);
    expect(text(el.querySelector('[role="status"]'))).toBe('1 created, 3 left as they are, 1 failed.');
    expect(Array.from(el.querySelectorAll('.results li')).map(row)).toStrictEqual([
      'orders queue Already existed. Left as it is.',
      'billing queue Exists with another configuration (maxDeliveryCount). Left as it is.',
      'orders-archive queue Created',
      'events topic Already existed. Left as it is.',
      'warehouse subscription in events Failed: The broker did not create it.'
    ]);
    expect(refreshTree).toHaveBeenCalledTimes(1);
    expect(button('Close')).toBeDefined();
  });

  it('a document the API refuses is shown in its words, naming the field, and nothing can be created', async () => {
    const refusal = 'entities.queues[0]: lockDuration must be between 00:00:05 and 00:05:00.';
    open(() => throwError(() => new HttpErrorResponse({ status: 400, error: { message: refusal } })));

    await choose(JSON.stringify(DOCUMENT));

    expect(text(el.querySelector('[role="alert"] .grow'))).toBe(refusal);
    expect(create()).toBeUndefined();
  });

  it('a file that is not JSON is refused before the API is called', async () => {
    open();

    await choose('not json at all', 'notes.txt');

    expect(text(el.querySelector('[role="alert"] .grow'))).toBe('This file is not JSON. Choose a file written by Export definitions.');
    expect(dryRun).not.toHaveBeenCalled();
  });

  it('when every entity already exists there is nothing to create and no Create button', async () => {
    open(() => of({ dryRun: true, items: PLAN.items.filter(i => i.outcome !== 'Create') }));

    await choose(JSON.stringify(DOCUMENT));

    expect(text(el.querySelector('mat-dialog-content'))).toContain('Nothing to create: every entity in the file already exists here.');
    expect(create()).toBeUndefined();
  });

  it('an import the API does not confirm says some entities may exist now and offers the dry run again', async () => {
    open(() => of(PLAN), () => throwError(() => new HttpErrorResponse({ status: 500 })));
    await choose(JSON.stringify(DOCUMENT));
    typeNamespace('contoso-prod');

    create()!.click();
    fixture.detectChanges();

    expect(text(el.querySelector('[role="alert"] .grow'))).toBe(
      'The API did not confirm the import. Some entities may have been created: run the dry run again to see what exists now.');
    expect(button('Run the dry run again')).toBeDefined();
    expect(refreshTree).not.toHaveBeenCalled();
  });

  it('while the import runs the dialog cannot be closed, so its result is never abandoned half way', async () => {
    const pending = new Subject<DefinitionsImportResult>();
    open(() => of(PLAN), () => pending);
    await choose(JSON.stringify(DOCUMENT));
    typeNamespace('contoso-prod');

    create()!.click();
    fixture.detectChanges();

    expect(button('Cancel')!.disabled).toBe(true);
    expect(dialogRef.disableClose).toBe(true);
    button('Cancel')!.click();
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(pending.observed).toBe(true);

    pending.next(RESULT);
    fixture.detectChanges();
    expect(dialogRef.disableClose).toBe(false);
  });
});
