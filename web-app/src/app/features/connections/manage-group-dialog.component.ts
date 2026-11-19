import { Component, inject, signal, WritableSignal, Inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormGroupDirective } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConnectionGroupService } from '../../core/services';
import { ConnectionGroup, ServiceBusConnection } from '../../core/models';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { EnvironmentChipComponent } from '../../shared/environment-chip.component';

interface ManageGroupDialogData {
  groups: ConnectionGroup[];
  connections?: ServiceBusConnection[];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

@Component({
  selector: 'app-manage-group-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatIconModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule,
    MatCheckboxModule,
    EnvironmentChipComponent
  ],
  template: `
    <h2 mat-dialog-title>Manage Groups</h2>

    <mat-dialog-content>
      <p class="intro">Clients and their environments group the saved connections. Nothing here reaches a broker.</p>
      <mat-tab-group mat-stretch-tabs="false" mat-align-tabs="start" animationDuration="0ms">
        <mat-tab label="Clients">
          <div class="tab-content">
            <div class="list-section">
              <h3>Existing Clients</h3>
              @if (clients().length === 0) {
                <p class="empty-message">No clients yet</p>
              } @else {
                <ul class="rows">
                  @for (client of clients(); track client.id) {
                    <li class="group-row">
                      <span class="group-name"><strong>{{ client.name }}</strong>&ngsp;<span class="counts">{{ clientCounts(client) }}</span></span>
                      <span class="item-actions">
                        <button mat-icon-button
                          [attr.aria-label]="'Edit client ' + client.name"
                          [matTooltip]="'Edit client ' + client.name"
                          (click)="editClient(client)">
                          <mat-icon class="row-icon">mode_edit_outline</mat-icon>
                        </button>
                        <button mat-button class="delete"
                          [attr.aria-label]="'Delete client ' + client.name"
                          (click)="deleteClient(client)">
                          <mat-icon class="row-icon">delete_outline</mat-icon>Delete
                        </button>
                      </span>
                    </li>
                  }
                </ul>
              }
            </div>

            <div class="form-section">
              <h3>{{ editingClient() ? 'Edit Client' : 'Add New Client' }}</h3>
              <form [formGroup]="clientForm" #clientDir="ngForm" (ngSubmit)="saveClient(clientDir)">
                <div class="grid">
                  <div class="field">
                    <label for="grp-client-name-1">Client Name</label>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <input matInput id="grp-client-name-1" formControlName="name" placeholder="e.g., Contoso">
                    @if (clientForm.get('name')?.hasError('required') && clientForm.get('name')?.touched) {
                      <mat-error>Client name is required</mat-error>
                    }
                  </mat-form-field>
                  </div>

                  <div class="field">
                    <label for="grp-description-optional-2">Description (optional)</label>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <input matInput id="grp-description-optional-2" formControlName="description" placeholder="Brief description">
                  </mat-form-field>
                  </div>
                </div>

                <div class="form-actions">
                  @if (editingClient()) {
                    <button matButton type="button" (click)="cancelEditClient(clientDir)">Cancel</button>
                  }
                  <button matButton="tonal" type="submit" [disabled]="!clientForm.valid || saving()">
                    <mat-icon>{{ editingClient() ? 'save' : 'add' }}</mat-icon>
                    {{ editingClient() ? 'Update' : 'Add' }} Client
                  </button>
                </div>
              </form>
            </div>
          </div>
        </mat-tab>

        <mat-tab label="Environments" [disabled]="clients().length === 0">
          <div class="tab-content">
            <div class="field client-selector">
              <label id="grp-select-client-3-label" for="grp-select-client-3">Select Client</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-select id="grp-select-client-3" aria-labelledby="grp-select-client-3-label" [(value)]="selectedClientId" (selectionChange)="onClientSelected()">
                @for (client of clients(); track client.id) {
                  <mat-option [value]="client.id">{{ client.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            </div>

            @if (!selectedClientId) {
              <p class="empty-message">Select a client above to view and manage its environments.</p>
            } @else {
              <div class="list-section">
                <h3>Environments</h3>
                @if (getEnvironmentsByClient(selectedClientId).length === 0) {
                  <p class="empty-message">No environments for this client</p>
                } @else {
                  <ul class="rows">
                    @for (env of getEnvironmentsByClient(selectedClientId); track env.id) {
                      <li class="group-row">
                        <span class="group-name"><strong>{{ env.name }}</strong>&ngsp;<span class="counts">{{ plural(connectionsOf(env).length, 'connection', 'connections') }}</span></span>
                        <span class="item-actions">
                          <app-environment-chip [name]="env.name" [isProduction]="!!env.isProduction" />
                          <mat-checkbox [checked]="!!env.isProduction" (change)="setProduction(env, $event)">
                            Production<span class="cdk-visually-hidden">: mark {{ env.name }} as a production environment</span>
                          </mat-checkbox>
                          <button mat-icon-button
                            [attr.aria-label]="'Edit environment ' + env.name"
                            [matTooltip]="'Edit environment ' + env.name"
                            (click)="editEnvironment(env)">
                            <mat-icon class="row-icon">mode_edit_outline</mat-icon>
                          </button>
                          <button mat-button class="delete"
                            [attr.aria-label]="'Delete environment ' + env.name"
                            (click)="deleteEnvironment(env)">
                            <mat-icon class="row-icon">delete_outline</mat-icon>Delete
                          </button>
                        </span>
                      </li>
                    }
                  </ul>
                  <p class="production-note">A connection in an environment marked Production shows the PRODUCTION chip on the toolbar and in every confirmation, and its destructive actions ask for the typed name.</p>
                }
              </div>

              <div class="form-section">
                <h3>{{ editingEnvironment() ? 'Edit Environment' : 'Add New Environment' }}</h3>
                <form [formGroup]="environmentForm" #environmentDir="ngForm" (ngSubmit)="saveEnvironment(environmentDir)">
                  <div class="grid">
                    <div class="field">
                      <label for="grp-environment-name-4">Environment Name</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <input matInput id="grp-environment-name-4" formControlName="name" placeholder="e.g., Production, Development">
                      @if (environmentForm.get('name')?.hasError('required') && environmentForm.get('name')?.touched) {
                        <mat-error>Environment name is required</mat-error>
                      }
                    </mat-form-field>
                    </div>

                    <div class="field">
                      <label for="grp-description-optional-5">Description (optional)</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <input matInput id="grp-description-optional-5" formControlName="description" placeholder="Brief description">
                    </mat-form-field>
                    </div>
                  </div>

                  <div class="form-actions">
                    @if (editingEnvironment()) {
                      <button matButton type="button" (click)="cancelEditEnvironment(environmentDir)">Cancel</button>
                    }
                    <button matButton="tonal" type="submit" [disabled]="!environmentForm.valid || saving()">
                      <mat-icon>{{ editingEnvironment() ? 'save' : 'add' }}</mat-icon>
                      {{ editingEnvironment() ? 'Update' : 'Add' }} Environment
                    </button>
                  </div>
                </form>
              </div>
            }
          </div>
        </mat-tab>
      </mat-tab-group>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton="filled" (click)="close()">Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .intro {
      margin: 0 0 8px;
      color: var(--mat-sys-on-surface-variant);
    }

    .tab-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding-top: 16px;
    }

    .list-section h3 {
      margin: 0 0 4px;
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
    }

    .form-section h3 {
      margin: 0 0 12px;
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-on-surface);
    }

    .item-actions button[mat-icon-button] {
      color: var(--mat-sys-on-surface-variant);
    }

    .row-icon {
      width: 20px;
      height: 20px;
      font-size: 20px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0 12px;
    }

    .form-actions {
      margin-top: 12px;
      display: flex;
      justify-content: flex-start;
      gap: 8px;
    }

    .item-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .delete {
      color: var(--mat-sys-error);
    }

    .counts {
      color: var(--mat-sys-on-surface-variant);
    }

    .client-selector {
      max-width: 320px;
    }

    .empty-message {
      margin: 0;
      padding: 16px 0;
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
    }

    .rows {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .group-row {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 52px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .group-name {
      display: flex;
      flex: 1;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 6px;
      min-width: 0;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;

      > label {
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .production-note {
      margin: 4px 0 0;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
  `]
})
export class ManageGroupDialogComponent {
  private dialogRef = inject(MatDialogRef<ManageGroupDialogComponent>);
  private groupService = inject(ConnectionGroupService);
  private snackBar = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private dialog = inject(MatDialog);
  readonly plural = plural;
  private readonly destroyRef = inject(DestroyRef);

