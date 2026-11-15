import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SendMessageDialogComponent, SendMessageDialogData } from './send-message-dialog.component';
import { QueueService, TopicService, ThemeService } from '../../core/services';
import { DEFAULT_AZURE_CAPABILITIES, DEFAULT_RABBITMQ_CAPABILITIES, ProviderService } from '../../core/services/provider.service';
import { ProviderCapabilities } from '../../core/models/provider.model';
import { ConnectionGroupService, ConnectionService } from '../../core/services';

describe('SendMessageDialogComponent', () => {
  let queueServiceMock: { sendMessage: ReturnType<typeof vi.fn> };
  let topicServiceMock: { sendMessage: ReturnType<typeof vi.fn> };
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  let themeServiceMock: { isDark: ReturnType<typeof signal<boolean>> };
  let capabilities: ReturnType<typeof signal<ProviderCapabilities | null>>;

  const dialogData: SendMessageDialogData = {
    entityType: 'queue',
    entityName: 'test-queue',
  };

  beforeEach(() => {
    queueServiceMock = { sendMessage: vi.fn().mockReturnValue(of({ success: true })) };
    topicServiceMock = { sendMessage: vi.fn().mockReturnValue(of({ success: true })) };
    dialogRefMock = { close: vi.fn() };
    snackBarMock = { open: vi.fn() };
    themeServiceMock = { isDark: signal(false) };
    capabilities = signal<ProviderCapabilities | null>(DEFAULT_AZURE_CAPABILITIES);

    TestBed.configureTestingModule({
      imports: [SendMessageDialogComponent],
      providers: [
        // The environment line reads the active connection; none is known here, so nothing is requested.
        { provide: ConnectionService, useValue: { currentTarget: 'sample.example.net', currentConnectionId: null } },
        { provide: ConnectionGroupService, useValue: {} },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: QueueService, useValue: queueServiceMock },
        { provide: TopicService, useValue: topicServiceMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: ThemeService, useValue: themeServiceMock },
        { provide: ProviderService, useValue: { capabilities } },
      ],
    });
  });

  function createComponent(options?: { activeTab?: number; scheduledTime?: string }) {
    const fixture = TestBed.createComponent(SendMessageDialogComponent);
    const component = fixture.componentInstance;
    if (options?.scheduledTime !== undefined) {
      component.scheduledEnqueueTimeLocal = options.scheduledTime;
    }
    fixture.detectChanges();
    return { fixture, component };
  }

  it('should be created', () => {
    const { component } = createComponent();
    expect(component).toBeTruthy();
  });

  it('should have scheduling input in Properties tab', () => {
    const { fixture } = createComponent({ activeTab: 1 });

    const el = fixture.nativeElement as HTMLElement;
    const scheduledInput = el.querySelector('[data-testid="scheduled-enqueue-time"]') as HTMLInputElement;

    expect(scheduledInput).toBeTruthy();
    expect(scheduledInput.type).toBe('datetime-local');
  });

  it('should have TTL input in Properties tab', () => {
    const { fixture } = createComponent({ activeTab: 1 });

    const el = fixture.nativeElement as HTMLElement;
    const ttlInput = el.querySelector('[data-testid="time-to-live"]') as HTMLInputElement;

    expect(ttlInput).toBeTruthy();
    expect(ttlInput.type).toBe('text');
    expect(ttlInput.placeholder).toBe('HH:mm:ss');
  });

  it('shows the body, the properties and the delivery options with custom properties as three columns on one page', () => {
    const { fixture } = createComponent();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nav.sections')).toBeNull();
    const columns = Array.from(el.querySelectorAll('.columns > section'));
    expect(columns.map(c => c.querySelector('h3')?.textContent?.trim())).toEqual(['Message Body', 'Properties', 'Delivery Options']);
    expect(Array.from(columns[2].querySelectorAll('h3')).map(h => h.textContent?.trim())).toContain('Custom Properties');
  });

  it('should convert datetime-local to Date for scheduledEnqueueTime', () => {
    const { component } = createComponent();
    component.message.body = '{"test": true}';
    component.scheduledEnqueueTimeLocal = '2026-06-15T14:30';

    component.send();

    expect(component.message.scheduledEnqueueTime).toBeInstanceOf(Date);
    expect(component.message.scheduledEnqueueTime!.getFullYear()).toBe(2026);
    expect(component.message.scheduledEnqueueTime!.getMonth()).toBe(5); // June = 5 (zero-based)
    expect(component.message.scheduledEnqueueTime!.getDate()).toBe(15);
    expect(component.message.scheduledEnqueueTime!.getHours()).toBe(14);
    expect(component.message.scheduledEnqueueTime!.getMinutes()).toBe(30);
  });

  it('should not set scheduledEnqueueTime when datetime-local is empty', () => {
    const { component } = createComponent();
    component.message.body = '{"test": true}';
    component.scheduledEnqueueTimeLocal = '';

    component.send();

    expect(component.message.scheduledEnqueueTime).toBeUndefined();
  });

  it('should bind timeToLive as string', () => {
    const { component } = createComponent();
    component.message.body = '{"test": true}';
    component.message.timeToLive = '01:30:00';

    component.send();

    expect(component.message.timeToLive).toBe('01:30:00');
    expect(typeof component.message.timeToLive).toBe('string');
  });

  it('should show "Schedule" button text when scheduledEnqueueTimeLocal is set', () => {
    const { fixture } = createComponent({ scheduledTime: '2026-06-15T14:30' });

    const el = fixture.nativeElement as HTMLElement;
    const sendButton = el.querySelector('.send-button') as HTMLButtonElement;

    expect(sendButton.textContent).toContain('Schedule');
  });

  it('should show "Send" button text when scheduledEnqueueTimeLocal is empty', () => {
    const { fixture } = createComponent();

    const el = fixture.nativeElement as HTMLElement;
    const sendButton = el.querySelector('.send-button') as HTMLButtonElement;

    expect(sendButton.textContent).toContain('Send');
    expect(sendButton.textContent).not.toContain('Schedule');
  });

  it('should set min attribute on scheduling input to current datetime', () => {
    const { fixture } = createComponent({ activeTab: 1 });

    const el = fixture.nativeElement as HTMLElement;
    const scheduledInput = el.querySelector('[data-testid="scheduled-enqueue-time"]') as HTMLInputElement;

    expect(scheduledInput.min).toBeTruthy();
    // The min value should be a datetime-local format: YYYY-MM-DDTHH:mm
    expect(scheduledInput.min).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('should format toDateTimeLocal correctly', () => {
    const { component } = createComponent();
    const date = new Date(2026, 0, 5, 9, 7); // Jan 5, 2026 09:07

    const result = component.toDateTimeLocal(date);

    expect(result).toBe('2026-01-05T09:07');
  });

  it('should pass timeToLive to the service when sending', () => {
    const { component } = createComponent();
    component.message.body = '{"test": true}';
    component.message.timeToLive = '00:45:00';

    component.send();

    const sentMessage = queueServiceMock.sendMessage.mock.calls[0][1];
    expect(sentMessage.timeToLive).toBe('00:45:00');
  });

  it('should pass scheduledEnqueueTime to the service when sending', () => {
    const { component } = createComponent();
    component.message.body = '{"test": true}';
    component.scheduledEnqueueTimeLocal = '2026-12-25T10:00';

    component.send();

    const sentMessage = queueServiceMock.sendMessage.mock.calls[0][1];
    expect(sentMessage.scheduledEnqueueTime).toBeInstanceOf(Date);
  });

  it('a scheduled send shows the sequence number the API returned, until closed, so the message can be cancelled later', () => {
    queueServiceMock.sendMessage.mockReturnValue(of({ success: true, sequenceNumber: 42 }));
    const { fixture, component } = createComponent();
    const open = vi.spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open');
    component.message.body = '{"id":1}';
    component.scheduledEnqueueTimeLocal = '2026-12-25T10:00';

    component.send();

    expect(open.mock.calls, 'the number stays on screen: no duration').toEqual([
      ['Scheduled as sequence number 42. Keep it: a scheduled message is cancelled by this number.', 'Close']
    ]);
    expect(dialogRefMock.close).toHaveBeenCalledWith(true);
  });

  it('a send without a time keeps the short confirmation, with no sequence number', () => {
    queueServiceMock.sendMessage.mockReturnValue(of({ success: true, sequenceNumber: null }));
    const { fixture, component } = createComponent();
    const open = vi.spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open');
    component.message.body = '{"id":1}';

    component.send();

    expect(open.mock.calls).toEqual([['Message sent successfully!', 'Close', { duration: 3000 }]]);
  });

  describe('a feature the broker lacks is hidden, and stays visible on Azure', () => {
    const labels = (el: HTMLElement) => Array.from(el.querySelectorAll('label')).map(l => (l.textContent ?? '').trim());

    it('a broker without sessions has no Session ID field; Azure has it', () => {
      capabilities.set(DEFAULT_RABBITMQ_CAPABILITIES);
      expect(labels(createComponent({ activeTab: 1 }).fixture.nativeElement)).not.toContain('Session ID');

      capabilities.set(DEFAULT_AZURE_CAPABILITIES);
      expect(labels(createComponent({ activeTab: 1 }).fixture.nativeElement)).toContain('Session ID');
    });

    it('a broker without scheduled messages has no Scheduled Delivery field; Azure has it', () => {
      capabilities.set(DEFAULT_RABBITMQ_CAPABILITIES);
      const rabbit = createComponent({ activeTab: 1 }).fixture.nativeElement as HTMLElement;
      expect(labels(rabbit)).not.toContain('Scheduled Delivery');
      expect(rabbit.querySelector('[data-testid="scheduled-enqueue-time"]')).toBeNull();
      expect(rabbit.querySelector('[data-testid="time-to-live"]')).not.toBeNull();

      capabilities.set(DEFAULT_AZURE_CAPABILITIES);
      const azure = createComponent({ activeTab: 1 }).fixture.nativeElement as HTMLElement;
      expect(labels(azure)).toContain('Scheduled Delivery');
      expect(azure.querySelector('[data-testid="scheduled-enqueue-time"]')).not.toBeNull();
    });
  });
  describe('a retry after a failed send sends only what the form holds now', () => {
    it('properties and a schedule the user cleared after a failed send are not sent again', () => {
      queueServiceMock.sendMessage
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'An internal error occurred.' } })))
        .mockReturnValueOnce(of({ success: true }));
      const { component } = createComponent();
      component.message.body = '{"id":1}';
      component.customProperties = [{ key: 'env', value: 'prod' }];
      component.scheduledEnqueueTimeLocal = '2026-12-25T10:00';
      component.send();

      component.customProperties = [];
      component.scheduledEnqueueTimeLocal = '';
      component.send();

      const retried = { ...queueServiceMock.sendMessage.mock.calls[1][1] };
      expect(queueServiceMock.sendMessage).toHaveBeenCalledTimes(2);
      expect(retried.applicationProperties).toBeUndefined();
      expect(retried.scheduledEnqueueTime).toBeUndefined();
      expect(retried.body).toBe('{"id":1}');
    });
  });

  describe('a send refused because the entity is disabled', () => {
    it('a 409 shows the API message, the dialog stays open with its message, and nothing is resent', () => {
      queueServiceMock.sendMessage.mockReturnValue(throwError(() =>
        new HttpErrorResponse({ status: 409, error: { message: 'The entity is disabled for this operation.' } })));
      const { fixture, component } = createComponent();
      const open = vi.spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open');
      component.message.body = '{"id":1}';

      component.send();

      expect(open.mock.calls.at(-1)?.[0]).toBe('The entity is disabled for this operation.');
      expect(dialogRefMock.close).not.toHaveBeenCalled();
      expect(component.sending()).toBe(false);
      expect(component.message.body).toBe('{"id":1}');
      expect(queueServiceMock.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('a 500 keeps the generic failure', () => {
      queueServiceMock.sendMessage.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'An internal error occurred.' } })));
      const { fixture, component } = createComponent();
      const open = vi.spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open');
      component.message.body = 'x';

      component.send();

      expect(open.mock.calls.at(-1)?.[0]).toBe('Failed to send message');
    });
  });
  describe('as the Send artboard draws it', () => {
    const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const button = (el: HTMLElement, label: string) => Array.from(el.querySelectorAll('button')).find(b => text(b).endsWith(label)) as HTMLButtonElement;
    const type = (input: HTMLInputElement | HTMLTextAreaElement, value: string, fixture: { detectChanges(): void }) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    beforeEach(() => localStorage.removeItem('explorer-messages-templates'));
    const createWith = (setup: (c: SendMessageDialogComponent) => void) => {
      const fixture = TestBed.createComponent(SendMessageDialogComponent);
      setup(fixture.componentInstance);
      fixture.detectChanges();
      return { fixture, component: fixture.componentInstance };
    };
    afterEach(() => vi.restoreAllMocks());

    it('Save as Template asks for the name on the dialog, never in a browser prompt, and saves it', async () => {
      const prompt = vi.spyOn(window, 'prompt');
      const { fixture, component } = createWith(c => { c.message.body = '{"a":1}'; });
      const el = fixture.nativeElement as HTMLElement;
      button(el, 'Save as Template').click();
      fixture.detectChanges();

      const panel = el.querySelector('[data-testid="save-template"]') as HTMLElement;
      expect(text(panel)).toContain('Enter a name for this template');
      expect(Array.from(panel.querySelectorAll('button')).map(text)).toEqual(['Cancel', 'bookmarkSave template']);
      expect(text(button(panel, 'Save template').querySelector('mat-icon')), 'as Send.dc.html draws it: Save template with the bookmark icon').toBe('bookmark');
      type(panel.querySelector('input')!, 'Order created', fixture);
      await fixture.whenStable();
      button(panel, 'Save template').click();
      fixture.detectChanges();

      expect(prompt).not.toHaveBeenCalled();
      expect(component.templates().map(t => t.name)).toEqual(['Order created']);
      expect(el.querySelector('[data-testid="save-template"]')).toBeNull();
    });

    it('deleting a template asks on the dialog, Keep keeps it, and Delete template removes it, never a browser confirm', () => {
      const confirm = vi.spyOn(window, 'confirm');
      const { fixture, component } = createWith(c => {
        c.message.body = '{"a":1}';
        c.templateName = 'Order created';
        c.confirmSaveTemplate();
        c.selectedTemplateId = c.templates()[0].id;
      });
      const el = fixture.nativeElement as HTMLElement;

      (el.querySelector('[aria-label="Delete template"]') as HTMLElement).click();
      fixture.detectChanges();
      let panel = el.querySelector('[data-testid="delete-template"]') as HTMLElement;
      expect(text(panel)).toContain('Delete template "Order created"?');
      button(panel, 'Keep').click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="delete-template"]')).toBeNull();
      expect(component.templates()).toHaveLength(1);

      (el.querySelector('[aria-label="Delete template"]') as HTMLElement).click();
      fixture.detectChanges();
      panel = el.querySelector('[data-testid="delete-template"]') as HTMLElement;
      expect(text(button(panel, 'Delete template').querySelector('mat-icon')), 'as Send.dc.html draws it: Delete template with the trash icon').toBe('delete');
      button(panel, 'Delete template').click();
      fixture.detectChanges();
      expect(component.templates()).toHaveLength(0);
      expect(confirm).not.toHaveBeenCalled();
    });

    it('Format JSON says Invalid JSON beside it, not in a snack bar', () => {
      const { fixture } = createWith(c => { c.message.body = 'not json'; });
      const el = fixture.nativeElement as HTMLElement;
      button(el, 'Format JSON').click();
      fixture.detectChanges();
      const error = el.querySelector('.inline-error') as HTMLElement;
      expect(text(error)).toBe('Invalid JSON');
      expect(error.getAttribute('aria-live')).toBe('polite');
      expect(snackBarMock.open).not.toHaveBeenCalled();
    });

    it('says what an empty schedule and an empty time to live mean, and why Send is off with no body', () => {
      const { fixture } = createWith(c => { c.message.body = ''; });
      const el = fixture.nativeElement as HTMLElement;
      const hints = Array.from(el.querySelectorAll('mat-hint')).map(text);
      expect(hints).toContain('Empty: delivered as soon as it is sent.');
      expect(hints).toContain('Empty: the default of the queue.');
      expect(el.querySelector('.send-button')!.getAttribute('title')).toBe('The message body is empty');
    });

    it('the time to live hint names the default of the entity when the panel passes it', () => {
      TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { entityType: 'queue', entityName: 'orders', defaultTimeToLive: '14d' } });
      const { fixture } = createWith(() => {});
      const hints = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mat-hint')).map(text);
      expect(hints, 'the drawn hint: "Empty: the default of the {entity}, {ttl}."').toContain('Empty: the default of the queue, 14d.');
    });

    it('an edited resubmit says which dead-letter message it was filled from', () => {
      TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { entityType: 'queue', entityName: 'orders', mode: 'resubmit', sourceSequenceNumber: 48211870, prefill: { body: '{}' } } });
      const { fixture } = createWith(() => {});
      expect(text((fixture.nativeElement as HTMLElement).querySelector('.note'))).toContain(
        'This sends a new message to orders with the fields below, filled from dead-letter message 48211870. The original is not removed: it stays in dead-letter until it is deleted.');
    });

    it('on a topic, a set schedule says the topic holds the message until then', () => {
      TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { entityType: 'topic', entityName: 'orders-topic' } });
      const { fixture } = createWith(c => { c.scheduledEnqueueTimeLocal = '2099-01-01T10:00'; });
      const hints = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mat-hint')).map(text);
      expect(hints).toContain('Held by the topic until then, as a scheduled message.');
      expect(hints).toContain('Empty: the default of the topic.');
    });

    it('labels each custom property field "Key of property N" and "Value of property N", and names the remove button after the property', () => {
      const { fixture } = createWith(c => { c.addProperty(); c.addProperty(); c.customProperties[0].key = 'tenant'; });
      const el = fixture.nativeElement as HTMLElement;
      const labels = Array.from(el.querySelectorAll('.property-row mat-label')).map(text);
      expect(labels, 'each property field carries the drawn label with its number').toEqual(
        ['Key of property 1', 'Value of property 1', 'Key of property 2', 'Value of property 2']);
      expect(el.querySelectorAll('.property-row input[aria-label]').length, 'the label, not an aria-label, names the field').toBe(0);
      expect(el.querySelector('[aria-label="Remove property tenant"]')!.getAttribute('title')).toBe('Remove property');
    });
  });

  describe('a binary body', () => {
    const binary: ProviderCapabilities = { ...DEFAULT_AZURE_CAPABILITIES, supportsBinaryBody: true };

    it('a provider that declares binary bodies offers the base64 choice, and one that does not hides it', () => {
      capabilities.set(binary);
      const azure = createComponent();
      expect((azure.fixture.nativeElement as HTMLElement).querySelector('[data-testid="body-is-base64"]'), 'the choice is offered where the provider sends bytes').not.toBeNull();

      capabilities.set(DEFAULT_RABBITMQ_CAPABILITIES);
      azure.fixture.detectChanges();
      expect((azure.fixture.nativeElement as HTMLElement).querySelector('[data-testid="body-is-base64"]'), 'a provider without binary bodies never gets a base64 body').toBeNull();
    });

    it('a base64 body is sent with its flag, so the bytes round trip', () => {
      capabilities.set(binary);
      const { component } = createComponent();
      component.message.body = 'AP8=';
      component.message.bodyEncoding = 'base64';

      component.send();

      expect(queueServiceMock.sendMessage).toHaveBeenCalledWith('test-queue', expect.objectContaining({ body: 'AP8=', bodyEncoding: 'base64' }));
    });

    it('edit and resubmit of a binary message keeps the base64 flag of the source', () => {
      TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { entityType: 'queue', entityName: 'orders', mode: 'resubmit', sourceSequenceNumber: 7, prefill: { body: 'AP8=', bodyEncoding: 'base64' } } });
      capabilities.set(binary);
      const { component } = createComponent();

      component.send();

      expect(queueServiceMock.sendMessage, 'the resubmitted copy carries the bytes of the dead-lettered one').toHaveBeenCalledWith('orders', expect.objectContaining({ body: 'AP8=', bodyEncoding: 'base64' }));
    });

    it('a body flagged base64 that does not decode is not sent', () => {
      capabilities.set(binary);
      const { component } = createComponent();
      component.message.body = 'not base64!';
      component.message.bodyEncoding = 'base64';

      component.send();

      expect(component.base64Invalid(), 'the dialog says the body is not base64').toBe(true);
      expect(queueServiceMock.sendMessage, 'a body that is not the bytes meant is never sent').not.toHaveBeenCalled();
    });
  });
});
