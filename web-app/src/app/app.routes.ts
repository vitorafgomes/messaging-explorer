import { Routes } from '@angular/router';
import { requireConnection } from './core/services/require-connection.guard';

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
    canActivate: [requireConnection],
    loadComponent: () => import('./features/entities/entities-container.component').then(m => m.EntitiesContainerComponent)
  },
  {
    path: 'queues',
    canActivate: [requireConnection],
    loadComponent: () => import('./features/queues/queues.component').then(m => m.QueuesComponent)
  },
  {
    path: 'topics',
    canActivate: [requireConnection],
    loadComponent: () => import('./features/topics/topics.component').then(m => m.TopicsComponent)
  },
  {
    path: 'monitoring',
    canActivate: [requireConnection],
    loadComponent: () => import('./features/monitoring/monitoring.component').then(m => m.MonitoringComponent)
  },
  {
    path: 'logs',
    loadComponent: () => import('./features/logs/logs.component').then(m => m.LogsComponent)
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings.component').then(m => m.SettingsComponent)
  }
];
