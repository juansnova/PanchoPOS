import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';

type LegalDocKind = 'terms' | 'privacy';

@Component({
  selector: 'app-legal-document',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  template: `
    <div class="legal-doc-page">

      <main class="legal-doc-main">
        @if (kind() === 'terms') {
          <article class="legal-doc-article">
            <h1>{{ 'LEGAL.DOC.TOS_TITLE' | translate }}</h1>
            <p class="legal-doc-updated">{{ 'LEGAL.DOC.LAST_UPDATED' | translate: { date: lastUpdated } }}</p>
            <p class="legal-doc-disclaimer">{{ 'LEGAL.DOC.NOT_LEGAL_ADVICE' | translate }}</p>
            <p class="legal-doc-intro">{{ 'LEGAL.DOC.TOS_INTRO' | translate }}</p>
            @for (id of tosSectionIds; track id) {
              <section class="legal-doc-section">
                <h2>{{ ('LEGAL.DOC.TOS_' + id + '_TITLE') | translate }}</h2>
                <p>{{ ('LEGAL.DOC.TOS_' + id + '_BODY') | translate }}</p>
              </section>
            }
            <p class="legal-doc-cross">
              <a routerLink="/privacy">{{ 'LEGAL.DOC.SEE_PRIVACY' | translate }}</a>
            </p>
          </article>
        } @else {
          <article class="legal-doc-article">
            <h1>{{ 'LEGAL.DOC.PRIVACY_TITLE' | translate }}</h1>
            <p class="legal-doc-updated">{{ 'LEGAL.DOC.LAST_UPDATED' | translate: { date: lastUpdated } }}</p>
            <p class="legal-doc-disclaimer">{{ 'LEGAL.DOC.NOT_LEGAL_ADVICE' | translate }}</p>
            <p class="legal-doc-intro">{{ 'LEGAL.DOC.PRIVACY_INTRO' | translate }}</p>
            @for (id of privacySectionIds; track id) {
              <section class="legal-doc-section">
                <h2>{{ ('LEGAL.DOC.PRIVACY_' + id + '_TITLE') | translate }}</h2>
                <p>{{ ('LEGAL.DOC.PRIVACY_' + id + '_BODY') | translate }}</p>
              </section>
            }
            <p class="legal-doc-cross">
              <a routerLink="/terms">{{ 'LEGAL.DOC.SEE_TERMS' | translate }}</a>
            </p>
          </article>
        }

        <nav class="legal-doc-nav" aria-label="{{ 'LEGAL.LINKS_NAV' | translate }}">
          <a routerLink="/" class="legal-doc-back">{{ 'LEGAL.DOC.BACK_HOME' | translate }}</a>
        </nav>
      </main>
    </div>
  `,
  styles: [
    `
      .legal-doc-page {
        min-height: 100vh;
        background: var(--color-bg);
        color: var(--color-text);
      }
      .legal-doc-main {
        max-width: 42rem;
        margin: 0 auto;
        padding: var(--space-5) var(--space-4) var(--space-8);
      }
      .legal-doc-article h1 {
        font-size: 1.65rem;
        font-weight: 700;
        line-height: 1.25;
        margin: 0 0 var(--space-3);
        letter-spacing: -0.02em;
      }
      .legal-doc-updated {
        font-size: 0.875rem;
        color: var(--color-text-muted, #5c5c5c);
        margin: 0 0 var(--space-3);
      }
      .legal-doc-disclaimer {
        font-size: 0.8125rem;
        color: var(--color-text-muted, #5c5c5c);
        font-style: italic;
        margin: 0 0 var(--space-4);
        padding: var(--space-3);
        background: var(--color-surface, #f5f5f5);
        border-radius: var(--radius-md, 8px);
      }
      .legal-doc-intro {
        margin: 0 0 var(--space-5);
        line-height: 1.6;
      }
      .legal-doc-section {
        margin-bottom: var(--space-5);
      }
      .legal-doc-section h2 {
        font-size: 1.125rem;
        font-weight: 600;
        margin: 0 0 var(--space-2);
      }
      .legal-doc-section p {
        margin: 0;
        line-height: 1.65;
        white-space: pre-line;
      }
      .legal-doc-cross {
        margin: var(--space-6) 0 0;
      }
      .legal-doc-cross a {
        color: var(--color-primary, #2563eb);
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .legal-doc-nav {
        margin-top: var(--space-8);
        padding-top: var(--space-4);
        border-top: 1px solid var(--color-border, rgba(0, 0, 0, 0.08));
      }
      .legal-doc-back {
        color: var(--color-primary, #2563eb);
        font-weight: 500;
        text-decoration: none;
      }
      .legal-doc-back:hover {
        text-decoration: underline;
      }
      @media (max-width: 480px) {
        .legal-doc-article h1 {
          font-size: 1.35rem;
        }
      }
    `,
  ],
})
export class LegalDocumentComponent {
  private readonly route = inject(ActivatedRoute);

  readonly lastUpdated = '2026-03-27';

  readonly tosSectionIds = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] as const;
  readonly privacySectionIds = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'] as const;

  readonly kind = toSignal(
    this.route.data.pipe(map((d) => (d['legalDoc'] === 'privacy' ? 'privacy' : 'terms') as LegalDocKind)),
    { initialValue: 'terms' as LegalDocKind },
  );
}
