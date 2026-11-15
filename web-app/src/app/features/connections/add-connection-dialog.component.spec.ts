import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AddConnectionDialogComponent, PROXY_FORMAT, PROXY_NEEDS_WEBSOCKETS, PROXY_USER_INFO, RESOURCE_ID_FORMAT } from './add-connection-dialog.component';
import { ConnectionService } from '../../core/services';
import { ProviderType, ServiceBusConnection } from '../../core/models';

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
    expect(recommended?.note).toBe('Recommended');
  });

  it('renders five Azure auth options in expected order, Default credential last', () => {
    const { component } = createComponent();
    expect(component.azureAuthOptions.map(o => o.value)).toEqual([
      'InteractiveBrowser',
      'ConnectionString',
      'ServicePrincipal',
      'AzureCli',
      'DefaultCredential'
    ]);
  });

  it('uses the RabbitMQ-specific state when the provider changes, with host, username and password left empty', () => {
    const { component } = createComponent();
    component.providerType = ProviderType.RabbitMQ;
    component.onProviderTypeChange();
    expect(component.providerType).toBe(ProviderType.RabbitMQ);
    expect(component.hostName, 'Host Name starts empty; localhost is only its placeholder').toBe('');
    expect(component.userName, 'Username starts empty').toBe('');
    expect(component.password, 'the password is never prefilled').toBe('');
    expect(component.port).toBe(5672);
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

  it('offers the two RabbitMQ TLS checkboxes and sends both flags on test and save', () => {
    const fixture = TestBed.createComponent(AddConnectionDialogComponent);
    const component = fixture.componentInstance;
    component.providerType = ProviderType.RabbitMQ;
    component.onProviderTypeChange();
    fixture.detectChanges();
    const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mat-checkbox')).map(c => c.textContent?.trim());
    expect(labels).toEqual(['Use TLS for AMQP (amqps)', 'Use TLS for the management API (https)']);

    component.name = 'tls-rabbit';
    component.useSsl = true;
    component.useManagementSsl = true;
    component.testConnection();
    component.save();

    expect(connectionServiceMock.testConnection.mock.calls[0][0]).toEqual(expect.objectContaining({ useSsl: true, useManagementSsl: true }));
    expect(connectionServiceMock.saveConnection.mock.calls[0][0]).toEqual(expect.objectContaining({ useSsl: true, useManagementSsl: true }));
  });

  describe('add, as the Connections artboard draws it', () => {
    async function render(setup?: (component: AddConnectionDialogComponent) => void) {
      const fixture = TestBed.createComponent(AddConnectionDialogComponent);
      setup?.(fixture.componentInstance);
      await settle(fixture);
      return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
    }

    async function pick(fixture: ComponentFixture<AddConnectionDialogComponent>, label: string) {
      const radio = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mat-radio-button'))
        .find(r => norm(r.querySelector('.auth-label')?.textContent) === label);
      (radio!.querySelector('input') as HTMLInputElement).click();
      await settle(fixture);
    }

    const rabbitMq = (c: AddConnectionDialogComponent) => { c.providerType = ProviderType.RabbitMQ; c.onProviderTypeChange(); };

    it('opens with the NO ENVIRONMENT chip and "New connection, saved on this computer. Nothing is created on the broker." (row 52)', async () => {
      const { el } = await render();
      expect(norm(el.querySelector('.environment-line .environment-chip')?.textContent), 'no environment is chosen yet').toBe('NO ENVIRONMENT');
      expect(norm(el.querySelector('.environment-line .where')?.textContent), 'the intro line of the add dialog')
        .toBe('New connection, saved on this computer. Nothing is created on the broker.');
    });

    it('the chip of the add dialog is the environment chosen in the form', async () => {
      const at = new Date();
      TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { groups: [
        { id: 'g1', name: 'Contoso', type: 'client', createdAt: at },
        { id: 'g2', name: 'Production', type: 'environment', parentId: 'g1', isProduction: true, createdAt: at }
      ] } });
      const { el } = await render(c => { c.clientId = 'g1'; c.environmentId = 'g2'; });
      const chip = el.querySelector('.environment-line .environment-chip');
      expect(norm(chip?.textContent).replace(/^warning /, ''), 'the chosen environment in capitals').toBe('PRODUCTION');
      expect(chip?.classList.contains('production'), 'an environment marked production is drawn as one').toBe(true);
    });

    it('has Connection Name with the placeholder "My Connection" beside Provider Type (row 53)', async () => {
      const { el } = await render();
      expect(input(el, 'Connection Name')?.placeholder, 'Connection Name placeholder').toBe('My Connection');
      const grid = field(el, 'Connection Name')?.parentElement;
      expect(grid?.classList.contains('two'), 'Connection Name and Provider Type share one two-column row').toBe(true);
      expect(grid?.contains(field(el, 'Provider Type')!)).toBe(true);
    });

    it('Provider Type offers Azure Service Bus and RabbitMQ, with no icon on an option (row 54)', async () => {
      const { fixture, el } = await render();
      (field(el, 'Provider Type')!.querySelector('.mat-mdc-select-trigger') as HTMLElement).click();
      await settle(fixture);
      const options = Array.from(document.querySelectorAll('mat-option'));
      expect(options.map(o => norm(o.textContent)), 'the two providers, in this order').toEqual(['Azure Service Bus', 'RabbitMQ']);
      expect(options.filter(o => o.querySelector('mat-icon')).length, 'the artboard draws no icon on a provider option').toBe(0);
    });

    it('Authentication is a radio group in a fieldset with the legend Authentication, in a column beside the fields (row 55)', async () => {
      const { el } = await render();
      const fieldset = el.querySelector('.auth-layout > fieldset.auth');
      expect(norm(fieldset?.querySelector('legend')?.textContent), 'the radio group is named by its legend').toBe('Authentication');
      expect(fieldset?.querySelector('mat-radio-group'), 'the choice is a radio group inside the fieldset').not.toBeNull();
      expect(field(el, 'Authentication'), 'no Authentication dropdown is left').toBeUndefined();
      const columns = Array.from(el.querySelector('.auth-layout')!.children).map(c => c.className.split(' ')[0]);
      expect(columns, 'the fieldset column, then the fields column beside it').toEqual(['auth', 'auth-fields']);
      expect(el.querySelector('.auth-fields')?.contains(field(el, 'Fully Qualified Namespace')!), 'the fields sit in the column beside the radios').toBe(true);
    });

    it('lists five options: Sign in with Microsoft "Recommended", Connection string, Service Principal "advanced", Azure CLI session "advanced", Default credential (row 56)', async () => {
      const { el } = await render();
      const options = Array.from(el.querySelectorAll('fieldset.auth mat-radio-button')).map(r =>
        [norm(r.querySelector('.auth-label')?.textContent), norm(r.querySelector('.auth-note')?.textContent)]);
      expect(options, 'the five options of the artboard, with their notes as plain words').toEqual([
        ['Sign in with Microsoft', 'Recommended'],
        ['Connection string', ''],
        ['Service Principal', 'advanced'],
        ['Azure CLI session', 'advanced'],
        ['Default credential', '']
      ]);
      expect(el.querySelector('fieldset.auth')?.textContent, 'notes are not in parentheses').not.toContain('(');
    });

    it('highlights the selected option, and the highlight follows the choice (row 57)', async () => {
      const { fixture, el, component } = await render();
      const selected = () => Array.from(el.querySelectorAll('fieldset.auth mat-radio-button.selected')).map(r => norm(r.querySelector('.auth-label')?.textContent));
      expect(selected(), 'Sign in with Microsoft is selected by default').toEqual(['Sign in with Microsoft']);
      component.signedIn.set(true);
      await pick(fixture, 'Connection string');
      expect(component.azureAuthType, 'the radio sets the auth type').toBe('ConnectionString');
      expect(selected(), 'the highlight moves to the chosen option').toEqual(['Connection string']);
      expect(component.signedIn(), 'changing the auth type drops a previous sign-in').toBe(false);
    });

    it('says "Choose how to authenticate against Azure Service Bus" under the options (row 58)', async () => {
      const { el } = await render();
      expect(norm(el.querySelector('fieldset.auth > .hint')?.textContent), 'the hint inside the fieldset')
        .toBe('Choose how to authenticate against Azure Service Bus');
    });

    it('Sign in with Microsoft: namespace "without the scheme", Tenant ID (optional) and the sign-in button with its line (rows 59-61)', async () => {
      const { el } = await render();
      expect(hint(el, 'Fully Qualified Namespace'), 'the namespace hint').toBe('Your Service Bus namespace host, without the scheme');
      expect(hint(el, 'Tenant ID (optional)'), 'the tenant hint').toBe("Leave empty to use the user's home tenant");
      expect(norm(el.querySelector('.sign-in')?.textContent), 'the button and its line')
        .toBe('Sign in with Microsoft Opens your browser. Enter the namespace first.');
    });

    it('Connection string: a masked single-line password input whose hint ends "Masked as you type or paste." (row 62)', async () => {
      const { fixture, el } = await render();
      await pick(fixture, 'Connection string');
      const box = input(el, 'Connection String');
      expect(box?.tagName, 'a single-line input, not a textarea').toBe('INPUT');
      expect(box?.type, 'the connection string is masked').toBe('password');
      expect(box?.value, 'the field starts empty').toBe('');
      expect(hint(el, 'Connection String')).toBe('Azure Service Bus connection string with Manage permissions. Masked as you type or paste.');
    });

    it('Service Principal: namespace "without the scheme", Tenant ID and Client ID side by side, Client Secret with no hint (rows 63-65)', async () => {
      const { fixture, el } = await render();
      await pick(fixture, 'Service Principal');
      expect(hint(el, 'Fully Qualified Namespace'), 'the namespace hint').toBe('Your Service Bus namespace host, without the scheme');
      const pair = field(el, 'Tenant ID')?.parentElement;
      expect(pair?.classList.contains('two') && pair.contains(field(el, 'Client ID')!), 'Tenant ID and Client ID in one two-column row').toBe(true);
      expect(input(el, 'Tenant ID')?.placeholder).toBe('00000000-0000-0000-0000-000000000000');
      expect(input(el, 'Client ID')?.placeholder).toBe('App registration client ID');
      expect(input(el, 'Client Secret')?.type, 'the client secret is masked').toBe('password');
      expect(input(el, 'Client Secret')?.value, 'the client secret starts empty').toBe('');
      expect(hint(el, 'Client Secret'), 'no hint promises a secure store').toBeNull();
    });

    it('Azure CLI session: namespace with "Uses your current "az login" session" (row 66)', async () => {
      const { fixture, el } = await render();
      await pick(fixture, 'Azure CLI session');
      expect(hint(el, 'Fully Qualified Namespace')).toBe('Uses your current "az login" session');
    });

    it('Default credential: namespace with the default credential chain hint and the development line, and saves as DefaultCredential (row 67)', async () => {
      const { fixture, el, component } = await render();
      await pick(fixture, 'Default credential');
      expect(hint(el, 'Fully Qualified Namespace')).toBe('Uses the default credential chain of this computer, without managed identity');
      expect(norm(el.querySelector('.auth-fields .dev-note')?.textContent), 'the development line')
        .toBe('For development: the app takes whichever sign-in this computer already has.');
      component.name = 'dev';
      component.fullyQualifiedNamespace = 'ns.servicebus.windows.net';
      expect(component.isFormValid(), 'the namespace is all Default credential needs').toBe(true);
      component.save();
      expect(connectionServiceMock.saveConnection.mock.calls[0][0]).toEqual(expect.objectContaining({
        authType: 'DefaultCredential', fullyQualifiedNamespace: 'ns.servicebus.windows.net', connectionString: ''
      }));
    });

    const written = (secret: string) => `${secret} is written, unencrypted, to workspace.json in the data folder of the app on this computer. Whoever can read your files can read it.`;

    it.each([
      ['a connection string', 'Connection string', false, written('The connection string')],
      ['a service principal', 'Service Principal', false, written('The client secret')],
      ['a RabbitMQ password', undefined, true, written('The password')]
    ] as const)('"Saved in plain text." in the warning container for %s, after Organization (row 68)', async (_kind, auth, provider, text) => {
      const { fixture, el } = await render(provider ? rabbitMq : undefined);
      if (auth) await pick(fixture, auth);
      const notice = el.querySelector('.store-notice');
      expect(notice?.classList.contains('plain'), 'the warning-container notice').toBe(true);
      expect(notice?.querySelector('mat-icon')?.textContent, 'with the warning icon').toBe('warning');
      expect(norm(notice?.querySelector('span')?.textContent), 'the words the artboard draws for this secret').toBe(`Saved in plain text. ${text}`);
      expect(el.querySelector('.grouping-section')!.compareDocumentPosition(notice!) & Node.DOCUMENT_POSITION_FOLLOWING, 'the notice sits after Organization').toBeTruthy();
    });

    it.each([
      ['Sign in with Microsoft', 'Only the namespace and the tenant are written to workspace.json. The sign-in token stays in memory, so you sign in again after a restart.'],
      ['Azure CLI session', 'Only the namespace is written to workspace.json. The app asks the Azure CLI for a token; run az login first.'],
      ['Default credential', 'Only the namespace is written to workspace.json. The credential comes from this computer each time.']
    ])('"No secret is saved." in the secondary container for %s (row 69)', async (auth, text) => {
      const { fixture, el } = await render();
      await pick(fixture, auth);
      const notice = el.querySelector('.store-notice');
      expect(notice?.classList.contains('none'), 'the secondary-container notice').toBe(true);
      expect(notice?.classList.contains('plain')).toBe(false);
      expect(notice?.querySelector('mat-icon')?.textContent, 'with the info icon').toBe('info');
      expect(norm(notice?.querySelector('span')?.textContent), 'the words the artboard draws for this sign-in').toBe(`No secret is saved. ${text}`);
    });

    it('RabbitMQ: Host Name spans 3 of 4 and starts empty with the placeholder "localhost"; Port 5672 (rows 75-76)', async () => {
      const { el } = await render(rabbitMq);
      expect(input(el, 'Host Name')?.value, 'Host Name starts empty').toBe('');
      expect(input(el, 'Host Name')?.placeholder).toBe('localhost');
      expect(field(el, 'Host Name')?.classList.contains('span-3'), 'Host Name spans 3 columns').toBe(true);
      expect(field(el, 'Host Name')?.parentElement?.classList.contains('four'), 'in the four-column grid').toBe(true);
      expect(input(el, 'Port')?.value).toBe('5672');
      expect(input(el, 'Port')?.placeholder).toBe('5672');
    });

    it('RabbitMQ: Username and Password span 2 and start empty; the password says "Starts empty and is never prefilled." (rows 77-78)', async () => {
      const { el } = await render(rabbitMq);
      expect(input(el, 'Username')?.value, 'Username starts empty').toBe('');
      expect(input(el, 'Username')?.placeholder, 'no guest placeholder').toBe('');
      expect(field(el, 'Username')?.classList.contains('span-2')).toBe(true);
      expect(input(el, 'Password')?.type, 'the password is masked').toBe('password');
      expect(input(el, 'Password')?.value, 'the password is never prefilled').toBe('');
      expect(input(el, 'Password')?.placeholder, 'no guest placeholder').toBe('');
      expect(field(el, 'Password')?.classList.contains('span-2')).toBe(true);
      expect(hint(el, 'Password')).toBe('Starts empty and is never prefilled.');
    });

    it('RabbitMQ: Virtual Host spans 3 and Management Port 1 with the hint "HTTP API port" (rows 79-80)', async () => {
      const { el } = await render(rabbitMq);
      expect(field(el, 'Virtual Host')?.classList.contains('span-3'), 'Virtual Host spans 3 columns').toBe(true);
      expect(input(el, 'Virtual Host')?.value).toBe('/');
      const mgmt = field(el, 'Management Port');
      expect(mgmt?.classList.contains('span-2') || mgmt?.classList.contains('span-3'), 'Management Port spans 1 column').toBe(false);
      expect(input(el, 'Management Port')?.value).toBe('15672');
      expect(hint(el, 'Management Port')).toBe('HTTP API port');
    });
  });
});

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

