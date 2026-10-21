import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SidebarComponent } from '../shared/sidebar.component';
import { ApiService, User, UserRole, UserCreate, UserUpdate } from '../services/api.service';
import { PermissionService } from '../services/permission.service';
import { ConfirmationModalComponent } from '../shared/confirmation-modal.component';
import { FocusFirstInputDirective } from '../shared/focus-first-input.directive';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule, SidebarComponent, ConfirmationModalComponent, FocusFirstInputDirective, TranslateModule],
  template: `
    <app-sidebar>
      <div class="users-page">
        <div class="us-hero">
          <div>
            <h1>{{ 'USERS.TITLE' | translate }}</h1>
            <p>{{ 'USERS.SUBTITLE' | translate }}</p>
          </div>
          <button type="button" class="us-add" data-testid="add-user" (click)="openCreateModal()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {{ 'USERS.ADD_USER' | translate }}
          </button>
        </div>

        @if (loading()) {
          <div class="loading">{{ 'COMMON.LOADING' | translate }}...</div>
        } @else if (error()) {
          <div class="error">{{ error() }}</div>
        } @else {
          <div class="us-chips">
            <button type="button" class="us-chip" [class.on]="roleFilter() === 'all'" (click)="roleFilter.set('all')">
              {{ 'USERS.ALL' | translate }} <i>{{ users().length }}</i>
            </button>
            @for (r of rolesPresent(); track r) {
              <button type="button" class="us-chip" [attr.data-role]="r" [class.on]="roleFilter() === r" (click)="roleFilter.set(r)">
                <span class="us-chip-ico" [innerHTML]="roleIcon(r, 16)" aria-hidden="true"></span>
                {{ getRoleDisplayName(r) }} <i>{{ roleCount(r) }}</i>
              </button>
            }
          </div>

          <div class="users-grid">
            @for (user of visibleUsers(); track user.id) {
              <article class="user-card" [attr.data-role]="user.role" [class.current-user]="user.id === currentUser()?.id">
                <div class="us-band"></div>
                <span class="us-mark" [innerHTML]="roleIcon(user.role, 130)" aria-hidden="true"></span>
                <div class="us-top">
                  <div class="user-avatar">
                    {{ getInitials(user) }}
                    <span class="us-avatar-role" [innerHTML]="roleIcon(user.role, 14)" aria-hidden="true"></span>
                  </div>
                  <div class="user-details">
                    <h3 class="user-name">{{ user.full_name || user.username }}</h3>
                    <p class="user-email">{{ user.username }}</p>
                  </div>
                  @if (user.id === currentUser()?.id) {
                    <span class="us-you">{{ 'USERS.YOU' | translate }}</span>
                  }
                </div>
                <div class="us-bottom">
                  <span class="user-role-badge">
                    <span [innerHTML]="roleIcon(user.role, 15)" aria-hidden="true"></span>
                    {{ getRoleDisplayName(user.role) }}
                  </span>
                  <div class="user-actions">
                    @if (canEditUser(user)) {
                      <button class="btn-icon" (click)="openEditModal(user)" [title]="'USERS.EDIT_USER' | translate" [attr.aria-label]="'USERS.EDIT_USER' | translate">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                    }
                    @if (canDeleteUser(user)) {
                      <button class="btn-icon btn-danger" (click)="confirmDelete(user)" [title]="'USERS.DELETE_USER' | translate" [attr.aria-label]="'USERS.DELETE_USER' | translate">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    }
                  </div>
                </div>
              </article>
            } @empty {
              <div class="empty-state">
                <p>{{ 'USERS.NO_USERS' | translate }}</p>
              </div>
            }
          </div>
        }

        <!-- Create/Edit Modal -->
        @if (showModal()) {
          <div class="modal-overlay">
            <div class="modal" (click)="$event.stopPropagation()" appFocusFirstInput>
              <div class="modal-header" [attr.data-role]="formRole">
                <span class="us-m-ico" [attr.data-role]="formRole" [innerHTML]="roleIcon(formRole, 26)" aria-hidden="true"></span>
                <div class="us-m-text">
                  <h2>{{ editingUser() ? ('USERS.EDIT_USER' | translate) : ('USERS.ADD_USER' | translate) }}</h2>
                  <p>{{ getRoleDisplayName(formRole) }}</p>
                </div>
                <button class="btn-close" (click)="closeModal()" [attr.aria-label]="'COMMON.CANCEL' | translate">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <form class="modal-body" (ngSubmit)="saveUser()">
                <div class="form-group">
                  <label for="username">{{ 'USERS.USERNAME' | translate }}</label>
                  <input
                    type="text"
                    id="username"
                    [(ngModel)]="formUsername"
                    name="username"
                    required
                    [disabled]="editingUser()?.id === currentUser()?.id"
                  />
                </div>
                <div class="form-group">
                  <label for="fullName">{{ 'USERS.FULL_NAME' | translate }}</label>
                  <input
                    type="text"
                    id="fullName"
                    [(ngModel)]="formFullName"
                    name="fullName"
                  />
                </div>
                <div class="form-group">
                  <label id="role-label">{{ 'USERS.ROLE' | translate }}</label>
                  <div class="us-roles" role="radiogroup" aria-labelledby="role-label">
                    @for (role of roleOptionsForModal(); track role) {
                      <button
                        type="button"
                        class="us-role"
                        role="radio"
                        [attr.data-role]="role"
                        [attr.aria-checked]="formRole === role"
                        [class.on]="formRole === role"
                        [disabled]="editingUser()?.id === currentUser()?.id"
                        (click)="formRole = role"
                      >
                        <span class="us-role-ico" [innerHTML]="roleIcon(role, 24)" aria-hidden="true"></span>
                        <b>{{ getRoleDisplayName(role) }}</b>
                        <small>{{ 'USERS.ROLE_DESC_' + role.toUpperCase() | translate }}</small>
                      </button>
                    }
                  </div>
                </div>
                <div class="form-group">
                  <label for="password">
                    {{ editingUser() ? ('USERS.NEW_PASSWORD' | translate) : ('USERS.PASSWORD' | translate) }}
                    @if (editingUser()) {
                      <span class="optional">({{ 'USERS.LEAVE_BLANK' | translate }})</span>
                    }
                  </label>
                  <div class="input-with-toggle">
                    <input
                      [type]="showPassword() ? 'text' : 'password'"
                      id="password"
                      [(ngModel)]="formPassword"
                      name="password"
                      [required]="!editingUser()"
                      minlength="6"
                    />
                    <button type="button" class="pw-toggle" (click)="showPassword.set(!showPassword())" [attr.aria-label]="showPassword() ? ('USERS.HIDE_PASSWORD' | translate) : ('USERS.SHOW_PASSWORD' | translate)" tabindex="-1">
                      @if (showPassword()) {
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      } @else {
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                </div>
                <div class="form-group">
                  <label for="password_confirm">{{ 'USERS.CONFIRM_PASSWORD' | translate }}</label>
                  <div class="input-with-toggle">
                    <input
                      [type]="showPasswordConfirm() ? 'text' : 'password'"
                      id="password_confirm"
                      [(ngModel)]="formPasswordConfirm"
                      name="password_confirm"
                      minlength="6"
                    />
                    <button type="button" class="pw-toggle" (click)="showPasswordConfirm.set(!showPasswordConfirm())" [attr.aria-label]="showPasswordConfirm() ? ('USERS.HIDE_PASSWORD' | translate) : ('USERS.SHOW_PASSWORD' | translate)" tabindex="-1">
                      @if (showPasswordConfirm()) {
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      } @else {
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                </div>
                @if (editingUser() && currentUser()?.role === 'owner' && editingUser()?.id !== currentUser()?.id) {
                  <p class="role-hint">{{ 'USERS.CO_OWNER_HINT' | translate }}</p>
                }
                @if (formError()) {
                  <div class="form-error">{{ formError() }}</div>
                }
                <div class="modal-actions">
                  <button type="button" class="btn-secondary" (click)="closeModal()">
                    {{ 'COMMON.CANCEL' | translate }}
                  </button>
                  <button type="submit" class="btn-primary" [disabled]="saving()">
                    {{ saving() ? ('COMMON.SAVING' | translate) : ('COMMON.SAVE' | translate) }}
                  </button>
                </div>
              </form>
            </div>
          </div>
        }

        <!-- Delete Confirmation -->
        @if (showDeleteConfirm()) {
          <app-confirmation-modal
            [title]="'USERS.DELETE_CONFIRM_TITLE' | translate"
            [message]="'USERS.DELETE_CONFIRM_MESSAGE' | translate: { name: userToDelete()?.username }"
            [confirmText]="'COMMON.DELETE' | translate"
            [cancelText]="'COMMON.CANCEL' | translate"
            [confirmBtnClass]="'btn-danger'"
            (confirm)="deleteUser()"
            (cancel)="cancelDelete()"
          ></app-confirmation-modal>
        }
      </div>
    </app-sidebar>
  `,
  styles: [`
    .users-page {
      max-width: 1200px;
    }

    .us-hero {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 18px;
      padding: 22px 26px;
      border-radius: 24px;
      color: #fff;
      position: relative;
      overflow: hidden;
      background:
        radial-gradient(circle at 92% 20%, rgba(245, 196, 81, 0.55) 0, transparent 28%),
        radial-gradient(circle at 78% 110%, rgba(108, 178, 238, 0.5) 0, transparent 32%),
        radial-gradient(circle at 60% -30%, rgba(240, 136, 168, 0.5) 0, transparent 30%),
        linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, #000));
      box-shadow: 0 18px 34px -22px var(--color-primary);
    }
    .us-hero > * { position: relative; z-index: 1; }
    .us-hero h1 { margin: 0; font-size: 1.8rem; font-weight: 800; letter-spacing: -0.02em; }
    .us-hero p { margin: 2px 0 0; opacity: 0.85; font-weight: 600; }

    .us-add {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 46px;
      padding: 0 22px;
      border: 0;
      border-radius: 999px;
      background: #fff;
      color: var(--color-primary);
      font: inherit;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 10px 20px -12px rgba(0, 0, 0, 0.5);
    }
    .us-add:hover { filter: brightness(0.96); }

    .us-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
    .us-chip {
      --rc: var(--color-primary);
      --rc2: color-mix(in srgb, var(--color-primary) 70%, #fff);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 42px;
      padding: 0 16px;
      border-radius: 999px;
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text);
      font: inherit;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      touch-action: manipulation;
    }
    .us-chip i {
      font-style: normal;
      min-width: 22px;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--color-bg);
      font-size: 0.75rem;
      text-align: center;
    }
    .us-chip[data-role] { border-color: color-mix(in srgb, var(--rc) 40%, transparent); background: color-mix(in srgb, var(--rc) 9%, var(--color-surface)); }
    .us-chip[data-role] i { background: color-mix(in srgb, var(--rc) 18%, transparent); color: var(--rc); }
    .us-chip:hover { border-color: var(--rc); }
    .us-chip.on { background: linear-gradient(135deg, var(--rc2), var(--rc)) !important; border-color: var(--rc); color: #fff; box-shadow: 0 10px 18px -12px var(--rc); }
    .us-chip.on i { background: rgba(255, 255, 255, 0.28) !important; color: #fff !important; }
    .us-chip-ico { display: inline-flex; color: var(--rc); }
    .us-chip.on .us-chip-ico { color: #fff; }

    [data-role][data-role='owner'] { --rc: #d9a014; --rc2: #f5c451; }
    [data-role][data-role='kitchen'] { --rc: #db4f7a; --rc2: #f088a8; }
    [data-role][data-role='waiter'] { --rc: #2f9e64; --rc2: #62c58f; }
    [data-role][data-role='courier'] { --rc: #2f86d6; --rc2: #6cb2ee; }

    .btn-primary {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      min-height: 46px;
      padding: 0 26px;
      background: var(--color-primary);
      color: white;
      border: none;
      border-radius: 999px;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 10px 20px -12px var(--color-primary);
      transition: filter 0.15s ease;
    }
    .btn-primary:hover:not(:disabled) { filter: brightness(1.07); }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

    .btn-secondary {
      min-height: 46px;
      padding: 0 24px;
      background: transparent;
      color: var(--color-text);
      border: 1px solid var(--color-border);
      border-radius: 999px;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
    }
    .btn-secondary:hover { background: var(--color-bg); }

    .users-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 16px;
    }

    .user-card {
      --rc: var(--color-primary);
      --rc2: var(--color-primary);
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 0 18px 16px;
      background: linear-gradient(180deg, color-mix(in srgb, var(--rc) 12%, var(--color-surface)) 0, var(--color-surface) 62%);
      border: 1px solid color-mix(in srgb, var(--rc) 35%, var(--color-border));
      border-radius: 24px;
      overflow: hidden;
      transition: transform 0.18s ease, box-shadow 0.18s ease;
    }
    .user-card:hover { transform: translateY(-3px); box-shadow: 0 18px 30px -22px rgba(0, 0, 0, 0.55); }
    .user-card.current-user { border-color: var(--rc); box-shadow: 0 0 0 2px color-mix(in srgb, var(--rc) 25%, transparent); }
    @media (prefers-reduced-motion: reduce) {
      .user-card { transition: none; }
      .user-card:hover { transform: none; }
    }

    .us-band {
      position: relative;
      height: 72px;
      margin: 0 -18px;
      background:
        radial-gradient(circle at 88% 30%, rgba(255, 255, 255, 0.35) 0, transparent 26%),
        radial-gradient(circle at 70% 120%, rgba(255, 255, 255, 0.28) 0, transparent 30%),
        radial-gradient(rgba(255, 255, 255, 0.28) 1.5px, transparent 1.6px) 0 0 / 14px 14px,
        linear-gradient(120deg, var(--rc), var(--rc2));
    }

    .us-mark {
      position: absolute;
      right: -14px;
      bottom: -18px;
      color: var(--rc);
      opacity: 0.09;
      pointer-events: none;
      transform: rotate(-12deg);
    }
    .us-top, .us-bottom { position: relative; z-index: 1; }

    .us-top {
      display: flex;
      align-items: flex-end;
      gap: 14px;
      margin-top: -38px;
    }

    .user-avatar {
      position: relative;
      width: 68px;
      height: 68px;
      border-radius: 50%;
      background: linear-gradient(145deg, var(--rc2), var(--rc));
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 1.35rem;
      flex-shrink: 0;
      border: 4px solid var(--color-surface);
      box-shadow: 0 0 0 3px var(--rc2), 0 12px 20px -10px var(--rc);
    }
    .us-avatar-role {
      position: absolute;
      right: -6px;
      bottom: -4px;
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--color-surface);
      color: var(--rc);
      border: 2px solid var(--rc);
    }

    .user-details { flex: 1; min-width: 0; padding-bottom: 2px; }
    .user-name {
      font-size: 1.05rem;
      font-weight: 800;
      color: var(--color-text);
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .user-email {
      font-size: 0.8rem;
      color: var(--color-text-muted);
      margin: 2px 0 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .us-you {
      align-self: flex-start;
      margin-top: 44px;
      padding: 2px 10px;
      border-radius: 999px;
      background: var(--rc);
      color: #fff;
      font-size: 0.7rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .us-bottom { display: flex; align-items: center; justify-content: space-between; gap: 10px; }

    .user-role-badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 5px 14px 5px 10px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--rc) 14%, transparent);
      color: var(--rc);
      font-size: 0.8rem;
      font-weight: 800;
    }
    .user-role-badge span { display: inline-flex; }

    .user-actions { display: flex; gap: var(--space-2); }

    .btn-icon {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      background: color-mix(in srgb, var(--rc, var(--color-primary)) 12%, var(--color-surface));
      border: 1px solid color-mix(in srgb, var(--rc, var(--color-primary)) 35%, transparent);
      border-radius: 50%;
      color: var(--rc, var(--color-text-muted));
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-icon:hover { background: var(--rc, var(--color-primary)); border-color: var(--rc, var(--color-primary)); color: #fff; }
    .btn-icon.btn-danger { background: rgba(220, 38, 38, 0.08); border-color: rgba(220, 38, 38, 0.3); color: #dc2626; }
    .btn-icon.btn-danger:hover { background: #fee2e2; border-color: #fca5a5; color: #dc2626; }

    .loading, .error, .empty-state {
      text-align: center;
      padding: var(--space-8);
      color: var(--color-text-muted);
    }
    .error { color: #dc2626; }

    /* Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: var(--space-4);
    }

    .modal {
      background: var(--color-surface);
      border-radius: 26px;
      width: 100%;
      max-width: 520px;
      max-height: 92vh;
      overflow-y: auto;
      box-shadow: 0 30px 70px -18px rgba(0, 0, 0, 0.45);
    }

    .modal-header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px 22px 14px;
      background: linear-gradient(135deg, color-mix(in srgb, var(--rc, var(--color-primary)) 22%, transparent), transparent 85%);
    }
    .modal-header[data-role='owner'] { --rc: #d9a014; }
    .modal-header[data-role='kitchen'] { --rc: #db4f7a; }
    .modal-header[data-role='waiter'] { --rc: #2f9e64; }
    .modal-header[data-role='courier'] { --rc: #2f86d6; }
    .us-m-ico {
      --rc: var(--color-primary);
      --rc2: var(--color-primary);
      flex: none;
      display: grid;
      place-items: center;
      width: 52px;
      height: 52px;
      border-radius: 17px;
      color: #fff;
      background: linear-gradient(145deg, var(--rc2), var(--rc));
      box-shadow: 0 12px 20px -12px var(--rc);
    }
    .us-m-ico[data-role='owner'] { --rc: #d9a014; --rc2: #f5c451; }
    .us-m-ico[data-role='kitchen'] { --rc: #db4f7a; --rc2: #f088a8; }
    .us-m-ico[data-role='waiter'] { --rc: #2f9e64; --rc2: #62c58f; }
    .us-m-ico[data-role='courier'] { --rc: #2f86d6; --rc2: #6cb2ee; }
    .us-m-text { flex: 1; min-width: 0; }
    .modal-header h2 { font-size: 1.3rem; font-weight: 800; margin: 0; }
    .us-m-text p { margin: 2px 0 0; font-size: 0.85rem; font-weight: 700; color: var(--color-text-muted); }

    .btn-close {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      background: none;
      border: none;
      border-radius: 50%;
      color: var(--color-text-muted);
      cursor: pointer;
    }
    .btn-close:hover { background: var(--color-bg); color: var(--color-text); }

    .modal-body { padding: 8px 22px 22px; }

    .form-group { margin-bottom: var(--space-4); }
    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--color-text-muted);
    }
    .form-group .optional { font-weight: 400; }

    .form-group input {
      width: 100%;
      min-height: 48px;
      padding: 0 14px;
      border: 1px solid var(--color-border);
      border-radius: 14px;
      font: inherit;
      font-weight: 600;
      background: var(--color-surface);
      color: var(--color-text);
    }
    .form-group input:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px var(--color-primary-light);
    }
    .form-group input:disabled { opacity: 0.6; cursor: not-allowed; }

    .us-roles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .us-role {
      --rc: var(--color-primary);
      --rc2: var(--color-primary);
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 12px 14px;
      border-radius: 18px;
      border: 2px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
      touch-action: manipulation;
    }
    .us-role b { font-weight: 800; font-size: 0.9rem; }
    .us-role small { font-size: 0.72rem; line-height: 1.3; color: var(--color-text-muted); }
    .us-role-ico {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 14px;
      background: linear-gradient(145deg, var(--rc2), var(--rc));
      color: #fff;
      box-shadow: 0 10px 16px -10px var(--rc);
    }
    .us-role { background: color-mix(in srgb, var(--rc) 6%, var(--color-surface)); border-color: color-mix(in srgb, var(--rc) 25%, var(--color-border)); }
    .us-role:hover:not(:disabled) { border-color: var(--rc); }
    .us-role.on { border-color: var(--rc); background: color-mix(in srgb, var(--rc) 14%, var(--color-surface)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rc) 25%, transparent); }
    .us-role:disabled { opacity: 0.55; cursor: not-allowed; }

    .input-with-toggle { position: relative; display: flex; }
    .input-with-toggle input { flex: 1; padding-right: 2.75rem; }
    .input-with-toggle .pw-toggle {
      position: absolute;
      right: var(--space-2);
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      padding: var(--space-1);
      cursor: pointer;
      color: var(--color-text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .input-with-toggle .pw-toggle:hover { color: var(--color-text); }

    .role-hint {
      margin-bottom: var(--space-3);
      padding: 10px 14px;
      border-radius: 14px;
      background: var(--color-bg);
      font-size: 0.8rem;
      color: var(--color-text-muted, #64748b);
      line-height: 1.4;
    }

    .form-error {
      margin-bottom: var(--space-4);
      padding: var(--space-3);
      background: #fee2e2;
      border-radius: 14px;
      color: #dc2626;
      font-size: 0.875rem;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-3);
      margin-top: var(--space-5);
    }
  `]
})
export class UsersComponent implements OnInit {
  private api = inject(ApiService);
  private permissions = inject(PermissionService);
  private translate = inject(TranslateService);
  private sanitizer = inject(DomSanitizer);

