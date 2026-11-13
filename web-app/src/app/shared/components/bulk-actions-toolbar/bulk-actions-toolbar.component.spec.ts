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
    expect(Array.from(el.querySelectorAll('button')).map(text)).toEqual(['Delete', 'Move', 'Export', 'Clear']);
  });
});
