import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import {
  MessageDiffDialogComponent,
  MessageDiffDialogData,
} from './message-diff-dialog.component';
import { MessageInfo } from '../../core/models';
import { ConnectionGroupService, ConnectionService } from '../../core/services';

function makeMessage(overrides: Partial<MessageInfo> = {}): MessageInfo {
  return {
    messageId: 'msg-1',
    body: '{"key":"value"}',
    bodyType: 'json',
    sequenceNumber: 1,
    deliveryCount: 1,
    enqueuedTime: new Date('2026-01-01T00:00:00Z'),
    timeToLive: '00:05:00',
    applicationProperties: {},
    ...overrides,
  };
}

describe('MessageDiffDialogComponent', () => {
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };

  function setup(data: MessageDiffDialogData) {
    dialogRefMock = { close: vi.fn() };

    TestBed.configureTestingModule({
      imports: [MessageDiffDialogComponent],
      providers: [
        // The environment line reads the active connection; none is known here, so nothing is requested.
        { provide: ConnectionService, useValue: { currentTarget: 'sample.example.net', currentConnectionId: null } },
        { provide: ConnectionGroupService, useValue: {} },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRefMock },
      ],
    });

    const fixture = TestBed.createComponent(MessageDiffDialogComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    return { fixture, component };
  }

  it('should detect changed properties', () => {
    const { component } = setup({
      left: makeMessage({ messageId: 'id-A', deliveryCount: 1 }),
      right: makeMessage({ messageId: 'id-B', deliveryCount: 3 }),
      entityName: 'test-queue',
    });

    const messageIdProp = component.propertyComparisons.find(p => p.name === 'Message ID');
    expect(messageIdProp).toBeDefined();
    expect(messageIdProp!.status).toBe('changed');
    expect(messageIdProp!.leftValue).toBe('id-A');
    expect(messageIdProp!.rightValue).toBe('id-B');

    const deliveryProp = component.propertyComparisons.find(p => p.name === 'Delivery Count');
    expect(deliveryProp).toBeDefined();
    expect(deliveryProp!.status).toBe('changed');
    expect(deliveryProp!.leftValue).toBe('1');
    expect(deliveryProp!.rightValue).toBe('3');
  });

  it('should detect added and removed app properties', () => {
    const { component } = setup({
      left: makeMessage({
        applicationProperties: { shared: 'same', onlyLeft: 'val' },
      }),
      right: makeMessage({
        applicationProperties: { shared: 'same', onlyRight: 'val' },
      }),
      entityName: 'test-queue',
    });

    const shared = component.appPropertyComparisons.find(p => p.name === 'shared');
    expect(shared).toBeDefined();
    expect(shared!.status).toBe('same');

    const onlyLeft = component.appPropertyComparisons.find(p => p.name === 'onlyLeft');
    expect(onlyLeft).toBeDefined();
    expect(onlyLeft!.status).toBe('only-left');
    expect(onlyLeft!.leftValue).toBe('val');
    expect(onlyLeft!.rightValue).toBe('');

    const onlyRight = component.appPropertyComparisons.find(p => p.name === 'onlyRight');
    expect(onlyRight).toBeDefined();
    expect(onlyRight!.status).toBe('only-right');
    expect(onlyRight!.leftValue).toBe('');
    expect(onlyRight!.rightValue).toBe('val');
  });

  it('should show body diff with additions and removals', () => {
    const { component } = setup({
      left: makeMessage({ body: '{"name":"Alice"}' }),
      right: makeMessage({ body: '{"name":"Bob"}' }),
      entityName: 'test-queue',
    });

    expect(component.bodyDiffs.length).toBeGreaterThan(0);

    const hasRemoved = component.bodyDiffs.some(d => d.removed === true);
    const hasAdded = component.bodyDiffs.some(d => d.added === true);
    expect(hasRemoved).toBe(true);
    expect(hasAdded).toBe(true);
  });

  it('should show empty diff when bodies are identical', () => {
    const body = '{"same":"body"}';
    const { component } = setup({
      left: makeMessage({ body }),
      right: makeMessage({ body }),
      entityName: 'test-queue',
    });

    // All diffs should be context (no added/removed)
    const hasChanges = component.bodyDiffs.some(d => d.added || d.removed);
    expect(hasChanges).toBe(false);
  });

  it('should detect changed app properties', () => {
    const { component } = setup({
      left: makeMessage({
        applicationProperties: { env: 'dev' },
      }),
      right: makeMessage({
        applicationProperties: { env: 'prod' },
      }),
      entityName: 'test-queue',
    });

    const envProp = component.appPropertyComparisons.find(p => p.name === 'env');
    expect(envProp).toBeDefined();
    expect(envProp!.status).toBe('changed');
    expect(envProp!.leftValue).toBe('dev');
    expect(envProp!.rightValue).toBe('prod');
  });

  it('should mark properties as same when values match', () => {
    const { component } = setup({
      left: makeMessage({ messageId: 'same-id' }),
      right: makeMessage({ messageId: 'same-id' }),
      entityName: 'test-queue',
    });

    const messageIdProp = component.propertyComparisons.find(p => p.name === 'Message ID');
    expect(messageIdProp).toBeDefined();
    expect(messageIdProp!.status).toBe('same');
  });

  const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('as Send.dc.html draws it: each body line carries a "-" or "+" mark and says ", removed" or ", added" to a screen reader', () => {
    const { fixture } = setup({
      left: makeMessage({ body: 'one\ntwo\nthree' }),
      right: makeMessage({ body: 'one\nTWO\nthree' }),
      entityName: 'test-queue',
    });
    const el = fixture.nativeElement as HTMLElement;
    const lines = (side: number) => Array.from(el.querySelectorAll('.diff-panel')[side].querySelectorAll('.diff-line')).map(line => [
      text(line.querySelector('.mark')), text(line.querySelector('.line-text')), text(line.querySelector('.visually-hidden'))
    ]);

    expect(lines(0), 'the left side marks the removed line "-" and says ", removed"').toStrictEqual([
      ['', 'one', ''], ['-', 'two', ', removed'], ['', 'three', '']
    ]);
    expect(lines(1), 'the right side marks the added line "+" and says ", added"').toStrictEqual([
      ['', 'one', ''], ['+', 'TWO', ', added'], ['', 'three', '']
    ]);
  });

  it('as Send.dc.html draws it: a missing value reads "Empty" in the properties and the application properties', () => {
    const { fixture } = setup({
      left: makeMessage({ partitionKey: 'customer-1042', applicationProperties: {} }),
      right: makeMessage({ applicationProperties: { carrier: 'SAMPLE-CARRIER' } }),
      entityName: 'test-queue',
    });
    const el = fixture.nativeElement as HTMLElement;
    const tab = (label: string) => {
      (Array.from(el.querySelectorAll('.section-tab')).find(b => text(b) === label) as HTMLButtonElement).click();
      fixture.detectChanges();
    };
    const row = (name: string) => Array.from(el.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(text)).find(cells => cells[0] === name);

    tab('Properties');
    expect(row('Partition Key'), 'a property only one message has reads "Empty" on the other side').toStrictEqual(['Partition Key', 'customer-1042', 'Empty', 'Only Left']);

    tab('App Properties');
    expect(row('carrier'), 'an application property only one message has reads "Empty" on the other side').toStrictEqual(['carrier', 'Empty', 'SAMPLE-CARRIER', 'Only Right']);
  });

  it('as Send.dc.html draws it: the list of Body, Properties and App Properties is named "What to compare"', () => {
    const { fixture } = setup({ left: makeMessage(), right: makeMessage(), entityName: 'test-queue' });
    const nav = (fixture.nativeElement as HTMLElement).querySelector('nav.sections')!;

    expect(nav.getAttribute('aria-label'), 'the section list of the diff is named "What to compare"').toBe('What to compare');
    expect(Array.from(nav.querySelectorAll('button')).map(text), 'the sections compared').toStrictEqual(['Body', 'Properties', 'App Properties']);
  });
});
