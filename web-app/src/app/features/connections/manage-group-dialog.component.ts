import { Component, inject, signal, WritableSignal, Inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConnectionGroupService } from '../../core/services';
import { ConnectionGroup } from '../../core/models';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface ManageGroupDialogData {
  groups: ConnectionGroup[];
}

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
    MatListModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule
  ],
  template: `
    <h2 mat-dialog-title>Manage Groups</h2>

    <mat-dialog-content>
      <p class="intro">Clients and their environments group the saved connections. Nothing here reaches a broker.</p>
      <mat-tab-group>
        <mat-tab label="Clients">
          <div class="tab-content">
            <div class="list-section">
              <h3>Existing Clients</h3>
              @if (clients().length === 0) {
                <p class="empty-message">No clients yet</p>
              } @else {
                <mat-list>
                  @for (client of clients(); track client.id) {
                    <mat-list-item>
                      <mat-icon matListItemIcon>business</mat-icon>
                      <div matListItemTitle>{{ client.name }}</div>
                      @if (client.description) {
                        <div matListItemLine>{{ client.description }}</div>
                      }
                      <div matListItemMeta class="item-actions">
                        <button mat-icon-button
                          [attr.aria-label]="'Edit client ' + client.name"
                          [matTooltip]="'Edit client ' + client.name"
                          (click)="editClient(client)">
                          <mat-icon>edit</mat-icon>
                        </button>
                        <button mat-icon-button class="delete"
                          [attr.aria-label]="'Delete client ' + client.name"
                          [matTooltip]="'Delete client ' + client.name"
                          (click)="deleteClient(client)">
                          <mat-icon>delete</mat-icon>
                        </button>
                      </div>
                    </mat-list-item>
                  }
                </mat-list>
              }
            </div>

            <div class="form-section">
              <h3>{{ editingClient() ? 'Edit Client' : 'Add New Client' }}</h3>
              <form [formGroup]="clientForm" (ngSubmit)="saveClient()">
                <div class="grid">
                  <mat-form-field appearance="outline">
                    <mat-label>Client Name</mat-label>
                    <input matInput formControlName="name" placeholder="e.g., Acme Corp">
                    @if (clientForm.get('name')?.hasError('required') && clientForm.get('name')?.touched) {
                      <mat-error>Client name is required</mat-error>
                    }
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Description (optional)</mat-label>
                    <textarea matInput formControlName="description" rows="1" placeholder="Brief description"></textarea>
                  </mat-form-field>
                </div>

                <div class="form-actions">
                  @if (editingClient()) {
                    <button matButton type="button" (click)="cancelEditClient()">Cancel</button>
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
            <mat-form-field appearance="outline" class="client-selector">
              <mat-label>Select Client</mat-label>
              <mat-select [(value)]="selectedClientId" (selectionChange)="onClientSelected()">
                @for (client of clients(); track client.id) {
                  <mat-option [value]="client.id">{{ client.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            @if (!selectedClientId) {
              <p class="empty-message">Select a client above to view and manage its environments.</p>
            } @else {
              <div class="list-section">
                <h3>Environments</h3>
                @if (getEnvironmentsByClient(selectedClientId).length === 0) {
                  <p class="empty-message">No environments for this client</p>
                } @else {
                  <mat-list>
                    @for (env of getEnvironmentsByClient(selectedClientId); track env.id) {
                      <mat-list-item>
                        <mat-icon matListItemIcon>dns</mat-icon>
                        <div matListItemTitle>{{ env.name }}</div>
                        @if (env.description) {
                          <div matListItemLine>{{ env.description }}</div>
                        }
                        <div matListItemMeta class="item-actions">
                          <button mat-icon-button
                            [attr.aria-label]="'Edit environment ' + env.name"
                            [matTooltip]="'Edit environment ' + env.name"
                            (click)="editEnvironment(env)">
                            <mat-icon>edit</mat-icon>
                          </button>
                          <button mat-icon-button class="delete"
                            [attr.aria-label]="'Delete environment ' + env.name"
                            [matTooltip]="'Delete environment ' + env.name"
                            (click)="deleteEnvironment(env)">
                            <mat-icon>delete</mat-icon>
                          </button>
                        </div>
                      </mat-list-item>
                    }
                  </mat-list>
                }
              </div>

              <div class="form-section">
                <h3>{{ editingEnvironment() ? 'Edit Environment' : 'Add New Environment' }}</h3>
                <form [formGroup]="environmentForm" (ngSubmit)="saveEnvironment()">
                  <div class="grid">
                    <mat-form-field appearance="outline">
                      <mat-label>Environment Name</mat-label>
                      <input matInput formControlName="name" placeholder="e.g., Production, Development">
                      @if (environmentForm.get('name')?.hasError('required') && environmentForm.get('name')?.touched) {
                        <mat-error>Environment name is required</mat-error>
                      }
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Description (optional)</mat-label>
                      <textarea matInput formControlName="description" rows="1" placeholder="Brief description"></textarea>
                    </mat-form-field>
                  </div>

                  <div class="form-actions">
                    @if (editingEnvironment()) {
                      <button matButton type="button" (click)="cancelEditEnvironment()">Cancel</button>
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

    .list-section,
    .form-section {
      h3 {
        margin: 0 0 8px;
        font: var(--mat-sys-title-small);
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0 12px;
    }

    .form-actions {
      display: flex;
      justify-content: flex-start;
      gap: 8px;
    }

    .item-actions {
      display: flex;
      gap: 4px;
    }

    .delete {
      color: var(--mat-sys-error);
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

    mat-list {
      max-height: 320px;
      overflow-y: auto;
      padding: 0;
    }

    mat-list-item {
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
  `]
})
export class ManageGroupDialogComponent {
  private dialogRef = inject(MatDialogRef<ManageGroupDialogComponent>);
  private groupService = inject(ConnectionGroupService);
  private snackBar = inject(MatSnackBar);
  private fb = inject(FormBuilder);
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