  clients: WritableSignal<ConnectionGroup[]> = signal<ConnectionGroup[]>([]);
  environments: WritableSignal<ConnectionGroup[]> = signal<ConnectionGroup[]>([]);
  saving = signal(false);
  editingClient = signal<ConnectionGroup | null>(null);
  editingEnvironment = signal<ConnectionGroup | null>(null);
  selectedClientId: string = '';

  clientForm: FormGroup;
  environmentForm: FormGroup;

  constructor(@Inject(MAT_DIALOG_DATA) public data: ManageGroupDialogData) {
    this.clients.set(data.groups.filter(g => g.type === 'client'));
    this.environments.set(data.groups.filter(g => g.type === 'environment'));

    this.clientForm = this.fb.group({
      name: ['', Validators.required],
      description: ['']
    });

    this.environmentForm = this.fb.group({
      name: ['', Validators.required],
      description: ['']
    });
  }

  /** The saved connections whose client or environment is this group. */
  connectionsOf(group: ConnectionGroup): ServiceBusConnection[] {
    const all = this.data.connections ?? [];
    return group.type === 'client'
      ? all.filter(c => c.clientId === group.id)
      : all.filter(c => c.environmentId === group.id);
  }

  clientCounts(client: ConnectionGroup): string {
    const environments = this.environments().filter(e => e.parentId === client.id).length;
    return `${plural(environments, 'environment', 'environments')}, ${plural(this.connectionsOf(client).length, 'connection', 'connections')}`;
  }

