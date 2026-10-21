/**
 * Billing customers (Factura) – register company details for tax invoicing.
 * Staff can add/search customers and use them when printing invoices from orders.
 */
import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, BillingCustomer } from '../services/api.service';
import { PermissionService } from '../services/permission.service';
import { SidebarComponent } from '../shared/sidebar.component';
import { FocusFirstInputDirective } from '../shared/focus-first-input.directive';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AppSelectComponent, AppSelectOption } from '../shared/app-select.component';
import { formatMoneyCents } from '../shared/currency-symbol';

@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [FormsModule, SidebarComponent, FocusFirstInputDirective, TranslateModule, AppSelectComponent],
  template: `
    <app-sidebar>
      <section class="cu-hero">
        <div class="cu-hero-top">
          <p class="cu-eyebrow"><i></i>{{ 'CUSTOMERS.TITLE' | translate }}</p>
          @if (canWrite()) {
            <button class="cu-new" (click)="openModal(null)" data-testid="customers-add">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {{ 'CUSTOMERS.ADD' | translate }}
            </button>
          }
        </div>
        <div class="cu-hero-main">
          <h1 class="cu-title">{{ 'CUSTOMERS.HEADLINE_A' | translate }} <em>{{ 'CUSTOMERS.HEADLINE_B' | translate }}</em></h1>
          <dl class="cu-stats">
            <div><dt>{{ 'CUSTOMERS.STAT_TOTAL' | translate }}</dt><dd>{{ stats().total }}</dd></div>
            <div><dt>{{ 'CUSTOMERS.STAT_VIP' | translate }}</dt><dd class="gold">{{ stats().vip }}</dd></div>
            <div><dt>{{ 'CUSTOMERS.STAT_FREQ' | translate }}</dt><dd class="green">{{ stats().frequent }}</dd></div>
            <div><dt>{{ 'CUSTOMERS.STAT_SPENT' | translate }}</dt><dd class="money">{{ money(stats().spent) }}</dd></div>
          </dl>
        </div>
        <div class="cu-bar">
          <label class="cu-search">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input type="text" [placeholder]="'CUSTOMERS.SEARCH_PLACEHOLDER' | translate" [(ngModel)]="searchTerm" (ngModelChange)="load()" />
            @if (searchTerm) {
              <button type="button" class="cu-clear" (click)="searchTerm = ''; load()" aria-label="×">×</button>
            }
          </label>
          <div class="cu-chips" role="group">
            @for (t of tierFilters; track t) {
              <button type="button" class="cu-chip" [class.on]="tierFilter() === t" (click)="tierFilter.set(t)">
                {{ (t === 'all' ? 'CUSTOMERS.FILTER_ALL' : 'CUSTOMERS.TIER_' + t.toUpperCase()) | translate }}
                <b>{{ tierCount(t) }}</b>
              </button>
            }
          </div>
<app-select class="cu-sort" [options]="sortOptions" [searchable]="false" [ngModel]="sortBy()" (ngModelChange)="sortBy.set($event)" [ngModelOptions]="{ standalone: true }" />
        </div>
      </section>

      @if (error()) {
        <div class="error-banner">
          <span>{{ error() }}</span>
          <button class="icon-btn" (click)="error.set('')" aria-label="×">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      }

      @if (loading()) {
        <div class="cu-empty"><p>{{ 'CUSTOMERS.LOADING' | translate }}</p></div>
      } @else if (customers().length === 0) {
        <div class="cu-empty">
          <span class="cu-empty-ico">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
          </span>
          <h3>{{ 'CUSTOMERS.NONE' | translate }}</h3>
          <p>{{ 'CUSTOMERS.NONE_DESC' | translate }}</p>
          @if (canWrite()) {
            <button class="cu-new" (click)="openModal(null)">{{ 'CUSTOMERS.ADD' | translate }}</button>
          }
        </div>
      } @else if (visible().length === 0) {
        <div class="cu-empty">
          <h3>{{ 'CUSTOMERS.NO_RESULTS' | translate }}</h3>
          <button class="cu-ghost" (click)="tierFilter.set('all')">{{ 'CUSTOMERS.CLEAR_FILTERS' | translate }}</button>
        </div>
      } @else {
        <div class="cu-grid">
          @for (c of visible(); track c.id) {
            <article class="cu-card" [attr.data-tier]="tier(c)">
              <header class="cu-head">
                <span class="cu-av" [style.--h]="hue(c.name)" aria-hidden="true">{{ initial(c.name) }}</span>
                <div class="cu-who">
                  <h3>{{ c.name }}</h3>
                  @if (c.company_name) { <span class="cu-company">{{ c.company_name }}</span> }
                </div>
                <span class="cu-tier" [attr.data-tier]="tier(c)">
                  @if (tier(c) === 'vip') { <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg> }
                  {{ ('CUSTOMERS.TIER_' + tier(c).toUpperCase()) | translate }}
                </span>
              </header>

              <div class="cu-metrics">
                <div><b>{{ c.visits || 0 }}</b><small>{{ 'CUSTOMERS.VISITS' | translate }}</small></div>
                <div><b>{{ money(c.total_spent_cents || 0) }}</b><small>{{ 'CUSTOMERS.SPENT' | translate }}</small></div>
                <div><b>{{ lastVisitLabel(c) }}</b><small>{{ 'CUSTOMERS.LAST_VISIT' | translate }}</small></div>
              </div>

              @if (nextTier(c); as nt) {
                <div class="cu-progress" [attr.title]="'CUSTOMERS.NEXT_TIER' | translate: { n: nt.missing, tier: ('CUSTOMERS.TIER_' + nt.name.toUpperCase()) | translate }">
                  <span class="cu-bar-track"><span class="cu-bar-fill" [style.width.%]="nt.pct"></span></span>
                  <small>{{ 'CUSTOMERS.NEXT_TIER' | translate: { n: nt.missing, tier: ('CUSTOMERS.TIER_' + nt.name.toUpperCase()) | translate } }}</small>
                </div>
              }

              <ul class="cu-contact">
                @if (c.phone) {
                  <li>
                    <span>{{ c.phone }}</span>
                    <span class="cu-quick">
                      <a [href]="'tel:' + c.phone" [attr.aria-label]="'CUSTOMERS.CALL' | translate" [title]="'CUSTOMERS.CALL' | translate">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>
                      </a>
                      <a [href]="whatsappUrl(c.phone)" target="_blank" rel="noopener" class="wa" aria-label="WhatsApp" title="WhatsApp">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.1c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 21.8a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4a9.9 9.9 0 1 1 8.3 4.6zM12 0a12 12 0 0 0-10.3 18L0 24l6.2-1.6A12 12 0 1 0 12 0z"/></svg>
                      </a>
                    </span>
                  </li>
                }
                @if (c.email) {
                  <li>
                    <span>{{ c.email }}</span>
                    <span class="cu-quick">
                      <a [href]="'mailto:' + c.email" aria-label="Email" title="Email">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></svg>
                      </a>
                    </span>
                  </li>
                }
                @if (!c.phone && !c.email) {
                  <li class="muted">{{ 'CUSTOMERS.NO_CONTACT' | translate }}</li>
                }
              </ul>

              <div class="cu-tags">
                @if (c.tax_id) { <span class="cu-tag cu-tag-id">{{ c.tax_id }}</span> }
                @if (c.address) { <span class="cu-tag" [title]="c.address">{{ c.address }}</span> }
              </div>

              @if (canWrite()) {
                <footer class="cu-actions">
                  <button class="cu-btn" (click)="openModal(c)">{{ 'COMMON.EDIT' | translate }}</button>
                  <button class="cu-btn cu-btn-danger" (click)="confirmDelete(c)">{{ 'COMMON.DELETE' | translate }}</button>
                </footer>
              }
            </article>
          }
        </div>
      }

      <!-- Add/Edit Modal -->
      @if (showModal()) {
        <div class="modal-overlay" (click)="closeModal()">
          <div class="cu-modal" (click)="$event.stopPropagation()" appFocusFirstInput role="dialog" aria-modal="true">
            <div class="cu-mhead">
              <span class="cu-av cu-av-lg" [style.--h]="hue(form.name || '?')" aria-hidden="true">{{ initial(form.name) }}</span>
              <div class="cu-mhead-text">
                <small>{{ editing() ? ('CUSTOMERS.EDIT' | translate) : ('CUSTOMERS.ADD' | translate) }}</small>
                <h3>{{ form.name.trim() || ('CUSTOMERS.NEW_NAME' | translate) }}</h3>
                <div class="cu-ready">
                  <span [class.ok]="!!form.name.trim()">{{ 'CUSTOMERS.CHK_NAME' | translate }}</span>
                  <span [class.ok]="docOk()">{{ 'CUSTOMERS.CHK_DOC' | translate }}</span>
                  <span [class.ok]="emailOk() && !!form.email.trim()">{{ 'CUSTOMERS.CHK_EMAIL' | translate }}</span>
                </div>
              </div>
              <button type="button" class="icon-btn" (click)="closeModal()" aria-label="×">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <form (ngSubmit)="save()" class="cu-form" novalidate>
              @if (duplicate(); as dup) {
                <div class="cu-dup" role="status">
                  <b>{{ 'CUSTOMERS.DUP_TITLE' | translate }}</b>
                  <span>{{ 'CUSTOMERS.DUP_BODY' | translate: { name: dup.name } }}</span>
                </div>
              }

              <div class="cu-sec">
                <h4><i>1</i>{{ 'CUSTOMERS.SEC_WHO' | translate }}</h4>
                <div class="form-group">
                  <label for="cust-name">{{ (isCompany() ? 'CUSTOMERS.NAME_CONTACT' : 'CUSTOMERS.NAME_FULL') | translate }} *</label>
                  <input id="cust-name" type="text" [(ngModel)]="form.name" name="name" required autocomplete="off" />
                </div>
                <div class="form-group">
                  <label for="cust-company">{{ (isCompany() ? 'CUSTOMERS.COMPANY_LEGAL' : 'CUSTOMERS.COMPANY') | translate }}</label>
                  <input id="cust-company" type="text" [(ngModel)]="form.company_name" name="company_name" autocomplete="off" />
                </div>
              </div>

              <div class="cu-sec">
                <h4><i>2</i>{{ 'CUSTOMERS.SEC_DOC' | translate }}</h4>
                <div class="cu-doctypes" role="radiogroup" [attr.aria-label]="'CUSTOMERS.DOC_TYPE' | translate">
                  @for (d of docTypes; track d.value) {
                    <button type="button" role="radio" class="cu-doctype" [class.on]="form.document_type === d.value" [attr.aria-checked]="form.document_type === d.value" (click)="setDocType(d.value)">
                      <b>{{ d.value }}</b><small>{{ d.labelKey | translate }}</small>
                    </button>
                  }
                </div>
                <div class="form-group">
                  <label for="cust-tax">{{ 'CUSTOMERS.DOC_NUMBER' | translate }}</label>
                  <div class="cu-docnum">
                    <input id="cust-tax" type="text" [ngModel]="form.tax_id" (ngModelChange)="onDocInput($event)" name="tax_id" autocomplete="off"
                      [attr.inputmode]="form.document_type === 'PA' ? 'text' : 'numeric'" [placeholder]="'CUSTOMERS.TAX_ID_PLACEHOLDER' | translate" [class.bad]="!!form.tax_id && !docOk()" />
                    @if (form.document_type === 'NIT') {
                      <span class="cu-dv" [class.empty]="nitDv() === null"><small>DV</small><b>{{ nitDv() === null ? '–' : nitDv() }}</b></span>
                    }
                  </div>
                  @if (form.tax_id && !docOk()) {
                    <p class="cu-err">{{ 'CUSTOMERS.DOC_INVALID' | translate }}</p>
                  } @else {
                    <p class="field-hint">{{ 'CUSTOMERS.DOC_HINT' | translate }}</p>
                  }
                </div>
              </div>

              <div class="cu-sec">
                <h4><i>3</i>{{ 'CUSTOMERS.SEC_CONTACT' | translate }}</h4>
                <div class="cu-two">
                  <div class="form-group">
                    <label for="cust-phone">{{ 'CUSTOMERS.PHONE' | translate }}</label>
                    <input id="cust-phone" type="tel" [(ngModel)]="form.phone" name="phone" autocomplete="off" />
                  </div>
                  <div class="form-group">
                    <label for="cust-email">{{ 'CUSTOMERS.EMAIL' | translate }}</label>
                    <input id="cust-email" type="email" [(ngModel)]="form.email" name="email" autocomplete="off" [class.bad]="!emailOk()" />
                    @if (!emailOk()) { <p class="cu-err">{{ 'CUSTOMERS.EMAIL_INVALID' | translate }}</p> }
                  </div>
                </div>
                <p class="field-hint">{{ 'CUSTOMERS.EMAIL_HINT' | translate }}</p>
                <div class="form-group">
                  <label for="cust-address">{{ 'CUSTOMERS.ADDRESS' | translate }}</label>
                  <input id="cust-address" type="text" [(ngModel)]="form.address" name="address" autocomplete="off" />
                </div>
              </div>

              <div class="cu-mfoot">
                <button type="button" class="cu-ghost" (click)="closeModal()">{{ 'COMMON.CANCEL' | translate }}</button>
                <button type="submit" class="cu-new" [disabled]="!canSave() || saving()">
                  {{ saving() ? ('COMMON.SAVING' | translate) : (editing() ? ('COMMON.SAVE' | translate) : ('CUSTOMERS.CREATE' | translate)) }}
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Delete confirmation -->
      @if (deleting()) {
        <div class="modal-overlay" (click)="deleting.set(null)">
          <div class="cu-confirm" (click)="$event.stopPropagation()" role="alertdialog">
            <span class="cu-confirm-ico" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>
            </span>
            <h3>{{ 'CUSTOMERS.DELETE_TITLE' | translate }}</h3>
            <p>{{ 'CUSTOMERS.DELETE_CONFIRM' | translate:{ name: deleting()?.name } }}</p>
            <div class="cu-mfoot">
              <button class="cu-ghost" (click)="deleting.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
              <button class="cu-danger" (click)="deleteCustomer()" [disabled]="saving()">
                {{ saving() ? ('COMMON.SAVING' | translate) : ('COMMON.DELETE' | translate) }}
              </button>
            </div>
          </div>
        </div>
      }
    </app-sidebar>
  `,
  styles: [`
    .icon-btn { background: none; border: none; cursor: pointer; padding: 6px; border-radius: 50%; color: var(--color-text-muted); }
    .icon-btn:hover { color: var(--color-primary); background: var(--color-bg); }
    .error-banner { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; background: #fef2f2; color: #b91c1c; border-radius: 16px; margin-bottom: 1rem; }
    .field-hint { margin: 0.35rem 0 0; font-size: 0.8rem; color: var(--color-text-muted); }

    /* hero */
    .cu-hero { margin-bottom: 16px; padding: 22px 26px 20px; border-radius: 30px; border: 1px solid var(--color-border); background: radial-gradient(70% 140% at 0% 0%, color-mix(in srgb, var(--color-primary) 15%, #fff), transparent 70%), #fffdfa; box-shadow: 0 30px 50px -42px rgba(60, 30, 10, .55); }
    .cu-hero-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .cu-eyebrow { display: flex; align-items: center; gap: 10px; margin: 0; font-size: .68rem; font-weight: 800; letter-spacing: .22em; text-transform: uppercase; color: var(--color-primary); }
    .cu-eyebrow i { width: 26px; height: 2px; background: var(--color-primary); }
    .cu-new { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 22px; border: 0; border-radius: 999px; font: inherit; font-weight: 800; color: #fff; cursor: pointer; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 66%, #000)); box-shadow: 0 14px 22px -14px var(--color-primary); }
    .cu-new:disabled { opacity: .5; cursor: default; }
    .cu-hero-main { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px 32px; flex-wrap: wrap; margin-bottom: 18px; }
    .cu-title { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: clamp(2rem, 5vw, 3.4rem); font-weight: 500; letter-spacing: -.03em; line-height: 1.02; }
    .cu-title em { display: block; font-style: italic; color: var(--color-primary); }
    .cu-stats { display: flex; margin: 0; }
    .cu-stats > div { padding: 2px 22px; border-left: 1px dashed var(--color-border); }
    .cu-stats > div:first-child { border-left: 0; padding-left: 0; }
    .cu-stats dt { font-size: .62rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--color-text-muted); }
    .cu-stats dd { margin: 2px 0 0; font-family: Georgia, 'Times New Roman', serif; font-size: 2.1rem; line-height: 1; font-variant-numeric: tabular-nums; }
    .cu-stats dd.money { font-size: 1.5rem; padding-top: 7px; }
    .cu-stats dd.gold { color: #b8791a; }
    .cu-stats dd.green { color: #15803d; }
    .cu-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .cu-search { flex: 1 1 260px; max-width: 380px; display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--color-border); background: #fff; color: var(--color-text-muted); }
    .cu-search:focus-within { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
    .cu-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-weight: 600; color: var(--color-text); }
    .cu-clear { border: 0; background: none; font-size: 1.2rem; line-height: 1; color: var(--color-text-muted); cursor: pointer; }
    .cu-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .cu-chip { display: inline-flex; align-items: center; gap: 8px; min-height: 38px; padding: 0 8px 0 16px; border: 1px solid var(--color-border); border-radius: 999px; background: #fff; color: var(--color-text-muted); font: inherit; font-size: .84rem; font-weight: 700; cursor: pointer; }
    .cu-chip b { display: grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; font-size: .72rem; background: var(--color-bg); color: var(--color-text); }
    .cu-chip:hover { border-color: var(--color-primary); color: var(--color-primary); }
    .cu-chip.on { color: #fff; border-color: transparent; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 66%, #000)); box-shadow: 0 10px 16px -10px var(--color-primary); }
    .cu-chip.on b { color: var(--color-primary); background: #fff; }
    .cu-sort { display: block; min-width: 190px; }
    @media (max-width: 700px) { .cu-hero { padding: 18px 16px; } .cu-stats > div { padding: 2px 12px; } }


    /* avatar */
    .cu-av { --h: 20; flex: none; display: grid; place-items: center; width: 46px; height: 46px; border-radius: 50%; font-weight: 800; font-size: 1.15rem; color: hsl(var(--h) 55% 26%); background: hsl(var(--h) 70% 87%); box-shadow: inset 0 0 0 2px hsl(var(--h) 65% 75%); }
    .cu-av-sm { width: 26px; height: 26px; font-size: .78rem; }
    .cu-av-lg { width: 58px; height: 58px; font-size: 1.5rem; }

    /* cards */
    .cu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; }
    .cu-card { display: flex; flex-direction: column; gap: 14px; padding: 18px; border-radius: 26px; border: 1px solid var(--color-border); background: #fff; box-shadow: 0 22px 34px -30px rgba(60, 30, 10, .55); transition: transform .18s, box-shadow .18s; }
    .cu-card:hover { transform: translateY(-3px); box-shadow: 0 28px 40px -28px rgba(60, 30, 10, .55); }
    .cu-card[data-tier='vip'] { border-color: #f1d28a; background: linear-gradient(160deg, #fffaf0, #fff 55%); box-shadow: 0 22px 34px -28px rgba(184, 121, 26, .6); }
    .cu-head { display: flex; align-items: center; gap: 12px; }
    .cu-who { flex: 1; min-width: 0; }
    .cu-who h3 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 1.2rem; font-weight: 500; letter-spacing: -.01em; line-height: 1.15; overflow-wrap: anywhere; }
    .cu-company { display: block; font-size: .78rem; font-weight: 700; color: var(--color-text-muted); }
    .cu-tier { flex: none; display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px; border-radius: 999px; font-size: .64rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--color-text-muted); background: #ece5da; }
    .cu-tier[data-tier='regular'] { color: #1c1917; background: #e7e5e4; }
    .cu-tier[data-tier='frequent'] { color: #166534; background: #dcfce7; }
    .cu-tier[data-tier='vip'] { color: #fff; background: linear-gradient(135deg, #f5b942, #d97706); box-shadow: 0 8px 14px -8px #d97706; }
    .cu-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-radius: 18px; background: #faf6f0; }
    .cu-metrics > div { display: flex; flex-direction: column; gap: 1px; padding: 10px 12px; border-left: 1px dashed var(--color-border); min-width: 0; }
    .cu-metrics > div:first-child { border-left: 0; }
    .cu-metrics b { font-size: .98rem; font-weight: 800; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cu-metrics small { font-size: .6rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--color-text-muted); }
    .cu-progress { display: flex; flex-direction: column; gap: 5px; }
    .cu-bar-track { display: block; height: 6px; border-radius: 999px; background: #ece5da; overflow: hidden; }
    .cu-bar-fill { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #000)); }
    .cu-progress small { font-size: .72rem; font-weight: 700; color: var(--color-text-muted); }
    .cu-contact { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .cu-contact li { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: .88rem; font-weight: 600; min-width: 0; }
    .cu-contact li > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cu-contact li.muted { color: var(--color-text-muted); font-weight: 500; }
    .cu-quick { display: inline-flex; gap: 6px; flex: none; }
    .cu-quick a { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; color: var(--color-text-muted); background: var(--color-bg); transition: background .15s, color .15s; }
    .cu-quick a:hover { color: #fff; background: var(--color-primary); }
    .cu-quick a.wa:hover { background: #16a34a; }
    .cu-tags { display: flex; flex-wrap: wrap; gap: 6px; }
    .cu-tag { max-width: 100%; padding: 3px 11px; border-radius: 999px; font-size: .74rem; font-weight: 700; color: var(--color-text-muted); background: var(--color-bg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cu-tag-id { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; color: var(--color-text); }
    .cu-actions { display: flex; gap: 6px; margin-top: auto; padding-top: 12px; border-top: 1px dashed var(--color-border); }
    .cu-btn { min-height: 36px; padding: 0 16px; border: 0; border-radius: 999px; font: inherit; font-size: .8rem; font-weight: 700; cursor: pointer; color: var(--color-text); background: var(--color-bg); }
    .cu-btn:hover { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, #fff); }
    .cu-btn-danger { margin-left: auto; color: #b91c1c; background: transparent; }
    .cu-btn-danger:hover { color: #b91c1c; background: #fde8e6; }
    .cu-ghost { min-height: 44px; padding: 0 22px; border: 1px solid var(--color-border); border-radius: 999px; background: #fff; font: inherit; font-weight: 800; color: var(--color-text); cursor: pointer; }
    .cu-danger { min-height: 44px; padding: 0 22px; border: 0; border-radius: 999px; font: inherit; font-weight: 800; color: #fff; cursor: pointer; background: #dc2626; box-shadow: 0 12px 20px -12px #dc2626; }
    .cu-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 56px 16px; border-radius: 28px; border: 1.5px dashed var(--color-border); background: #fffdfa; text-align: center; color: var(--color-text-muted); }
    .cu-empty h3 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 1.4rem; font-weight: 500; color: var(--color-text); }
    .cu-empty p { margin: 0 0 6px; }
    .cu-empty-ico { display: grid; place-items: center; width: 80px; height: 80px; border-radius: 26px; color: var(--color-primary); background: var(--color-primary-light); }

    /* modals */
    .modal-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(28, 25, 23, .45); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
    .cu-modal { width: 100%; max-width: 640px; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; border-radius: 30px; background: #fffdfa; box-shadow: 0 40px 90px -24px rgba(40, 20, 5, .6); }
    .cu-mhead { display: flex; align-items: center; gap: 14px; padding: 22px 24px 18px; background: radial-gradient(90% 160% at 0% 0%, color-mix(in srgb, var(--color-primary) 22%, #fff), transparent 72%), #fffdfa; border-bottom: 2px dashed var(--color-border); }
    .cu-mhead-text { flex: 1; min-width: 0; }
    .cu-mhead-text small { display: block; font-size: .66rem; font-weight: 800; letter-spacing: .22em; text-transform: uppercase; color: var(--color-primary); }
    .cu-mhead-text h3 { margin: 2px 0 0; font-family: Georgia, 'Times New Roman', serif; font-size: 1.6rem; font-weight: 500; letter-spacing: -.02em; overflow-wrap: anywhere; }
    .cu-form { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; padding: 16px 22px 0; gap: 14px; }
    .cu-sec { padding: 16px 18px 6px; border-radius: 22px; border: 1px solid var(--color-border); background: #fff; }
    .cu-sec h4 { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; font-family: Georgia, 'Times New Roman', serif; font-size: 1.05rem; font-style: italic; font-weight: 500; }
    .cu-sec h4 i { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; font-family: inherit; font-size: .8rem; font-style: normal; font-weight: 800; color: #fff; background: linear-gradient(145deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 62%, #000)); }
    .cu-ready { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .cu-ready span { padding: 2px 10px; border-radius: 999px; font-size: .68rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #8a817a; background: #ece5da; }
    .cu-ready span.ok { color: #166534; background: #dcfce7; }
    .cu-ready span.ok::before { content: '✓ '; }
    .cu-dup { display: flex; flex-direction: column; gap: 2px; padding: 12px 16px; border-radius: 18px; font-size: .86rem; color: #78350f; background: #fef3c7; box-shadow: inset 0 0 0 1px rgba(180, 83, 9, .2); }
    .cu-doctypes { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 8px; margin-bottom: 14px; }
    .cu-doctype { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 10px 12px; border: 1.5px solid var(--color-border); border-radius: 16px; background: #fffdfa; font: inherit; text-align: left; cursor: pointer; color: var(--color-text); }
    .cu-doctype b { font-size: .98rem; font-weight: 800; letter-spacing: .04em; }
    .cu-doctype small { font-size: .66rem; font-weight: 600; line-height: 1.25; color: var(--color-text-muted); }
    .cu-doctype:hover { border-color: var(--color-primary); }
    .cu-doctype.on { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 9%, #fff); box-shadow: 0 0 0 1px var(--color-primary); }
    .cu-docnum { display: flex; align-items: stretch; gap: 10px; }
    .cu-form .cu-docnum input { flex: 1; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 1.05rem; letter-spacing: .06em; font-weight: 700; }
    .cu-form input.bad { border-color: #dc2626; background: #fef2f2; }
    .cu-dv { flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 58px; padding: 2px 10px; border-radius: 16px; background: color-mix(in srgb, var(--color-primary) 10%, #fff); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 35%, transparent); }
    .cu-dv.empty { background: #f3eee6; box-shadow: inset 0 0 0 1px var(--color-border); }
    .cu-dv small { font-size: .54rem; font-weight: 800; letter-spacing: .16em; color: var(--color-text-muted); }
    .cu-dv b { font-family: Georgia, 'Times New Roman', serif; font-size: 1.25rem; font-weight: 500; line-height: 1; color: var(--color-primary); }
    .cu-err { margin: 2px 0 0; font-size: .78rem; font-weight: 700; color: #dc2626; }
    .cu-two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
    @media (max-width: 560px) { .cu-two { grid-template-columns: 1fr; } }
    .cu-form .form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .cu-form label { font-size: .64rem; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; color: var(--color-text-muted); }
    .cu-form input { width: 100%; min-height: 46px; padding: 0 14px; border: 1px solid var(--color-border); border-radius: 16px; background: #fffdfa; font: inherit; font-weight: 600; color: var(--color-text); box-sizing: border-box; }
    .cu-form input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
    .cu-mfoot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 0 18px; position: sticky; bottom: 0; background: #fffdfa; }
    .cu-confirm { width: 100%; max-width: 420px; padding: 26px 24px 8px; display: flex; flex-direction: column; align-items: center; text-align: center; border-radius: 28px; background: #fffdfa; box-shadow: 0 40px 90px -24px rgba(40, 20, 5, .6); }
    .cu-confirm-ico { display: grid; place-items: center; width: 64px; height: 64px; margin-bottom: 10px; border-radius: 50%; color: #dc2626; background: #fee2e2; box-shadow: 0 0 0 8px #fef2f2; }
    .cu-confirm h3 { margin: 0 0 6px; font-family: Georgia, 'Times New Roman', serif; font-size: 1.45rem; font-weight: 500; }
    .cu-confirm p { margin: 0 0 8px; font-size: .92rem; line-height: 1.5; color: var(--color-text-muted); }
    @media (prefers-reduced-motion: reduce) { .cu-card, .cu-card:hover { transition: none; transform: none; } }
  `]
})
export class CustomersComponent implements OnInit {
  private api = inject(ApiService);
  private permissions = inject(PermissionService);
  private translate = inject(TranslateService);

