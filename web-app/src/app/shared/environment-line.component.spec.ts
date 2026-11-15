import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EnvironmentLineComponent, EnvironmentMark } from './environment-line.component';

@Component({
  standalone: true,
  imports: [EnvironmentLineComponent],
  template: `<app-environment-line [mark]="mark()"><b>orders</b> on contoso-prod (ns.example.net)</app-environment-line>`
})
class Host {
  readonly mark = signal<EnvironmentMark | undefined>(undefined);
}

describe('EnvironmentLineComponent: the chip, then where the change lands, as the dialog headers draw it', () => {
  function render(mark: EnvironmentMark | undefined): HTMLElement {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.mark.set(mark);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.environment-line') as HTMLElement;
  }

  it('a production environment: the PRODUCTION chip in the error container with a warning icon, then "orders on <connection>"', () => {
    const line = render({ name: 'Production', isProduction: true });
    const chip = line.querySelector('.environment-chip') as HTMLElement;

    expect(chip.textContent?.replace('warning', '').trim(), 'the chip says PRODUCTION').toBe('PRODUCTION');
    expect(chip.classList.contains('production'), 'a production environment takes the error container').toBe(true);
    expect(chip.querySelector('mat-icon')?.textContent?.trim(), 'a production chip carries the warning icon').toBe('warning');
    expect(line.querySelector('.where')?.textContent?.trim(), 'the line names the entity and the connection').toBe('orders on contoso-prod (ns.example.net)');
    expect(line.querySelector('.where b')?.textContent, 'the entity is in bold').toBe('orders');
  });

  it('a screen reader hears "Environment:" before the chip, visually hidden, as the dialog headers draw it', () => {
    const line = render({ name: 'Production', isProduction: true });
    const hidden = line.querySelector('.visually-hidden') as HTMLElement | null;

    expect(hidden?.textContent?.trim(), 'a visually hidden "Environment:" names the chip').toBe('Environment:');
    expect(hidden?.nextElementSibling?.tagName, 'the hidden word comes right before the chip').toBe('APP-ENVIRONMENT-CHIP');
    expect(render(undefined).querySelector('.visually-hidden'), 'no hidden word before "Environment not known", which already says it').toBeNull();
  });

  it('an environment not marked production: its name in capitals, no warning icon', () => {
    const chip = render({ name: 'Development', isProduction: false }).querySelector('.environment-chip') as HTMLElement;

    expect(chip.textContent?.trim()).toBe('DEVELOPMENT');
    expect(chip.classList.contains('production')).toBe(false);
    expect(chip.querySelector('mat-icon')).toBeNull();
  });

  it('a connection in no environment says NO ENVIRONMENT', () => {
    const chip = render({ name: null, isProduction: false }).querySelector('.environment-chip') as HTMLElement;

    expect(chip.textContent?.trim(), 'a connection in no environment says NO ENVIRONMENT').toBe('NO ENVIRONMENT');
  });

  it('while the environment is not known it says so in words, never NO ENVIRONMENT', () => {
    const line = render(undefined);

    expect(line.querySelector('.environment-chip'), 'no chip claims an environment that is not known').toBeNull();
    expect(line.querySelector('.not-known')?.textContent?.trim()).toBe('Environment not known');
    expect(line.querySelector('.where')?.textContent?.trim()).toBe('orders on contoso-prod (ns.example.net)');
  });
});