  cancelEditClient() {
    this.editingClient.set(null);
    this.clientForm.reset();
  }

  saveClient() {
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

        this.cancelEditClient();
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
    const envCount = this.environments().filter(e => e.parentId === client.id).length;

    if (envCount > 0) {
      this.snackBar.open(
        `Cannot delete client with ${envCount} environment(s). Delete environments first.`,
        'Close',
        { duration: 5000 }
      );
      return;
    }

    if (confirm(`Are you sure you want to delete "${client.name}"?`)) {
      this.groupService.deleteGroup(client.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.clients.set(this.clients().filter(c => c.id !== client.id));
          this.snackBar.open('Client deleted', 'Close', { duration: 3000 });
        },
        error: () => {
          this.snackBar.open('Failed to delete client', 'Close', { duration: 3000 });
        }
      });
    }
  }

  editEnvironment(env: ConnectionGroup) {
    this.editingEnvironment.set(env);
    this.environmentForm.patchValue({
      name: env.name,
      description: env.description || ''
    });
  }

  cancelEditEnvironment() {
    this.editingEnvironment.set(null);
    this.environmentForm.reset();
  }

  saveEnvironment() {
    if (!this.environmentForm.valid) return;

    const formValue = this.environmentForm.value;
    this.saving.set(true);

    const envData: Partial<ConnectionGroup> = {
      name: formValue.name,
      type: 'environment',
      parentId: this.selectedClientId,
      description: formValue.description || undefined
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

        this.cancelEditEnvironment();
        this.saving.set(false);
      },
      error: () => {
        this.snackBar.open('Failed to save environment', 'Close', { duration: 3000 });
        this.saving.set(false);
      }
    });
  }

  deleteEnvironment(env: ConnectionGroup) {
    if (confirm(`Are you sure you want to delete "${env.name}"?`)) {
      this.groupService.deleteGroup(env.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.environments.set(this.environments().filter(e => e.id !== env.id));
          this.snackBar.open('Environment deleted', 'Close', { duration: 3000 });
        },
        error: () => {
          this.snackBar.open('Failed to delete environment', 'Close', { duration: 3000 });
        }
      });
    }
  }

  close() {
    this.dialogRef.close(true);
  }
}