  sortOptions: AppSelectOption[] = [];

  private buildSortOptions(): AppSelectOption[] {
    return [
    { value: 'spent', label: this.translate.instant('CUSTOMERS.SORT_SPENT'), tone: 'a', svg: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 1.8 0 2.4 5 1.2 5 3.7 0 1-1 1.8-2.5 1.8-1.1 0-2.1-.5-2.6-1.5M12 6.5V8m0 8v1.5"/>' },
    { value: 'visits', label: this.translate.instant('CUSTOMERS.SORT_VISITS'), tone: 'c', svg: '<path d="M12 21s-7-4.4-9.3-9A5 5 0 0 1 12 6a5 5 0 0 1 9.3 6c-2.3 4.6-9.3 9-9.3 9z"/>' },
    { value: 'recent', label: this.translate.instant('CUSTOMERS.SORT_RECENT'), tone: 'b', svg: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
    { value: 'name', label: this.translate.instant('CUSTOMERS.SORT_NAME'), tone: 'a', svg: '<path d="M4 7h7M4 12h5M4 17h3M15 5v14M12 16l3 3 3-3"/>' },
    ];
  }

  customers = signal<BillingCustomer[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  showModal = signal(false);
  editing = signal<BillingCustomer | null>(null);
  deleting = signal<BillingCustomer | null>(null);
  searchTerm = '';

  readonly tierFilters = ['all', 'vip', 'frequent', 'regular', 'new'] as const;
  tierFilter = signal<'all' | 'vip' | 'frequent' | 'regular' | 'new'>('all');
  sortBy = signal<'spent' | 'visits' | 'recent' | 'name'>('spent');

  stats = computed(() => {
    const list = this.customers();
    return {
      total: list.length,
      vip: list.filter((c) => this.tier(c) === 'vip').length,
      frequent: list.filter((c) => this.tier(c) === 'frequent').length,
      spent: list.reduce((sum, c) => sum + (c.total_spent_cents || 0), 0),
    };
  });

  tierCount(t: 'all' | 'vip' | 'frequent' | 'regular' | 'new'): number {
    const list = this.customers();
    return t === 'all' ? list.length : list.filter((c) => this.tier(c) === t).length;
  }

  /** Customers after the tier filter and sort chosen on screen. */
  visible = computed(() => {
    const t = this.tierFilter();
    let list = this.customers().filter((c) => t === 'all' || this.tier(c) === t);
    const by = this.sortBy();
    list = [...list].sort((a, b) => {
      if (by === 'name') return a.name.localeCompare(b.name);
      if (by === 'visits') return (b.visits || 0) - (a.visits || 0);
      if (by === 'recent') return (b.last_visit || '').localeCompare(a.last_visit || '');
      return (b.total_spent_cents || 0) - (a.total_spent_cents || 0);
    });
    return list;
  });

  lastVisitLabel(c: BillingCustomer): string {
    if (!c.last_visit) return '—';
    const d = new Date(c.last_visit);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  /** Progress toward the next loyalty tier (visits needed), or null for VIP. */
  nextTier(c: BillingCustomer): { name: string; missing: number; pct: number } | null {
    const v = c.visits || 0;
    if (v >= 10) return null;
    const [name, target, from] = v >= 5 ? ['vip', 10, 5] : v >= 1 ? ['frequent', 5, 1] : ['regular', 1, 0];
    return { name: name as string, missing: (target as number) - v, pct: Math.max(4, ((v - (from as number)) / ((target as number) - (from as number))) * 100) };
  }

  hue(name: string): number {
    let h = 0;
    for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  initial(name: string): string {
    return (name || '?').trim().charAt(0).toUpperCase() || '?';
  }

  /** wa.me link: digits only; 10-digit Colombian mobiles get the 57 prefix. */
  whatsappUrl(phone: string): string {
    let digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 10) digits = '57' + digits;
    return 'https://wa.me/' + digits;
  }

  /** Loyalty tier from the number of paid visits: 0 new, 1-4 regular, 5-9 frequent, 10+ VIP. */
  tier(c: BillingCustomer): 'new' | 'regular' | 'frequent' | 'vip' {
    const v = c.visits || 0;
    return v >= 10 ? 'vip' : v >= 5 ? 'frequent' : v >= 1 ? 'regular' : 'new';
  }

  money(cents: number): string {
    return formatMoneyCents(cents);
  }

  form: {
    name: string;
    company_name: string;
    tax_id: string;
    address: string;
    email: string;
    phone: string;
    document_type: string;
  } = {
    name: '',
    company_name: '',
    tax_id: '',
    address: '',
    email: '',
    phone: '',
    document_type: 'CC'
  };

  /** DIAN identification document types (RUT / Factus). */
  readonly docTypes = [
    { value: 'CC', labelKey: 'CUSTOMERS.DOC_CC' },
    { value: 'NIT', labelKey: 'CUSTOMERS.DOC_NIT' },
    { value: 'CE', labelKey: 'CUSTOMERS.DOC_CE' },
    { value: 'PA', labelKey: 'CUSTOMERS.DOC_PA' },
    { value: 'TI', labelKey: 'CUSTOMERS.DOC_TI' },
  ];

  isCompany(): boolean {
    return this.form.document_type === 'NIT';
  }

  setDocType(value: string): void {
    this.form.document_type = value;
    this.onDocInput(this.form.tax_id);
  }

  /** Numeric documents keep digits only; passport allows letters and digits. */
  onDocInput(v: string): void {
    const raw = String(v ?? '');
    this.form.tax_id =
      this.form.document_type === 'PA'
        ? raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase().slice(0, 16)
        : raw.split('-')[0].replace(/\D/g, '').slice(0, 15);
  }

  docOk(): boolean {
    const d = this.form.tax_id.trim();
    if (!d) return false;
    if (this.form.document_type === 'NIT') return d.length >= 8;
    if (this.form.document_type === 'PA') return d.length >= 5;
    return d.length >= 6;
  }

  emailOk(): boolean {
    const e = this.form.email.trim();
    return !e || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  }

  /** DIAN check digit for a NIT (módulo 11 with the official weights). */
  nitDv(): number | null {
    const d = this.form.tax_id.trim();
    if (d.length < 5) return null;
    const w = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += Number(d[d.length - 1 - i]) * w[i];
    const r = sum % 11;
    return r > 1 ? 11 - r : r;
  }

  /** Another customer with the same document or phone (warns before creating a duplicate). */
  duplicate(): BillingCustomer | null {
    const tax = this.form.tax_id.trim();
    const phone = this.form.phone.replace(/\D/g, '');
    const editingId = this.editing()?.id;
    return (
      this.customers().find(
        (c) =>
          c.id !== editingId &&
          ((tax.length >= 5 && (c.tax_id || '').trim() === tax) ||
            (phone.length >= 7 && (c.phone || '').replace(/\D/g, '') === phone)),
      ) ?? null
    );
  }

  canSave(): boolean {
    return !!this.form.name.trim() && this.emailOk() && (!this.form.tax_id.trim() || this.docOk());
  }

  canWrite(): boolean {
    return this.permissions.hasPermission(this.api.getCurrentUser(), 'billing_customer:write');
  }

  ngOnInit() {
    this.translate
      .get('CUSTOMERS.SORT_SPENT')
      .subscribe(() => (this.sortOptions = this.buildSortOptions()));
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.getBillingCustomers(this.searchTerm.trim() || undefined).subscribe({
      next: list => { this.customers.set(list); this.loading.set(false); },
      error: err => { this.error.set(err.error?.detail || 'Failed to load customers'); this.loading.set(false); }
    });
  }

  openModal(c: BillingCustomer | null) {
    this.editing.set(c);
    if (c) {
      this.form = {
        name: c.name,
        company_name: c.company_name ?? '',
        tax_id: c.tax_id ?? '',
        address: c.address ?? '',
        email: c.email ?? '',
        phone: c.phone ?? '',
        document_type: c.document_type || 'CC'
      };
    } else {
      this.form = {
        name: '',
        company_name: '',
        tax_id: '',
        address: '',
        email: '',
        phone: '',
        document_type: 'CC'
      };
    }
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
    this.editing.set(null);
  }

  save() {
    if (!this.canSave()) return;
    this.saving.set(true);
    const f = this.form;
    const orNull = (v: string): string | null => v.trim() || null;
    const editing = this.editing();
    const payload = {
      name: f.name.trim(),
      company_name: orNull(f.company_name),
      tax_id: orNull(f.tax_id),
      document_type: f.tax_id.trim() ? f.document_type : null,
      address: orNull(f.address),
      email: orNull(f.email),
      phone: orNull(f.phone),
    };
    if (editing) {
      this.api.updateBillingCustomer(editing.id, payload).subscribe({
        next: () => { this.saving.set(false); this.closeModal(); this.load(); },
        error: err => { this.error.set(err.error?.detail || 'Update failed'); this.saving.set(false); }
      });
    } else {
      this.api.createBillingCustomer(payload).subscribe({
        next: () => { this.saving.set(false); this.closeModal(); this.load(); },
        error: err => { this.error.set(err.error?.detail || 'Create failed'); this.saving.set(false); }
      });
    }
  }

  confirmDelete(c: BillingCustomer) {
    this.deleting.set(c);
  }

  deleteCustomer() {
    const c = this.deleting();
    if (!c) return;
    this.saving.set(true);
    this.api.deleteBillingCustomer(c.id).subscribe({
      next: () => { this.saving.set(false); this.deleting.set(null); this.load(); },
      error: err => { this.error.set(err.error?.detail || 'Delete failed'); this.saving.set(false); }
    });
  }
}