  private confirmGroupDelete(group: ConnectionGroup, kind: 'client' | 'environment') {
    const names = this.connectionsOf(group).map(c => c.name);
    const environments = kind === 'client' ? this.environments().filter(e => e.parentId === group.id) : [];
    const data: ConfirmDialogData = {
      title: `Delete ${kind}?`,
      icon: 'warning',
      message: `This removes the ${kind} ${group.name} from this computer`
        + (environments.length ? `, with its environments: ${environments.map(e => e.name).join(', ')}. ` : '. ')
        + (names.length
          ? (environments.length
            ? `These connections stay saved and go to No client, with no environment: ${names.join(', ')}. `
            : `These connections stay saved and lose this ${kind}: ${names.join(', ')}. `)
          : `No connection is in this ${kind}. `)
        + 'Nothing on a broker is changed.',
      confirmText: `Delete ${kind}`,
      typedName: environments.some(e => e.isProduction) ? group.name : undefined,
      typedLabel: 'Type the name of the client to confirm',
    };
    return this.dialog.open(ConfirmDialogComponent, { width: '480px', data }).afterClosed();
  }

  onClientSelected() {
    this.cancelEditEnvironment();
  }

  getClientName(clientId?: string): string {
    return this.clients().find(c => c.id === clientId)?.name || 'Unknown';
  }

  getEnvironmentsByClient(clientId: string): ConnectionGroup[] {
    return this.environments().filter(e => e.parentId === clientId);
  }

  editClient(client: ConnectionGroup) {
    this.editingClient.set(client);
    this.clientForm.patchValue({
      name: client.name,
      description: client.description || ''
    });
  }

  /** Leaves the client form empty and out of the error state, as if never submitted. */
  cancelEditClient(form?: FormGroupDirective) {
    this.editingClient.set(null);
    if (form) form.resetForm(); else this.clientForm.reset();
  }

