import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import {
  MessageDiffDialogComponent,
  MessageDiffDialogData,
} from './message-diff-dialog.component';
import { MessageInfo } from '../../core/models';

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
});
