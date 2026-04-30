import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'connections',
    pathMatch: 'full'
  },
  {
    path: 'connections',
    loadComponent: () => import('./features/connections/connections.component').then(m => m.ConnectionsComponent)
  },
  {
    path: 'entities',
    loadComponent: () => import('./features/entities/entities-container.component').then(m => m.EntitiesContainerComponent)
  },
  {
    path: 'queues',
    loadComponent: () => import('./features/queues/queues.component').then(m => m.QueuesComponent)
  },
  {
    path: 'topics',
    loadComponent: () => import('./features/topics/topics.component').then(m => m.TopicsComponent)
  },
  {
    path: 'monitoring',
    loadComponent: () => import('./features/monitoring/monitoring.component').then(m => m.MonitoringComponent)
  }
];