  saveClient(form?: FormGroupDirective) {
    if (!this.clientForm.valid) return;

    const formValue = this.clientForm.value;
    this.saving.set(true);

    const clientData: Partial<ConnectionGroup> = {
      name: formValue.name,
      type: 'client',
      description: formValue.description || undefined
    };

    const operation = this.editingClient()
      ? this.groupService.updateGroup(this.editingClient()!.id, clientData)
      : this.groupService.createGroup(clientData);

    operation.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (group) => {
        this.snackBar.open(
          `Client ${this.editingClient() ? 'updated' : 'created'} successfully`,
          'Close',
          { duration: 3000 }
        );

        if (this.editingClient()) {
          const index = this.clients().findIndex(c => c.id === group.id);
          if (index !== -1) {
            const updated = [...this.clients()];
            updated[index] = group;
            this.clients.set(updated);
          }
        } else {
          this.clients.set([...this.clients(), group]);
        }

        this.cancelEditClient(form);
        this.saving.set(false);
      },
      error: (err) => {
        const detail = err?.error?.message || err?.message || err?.statusText || 'unknown error';
        this.snackBar.open(`Failed to save client: ${detail}`, 'Close', { duration: 6000 });
        console.error('[saveClient] error', err);
        this.saving.set(false);
      }
    });
  }

  deleteClient(client: ConnectionGroup) {
    this.confirmGroupDelete(client, 'client').subscribe(confirmed => {
      if (!confirmed) return;
      this.groupService.deleteGroup(client.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.clients.set(this.clients().filter(c => c.id !== client.id));
          this.environments.set(this.environments().filter(e => e.parentId !== client.id));
          this.snackBar.open('Client deleted', 'Close', { duration: 3000 });
        },
        error: () => {
          this.snackBar.open('Failed to delete client', 'Close', { duration: 3000 });
        }
      });
    });
  }

  editEnvironment(env: ConnectionGroup) {
    this.editingEnvironment.set(env);
    this.environmentForm.patchValue({
      name: env.name,
      description: env.description || ''
    });
  }

  /** Leaves the environment form empty and out of the error state, as if never submitted. */
  cancelEditEnvironment(form?: FormGroupDirective) {
    this.editingEnvironment.set(null);
    if (form) form.resetForm(); else this.environmentForm.reset();
  }

  saveEnvironment(form?: FormGroupDirective) {
    if (!this.environmentForm.valid) return;

    const formValue = this.environmentForm.value;
    this.saving.set(true);

    const envData: Partial<ConnectionGroup> = {
      name: formValue.name,
      type: 'environment',
      parentId: this.selectedClientId,
      description: formValue.description || undefined,
      isProduction: !!this.editingEnvironment()?.isProduction
    };

    const operation = this.editingEnvironment()
      ? this.groupService.updateGroup(this.editingEnvironment()!.id, envData)
      : this.groupService.createGroup(envData);

    operation.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (group) => {
        this.snackBar.open(
          `Environment ${this.editingEnvironment() ? 'updated' : 'created'} successfully`,
          'Close',
          { duration: 3000 }
        );

        if (this.editingEnvironment()) {
          const index = this.environments().findIndex(e => e.id === group.id);
          if (index !== -1) {
            const updated = [...this.environments()];
            updated[index] = group;
            this.environments.set(updated);
          }
        } else {
          this.environments.set([...this.environments(), group]);
        }

        this.cancelEditEnvironment(form);
        this.saving.set(false);
      },
      error: () => {
        this.snackBar.open('Failed to save environment', 'Close', { duration: 3000 });
        this.saving.set(false);
      }
    });
  }

  /** Marks an environment production or not; the checkbox goes back when the API refuses. */
  setProduction(env: ConnectionGroup, change: MatCheckboxChange) {
    const { id, name, type, parentId, description, order } = env;
    this.groupService.updateGroup(id, { name, type, parentId, description, order, isProduction: change.checked })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: group => this.environments.set(this.environments().map(e => e.id === group.id ? group : e)),
        error: () => {
          change.source.checked = !change.checked;
          this.snackBar.open(`Failed to mark ${env.name}: nothing was changed`, 'Close', { duration: 5000 });
        }
      });
  }

  deleteEnvironment(env: ConnectionGroup) {
    this.confirmGroupDelete(env, 'environment').subscribe(confirmed => {
      if (!confirmed) return;
      this.groupService.deleteGroup(env.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.environments.set(this.environments().filter(e => e.id !== env.id));
          this.snackBar.open('Environment deleted', 'Close', { duration: 3000 });
        },
        error: () => {
          this.snackBar.open('Failed to delete environment', 'Close', { duration: 3000 });
        }
      });
    });
  }

  close() {
    this.dialogRef.close(true);
  }
}
