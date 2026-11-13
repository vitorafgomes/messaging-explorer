import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { ResubmitRunIndicatorComponent } from './resubmit-run-indicator.component';
import { ContinuousResubmitDialogComponent } from './continuous-resubmit-dialog.component';
import { ResubmitRun, ResubmitRunService } from '../../core/services';

function fakeRun(entityName: string, read: number, total: number, topicName?: string): ResubmitRun {
  return {
    target: { entityType: topicName ? 'subscription' : 'queue', entityName, topicName, subQueue: 'deadletter' },
    progress: signal({ status: 'running', read, total })
  } as unknown as ResubmitRun;
}

describe('ResubmitRunIndicatorComponent', () => {
  let activeRuns: ReturnType<typeof signal<ResubmitRun[]>>;
  let dialog: { open: ReturnType<typeof vi.fn> };

  function render() {
    TestBed.configureTestingModule({
      imports: [ResubmitRunIndicatorComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ResubmitRunService, useValue: { activeRuns } },
        { provide: MatDialog, useValue: dialog }
      ]
    });
    const fixture = TestBed.createComponent(ResubmitRunIndicatorComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    activeRuns = signal<ResubmitRun[]>([]);
    dialog = { open: vi.fn() };
  });

  it('shows nothing on the toolbar while no run is active, and a named button as soon as one is', () => {
    const fixture = render();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();

    activeRuns.set([fakeRun('orders', 480, 700)]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button').getAttribute('aria-label')).toBe('Resubmit running: 1 run. Open a run');
  });

  it('opening a run from the toolbar opens the resubmit dialog of that entity, which shows the run', async () => {
    const run = fakeRun('eu', 2, 5, 'sales');
    activeRuns.set([fakeRun('orders', 480, 700), run]);
    const component = render().componentInstance;

    await component.open(run);

    expect(dialog.open).toHaveBeenCalledWith(ContinuousResubmitDialogComponent, expect.objectContaining({
      data: { entityType: 'subscription', entityName: 'eu', topicName: 'sales' }
    }));
  });
});