  roleFilter = signal<'all' | UserRole>('all');
  private readonly roleOrder: UserRole[] = ['owner', 'waiter', 'kitchen', 'courier'];
  rolesPresent = computed(() => this.roleOrder.filter((r) => this.users().some((u) => u.role === r)));
  visibleUsers = computed(() => {
    const f = this.roleFilter();
    return f === 'all' ? this.users() : this.users().filter((u) => u.role === f);
  });

  roleCount(role: UserRole): number {
    return this.users().filter((u) => u.role === role).length;
  }

  /** Drawn role icon: crown, chef hat, serving utensils, scooter. */
  roleIcon(role: string, size: number): SafeHtml {
    const paths: Record<string, string> = {
      owner: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
      kitchen: '<path d="M7 14a4 4 0 01-.5-7.9A5 5 0 0112 3a5 5 0 015.5 3.1A4 4 0 0117 14v6H7z"/><path d="M7 17h10"/>',
      waiter: '<path d="M7 3v8M5 3v5a2 2 0 004 0V3M7 11v10"/><path d="M17 21V3c-2.5 1.5-3 5-3 8h3"/>',
      courier: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M9 17h6l-2-8h-3M16 7h3l-1 10"/>',
    };
    const d = paths[role] ?? paths['waiter'];
    return this.sanitizer.bypassSecurityTrustHtml(
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
    );
  }

