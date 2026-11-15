import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { ManageGroupDialogComponent } from './manage-group-dialog.component';
import { ConnectionGroupService } from '../../core/services';
import { ConnectionGroup, ProviderType, ServiceBusConnection } from '../../core/models';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';

const group = (id: string, name: string, type: 'client' | 'environment', parentId?: string): ConnectionGroup =>
  ({ id, name, type, parentId, createdAt: new Date() });
const saved = (id: string, name: string, clientId?: string, environmentId?: string): ServiceBusConnection =>
  ({ id, name, clientId, environmentId, providerType: ProviderType.RabbitMQ, connectionString: '', createdAt: new Date() } as ServiceBusConnection);

describe('ManageGroupDialogComponent', () => {
  const dialog = { open: vi.fn() };
  const snackBar = { open: vi.fn() };
  const groupService = { deleteGroup: vi.fn(() => of(undefined)), createGroup: vi.fn((g: Partial<ConnectionGroup>) => of({ ...g, id: 'new', createdAt: new Date() } as ConnectionGroup)) };

  async function render(groups: ConnectionGroup[], connections: ServiceBusConnection[]) {
    dialog.open.mockReset();
    snackBar.open.mockReset();
    groupService.deleteGroup.mockClear();
    TestBed.configureTestingModule({
      imports: [ManageGroupDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { groups, connections } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: ConnectionGroupService, useValue: groupService },
      ],
    });
    TestBed.overrideProvider(MatDialog, { useValue: dialog });
    TestBed.overrideProvider(MatSnackBar, { useValue: snackBar });
    const fixture = TestBed.createComponent(ManageGroupDialogComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  const contoso = group('c', 'Contoso', 'client');
  const prod = group('p', 'Production', 'environment', 'c');
  const dev = group('d', 'Development', 'environment', 'c');
  const fabrikam = group('f', 'Fabrikam', 'client');
  const connections = [saved('1', 'contoso-prod', 'c', 'p'), saved('2', 'contoso-dev', 'c', 'd')];

  it('counts the environments and connections of each client, and the connections of each environment', async () => {
    const { el, component } = await render([contoso, prod, dev, fabrikam], connections);
    const lines = Array.from(el.querySelectorAll('.counts')).map(l => l.textContent?.trim());
    expect(lines).toEqual(['2 environments, 2 connections', '0 environments, 0 connections']);
    expect(component.plural(component.connectionsOf(prod).length, 'connection', 'connections')).toBe('1 connection');
  });

  it('after Add Client the name field is empty and not red, ready for the next client, and the name and count read as one line', async () => {
    const { fixture, el } = await render([], []);
    const nameInput = () => el.querySelector('input[formcontrolname="name"]') as HTMLInputElement;
    nameInput().value = 'Contoso';
    nameInput().dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Add Client')) as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(nameInput().value).toBe('');
    expect(el.querySelector('mat-form-field.mat-form-field-invalid'), 'no field in the error state after a successful add').toBeNull();
    expect(el.querySelector('.group-name')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Contoso 0 environments, 0 connections');
  });

  it('Delete of a client is a text button named after the client, and the client name hint reads "e.g., Contoso"', async () => {
    const { el } = await render([contoso, prod, fabrikam], connections);
    const del = el.querySelector('[aria-label="Delete client Fabrikam"]') as HTMLElement;
    expect(del.textContent?.replace('delete', '').trim()).toBe('Delete');
    expect((el.querySelector('input[formcontrolname="name"]') as HTMLInputElement).placeholder).toBe('e.g., Contoso');
    expect(el.querySelector('textarea')).toBeNull();
  });

  it('deleting an environment asks in a dialog of the app that names the connections that lose it, never a browser confirm', async () => {
    const browserConfirm = vi.spyOn(window, 'confirm');
    const { component } = await render([contoso, prod, dev], connections);
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });

    component.deleteEnvironment(prod);

    expect(browserConfirm).not.toHaveBeenCalled();
    expect(dialog.open.mock.calls[0][0]).toBe(ConfirmDialogComponent);
    const data = dialog.open.mock.calls[0][1].data as ConfirmDialogData;
    expect(data.title).toBe('Delete environment?');
    expect(data.message).toBe('This removes the environment Production from this computer. These connections stay saved and lose this environment: contoso-prod. Nothing on a broker is changed.');
    expect(data.confirmText).toBe('Delete environment');
    expect(groupService.deleteGroup).toHaveBeenCalledWith('p');
    browserConfirm.mockRestore();
  });

  it('a cancelled delete deletes nothing; a client with no connection says so', async () => {
    const { component } = await render([fabrikam], []);
    dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });

    component.deleteClient(fabrikam);

    const data = dialog.open.mock.calls[0][1].data as ConfirmDialogData;
    expect(data.message).toBe('This removes the client Fabrikam from this computer. No connection is in this client. Nothing on a broker is changed.');
    expect(groupService.deleteGroup).not.toHaveBeenCalled();
  });

  it('a client that still has environments is refused before any question, as the API removes no environment with it', async () => {
    const { component } = await render([contoso, prod], connections);
    component.deleteClient(contoso);
    expect(dialog.open).not.toHaveBeenCalled();
    expect(groupService.deleteGroup).not.toHaveBeenCalled();
    expect(snackBar.open.mock.calls[0][0]).toBe('Cannot delete client with 1 environment(s). Delete environments first.');
  });
});
