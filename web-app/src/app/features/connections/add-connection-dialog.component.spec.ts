import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AddConnectionDialogComponent } from './add-connection-dialog.component';
import { ConnectionService } from '../../core/services';
import { ProviderType } from '../../core/models';

/**
 * Unit tests for Azure auth-type dropdown behavior in the connection dialog.
 * Focuses on field visibility swapping, RabbitMQ hiding the dropdown,
 * Service Principal required fields and the sign-in round-trip.
 */
describe('AddConnectionDialogComponent - Azure auth', () => {
  let connectionServiceMock: {
    testConnection: ReturnType<typeof vi.fn>;
    saveConnection: ReturnType<typeof vi.fn>;
  };
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    connectionServiceMock = {
      testConnection: vi.fn().mockReturnValue(of({ success: true })),
      saveConnection: vi.fn().mockReturnValue(of({ id: 'new-id' }))
    };
    dialogRefMock = { close: vi.fn() };
    snackBarMock = { open: vi.fn() };

    TestBed.configureTestingModule({
      imports: [AddConnectionDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: ConnectionService, useValue: connectionServiceMock },
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: MAT_DIALOG_DATA, useValue: { groups: [] } }
      ]
    });
  });

  function createComponent() {
    const fixture = TestBed.createComponent(AddConnectionDialogComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    return { fixture, component };
  }

  it('defaults Azure auth type to InteractiveBrowser with Recommended badge', () => {
    const { component } = createComponent();
    expect(component.providerType).toBe(ProviderType.AzureServiceBus);
    expect(component.azureAuthType).toBe('InteractiveBrowser');
    const recommended = component.azureAuthOptions.find(o => o.value === 'InteractiveBrowser');
    expect(recommended?.badge).toBe('Recommended');
  });

  it('renders four Azure auth options in expected order', () => {
    const { component } = createComponent();
    expect(component.azureAuthOptions.map(o => o.value)).toEqual([
      'InteractiveBrowser',
      'ConnectionString',
      'ServicePrincipal',
      'AzureCli'
    ]);
  });

  it('hides the auth dropdown entirely for RabbitMQ provider', () => {
    const { fixture, component } = createComponent();
    component.providerType = ProviderType.RabbitMQ;
    fixture.detectChanges();
    const html = fixture.nativeElement.innerHTML as string;
    expect(html).not.toContain('Authentication');
    expect(html).toContain('Host Name');
  });

  it('invalidates the form on InteractiveBrowser until sign-in completes', () => {
    const { component } = createComponent();
    component.azureAuthType = 'InteractiveBrowser';
    component.fullyQualifiedNamespace = 'ns.servicebus.windows.net';
    expect(component.isFormValid()).toBe(false);
    component.signedIn.set(true);
    expect(component.isFormValid()).toBe(true);
  });

  it('requires all four fields when auth type is ServicePrincipal', () => {
    const { component } = createComponent();
    component.azureAuthType = 'ServicePrincipal';
    component.fullyQualifiedNamespace = 'ns.servicebus.windows.net';
    expect(component.isFormValid()).toBe(false);
    component.tenantId = 'tenant-id';
    component.servicePrincipalClientId = 'client-id';
    expect(component.isFormValid()).toBe(false);
    component.clientSecret = 'secret';
    expect(component.isFormValid()).toBe(true);
  });

  it('accepts Azure CLI with only fullyQualifiedNamespace', () => {
    const { component } = createComponent();
    component.azureAuthType = 'AzureCli';
    expect(component.isFormValid()).toBe(false);
    component.fullyQualifiedNamespace = 'ns.servicebus.windows.net';
    expect(component.isFormValid()).toBe(true);
  });

  it('resets signedIn when the auth type changes', () => {
    const { component } = createComponent();
    component.signedIn.set(true);
    component.azureAuthType = 'ConnectionString';
    component.onAzureAuthTypeChange();
    expect(component.signedIn()).toBe(false);
  });

  it('signInWithMicrosoft posts InteractiveBrowser payload and flips signedIn on success', () => {
    const { component } = createComponent();
    component.fullyQualifiedNamespace = 'ns.servicebus.windows.net';
    component.tenantId = 'tenant-a';
    component.signInWithMicrosoft();
    expect(connectionServiceMock.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: ProviderType.AzureServiceBus,
        authType: 'InteractiveBrowser',
        fullyQualifiedNamespace: 'ns.servicebus.windows.net',
        tenantId: 'tenant-a'
      })
    );
    expect(component.signedIn()).toBe(true);
    expect(component.signingIn()).toBe(false);
  });

  it('keeps signedIn false when sign-in request errors', () => {
    connectionServiceMock.testConnection.mockReturnValueOnce(
      throwError(() => ({ message: 'denied' }))
    );
    const { component } = createComponent();
    component.fullyQualifiedNamespace = 'ns.servicebus.windows.net';
    component.signInWithMicrosoft();
    expect(component.signedIn()).toBe(false);
    expect(component.signingIn()).toBe(false);
  });

  it('save for ServicePrincipal sends credential fields and empty connectionString', () => {
    const { component } = createComponent();
    component.name = 'sp-conn';
    component.azureAuthType = 'ServicePrincipal';
    component.fullyQualifiedNamespace = 'ns.servicebus.windows.net';
    component.tenantId = 't';
    component.servicePrincipalClientId = 'c';
    component.clientSecret = 's';
    component.save();
    const payload = connectionServiceMock.saveConnection.mock.calls[0][0];
    expect(payload.authType).toBe('ServicePrincipal');
    expect(payload.fullyQualifiedNamespace).toBe('ns.servicebus.windows.net');
    expect(payload.servicePrincipalClientId).toBe('c');
    expect(payload.clientSecret).toBe('s');
    expect(payload.connectionString).toBe('');
  });

  it('save for ConnectionString omits identity fields and sends the string', () => {
    const { component } = createComponent();
    component.name = 'cs-conn';
    component.azureAuthType = 'ConnectionString';
    component.connectionString = 'Endpoint=sb://x;SharedAccessKeyName=y;SharedAccessKey=z';
    component.save();
    const payload = connectionServiceMock.saveConnection.mock.calls[0][0];
    expect(payload.authType).toBe('ConnectionString');
    expect(payload.connectionString).toContain('Endpoint=sb://');
    expect(payload.fullyQualifiedNamespace).toBeUndefined();
    expect(payload.servicePrincipalClientId).toBeUndefined();
  });
});