  users = signal<User[]>([]);
  currentUser = signal<User | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  // Modal state
  showModal = signal(false);
  editingUser = signal<User | null>(null);
  saving = signal(false);
  formError = signal<string | null>(null);

  // Form fields
  formUsername = '';
  formFullName = '';
  formRole: UserRole = 'waiter';
  formPassword = '';
  formPasswordConfirm = '';
  showPassword = signal(false);
  showPasswordConfirm = signal(false);

  // Delete confirmation
  showDeleteConfirm = signal(false);
  userToDelete = signal<User | null>(null);

  // Available roles based on current user's permissions
  availableRoles = signal<UserRole[]>([]);

  ngOnInit() {
    this.currentUser.set(this.api.getCurrentUser());
    this.loadUsers();
    this.updateAvailableRoles();
  }

  loadUsers() {
    this.loading.set(true);
    this.error.set(null);

    this.api.getUsers().subscribe({
      next: (users) => {
        this.users.set(users);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.detail || 'Failed to load users');
        this.loading.set(false);
      }
    });
  }

  updateAvailableRoles() {
    const user = this.currentUser();
    if (!user) return;

    if (user.role === 'owner') {
      this.availableRoles.set(['owner', 'waiter', 'kitchen', 'courier']);
    }
  }

  /** Roles shown in create/edit modal. */
  roleOptionsForModal(): UserRole[] {
    return this.availableRoles();
  }

  getInitials(user: User): string {
    if (user.full_name) {
      const parts = user.full_name.split(' ');
      return parts.map(p => p[0]).join('').toUpperCase().slice(0, 2);
    }
    return user.username.slice(0, 2).toUpperCase();
  }

  getRoleDisplayName(role: UserRole): string {
    const roleKey = `USERS.ROLES.${role.toUpperCase()}`;
    return this.translate.instant(roleKey);
  }

  canEditUser(user: User): boolean {
    const current = this.currentUser();
    if (!current) return false;

    // Only the administrator (owner) edits users
    return current.role === 'owner';
  }

  canDeleteUser(user: User): boolean {
    const current = this.currentUser();
    if (!current) return false;

    // Can't delete yourself
    if (user.id === current.id) return false;

    // Can't delete owner
    if (user.role === 'owner') return false;

    // Only owner can delete
    return current.role === 'owner';
  }

  openCreateModal() {
    this.editingUser.set(null);
    this.formUsername = '';
    this.formFullName = '';
    this.formRole = 'waiter';
    this.formPassword = '';
    this.formPasswordConfirm = '';
    this.formError.set(null);
    this.showModal.set(true);
  }

  openEditModal(user: User) {
    this.editingUser.set(user);
    this.formUsername = user.username;
    this.formFullName = user.full_name || '';
    this.formRole = user.role;
    this.formPassword = '';
    this.formPasswordConfirm = '';
    this.formError.set(null);
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
    this.editingUser.set(null);
  }

  saveUser() {
    this.formError.set(null);

    const editing = this.editingUser();
    if (!editing) {
      if (this.formPassword !== this.formPasswordConfirm) {
        this.formError.set(this.translate.instant('USERS.PASSWORDS_DO_NOT_MATCH'));
        return;
      }
      if (!this.formPassword || this.formPassword.length < 6) {
        this.formError.set(this.translate.instant('COMMON.ERROR'));
        return;
      }
    } else if (this.formPassword || this.formPasswordConfirm) {
      if (this.formPassword !== this.formPasswordConfirm) {
        this.formError.set(this.translate.instant('USERS.PASSWORDS_DO_NOT_MATCH'));
        return;
      }
      if (this.formPassword.length < 6) {
        this.formError.set(this.translate.instant('COMMON.ERROR'));
        return;
      }
    }

    this.saving.set(true);

    if (editing) {
      // Update existing user
      const updateData: UserUpdate = {};

      if (this.formUsername !== editing.username) {
        updateData.username = this.formUsername;
      }
      if (this.formFullName !== (editing.full_name || '')) {
        updateData.full_name = this.formFullName || undefined;
      }
      if (this.formRole !== editing.role) {
        updateData.role = this.formRole;
      }
      if (this.formPassword) {
        updateData.password = this.formPassword;
      }

      this.api.updateUser(editing.id!, updateData).subscribe({
        next: () => {
          this.saving.set(false);
          this.closeModal();
          this.loadUsers();
        },
        error: (err) => {
          this.formError.set(err.error?.detail || 'Failed to update user');
          this.saving.set(false);
        }
      });
    } else {
      // Create new user
      const createData: UserCreate = {
        username: this.formUsername,
        password: this.formPassword,
        full_name: this.formFullName || undefined,
        role: this.formRole,
      };

      this.api.createUser(createData).subscribe({
        next: () => {
          this.saving.set(false);
          this.closeModal();
          this.loadUsers();
        },
        error: (err) => {
          this.formError.set(err.error?.detail || 'Failed to create user');
          this.saving.set(false);
        }
      });
    }
  }

  confirmDelete(user: User) {
    this.userToDelete.set(user);
    this.showDeleteConfirm.set(true);
  }

  cancelDelete() {
    this.showDeleteConfirm.set(false);
    this.userToDelete.set(null);
  }

  deleteUser() {
    const user = this.userToDelete();
    if (!user) return;

    this.api.deleteUser(user.id!).subscribe({
      next: () => {
        this.showDeleteConfirm.set(false);
        this.userToDelete.set(null);
        this.loadUsers();
      },
      error: (err) => {
        console.error('Delete failed:', err);
        this.showDeleteConfirm.set(false);
      }
    });
  }
}
