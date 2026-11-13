import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { NEVER, of } from 'rxjs';
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
    (fixture.nativeElement.querySelector('button[title="Toggle Debug Mode (F9)"]') as HTMLElement).click();
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('.debug-panel') as HTMLElement;
    const labels = Array.from(panel.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(labels).toEqual(['Refresh', 'Force Reload']);
  });
});
