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
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
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
    MatCardModule,
    MatSnackBarModule,
    MatTabsModule
  ],
  template: `
    <div class="modal-header">
      <h5 class="modal-title d-flex align-items-center gap-2">
        <i class="fa fa-folder"></i>
        Manage Groups
      </h5>
    </div>

    <div class="modal-body">
      <mat-tab-group>
        <!-- Clients Tab -->
        <mat-tab label="Clients">
          <div class="tab-content">
            <div class="form-section">
              <h3>{{ editingClient() ? 'Edit Client' : 'Add New Client' }}</h3>
              <form [formGroup]="clientForm" (ngSubmit)="saveClient()">
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Client Name</mat-label>
                  <input matInput formControlName="name" placeholder="e.g., Acme Corp">
                  @if (clientForm.get('name')?.hasError('required') && clientForm.get('name')?.touched) {
                    <mat-error>Client name is required</mat-error>
                  }
                </mat-form-field>

                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Description (optional)</mat-label>
                  <textarea matInput formControlName="description" rows="2" placeholder="Brief description"></textarea>
                </mat-form-field>

                <div class="form-actions">
                  @if (editingClient()) {
                    <button mat-button type="button" (click)="cancelEditClient()">Cancel</button>
                  }
                  <button mat-raised-button color="primary" type="submit" [disabled]="!clientForm.valid || saving()">
                    {{ editingClient() ? 'Update' : 'Add' }} Client
                  </button>
                </div>
              </form>
            </div>

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
                        <button mat-icon-button (click)="editClient(client)">
                          <mat-icon>edit</mat-icon>
                        </button>
                        <button mat-icon-button color="warn" (click)="deleteClient(client)">
                          <mat-icon>delete</mat-icon>
                        </button>
                      </div>
                    </mat-list-item>
                  }
                </mat-list>
              }
            </div>
          </div>
        </mat-tab>

        <!-- Environments Tab -->
        <mat-tab label="Environments" [disabled]="clients().length === 0">
          <div class="env-tab-content">
            <!-- Client selector -->
            <div class="client-selector">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Select Client</mat-label>
                <mat-select [(value)]="selectedClientId" (selectionChange)="onClientSelected()">
                  @for (client of clients(); track client.id) {
                    <mat-option [value]="client.id">{{ client.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>

            @if (!selectedClientId) {
              <div class="empty-message" style="text-align: center; padding: 48px 24px;">
                <p>Select a client above to view and manage its environments.</p>
              </div>
            } @else {
              <div class="tab-content">
                <div class="form-section">
                  <h3>{{ editingEnvironment() ? 'Edit Environment' : 'Add New Environment' }}</h3>
                  <form [formGroup]="environmentForm" (ngSubmit)="saveEnvironment()">
                    <mat-form-field appearance="outline" class="full-width">
                      <mat-label>Environment Name</mat-label>
                      <input matInput formControlName="name" placeholder="e.g., Production, Development">
                      @if (environmentForm.get('name')?.hasError('required') && environmentForm.get('name')?.touched) {
                        <mat-error>Environment name is required</mat-error>
                      }
                    </mat-form-field>

                    <mat-form-field appearance="outline" class="full-width">
                      <mat-label>Description (optional)</mat-label>
                      <textarea matInput formControlName="description" rows="2" placeholder="Brief description"></textarea>
                    </mat-form-field>

                    <div class="form-actions">
                      @if (editingEnvironment()) {
                        <button mat-button type="button" (click)="cancelEditEnvironment()">Cancel</button>
                      }
                      <button mat-raised-button color="primary" type="submit" [disabled]="!environmentForm.valid || saving()">
                        {{ editingEnvironment() ? 'Update' : 'Add' }} Environment
                      </button>
                    </div>
                  </form>
                </div>

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
                            <button mat-icon-button (click)="editEnvironment(env)">
                              <mat-icon>edit</mat-icon>
                            </button>
                            <button mat-icon-button color="warn" (click)="deleteEnvironment(env)">
                              <mat-icon>delete</mat-icon>
                            </button>
                          </div>
                        </mat-list-item>
                      }
                    </mat-list>
                  }
                </div>
              </div>
            }
          </div>
        </mat-tab>
      </mat-tab-group>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" (click)="close()">
        <i class="fa fa-times me-2"></i>
        Close
      </button>
    </div>
  `,
  styles: [`
    // Override Material Dialog container styles to use Bootstrap theme variables
    :host ::ng-deep {
      .mat-mdc-dialog-container,
      .mat-mdc-dialog-surface {
        background-color: var(--bs-body-bg) !important;
        color: var(--bs-body-color) !important;
      }

      // Material Form Field Customization
      .mat-mdc-form-field {
        // Label colors
        .mat-mdc-floating-label {
          color: var(--bs-secondary-color) !important;
        }

        // Outline (border) colors
        .mdc-notched-outline {
          .mdc-notched-outline__leading,
          .mdc-notched-outline__notch,
          .mdc-notched-outline__trailing {
            border-color: var(--bs-border-color) !important;
          }
        }

        // Focused state
        &.mat-focused {
          .mdc-notched-outline {
            .mdc-notched-outline__leading,
            .mdc-notched-outline__notch,
            .mdc-notched-outline__trailing {
              border-color: var(--bs-primary) !important;
            }
          }

          .mat-mdc-floating-label {
            color: var(--bs-primary) !important;
          }
        }

        // Input field
        .mat-mdc-input-element {
          background-color: var(--bs-secondary-bg) !important;
          color: var(--bs-body-color) !important;
          border-radius: 4px;
          padding: 8px 12px;
        }

        // Textarea
        .mat-mdc-input-element[textarea] {
          background-color: var(--bs-secondary-bg) !important;
          color: var(--bs-body-color) !important;
        }

        // Error messages
        .mat-mdc-form-field-error {
          color: var(--bs-danger) !important;
        }
      }

      // Material Select
      .mat-mdc-select {
        .mat-mdc-select-value {
          color: var(--bs-body-color) !important;
        }

        .mat-mdc-select-arrow {
          color: var(--bs-secondary-color) !important;
        }
      }

      // Select panel (dropdown)
      .mat-mdc-select-panel {
        background-color: var(--bs-body-bg) !important;

        .mat-mdc-option {
          color: var(--bs-body-color) !important;

          &:hover {
            background-color: var(--bs-secondary-bg) !important;
          }

          &.mat-mdc-option-active {
            background-color: var(--bs-tertiary-bg) !important;
          }
        }
      }

      // Material Tabs
      .mat-mdc-tab-group {
        .mat-mdc-tab-header {
          background-color: var(--bs-body-bg) !important;
          border-bottom: 1px solid var(--bs-border-color);
        }

        .mat-mdc-tab {
          color: var(--bs-secondary-color) !important;

          &.mat-mdc-tab-active {
            color: var(--bs-primary) !important;
          }
        }

        .mat-mdc-tab-body-wrapper {
          background-color: var(--bs-body-bg);
        }
      }
    }

    .modal-header {
      border-bottom: 1px solid var(--bs-border-color);
      padding: 16px 24px;
      background-color: var(--bs-body-bg);
    }

    .modal-title {
      margin: 0;
      font-size: 18px;
      font-weight: 500;
      color: var(--bs-body-color);

      i {
        font-size: 20px;
      }
    }

    .modal-body {
      min-height: 500px;
      max-height: 70vh;
      padding: 0;
      background-color: var(--bs-body-bg);
      color: var(--bs-body-color);
    }

    .modal-footer {
      border-top: 1px solid var(--bs-border-color);
      padding: 16px 24px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      background-color: var(--bs-body-bg);
    }

    .tab-content {
      padding: 24px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }

    .form-section,
    .list-section {
      h3 {
        margin: 0 0 16px 0;
        font-size: 16px;
        font-weight: 500;
        color: var(--bs-secondary-color);
      }
    }

    .full-width {
      width: 100%;
      margin-bottom: 16px;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }

    .item-actions {
      display: flex;
      gap: 4px;
    }

    .empty-message {
      color: var(--bs-secondary-color);
      font-style: italic;
      text-align: center;
      padding: 24px;
    }

    mat-list {
      max-height: 400px;
      overflow-y: auto;
    }

    mat-list-item {
      border-bottom: 1px solid var(--bs-border-color);

      &:hover {
        background-color: var(--bs-secondary-bg);
      }
    }

    .env-tab-content {
      padding: 24px;
    }

    .client-selector {
      margin-bottom: 16px;
    }

    .client-env-group {
      margin-bottom: 16px;

      &:last-child {
        margin-bottom: 0;
      }
    }

    .client-env-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 8px 0;
      font-size: 14px;
      font-weight: 500;
      color: var(--bs-primary);
      padding: 8px 12px;
      background-color: var(--bs-tertiary-bg);
      border-radius: 4px;
      border-left: 3px solid var(--bs-primary);
    }

    .client-env-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
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
      error: () => {
        this.snackBar.open('Failed to save client', 'Close', { duration: 3000 });
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
