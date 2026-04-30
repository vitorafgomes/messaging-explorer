import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { ExportConnectionsDialogComponent } from './export-connections-dialog.component';

describe('ExportConnectionsDialogComponent', () => {
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    dialogRefMock = { close: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ExportConnectionsDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
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
});
