import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { ClearAllDataDialogComponent } from './clear-all-data-dialog.component';
import { ConnectionService, ConnectionGroupService } from '../../core/services';

/** The text of an element as a reader hears it: every text node, separated by one space. */
function words(node: Element | null | undefined): string {
  if (!node) return '';
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

describe('ClearAllDataDialogComponent', () => {
  const result = { message: 'All data cleared', connectionsDeleted: 3, groupsDeleted: 2 };
  let dialogRef: { close: ReturnType<typeof vi.fn>; disableClose: boolean };
  let connectionService: any;
  let groupService: any;

  beforeEach(() => {
    dialogRef = { close: vi.fn(), disableClose: false };
    connectionService = {
      connectionStatus$: of({ connected: true, namespace: 'sample-ns.servicebus.windows.net' }),
      getConnections: vi.fn(() => of([{ id: 'a' }, { id: 'b' }, { id: 'c' }])),
      clearAllData: vi.fn(() => of(result)),
    };
    groupService = { getGroups: vi.fn(() => of([{ id: 'g1' }, { id: 'g2' }])) };
  });

  async function render() {
    await TestBed.configureTestingModule({
      imports: [ClearAllDataDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: ConnectionService, useValue: connectionService },
        { provide: ConnectionGroupService, useValue: groupService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ClearAllDataDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const confirm = () => Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Clear all data')) as HTMLButtonElement;
    const type = (text: string) => {
      const input = el.querySelector('input') as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const click = (button: HTMLElement) => { button.click(); fixture.detectChanges(); };
    const text = () => words(el);
    return { fixture, el, confirm, type, text, click };
  }

  it('names what it destroys: the connections and groups read now, the file, no broker touched, and the connection it leaves first', async () => {
    const { text } = await render();
    expect(text()).toContain('Connected now to sample-ns.servicebus.windows.net ; the app disconnects first.');
    expect(text()).toContain('every saved connection, client and environment from this computer, with the secrets stored in them. No broker is touched. It cannot be undone.');
    expect(text()).toContain('Connections 3, read now');
    expect(text()).toContain('Clients and environments 2');
    expect(text()).toContain('File data/workspace.json');
    expect(text()).toContain('Type clear all data to confirm');
  });

  it('the button stays disabled until the words are typed exactly, and a near word never clears', async () => {
    const { confirm, type } = await render();
    expect(confirm().disabled).toBe(true);

    for (const near of ['clear all dat', 'Clear all data', 'CLEAR ALL DATA', 'clear  all data', 'clear all data!']) {
      type(near);
      expect(confirm().disabled).toBe(true);
      confirm().click();
    }
    expect(connectionService.clearAllData).not.toHaveBeenCalled();

    type('clear all data');
    expect(confirm().disabled).toBe(false);
  });

  it('the exact words, with surrounding spaces ignored, clear once and close with the result', async () => {
    const { confirm, type } = await render();
    type('  clear all data ');
    confirm().click();

    expect(connectionService.clearAllData).toHaveBeenCalledTimes(1);
    expect(dialogRef.close).toHaveBeenCalledWith(result);
  });

  it('when the saved data cannot be read nothing can be cleared, and Retry reads again', async () => {
    connectionService.getConnections = vi.fn(() => throwError(() => new Error('down')));
    const { confirm, type, text, el, fixture } = await render();
    type('clear all data');

    expect(text()).toContain('Could not read what is saved, so nothing can be cleared yet.');
    expect(confirm().disabled).toBe(true);

    connectionService.getConnections = vi.fn(() => of([{ id: 'a' }]));
    (Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Retry') as HTMLElement).click();
    fixture.detectChanges();
    expect(text()).toContain('Connections 1, read now');
    expect(confirm().disabled).toBe(false);
  });

  it('a failed clear stays open and says the data was not cleared', async () => {
    connectionService.clearAllData = vi.fn(() => throwError(() => new Error('500')));
    const { confirm, type, text, click } = await render();
    type('clear all data');
    click(confirm());

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(text()).toContain('The data was not cleared: the local API answered with an error.');
    expect(dialogRef.disableClose).toBe(false);
  });
});
