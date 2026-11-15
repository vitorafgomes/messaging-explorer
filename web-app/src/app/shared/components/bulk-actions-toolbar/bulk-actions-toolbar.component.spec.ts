import { TestBed } from '@angular/core/testing';
import { BulkActionsToolbarComponent } from './bulk-actions-toolbar.component';

describe('BulkActionsToolbarComponent', () => {
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function render(selectedCount: number) {
    const fixture = TestBed.createComponent(BulkActionsToolbarComponent);
    fixture.componentInstance.selectedCount = selectedCount;
    fixture.componentInstance.detail = 'selected of 20 loaded, 37 in the dead-letter queue';
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('with nothing selected the bar stays on screen, says how to select and offers no action', () => {
    const el = render(0);

    expect(text(el)).toBe('No message selected. Tick rows to resubmit, move, compare, export or delete them.');
    expect(el.querySelectorAll('button')).toHaveLength(0);
  });

  it('with a selection it says what the selection covers and offers the actions', () => {
    const el = render(3);

    expect(text(el.querySelector('.selection'))).toBe('3 selected of 20 loaded, 37 in the dead-letter queue');
    expect(Array.from(el.querySelectorAll('button')).map(text)).toEqual(['Move', 'Export', 'Clear', 'Delete 3']);
  });

  it('orders the actions as drawn: Resubmit, Move, Compare, Export, Cancel scheduled, Clear, then Delete with the count, apart', () => {
    const fixture = TestBed.createComponent(BulkActionsToolbarComponent);
    Object.assign(fixture.componentInstance, { selectedCount: 2, showResubmit: true, showCompare: true, showCancelScheduled: true });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll('button'));
    expect(buttons.map(text)).toEqual(['Resubmit', 'Move', 'Compare', 'Export', 'Cancel scheduled', 'Clear', 'Delete 2']);
    const del = buttons[buttons.length - 1];
    expect(del.previousElementSibling?.classList).toContain('divider');
    expect(del.classList).toContain('delete');
    expect(del.hasAttribute('matbutton') && !del.getAttribute('matbutton')).toBe(true);
    expect(buttons.find(b => text(b) === 'Clear')!.querySelector('mat-icon')).toBeNull();
  });

  it('a blocked Cancel scheduled says why on a line of its own', () => {
    const fixture = TestBed.createComponent(BulkActionsToolbarComponent);
    Object.assign(fixture.componentInstance, { selectedCount: 2, showCancelScheduled: true, cancelScheduledBlockedReason: '1 of the 2 selected is not scheduled.' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('p#cancel-scheduled-reason'))).toBe('Cancel scheduled is off: 1 of the 2 selected is not scheduled.');
  });
});

describe('BulkActionsToolbarComponent: deferred actions', () => {
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function render(inputs: object) {
    const fixture = TestBed.createComponent(BulkActionsToolbarComponent);
    Object.assign(fixture.componentInstance, { selectedCount: 3, ...inputs });
    fixture.detectChanges();
    return fixture;
  }

  it('with deferred messages selected it offers Resubmit deferred and Dead-letter deferred among the routine actions, and Delete N deferred apart in the error colour', () => {
    const fixture = render({ deferredCount: 2, deferredNote: 'The deferred actions act on the 2 deferred only.' });
    const el = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll('button'));

    expect(buttons.map(text), 'the order: routine actions, deferred routine actions, Clear, then the deletes apart')
      .toEqual(['Move', 'Export', 'Resubmit deferred', 'Dead-letter deferred', 'Clear', 'Delete 3', 'Delete 2 deferred']);
    const deleteDeferred = buttons[buttons.length - 1];
    expect(deleteDeferred.classList, 'Delete N deferred is in the error colour').toContain('delete');
    expect(text(el.querySelector('.deferred-note')), 'the note says what the deferred actions leave out').toBe('The deferred actions act on the 2 deferred only.');

    const emitted: string[] = [];
    fixture.componentInstance.actionClicked.subscribe(e => emitted.push(e.action));
    [buttons[2], buttons[3], deleteDeferred].forEach(b => b.click());
    expect(emitted, 'each deferred button emits its own action').toEqual(['resubmit-deferred', 'deadletter-deferred', 'delete-deferred']);
  });

  it('with no deferred message selected it offers no deferred action and no note', () => {
    const el = render({}).nativeElement as HTMLElement;

    expect(Array.from(el.querySelectorAll('button')).map(text), 'no deferred action').toEqual(['Move', 'Export', 'Clear', 'Delete 3']);
    expect(el.querySelector('.deferred-note'), 'no note').toBeNull();
  });
});