async function settle(fixture: ComponentFixture<AddConnectionDialogComponent>) {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function field(el: HTMLElement, label: string): HTMLElement | undefined {
  return Array.from(el.querySelectorAll<HTMLElement>('.field')).find(f => norm(f.querySelector(':scope > label')?.textContent) === label);
}

function input(el: HTMLElement, label: string): HTMLInputElement | undefined {
  return field(el, label)?.querySelector<HTMLInputElement>('input, textarea') ?? undefined;
}

function hint(el: HTMLElement, label: string): string | null {
  const found = field(el, label)?.querySelector('mat-hint');
  return found ? norm(found.textContent) : null;
}

describe('AddConnectionDialogComponent - edit', () => {
  let connectionServiceMock: { testConnection: ReturnType<typeof vi.fn>; saveConnection: ReturnType<typeof vi.fn> };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };

  function open(connection: Partial<ServiceBusConnection>) {
    connectionServiceMock = {
      testConnection: vi.fn().mockReturnValue(of({ success: true })),
      saveConnection: vi.fn().mockReturnValue(of({ id: 'c1' }))
    };
    snackBarMock = { open: vi.fn() };
    dialogRefMock = { close: vi.fn() };
    TestBed.configureTestingModule({
      imports: [AddConnectionDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: ConnectionService, useValue: connectionServiceMock },
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: MAT_DIALOG_DATA, useValue: { groups: [], connection: { id: 'c1', name: 'conn', isConnected: false, createdAt: new Date(), ...connection } } }
      ]
    });
    const fixture = TestBed.createComponent(AddConnectionDialogComponent);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const button = (name: string) => Array.from(element.querySelectorAll('button')).find(b => b.textContent?.trim() === name);
    return { fixture, component: fixture.componentInstance, element, button };
  }

  const rabbit: Partial<ServiceBusConnection> = {
    providerType: 'RabbitMQ' as unknown as ProviderType, hostName: 'rabbit', port: 5672, userName: 'explorer',
    password: '***', virtualHost: '/', managementPort: 15672, useSsl: true
  };

  it('says under the title the environment chip and "<b>name</b> to target" of the connection being edited', () => {
    const { element } = open(rabbit);
    expect(norm(element.querySelector('.environment-line .environment-chip')?.textContent), 'a connection in no environment').toBe('NO ENVIRONMENT');
    expect(norm(element.querySelector('.environment-line .where')?.textContent), 'the drawn line of the edit dialog').toBe('conn to rabbit:5672');
    expect(norm(element.querySelector('.environment-line .where b')?.textContent), 'the name is bold').toBe('conn');
  });

  it('Test of a stored connection sends its id with the stored secret as the mask, so the API tests with the stored one', () => {
    const { component } = open(rabbit);

    component.testConnection();

    expect(connectionServiceMock.testConnection.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 'c1', password: '***' }));
  });

  it('shows Provider Type and Authentication as read-only text, not as selects', () => {
    const { element } = open(rabbit);
    const facts = Array.from(element.querySelectorAll('.fact')).map(f =>
      [f.querySelector('.fact-label')?.textContent?.trim(), f.querySelector('.fact-value')?.textContent?.trim()]);
    expect(facts).toEqual([['Provider Type', 'RabbitMQ'], ['Authentication', 'Username and password, virtual host /']]);
    const fieldLabels = Array.from(element.querySelectorAll('.field > label')).map(l => l.textContent?.trim());
    expect(fieldLabels).not.toContain('Provider Type');
    expect(fieldLabels).not.toContain('Authentication');
    expect(fieldLabels).toContain('Connection Name');
  });

  it('a stored secret shows the lock, its label and Stored with Replace, and never fills an input with it', () => {
    const { element, button } = open(rabbit);
    const stored = element.querySelector('.secret-stored');
    expect(stored?.querySelector('mat-icon')?.textContent).toBe('lock');
    expect(stored?.textContent).toContain('Password');
    expect(stored?.textContent).toContain('Stored. It is never shown again and never sent back to this screen. Saving keeps it as it is.');
    expect(button('Replace')).toBeDefined();
    const values = Array.from(element.querySelectorAll('input')).map(i => i.value);
    expect(values).not.toContain('***');
    expect(element.querySelector('input[type="password"]')).toBeNull();
  });

  it('a save without Replace sends the mask for the stored secret, never a value, and keeps the TLS flag', () => {
    const { component } = open(rabbit);
    component.save();
    const payload = connectionServiceMock.saveConnection.mock.calls[0][0];
    expect(payload.password).toBe('***');
    expect(payload.useSsl).toBe(true);
    expect(payload.id).toBe('c1');
  });

  it('Replace opens New <secret> with its hint and Keep the stored value; Replace sends the new value', async () => {
    const { fixture, component, element, button } = open(rabbit);
    button('Replace')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('.secret-replace .field > label')?.textContent?.trim()).toBe('New Password');
    expect(element.querySelector('.secret-replace input')?.getAttribute('type')).toBe('password');
    expect(element.textContent).toContain('Replaces the stored value when you choose Update. Saved in plain text in workspace.json on this computer.');
    expect(button('Keep the stored value')).toBeDefined();
    expect((element.querySelector('.secret-replace input') as HTMLInputElement).value, 'Replace starts from an empty field, never the stored secret').toBe('');
    expect(component.newSecret, 'the field behind Replace holds nothing of the stored secret').toBe('');

    component.newSecret = 'new-password';
    component.save();
    expect(connectionServiceMock.saveConnection.mock.calls[0][0].password).toBe('new-password');
  });

  it.each([
    [{ providerType: ProviderType.AzureServiceBus, authType: 'ConnectionString', connectionString: '***' }, 'New Connection String'],
    [{ providerType: ProviderType.AzureServiceBus, authType: 'ServicePrincipal', clientSecret: '***', fullyQualifiedNamespace: 'ns.servicebus.windows.net' }, 'New Client Secret'],
  ] as const)('Replace of a stored Azure secret starts from an empty field (%#)', async (connection, label) => {
    const { fixture, component, element, button } = open(connection as Partial<ServiceBusConnection>);
    button('Replace')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(element.querySelector('.secret-replace .field > label')?.textContent?.trim()).toBe(label);
    expect((element.querySelector('.secret-replace input') as HTMLInputElement).value).toBe('');
    expect(component.newSecret).toBe('');
  });

  it('Keep the stored value closes Replace and the save sends the mask again', () => {
    const { fixture, component, button } = open({ providerType: ProviderType.AzureServiceBus, authType: 'ConnectionString', connectionString: '***' });
    button('Replace')!.click();
    fixture.detectChanges();
    component.newSecret = 'typed-then-dropped';
    button('Keep the stored value')!.click();
    fixture.detectChanges();

    expect(component.isFormValid()).toBe(true);
    component.save();
    expect(connectionServiceMock.saveConnection.mock.calls[0][0].connectionString).toBe('***');
  });

  it('a stored client secret keeps Update enabled and is sent as the mask', () => {
    const { component } = open({
      providerType: ProviderType.AzureServiceBus, authType: 'ServicePrincipal', fullyQualifiedNamespace: 'ns.servicebus.windows.net',
      tenantId: 't', servicePrincipalClientId: 'c', clientSecret: '***'
    });
    expect(component.secretLabel()).toBe('Client Secret');
    expect(component.isFormValid()).toBe(true);
    component.save();
    expect(connectionServiceMock.saveConnection.mock.calls[0][0].clientSecret).toBe('***');
  });

  it('a sign-in connection says no secret is stored and saves without a new sign-in', () => {
    const { component, element } = open({ providerType: ProviderType.AzureServiceBus, authType: 'InteractiveBrowser', fullyQualifiedNamespace: 'ns.servicebus.windows.net' });
    expect(element.querySelector('.no-secret span')?.textContent?.trim())
      .toBe('No secret is stored. This connection signs in with Microsoft; the token stays in memory.');
    expect(element.querySelector('.secret-stored, .secret-replace')).toBeNull();
    expect(component.isFormValid()).toBe(true);
  });

  it.each([
    ['RabbitMQ', rabbit, [['Connection Name', 'conn'], ['Host Name', 'rabbit'], ['Port', '5672'], ['Username', 'explorer'], ['Virtual Host', '/'], ['Management Port', '15672']]],
    ['sign-in', { providerType: ProviderType.AzureServiceBus, authType: 'InteractiveBrowser', fullyQualifiedNamespace: 'ns.servicebus.windows.net', tenantId: 't1' },
      [['Connection Name', 'conn'], ['Fully Qualified Namespace', 'ns.servicebus.windows.net'], ['Tenant ID (optional)', 't1']]],
    ['service principal', { providerType: ProviderType.AzureServiceBus, authType: 'ServicePrincipal', fullyQualifiedNamespace: 'ns.servicebus.windows.net', tenantId: 't1', servicePrincipalClientId: 'c1', clientSecret: '***' },
      [['Connection Name', 'conn'], ['Fully Qualified Namespace', 'ns.servicebus.windows.net'], ['Tenant ID', 't1'], ['Client ID', 'c1']]],
    ['connection string', { providerType: ProviderType.AzureServiceBus, authType: 'ConnectionString', connectionString: '***' }, [['Connection Name', 'conn']]]
  ] as const)('edit of a %s connection: Connection Name full width, then only its non-secret fields, no hints and no add-only parts (row 86)', async (_kind, connection, expected) => {
    const { fixture, element } = open(connection as Partial<ServiceBusConnection>);
    await settle(fixture);
    const grid = element.querySelector('.grid.two.edit-fields');
    const fields = Array.from(grid?.querySelectorAll('.field') ?? []);
    expect(fields.map(f => [norm(f.querySelector(':scope > label')?.textContent), (f.querySelector('input') as HTMLInputElement).value]),
      'the editable fields, in the order the artboard draws them, with their stored values').toEqual(expected);
    expect(fields[0].classList.contains('full'), 'Connection Name spans the full width').toBe(true);
    expect(fields.slice(1).some(f => f.classList.contains('full')), 'the other fields share the two columns').toBe(false);
    expect(grid?.querySelector('mat-hint'), 'the edit fields carry no hint').toBeNull();
    expect(element.querySelectorAll('mat-form-field').length, 'no field outside the edit grid but the replace and organization ones and, on Azure, the proxy address and the resource ID')
      .toBe(fields.length + 1 + (_kind === 'RabbitMQ' ? 0 : 2));
    expect(element.querySelector('fieldset.auth, .store-notice, input[type="password"]'), 'no auth choice, no add notice, no secret input').toBeNull();
    expect(Array.from(element.querySelectorAll('mat-checkbox')).map(c => norm(c.textContent)), 'RabbitMQ keeps its two TLS checkboxes in edit; Azure has none')
      .toEqual(_kind === 'RabbitMQ' ? ['Use TLS for AMQP (amqps)', 'Use TLS for the management API (https)'] : []);
  });

  it('a failed save keeps the dialog open and says the connection was not saved', () => {
    // The dialog imports MatSnackBarModule, whose MatSnackBar overrides the TestBed provider.
    const snack = vi.spyOn(MatSnackBar.prototype, 'open').mockReturnValue(undefined as never);
    const { component } = open(rabbit);
    connectionServiceMock.saveConnection.mockReturnValue(throwError(() => ({ error: { message: 'Unable to connect to RabbitMQ server' } })));
    component.save();
    expect(dialogRefMock.close).not.toHaveBeenCalled();
    expect(snack).toHaveBeenCalledWith('Unable to connect to RabbitMQ server', 'Close', { duration: 3000 });
    expect(component.saving()).toBe(false);
    snack.mockRestore();
  });
});

