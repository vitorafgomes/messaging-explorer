import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ExportConnectionsDialogComponent } from './export-connections-dialog.component';

describe('ExportConnectionsDialogComponent', () => {
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
  const at = new Date();
  const groups = [
    { id: 'g1', name: 'Contoso', type: 'client', createdAt: at },
    { id: 'g2', name: 'Production', type: 'environment', parentId: 'g1', isProduction: true, createdAt: at },
    { id: 'g3', name: 'Development', type: 'environment', parentId: 'g1', createdAt: at }
  ];
  const connections = [
    { id: 'c1', name: 'Contoso production', environmentId: 'g2' },
    { id: 'c2', name: 'Contoso development', environmentId: 'g3' },
    { id: 'c3', name: 'Contoso RabbitMQ' }
  ];

  beforeEach(() => {
    dialogRefMock = { close: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ExportConnectionsDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MAT_DIALOG_DATA, useValue: { connections, groups } },
      ],
    });
  });

  function createComponent() {
    const fixture = TestBed.createComponent(ExportConnectionsDialogComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    return { fixture, component };
  }

  it('should be created with includeSecrets defaulting to false', () => {
    const { component } = createComponent();
    expect(component).toBeTruthy();
    expect(component.includeSecrets()).toBe(false);
  });

  it('should close with includeSecrets=false when confirmed without opt-in', () => {
    const { component } = createComponent();
    component.confirm();
    expect(dialogRefMock.close).toHaveBeenCalledWith({ includeSecrets: false });
  });

  it('should close with includeSecrets=true when opt-in checkbox is set', () => {
    const { component } = createComponent();
    component.includeSecrets.set(true);
    component.confirm();
    expect(dialogRefMock.close).toHaveBeenCalledWith({ includeSecrets: true });
  });

  it('should close with no result when cancelled', () => {
    const { component } = createComponent();
    component.cancel();
    expect(dialogRefMock.close).toHaveBeenCalledWith();
  });

  it('should not render the warning box when includeSecrets is false', () => {
    const { fixture } = createComponent();
    const warning = fixture.nativeElement.querySelector('.warning-box');
    expect(warning).toBeNull();
  });

  it('should render the warning box when includeSecrets is true', () => {
    const { fixture, component } = createComponent();
    component.includeSecrets.set(true);
    fixture.detectChanges();
    const warning = fixture.nativeElement.querySelector('.warning-box');
    expect(warning).not.toBeNull();
    expect(warning.textContent).toContain('real connection strings');
  });

  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('says how many connections, clients and environments go into the file, each pluralised as counted', () => {
    const { fixture } = createComponent();
    expect(text(fixture.nativeElement.querySelector('.summary')), 'the drawn summary line with the counts of the saved data')
      .toBe('3 connections, 1 client and 2 environments go into one JSON file that you choose where to save.');
  });

  it('the secrets warning says who can connect with the file, the one marked Production included, and to delete it when it has served', () => {
    const { fixture, component } = createComponent();
    component.includeSecrets.set(true);
    fixture.detectChanges();
    expect(text(fixture.nativeElement.querySelector('.warning-box')).replace(/^warning ?/, ''), 'the full drawn warning').toBe(
      'The file will hold real secrets. The exported file will contain real connection strings, passwords, and client secrets, unencrypted. '
      + 'Anyone who opens it can connect to these brokers, the one marked Production included. Store it securely and delete it when it has served.');
  });

  it('with no connection in a production environment the warning does not claim one', () => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { connections: [connections[1]], groups: groups.slice(0, 1) } });
    const { fixture, component } = createComponent();
    component.includeSecrets.set(true);
    fixture.detectChanges();
    expect(text(fixture.nativeElement.querySelector('.summary'))).toBe('1 connection, 1 client and 0 environments go into one JSON file that you choose where to save.');
    expect(text(fixture.nativeElement.querySelector('.warning-box')), 'no Production clause when none is marked')
      .toContain('Anyone who opens it can connect to these brokers. Store it securely');
  });
});
