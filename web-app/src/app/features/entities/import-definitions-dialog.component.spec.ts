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
      queues: [{ name: 'orders' }, { name: 'billing', options: { maxDeliveryCount: 10 } }, { name: 'orders-archive' }],
      topics: [{ name: 'events', subscriptions: [{ name: 'warehouse', rules: [{ name: 'a' }, { name: 'b' }] }] }]
    }
  };

  const PLAN: DefinitionsImportResult = {
    dryRun: true,
    items: [
      { kind: 'Queue', name: 'orders', topic: null, outcome: 'Exists', differingFields: null, reason: null },
      {
        kind: 'Queue', name: 'billing', topic: null, outcome: 'Differs', differingFields: ['maxDeliveryCount', 'lockDuration', 'forwardTo'], reason: null,
        differences: [
          { field: 'maxDeliveryCount', current: 5, inFile: 10 },
          { field: 'lockDuration', current: '00:01:00', inFile: '00:00:30' },
          { field: 'forwardTo', current: '', inFile: 'orders' }
        ]
      },
      { kind: 'Queue', name: 'orders-archive', topic: null, outcome: 'Create', differingFields: null, reason: null },
      { kind: 'Topic', name: 'events', topic: null, outcome: 'Exists', differingFields: null, reason: null },
      { kind: 'Subscription', name: 'warehouse', topic: 'events', outcome: 'Create', differingFields: null, reason: null }
    ]
  };

  const RESULT: DefinitionsImportResult = {
    dryRun: false,
    items: [
      { kind: 'Queue', name: 'orders', topic: null, outcome: 'Exists', differingFields: null, reason: null },
      { kind: 'Queue', name: 'billing', topic: null, outcome: 'Differs', differingFields: ['maxDeliveryCount', 'lockDuration'], reason: null },
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
          useValue: { getGroups: () => of([{ id: 'g-client', name: 'Contoso', type: 'client' }, { id: 'g-env', name: 'Production', type: 'environment', isProduction: true }]) }
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
  const cells = (tr: Element) => Array.from(tr.children).map(text).join(' | ');
  const table = () => Array.from(el.querySelectorAll('table.dry-run tr')).map(cells);
  const facts = () => Array.from(el.querySelectorAll('.fact')).map(f => `${text(f.querySelector('dt'))}: ${text(f.querySelector('dd'))}`);

  it('as Monitoring.dc.html draws it: the PRODUCTION chip, then "Into <connection>"', () => {
    open();
    const chip = el.querySelector('.environment-line .environment-chip') as HTMLElement;

    expect(chip?.textContent?.replace('warning', '').trim(), 'the import opens with the PRODUCTION chip').toBe('PRODUCTION');
    expect(chip.classList.contains('production'), 'a production environment takes the error container').toBe(true);
    expect(text(el.querySelector('.environment-line .where'))).toBe('Into Contoso (contoso-prod)');
  });

  it('as Monitoring.dc.html draws it: the dry run as a table of Entity, Kind, Result and Detail, in the order of the file', async () => {
    open();

    await choose(JSON.stringify(DOCUMENT));

    expect(dryRun).toHaveBeenCalledExactlyOnceWith(DOCUMENT);
    expect(importFn).not.toHaveBeenCalled();
    expect(text(el.querySelector('.file .grow')), 'the file records no source, so the line names the file and its counts').toBe(
      'contoso-dev.definitions.json: 3 queues, 1 topic, 1 subscription, 2 rules');
    expect(table(), 'each entity with its result chip and the detail the artboard draws; a difference gives its value here and in the file').toStrictEqual([
      'Entity | Kind | Result | Detail',
      'orders | Queue | check_circle Already exists | Same definition. Left as it is.',
      'billing | Queue | warning Exists and differs | Max delivery count is 5 here and 10 in the file. Lock duration is 00:01:00 here and 00:00:30 in the file. Forward to is not set here and orders in the file. Left as it is.',
      'orders-archive | Queue | add Would be created | With the configuration in the file.',
      'events | Topic | check_circle Already exists | Same definition. Left as it is.',
      'warehouse in events | Subscription | add Would be created | With its 2 rules.'
    ]);
    expect(text(el.querySelector('.notice span')), 'the drawn sentence counts what exists and what differs apart').toBe(
      'Import only creates. 2 entities would be created. 2 already exist and 1 exists and differs: these 3 stay exactly as they are. Nothing is updated and nothing is deleted.');
  });

  it('as Monitoring.dc.html draws it: a file that names its source reads "exported from <source>" before its counts', async () => {
    open();

    await choose(JSON.stringify({ ...DOCUMENT, source: 'contoso-dev' }));

    expect(text(el.querySelector('.file .grow')), 'the file line names the namespace the file was exported from').toBe(
      'contoso-dev.definitions.json exported from contoso-dev: 3 queues, 1 topic, 1 subscription, 2 rules');
  });

  it('a source that is not a text, or is blank, is not shown: the file line stays as for a file without one', async () => {
    for (const source of [42, '  ', { host: 'x' }, null]) {
      TestBed.resetTestingModule();
      open();

      await choose(JSON.stringify({ ...DOCUMENT, source }));

      expect(text(el.querySelector('.file .grow')), `source ${JSON.stringify(source)} is not shown`).toBe(
        'contoso-dev.definitions.json: 3 queues, 1 topic, 1 subscription, 2 rules');
    }
  });

  it('a subscription that exists says its rule is the same, one whose rules differ says so, and the fact names what would be created', async () => {
    const document = { version: 1, entities: { queues: [{ name: 'orders-archive' }], topics: [{ name: 'events', subscriptions: [{ name: 'email', rules: [{ name: '$Default' }] }] }] } };
    open(() => of({
      dryRun: true,
      items: [
        { kind: 'Queue', name: 'orders-archive', topic: null, outcome: 'Create', differingFields: null, reason: null },
        { kind: 'Subscription', name: 'email', topic: 'events', outcome: 'Exists', differingFields: null, reason: null },
        { kind: 'Subscription', name: 'audit', topic: 'events', outcome: 'Differs', differingFields: ['rules'], reason: null, differences: [{ field: 'rules', current: null, inFile: null }] }
      ]
    }));

    await choose(JSON.stringify(document));

    expect(table().slice(1)).toStrictEqual([
      'orders-archive | Queue | add Would be created | With the configuration in the file.',
      'email in events | Subscription | check_circle Already exists | Same definition and the same rule. Left as it is.',
      'audit in events | Subscription | warning Exists and differs | The rules differ here. Left as it is.'
    ]);
    expect(text(el.querySelector('.notice span'))).toBe(
      'Import only creates. 1 entity would be created. 1 already exists and 1 exists and differs: these 2 stay exactly as they are. Nothing is updated and nothing is deleted.');
    expect(facts()[2], 'the names that would be created').toBe('Would be created: Queue orders-archive');
  });

  it('one entity left as it is, and none that differs, reads "1 already exists: it stays exactly as it is."', async () => {
    open(() => of({ dryRun: true, items: PLAN.items.filter(i => i.name === 'orders' || i.name === 'orders-archive') }));

    await choose(JSON.stringify(DOCUMENT));

    expect(text(el.querySelector('.notice span'))).toBe(
      'Import only creates. 1 entity would be created. 1 already exists: it stays exactly as it is. Nothing is updated and nothing is deleted.');
  });

  it('the confirmation names the target connection and environment, and Create stays disabled until the namespace is typed exactly', async () => {
    open();
    await choose(JSON.stringify(DOCUMENT));

    expect(facts(), 'the "Would be created" fact lists the names as drawn').toStrictEqual([
      'Connection: contoso (contoso-prod)', 'Environment: Contoso / Production', 'Would be created: Queue orders-archive, subscription warehouse in events with 2 rules']);
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
      'billing queue Exists with another configuration (Max delivery count, Lock duration). Left as it is.',
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