describe('AddConnectionDialogComponent - Azure transport and proxy', () => {
  let connectionServiceMock: { testConnection: ReturnType<typeof vi.fn>; saveConnection: ReturnType<typeof vi.fn> };

  async function open(connection?: Partial<ServiceBusConnection>) {
    connectionServiceMock = {
      testConnection: vi.fn().mockReturnValue(of({ success: true })),
      saveConnection: vi.fn().mockReturnValue(of({ id: 'c1' }))
    };
    TestBed.configureTestingModule({
      imports: [AddConnectionDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: ConnectionService, useValue: connectionServiceMock },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: { groups: [], connection: connection && { id: 'c1', name: 'conn', isConnected: false, createdAt: new Date(), ...connection } }
        }
      ]
    });
    const fixture = TestBed.createComponent(AddConnectionDialogComponent);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, component: fixture.componentInstance, el };
  }

  /** The dialog's fields are plain properties, so a change made by the test marks the view before it is checked. */
  async function refresh(fixture: ComponentFixture<AddConnectionDialogComponent>) {
    fixture.componentRef.injector.get(ChangeDetectorRef).markForCheck();
    await settle(fixture);
  }

  const fieldError = (el: HTMLElement) => norm(el.querySelector('.network .field-error')?.textContent) || null;

  it('an Azure connection offers the transport AMQP, the default, or AMQP over WebSockets, and an optional proxy whose hint says no credential is stored', async () => {
    const { component, el } = await open();
    const network = el.querySelector('fieldset.network');
    expect(norm(network?.querySelector('legend')?.textContent), 'the transport is a fieldset named Transport').toBe('Transport');
    expect(Array.from(network!.querySelectorAll('mat-radio-button')).map(r => norm(r.textContent)))
      .toEqual(['AMQP (port 5671)', 'AMQP over WebSockets (port 443)']);
    expect(component.useWebSockets, 'AMQP is the default transport, the behaviour before this change').toBe(false);
    expect(norm(network?.querySelector('.field > label')?.textContent)).toBe('Proxy address (optional)');
    expect(norm(network?.querySelector('mat-hint')?.textContent), 'the hint says the proxy uses the default credentials and none is stored')
      .toBe('Only with AMQP over WebSockets. The address only: the proxy is reached with the default credentials of this computer, and no proxy user name or password is stored.');
  });

  it('RabbitMQ has no transport or proxy', async () => {
    const { fixture, component, el } = await open();
    component.providerType = ProviderType.RabbitMQ;
    component.onProviderTypeChange();
    await refresh(fixture);
    expect(el.querySelector('fieldset.network'), 'the transport is an Azure setting').toBeNull();
  });

  it('refuses a proxy with a user name or password, a proxy without WebSockets and an address that is not http, with a message, and disables Save', async () => {
    const { fixture, component, el } = await open();
    component.name = 'proxied';
    component.azureAuthType = 'ConnectionString';
    component.connectionString = 'Endpoint=sb://contoso-test.servicebus.windows.net/;SharedAccessKeyName=K;SharedAccessKey=k';
    const save = () => Array.from(el.querySelectorAll('button')).find(b => norm(b.textContent) === 'Save') as HTMLButtonElement;

    component.useWebSockets = true;
    component.proxyAddress = 'http://user:pass@proxy.example:8080';
    await refresh(fixture);
    expect(fieldError(el), 'user info in the proxy address is refused').toBe(PROXY_USER_INFO);
    expect(save().disabled, 'a refused proxy cannot be saved').toBe(true);

    component.proxyAddress = 'proxy.example:8080';
    await refresh(fixture);
    expect(fieldError(el), 'an address without http:// is refused').toBe(PROXY_FORMAT);

    component.proxyAddress = 'http://proxy.example:8080';
    component.useWebSockets = false;
    await refresh(fixture);
    expect(fieldError(el), 'a proxy on the AMQP transport is refused, never switched silently').toBe(PROXY_NEEDS_WEBSOCKETS);
    expect(save().disabled, 'a proxy without WebSockets cannot be saved').toBe(true);

    component.useWebSockets = true;
    await refresh(fixture);
    expect(fieldError(el), 'an http proxy over WebSockets is accepted').toBeNull();
    expect(save().disabled, 'an http proxy over WebSockets can be saved').toBe(false);
  });

  it('an Azure connection takes an optional resource ID in the namespace format, refuses any other with a message, and saves it trimmed', async () => {
    const { fixture, component, el } = await open({ providerType: ProviderType.AzureServiceBus, authType: 'AzureCli', fullyQualifiedNamespace: 'contoso-test.servicebus.windows.net' });
    const resourceId = '/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-test/providers/Microsoft.ServiceBus/namespaces/contoso-test';
    const field = Array.from(el.querySelectorAll('.field')).find(f => norm(f.querySelector(':scope > label')?.textContent) === 'Azure resource ID (optional)');
    const error = () => Array.from(el.querySelectorAll('.field-error')).map(e => norm(e.textContent)).find(t => t === RESOURCE_ID_FORMAT) ?? null;
    expect(norm(field?.querySelector('mat-hint')?.textContent)).toBe('For the Azure Monitor metrics on Monitoring, read with an Entra ID sign-in. Not a secret, and not needed to connect.');

    component.azureResourceId = resourceId + '/queues/orders';
    await refresh(fixture);
    expect(error(), 'a resource ID that does not name a namespace is refused with its message').toBe(RESOURCE_ID_FORMAT);
    expect(component.isFormValid(), 'a refused resource ID cannot be saved').toBe(false);

    component.azureResourceId = ` ${resourceId} `;
    await refresh(fixture);
    expect(error()).toBeNull();
    component.save();
    expect(connectionServiceMock.saveConnection.mock.calls[0][0], 'the save carries the resource ID').toEqual(expect.objectContaining({ azureResourceId: resourceId }));
  });

  it('test, save and sign-in send the transport and the proxy; an empty proxy is left out', async () => {
    const { component } = await open();
    component.name = 'proxied';
    component.fullyQualifiedNamespace = 'contoso-test.servicebus.windows.net';
    component.useWebSockets = true;
    component.proxyAddress = ' http://proxy.example:8080 ';

    component.signInWithMicrosoft();
    component.testConnection();
    component.save();

    const sent = { useWebSockets: true, proxyAddress: 'http://proxy.example:8080' };
    expect(connectionServiceMock.testConnection.mock.calls[0][0], 'sign-in reaches the namespace through the proxy').toEqual(expect.objectContaining(sent));
    expect(connectionServiceMock.testConnection.mock.calls[1][0], 'the test carries the transport').toEqual(expect.objectContaining(sent));
    expect(connectionServiceMock.saveConnection.mock.calls[0][0], 'the save carries the transport').toEqual(expect.objectContaining(sent));

    component.useWebSockets = false;
    component.proxyAddress = '';
    component.save();
    const plain = connectionServiceMock.saveConnection.mock.calls[1][0];
    expect(plain.useWebSockets, 'AMQP is sent as useWebSockets false').toBe(false);
    expect(plain.proxyAddress, 'an empty proxy is not sent').toBeUndefined();
  });

  it('an edit shows the stored transport and proxy and an Update sends them with the masked secret', async () => {
    const { component, el } = await open({
      providerType: ProviderType.AzureServiceBus, authType: 'ConnectionString', connectionString: '***',
      useWebSockets: true, proxyAddress: 'http://proxy.example:8080'
    });
    expect(el.querySelector('fieldset.network'), 'the edit offers the transport').not.toBeNull();
    expect(component.useWebSockets, 'the edit loads the stored transport').toBe(true);
    expect((el.querySelector('.network input:not([type="radio"])') as HTMLInputElement).value, 'the edit shows the stored proxy').toBe('http://proxy.example:8080');

    component.save();

    expect(connectionServiceMock.saveConnection.mock.calls[0][0]).toEqual(expect.objectContaining({
      id: 'c1', connectionString: '***', useWebSockets: true, proxyAddress: 'http://proxy.example:8080'
    }));
  });
});
