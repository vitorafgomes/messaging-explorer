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
    <div class="entities-container d-flex">
      <div class="entities-sidenav">
        <app-entities-tree></app-entities-tree>
      </div>
      <div class="entities-content flex-fill">
        <app-entity-details></app-entity-details>
      </div>
    </div>
  `,
  styles: [`
    .entities-container {
      width: 100%;
      height: 100%;
    }

    .entities-sidenav {
      width: 320px;
      border-right: 1px solid var(--bs-border-color);
      padding: 0;
      flex-shrink: 0;
    }

    .entities-content {
      background: var(--bs-secondary-bg);
      padding: 0;
    }
  `]
})
export class EntitiesContainerComponent {}
