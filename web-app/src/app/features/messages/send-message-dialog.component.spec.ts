import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SendMessageDialogComponent, SendMessageDialogData } from './send-message-dialog.component';
import { QueueService, TopicService, ThemeService } from '../../core/services';

describe('SendMessageDialogComponent', () => {
  let queueServiceMock: { sendMessage: ReturnType<typeof vi.fn> };
  let topicServiceMock: { sendMessage: ReturnType<typeof vi.fn> };
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  let themeServiceMock: { isDark: ReturnType<typeof signal<boolean>> };

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

    TestBed.configureTestingModule({
      imports: [SendMessageDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: QueueService, useValue: queueServiceMock },
        { provide: TopicService, useValue: topicServiceMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: ThemeService, useValue: themeServiceMock },
      ],
    });
  });

  function createComponent(options?: { activeTab?: number; scheduledTime?: string }) {
    const fixture = TestBed.createComponent(SendMessageDialogComponent);
    const component = fixture.componentInstance;
    if (options?.activeTab !== undefined) {
      component.activeTab = options.activeTab;
    }
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

  it('should have Delivery Options separator in Properties tab', () => {
    const { fixture } = createComponent({ activeTab: 1 });

    const el = fixture.nativeElement as HTMLElement;
    const heading = el.querySelector('h6');

    expect(heading).toBeTruthy();
    expect(heading!.textContent).toContain('Delivery Options');
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
    const sendButton = el.querySelector('.btn-primary') as HTMLButtonElement;

    expect(sendButton.textContent).toContain('Schedule');
  });

  it('should show "Send" button text when scheduledEnqueueTimeLocal is empty', () => {
    const { fixture } = createComponent();

    const el = fixture.nativeElement as HTMLElement;
    const sendButton = el.querySelector('.btn-primary') as HTMLButtonElement;

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
});
