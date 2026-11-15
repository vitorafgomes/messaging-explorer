import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BugReportDialogComponent, BugReportDialogData } from './bug-report-dialog.component';

/** The text of an element as a reader hears it: every text node, separated by one space. */
function words(node: Element | null | undefined): string {
  if (!node) return '';
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

describe('BugReportDialogComponent', () => {
  const data: BugReportDialogData = {
    type: 'bug',
    version: '2.4.4',
    platform: 'linux',
    errors: ['2026-11-14T00:00:00.000Z - The request to the local API timed out'],
  };

  async function render(overrides: Partial<BugReportDialogData> = {}) {
    await TestBed.configureTestingModule({
      imports: [BugReportDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { ...data, ...overrides } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BugReportDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const type = async (index: number, text: string) => {
      const field = el.querySelectorAll('input, textarea')[index] as HTMLInputElement;
      field.value = text;
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const button = (label: string) => Array.from(el.querySelectorAll('button'))
      .find(b => words(b).includes(label)) as HTMLButtonElement;
    return { fixture, el, type, button };
  }

  afterEach(() => vi.restoreAllMocks());

  it('says nothing is sent from the app, that the name is published, and that the issue is public', async () => {
    const { el } = await render();
    const text = words(el);
    expect(text).toContain('Nothing is sent from the app. Submit opens a new GitHub issue in your browser with the text below filled in; you read it, change it and submit it there.');
    expect(text).toContain('Published with the issue. Leave it empty to add no name.');
    expect(words(el.querySelector('.public'))).toBe('warning The issue is public. Do not paste a connection string, a password or a message body into it.');
  });

  it('previews what is included besides what you type, with the count of errors caught', async () => {
    const { el } = await render();
    const included = el.querySelector('[data-testid="included"]') as HTMLElement;
    expect(words(included.querySelector('h3'))).toBe('What is included, besides what you type');
    const preview = included.querySelector('pre')!.textContent!;
    expect(preview).toContain('**Version:** 2.4.4');
    expect(preview).toContain('**Platform:** linux');
    expect(preview).toContain('The request to the local API timed out');
    expect(words(included.querySelector('.caption'))).toBe('The version, the platform and the errors the app caught in this session (1). No connection, no namespace, no message body.');
  });

  it('the preview is exactly the body that Submit opens on GitHub, the name included only when given', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { el, type, button } = await render();
    await type(0, 'Peek hangs');
    await type(1, 'It never ends.');
    const preview = () => el.querySelector('[data-testid="included"] pre')!.textContent!;
    expect(preview()).not.toContain('**Reporter:**');

    await type(2, 'Ana');
    expect(preview()).toContain('**Reporter:** Ana');
    const shown = preview();

    button('Submit Bug Report').click();
    const url = new URL(open.mock.calls[0][0] as string);
    expect(url.searchParams.get('body')).toBe(shown);
    expect(url.searchParams.get('title')).toBe('Peek hangs');
  });

  it('Cancel is a text button and Submit is the primary button with the browser icon after its words', async () => {
    const { button } = await render();
    const cancel = button('Cancel');
    const submit = button('Submit Bug Report');
    expect(cancel.hasAttribute('mat-stroked-button')).toBe(false);
    expect(cancel.hasAttribute('mat-button')).toBe(true);
    expect(submit.hasAttribute('mat-flat-button')).toBe(true);
    expect(submit.classList.contains('mat-warn')).toBe(false);
    expect(words(submit)).toBe('Submit Bug Report open_in_new');
    expect(submit.disabled).toBe(true);
  });
});
