import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EntitiesTreeComponent } from './entities-tree.component';
import { EntityDetailsComponent } from './entity-details.component';

@Component({
  selector: 'app-entities-container',
  standalone: true,
  imports: [
    CommonModule,
    EntitiesTreeComponent,
    EntityDetailsComponent
  ],
  template: `
    <div class="entities-container">
      <div class="entities-sidenav">
        <app-entities-tree></app-entities-tree>
      </div>
      <div class="entities-content">
        <app-entity-details></app-entity-details>
      </div>
    </div>
  `,
  styles: [`
    .entities-container {
      display: flex;
      width: 100%;
      height: 100%;
    }

    .entities-sidenav {
      flex: 0 0 26%;
      min-width: 264px;
      max-width: 340px;
      border-right: 1px solid var(--mat-sys-outline-variant);
    }

    .entities-content {
      flex: 1;
      min-width: 0;
    }
  `]
})
export class EntitiesContainerComponent {}
