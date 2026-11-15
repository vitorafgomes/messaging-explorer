import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { parseSequenceNumbers, TopicCancelScheduledDialogComponent } from './topic-cancel-scheduled-dialog.component';

describe('TopicCancelScheduledDialogComponent', () => {
  let close: ReturnType<typeof vi.fn>;

  function render() {
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [TopicCancelScheduledDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { topicName: 'billing/events' } },
        { provide: MatDialogRef, useValue: { close } }
      ]
    });
    const fixture = TestBed.createComponent(TopicCancelScheduledDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const type = (value: string) => {
      const input = el.querySelector('textarea')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const next = () => Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Next')!;
    return { el, type, next };
  }

  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('names the topic and says plainly that the app does not list its scheduled messages, so the numbers returned when scheduling are needed', () => {
    const { el } = render();

    expect(text(el.querySelector('h2'))).toBe('Cancel scheduled messages of billing/events');
    expect(text(el.querySelector('.explain'))).toBe(
      "This app does not list a topic's scheduled messages yet. Enter the sequence numbers returned when they were scheduled: the send dialog shows the number of each message it schedules.");
  });

  it('closes with exactly the typed numbers, separated by commas, spaces or lines', () => {
    const { type, next } = render();

    expect(next().disabled, 'nothing typed, nothing to cancel').toBe(true);
    type('12, 13\n14 ');
    next().click();

    expect(close).toHaveBeenCalledWith([12, 13, 14]);
  });

  it('a number that is not a positive whole number, a repeat or more than 500 is refused with the reason and Next stays disabled', () => {
    const { el, type, next } = render();

    for (const [value, reason] of [
      ['12, abc', 'Each sequence number must be a positive whole number.'],
      ['0', 'Each sequence number must be a positive whole number.'],
      ['12, 12', 'A sequence number is repeated.'],
      [Array.from({ length: 501 }, (_, i) => i + 1).join(','), 'Cancel takes at most 500 sequence numbers at a time; 501 are given.']
    ]) {
      type(value);
      expect(text(el.querySelector('[role="alert"]')), value.slice(0, 12)).toBe(reason);
      expect(next().disabled).toBe(true);
      next().click();
    }
    expect(close).not.toHaveBeenCalled();
  });

  it('500 distinct numbers are accepted, the most one cancel takes', () => {
    expect(parseSequenceNumbers(Array.from({ length: 500 }, (_, i) => i + 1).join(' ')).numbers).toHaveLength(500);
  });
});
