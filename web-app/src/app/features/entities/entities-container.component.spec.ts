import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EntitiesContainerComponent } from './entities-container.component';

describe('EntitiesContainerComponent', () => {
  it('the tree narrows to 232 px at the minimum window of 1000 by 700, as Window.dc.html draws it', () => {
    TestBed.overrideComponent(EntitiesContainerComponent, { set: { imports: [], schemas: [NO_ERRORS_SCHEMA] } });
    const fixture = TestBed.createComponent(EntitiesContainerComponent);
    fixture.detectChanges();
    const tree = getComputedStyle((fixture.nativeElement as HTMLElement).querySelector('.entities-sidenav')!);

    expect(tree.minWidth, 'the tree is never narrower than 232 px').toBe('232px');
    expect(tree.flexBasis, 'the tree takes 23.2% of the width: 232 px at 1000 px, about 280 px at 1216 px').toBe('23.2%');
  });
});
