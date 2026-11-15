import { TestBed } from '@angular/core/testing';
import { EnvironmentChipComponent } from './environment-chip.component';

describe('EnvironmentChipComponent', () => {
  function render(name: string | null, isProduction: boolean) {
    const fixture = TestBed.createComponent(EnvironmentChipComponent);
    fixture.componentRef.setInput('name', name);
    fixture.componentRef.setInput('isProduction', isProduction);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.environment-chip') as HTMLElement;
  }

  it('an environment marked production reads its name in capitals, in the production style, with a warning icon', () => {
    const chip = render('Production', true);
    expect(chip.textContent?.replace('warning', '').trim()).toBe('PRODUCTION');
    expect(chip.classList.contains('production')).toBe(true);
    expect(chip.querySelector('mat-icon')?.textContent).toBe('warning');
  });

  it('an environment not marked production reads its name in capitals, with no warning icon', () => {
    const chip = render('Development', false);
    expect(chip.textContent?.trim()).toBe('DEVELOPMENT');
    expect(chip.classList.contains('production')).toBe(false);
    expect(chip.querySelector('mat-icon')).toBeNull();
  });

  it('a connection in no environment reads NO ENVIRONMENT, in the warning container', () => {
    const chip = render(null, true);
    expect(chip.textContent?.trim()).toBe('NO ENVIRONMENT');
    expect(chip.classList.contains('none')).toBe(true);
    expect(chip.classList.contains('production')).toBe(false);
  });
});
