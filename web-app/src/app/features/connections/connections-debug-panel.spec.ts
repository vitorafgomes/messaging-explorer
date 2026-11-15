import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NEVER, from, of } from 'rxjs';
import { ConnectionsComponent } from './connections.component';
import { ConnectionService, ConnectionGroupService, DevSettingsService } from '../../core/services';

describe('ConnectionsComponent debug panel', () => {
  afterEach(() => {
    localStorage.removeItem('dev-mode');
    vi.restoreAllMocks();
  });

  it('has no Clear All Data button: clearing all data lives in the danger zone of Settings', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [ConnectionsComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: ConnectionService, useValue: { getConnections: () => NEVER, connectionStatus$: of({ connected: false }) } },
        {
          provide: ConnectionGroupService,
          useValue: { getGroups: () => NEVER, buildGroupTree: () => [], getUngroupedConnections: () => [] },
        },
      ],
    }).compileComponents();
    TestBed.inject(DevSettingsService).toggle();
    const fixture = TestBed.createComponent(ConnectionsComponent);
    fixture.detectChanges();
    const debugButton = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLElement[])
      .find(b => b.textContent?.trim().endsWith('Debug'));
    expect(debugButton, 'the Debug button of the header').toBeDefined();
    debugButton!.click();
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('.debug-panel') as HTMLElement;
    const labels = Array.from(panel.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(labels).toEqual(['Refresh', 'Force Reload']);
  });

  it('Force Reload reports the counts before, on load and after in the snack bar, never in a browser alert box', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const browserAlert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const snackBar = { open: vi.fn() };
    TestBed.overrideProvider(MatSnackBar, { useValue: snackBar });
    await TestBed.configureTestingModule({
      imports: [ConnectionsComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        {
          provide: ConnectionService,
          // The API answers asynchronously, as HttpClient does.
          useValue: { getConnections: () => from(Promise.resolve([{ id: 'c1', name: 'orders' }])), connectionStatus$: of({ connected: false }) },
        },
        {
          provide: ConnectionGroupService,
          useValue: { getGroups: () => from(Promise.resolve([])), buildGroupTree: () => [], getUngroupedConnections: (c: unknown[]) => c },
        },
      ],
    }).compileComponents();
    TestBed.inject(DevSettingsService).toggle();
    const fixture = TestBed.createComponent(ConnectionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.toggleDebugMode();
    fixture.detectChanges();

    vi.useFakeTimers();
    try {
      const forceReload = (Array.from(fixture.nativeElement.querySelectorAll('.debug-panel button')) as HTMLElement[])
        .find(b => b.textContent?.trim() === 'Force Reload')!;
      forceReload.click();
      await vi.advanceTimersByTimeAsync(2000);
    } finally {
      vi.useRealTimers();
    }

    expect(browserAlert, 'the debug panel never opens a browser alert box').not.toHaveBeenCalled();
    expect(snackBar.open.mock.calls.map(call => call[0]), 'the counts before, on load and after the reload, in the snack bar')
      .toEqual(['Before reload: 1 connection, 0 groups', 'Load complete: 1 connection, 0 groups', 'After reload: 1 connection, 0 groups']);
  });
});
