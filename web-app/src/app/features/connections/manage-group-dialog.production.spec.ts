import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { ManageGroupDialogComponent } from './manage-group-dialog.component';
import { ConnectionGroupService } from '../../core/services';
import { ConnectionGroup } from '../../core/models';

const client: ConnectionGroup = { id: 'g1', name: 'Contoso', type: 'client', createdAt: new Date() };
const production: ConnectionGroup = { id: 'g2', name: 'Production', type: 'environment', parentId: 'g1', createdAt: new Date(), isProduction: true };
const development: ConnectionGroup = { id: 'g3', name: 'Development', type: 'environment', parentId: 'g1', createdAt: new Date() };

describe('ManageGroupDialogComponent - the Production mark', () => {
  let groupService: { updateGroup: ReturnType<typeof vi.fn>; createGroup: ReturnType<typeof vi.fn>; deleteGroup: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };

  function render() {
    TestBed.configureTestingModule({
      imports: [ManageGroupDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: ConnectionGroupService, useValue: groupService },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { groups: [client, production, development] } }
      ]
    });
    const fixture = TestBed.createComponent(ManageGroupDialogComponent);
    const component = fixture.componentInstance;
    component.selectedClientId = 'g1';
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const tabs = Array.from(element.querySelectorAll('[role="tab"]')) as HTMLElement[];
    tabs.find(t => t.textContent?.includes('Environments'))!.click();
    fixture.detectChanges();
    const checkbox = (name: string) => Array.from(element.querySelectorAll('mat-checkbox'))
      .find(c => c.textContent?.includes(`mark ${name} as`)) as HTMLElement | undefined;
    return { fixture, component, element, checkbox };
  }

  beforeEach(() => {
    groupService = {
      updateGroup: vi.fn((id: string, g: Partial<ConnectionGroup>) => of({ ...g, id, createdAt: new Date() })),
      createGroup: vi.fn(),
      deleteGroup: vi.fn()
    };
    snackBar = { open: vi.fn() };
  });

  it('offers a Production checkbox per environment, with a hidden label that names it, and the note under the list', () => {
    const { element, checkbox } = render();

    expect(checkbox('Production')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Production: mark Production as a production environment');
    expect(checkbox('Production')?.querySelector('.cdk-visually-hidden')?.textContent).toBe(': mark Production as a production environment');
    expect(checkbox('Production')?.querySelector('input')?.checked).toBe(true);
    expect(checkbox('Development')?.querySelector('input')?.checked).toBe(false);
    expect(element.querySelector('.production-note')?.textContent).toBe(
      'A connection in an environment marked Production shows the PRODUCTION chip on the toolbar and in every confirmation, and its destructive actions ask for the typed name.');
  });

  it('checking Production saves the mark on that environment and its chip turns PRODUCTION', () => {
    const { fixture, element, checkbox } = render();

    checkbox('Development')!.querySelector('input')!.click();
    fixture.detectChanges();

    expect(groupService.updateGroup).toHaveBeenCalledWith('g3', expect.objectContaining({
      name: 'Development', type: 'environment', parentId: 'g1', isProduction: true
    }));
    const chips = Array.from(element.querySelectorAll('.environment-chip')).map(c => c.textContent?.replace('warning', '').trim());
    expect(chips).toEqual(['PRODUCTION', 'DEVELOPMENT']);
    expect(element.querySelectorAll('.environment-chip.production')).toHaveLength(2);
  });

  it('a mark the API refuses is undone and reported, and the environment stays as it was', () => {
    groupService.updateGroup.mockReturnValue(throwError(() => new Error('500')));
    // The dialog imports MatSnackBarModule, whose MatSnackBar overrides the TestBed provider.
    const open = vi.spyOn(MatSnackBar.prototype, 'open').mockReturnValue(undefined as never);
    const { fixture, component, checkbox } = render();

    checkbox('Development')!.querySelector('input')!.click();
    fixture.detectChanges();

    expect(checkbox('Development')?.querySelector('input')?.checked).toBe(false);
    expect(component.environments().find(e => e.id === 'g3')?.isProduction).toBeFalsy();
    expect(open).toHaveBeenCalledWith('Failed to mark Development: nothing was changed', 'Close', { duration: 5000 });
    open.mockRestore();
  });

  it('renaming an environment keeps its Production mark', () => {
    const { component } = render();

    component.editEnvironment(production);
    component.environmentForm.patchValue({ name: 'Prod' });
    component.saveEnvironment();

    expect(groupService.updateGroup).toHaveBeenCalledWith('g2', expect.objectContaining({ name: 'Prod', isProduction: true }));
  });
});
