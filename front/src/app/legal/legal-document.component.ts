import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs/operators';

type LegalDocKind = 'terms' | 'privacy';

interface LegalSection {
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

interface LegalDoc {
  eyebrow: string;
  title: string;
  lead: string;
  highlights: { value: string; label: string }[];
  sections: LegalSection[];
}

const TERMS: LegalDoc = {
  eyebrow: 'Términos del servicio',
  title: 'Las reglas de la mesa, claras desde el principio',
  lead: 'Al pedir, reservar o usar los servicios de Pancho Panza por la web, aceptas estas condiciones. Las escribimos en lenguaje sencillo para que sepas qué esperar de nosotros y qué esperamos de ti.',
  highlights: [
    { value: 'COP', label: 'Precios en pesos colombianos, IVA incluido' },
    { value: '5 min', label: 'Para modificar o cancelar un pedido sin preparar' },
    { value: '24/7', label: 'Pedidos y reservas desde cualquier dispositivo' },
  ],
  sections: [
    {
      title: 'Quiénes somos y qué cubre este documento',
      paragraphs: [
        'Pancho Panza es un restaurante que ofrece servicio en mesa, domicilio, recogida y reservas. Estos términos regulan el uso del menú digital, el carrito, los pedidos, las reservas y cualquier otra función disponible en este sitio.',
        'Si no estás de acuerdo con alguna parte, te pedimos que no uses el servicio y que nos consultes cualquier duda antes de hacer un pedido.',
      ],
    },
    {
      title: 'Pedidos y confirmación',
      paragraphs: [
        'Un pedido queda en firme cuando aparece como recibido en la pantalla de seguimiento. Los platos se preparan al momento, por eso los tiempos son estimados y pueden variar en horas de alta demanda.',
      ],
      bullets: [
        'Revisa el carrito antes de confirmar: cantidades, notas y datos de entrega.',
        'Si algún plato se agota, te avisaremos y podrás cambiarlo o quitarlo del pedido.',
        'Las notas sobre alergias o preferencias se atienden con el mayor cuidado, pero no podemos garantizar la ausencia total de trazas.',
      ],
    },
    {
      title: 'Precios, impuestos y propinas',
      paragraphs: [
        'Todos los precios se expresan en pesos colombianos (COP) e incluyen los impuestos aplicables. En domicilios se suma el costo de envío que verás antes de confirmar.',
        'La propina es voluntaria. Puedes dejarla o ajustarla al momento de pagar; nunca se incluye sin que lo sepas.',
      ],
    },
    {
      title: 'Pagos',
      paragraphs: [
        'Aceptamos efectivo, tarjeta y los medios de pago digitales que aparezcan habilitados al finalizar el pedido. Los pagos en línea los procesa un tercero autorizado; no almacenamos los datos completos de tu tarjeta.',
      ],
    },
    {
      title: 'Domicilios y recogida',
      paragraphs: [
        'Entregamos dentro de la zona de cobertura configurada. Necesitamos una dirección completa y un teléfono de contacto para poder llegar a ti. Si no es posible entregar por datos incorrectos o ausencia, el pedido puede cancelarse y el valor del plato ya preparado podrá cobrarse.',
      ],
    },
    {
      title: 'Cancelaciones y devoluciones',
      paragraphs: [
        'Puedes cancelar mientras el pedido no haya empezado a prepararse. Una vez en cocina, solo podremos hacerlo en casos justificados.',
        'Si recibes un plato en mal estado o distinto al pedido, avísanos de inmediato: lo reponemos o devolvemos el valor, según prefieras. Esto no limita tus derechos como consumidor según la Ley 1480 de 2011 (Estatuto del Consumidor).',
      ],
    },
    {
      title: 'Reservas',
      paragraphs: [
        'Mantenemos tu mesa durante 15 minutos después de la hora reservada. Si vas a retrasarte o no podrás asistir, avísanos para liberar el espacio a otros comensales.',
      ],
    },
    {
      title: 'Uso adecuado del sitio',
      paragraphs: [
        'Te pedimos usar el servicio de buena fe: no hacer pedidos falsos, no intentar vulnerar la seguridad del sitio ni usar datos de terceros sin autorización. Podemos limitar el acceso si detectamos un uso abusivo.',
      ],
    },
    {
      title: 'Cambios en estos términos',
      paragraphs: [
        'Podemos actualizar este documento cuando cambie el servicio o la normativa. La fecha de la última revisión aparece al pie de esta página; seguir usando el servicio después de un cambio significa que lo aceptas.',
      ],
    },
  ],
};

const PRIVACY: LegalDoc = {
  eyebrow: 'Política de privacidad',
  title: 'Tus datos, tratados con el mismo cuidado que tu plato',
  lead: 'Solo pedimos lo necesario para atenderte bien. Aquí explicamos qué datos recogemos, para qué los usamos y cómo puedes ejercer tus derechos conforme a la Ley 1581 de 2012 de protección de datos personales en Colombia.',
  highlights: [
    { value: 'Mínimos', label: 'Solo los datos que necesitamos para tu pedido' },
    { value: 'Sin venta', label: 'No vendemos ni cedemos tus datos a terceros' },
    { value: 'Tuyo', label: 'Puedes consultarlos, corregirlos o eliminarlos' },
  ],
  sections: [
    {
      title: 'Responsable del tratamiento',
      paragraphs: [
        'Pancho Panza es el responsable del tratamiento de los datos personales recogidos a través de este sitio. Puedes contactarnos por los medios publicados en la sección de contacto del restaurante.',
      ],
    },
    {
      title: 'Qué datos recogemos',
      paragraphs: ['Según lo que hagas en el sitio, podemos tratar:'],
      bullets: [
        'Datos de contacto: nombre, teléfono y correo electrónico.',
        'Datos de entrega: dirección, indicaciones y ubicación aproximada para domicilios.',
        'Datos del pedido: platos, notas, alergias o preferencias y valores pagados.',
        'Datos de facturación, si solicitas factura electrónica.',
        'Datos técnicos básicos: tipo de dispositivo, navegador y registros de seguridad.',
      ],
    },
    {
      title: 'Para qué los usamos',
      paragraphs: ['Usamos tus datos únicamente para:'],
      bullets: [
        'Preparar, entregar y cobrar tu pedido o gestionar tu reserva.',
        'Avisarte sobre el estado del pedido o cambios que lo afecten.',
        'Emitir facturas y cumplir obligaciones contables y tributarias.',
        'Atender solicitudes, quejas y comentarios.',
        'Mantener la seguridad del servicio y prevenir fraudes.',
      ],
    },
    {
      title: 'Con quién los compartimos',
      paragraphs: [
        'No vendemos tus datos. Solo los compartimos cuando es indispensable para prestar el servicio: con el repartidor que entrega tu pedido, con proveedores de pago y de alojamiento tecnológico, y con autoridades cuando la ley lo exija.',
      ],
    },
    {
      title: 'Cuánto tiempo los conservamos',
      paragraphs: [
        'Guardamos la información el tiempo necesario para las finalidades descritas y para cumplir obligaciones legales, como la conservación de soportes contables. Después, se eliminan o se anonimizan.',
      ],
    },
    {
      title: 'Tus derechos',
      paragraphs: ['Como titular de los datos tienes derecho a:'],
      bullets: [
        'Conocer, actualizar y rectificar tus datos personales.',
        'Solicitar prueba de la autorización que nos diste.',
        'Ser informado del uso que damos a tu información.',
        'Revocar la autorización y pedir la supresión de tus datos cuando no exista un deber legal de conservarlos.',
        'Presentar quejas ante la Superintendencia de Industria y Comercio (SIC).',
      ],
    },
    {
      title: 'Cómo ejercer tus derechos',
      paragraphs: [
        'Escríbenos o acércate al restaurante indicando qué quieres hacer y con qué datos hiciste tu pedido. Responderemos tu consulta en un máximo de 10 días hábiles y tu reclamo en un máximo de 15 días hábiles, como establece la ley.',
      ],
    },
    {
      title: 'Seguridad',
      paragraphs: [
        'Aplicamos medidas técnicas y organizativas razonables para proteger tu información: conexiones cifradas, acceso restringido por roles y copias de respaldo. Ningún sistema es infalible, pero trabajamos para que el riesgo sea mínimo.',
      ],
    },
    {
      title: 'Cambios en esta política',
      paragraphs: [
        'Si modificamos esta política, publicaremos la nueva versión en esta misma página con su fecha de revisión.',
      ],
    },
  ],
};

@Component({
  selector: 'app-legal-document',
  standalone: true,
  imports: [RouterLink],
  template: `
    @let d = doc();
    <div class="lg-page">
      <header class="lg-hero">
        <div class="lg-hero-inner">
          <div class="lg-brand">
            <span class="lg-brand-mark" aria-hidden="true">P</span>
            <span class="lg-brand-name">Pancho Panza</span>
          </div>
          <span class="lg-eyebrow">{{ d.eyebrow }}</span>
          <h1>{{ d.title }}</h1>
          <p class="lg-lead">{{ d.lead }}</p>
          <div class="lg-switch" role="tablist">
            <a routerLink="/terms" [class.on]="kind() === 'terms'">Términos del servicio</a>
            <a routerLink="/privacy" [class.on]="kind() === 'privacy'">Política de privacidad</a>
          </div>
        </div>
      </header>

      <main class="lg-main">
        <div class="lg-stats">
          @for (h of d.highlights; track h.value) {
            <div class="lg-stat">
              <strong>{{ h.value }}</strong>
              <span>{{ h.label }}</span>
            </div>
          }
        </div>

        <div class="lg-body">
          <nav class="lg-toc" aria-label="Contenido">
            <span class="lg-toc-title">En este documento</span>
            @for (s of d.sections; track s.title; let i = $index) {
              <a [href]="'#sec-' + (i + 1)" (click)="jump($event, i + 1)">
                <em>{{ i + 1 }}</em>{{ s.title }}
              </a>
            }
          </nav>

          <article class="lg-article">
            @for (s of d.sections; track s.title; let i = $index) {
              <section class="lg-sec" [id]="'sec-' + (i + 1)">
                <span class="lg-num">{{ pad(i + 1) }}</span>
                <div class="lg-sec-body">
                  <h2>{{ s.title }}</h2>
                  @for (p of s.paragraphs; track p) {
                    <p>{{ p }}</p>
                  }
                  @if (s.bullets) {
                    <ul>
                      @for (b of s.bullets; track b) {
                        <li>{{ b }}</li>
                      }
                    </ul>
                  }
                </div>
              </section>
            }

            <footer class="lg-foot">
              <p>Última actualización: {{ lastUpdated }}</p>
              <div class="lg-foot-links">
                <a [routerLink]="kind() === 'terms' ? '/privacy' : '/terms'">
                  {{ kind() === 'terms' ? 'Ver la política de privacidad' : 'Ver los términos del servicio' }}
                </a>
              </div>
            </footer>
          </article>
        </div>
      </main>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .lg-page {
        min-height: 100vh;
        background: var(--color-bg);
        color: var(--color-text);
      }

      /* Hero */
      .lg-hero {
        background: #fff;
        border-bottom: 1px solid var(--color-border);
        position: relative;
        overflow: hidden;
      }
      .lg-hero::before {
        content: '';
        position: absolute;
        right: -8rem;
        top: -9rem;
        width: 26rem;
        height: 26rem;
        border-radius: 50%;
        background: radial-gradient(
          circle at 35% 35%,
          color-mix(in srgb, var(--color-brand-accent) 26%, transparent),
          transparent 68%
        );
        pointer-events: none;
      }
      .lg-hero-inner {
        position: relative;
        max-width: 64rem;
        margin: 0 auto;
        padding: 1.75rem 1.5rem 2.25rem;
      }
      .lg-brand {
        display: inline-flex;
        align-items: center;
        gap: 0.6rem;
        text-decoration: none;
        color: var(--color-text);
        margin-bottom: 2.5rem;
      }
      .lg-brand-mark {
        width: 2rem;
        height: 2rem;
        border-radius: 0.6rem;
        background: var(--color-brand-accent);
        color: #fff;
        display: grid;
        place-items: center;
        font-family: var(--font-brand);
        font-weight: 700;
      }
      .lg-brand-name {
        font-family: var(--font-brand);
        font-weight: 600;
        font-size: 1.1rem;
        letter-spacing: 0.01em;
      }
      .lg-eyebrow {
        display: block;
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--color-primary);
        margin-bottom: 0.75rem;
      }
      .lg-hero h1 {
        margin: 0;
        max-width: 38rem;
        font-family: var(--font-brand);
        font-size: clamp(1.9rem, 4.6vw, 2.9rem);
        font-weight: 600;
        line-height: 1.12;
        letter-spacing: -0.015em;
      }
      .lg-lead {
        margin: 1rem 0 0;
        max-width: 38rem;
        color: var(--color-text-muted);
        font-size: 1.02rem;
        line-height: 1.65;
      }
      .lg-switch {
        display: inline-flex;
        margin-top: 1.75rem;
        padding: 0.25rem;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 999px;
      }
      .lg-switch a {
        padding: 0.5rem 1.1rem;
        border-radius: 999px;
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--color-text-muted);
        text-decoration: none;
        transition: background 0.18s ease, color 0.18s ease;
      }
      .lg-switch a:hover {
        color: var(--color-text);
      }
      .lg-switch a.on {
        background: var(--color-primary);
        color: #fff;
      }

      /* Stats */
      .lg-main {
        max-width: 64rem;
        margin: 0 auto;
        padding: 0 1.5rem 4rem;
      }
      .lg-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem;
        margin-top: -1.25rem;
        position: relative;
      }
      .lg-stat {
        background: #fff;
        border: 1px solid var(--color-border);
        border-radius: 1rem;
        padding: 1rem 1.15rem;
        box-shadow: 0 6px 20px -14px rgba(28, 25, 23, 0.35);
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }
      .lg-stat strong {
        font-family: var(--font-brand);
        font-size: 1.35rem;
        font-weight: 600;
        color: var(--color-primary);
        line-height: 1.1;
      }
      .lg-stat span {
        font-size: 0.8rem;
        line-height: 1.4;
        color: var(--color-text-muted);
      }

      /* Body */
      .lg-body {
        display: grid;
        grid-template-columns: 15rem minmax(0, 1fr);
        gap: 3rem;
        margin-top: 2.5rem;
        align-items: start;
      }
      .lg-toc {
        position: sticky;
        top: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
      }
      .lg-toc-title {
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        margin-bottom: 0.6rem;
      }
      .lg-toc a {
        display: flex;
        gap: 0.6rem;
        padding: 0.4rem 0 0.4rem 0.75rem;
        border-left: 2px solid var(--color-border);
        font-size: 0.84rem;
        line-height: 1.35;
        color: var(--color-text-muted);
        text-decoration: none;
        transition: color 0.15s ease, border-color 0.15s ease;
      }
      .lg-toc a em {
        font-style: normal;
        font-variant-numeric: tabular-nums;
        color: var(--color-brand-accent);
        font-weight: 600;
      }
      .lg-toc a:hover {
        color: var(--color-text);
        border-left-color: var(--color-primary);
      }

      .lg-article {
        background: #fff;
        border: 1px solid var(--color-border);
        border-radius: 1.25rem;
        padding: 0.5rem 2rem 1.75rem;
      }
      .lg-sec {
        display: grid;
        grid-template-columns: 3rem minmax(0, 1fr);
        gap: 0.5rem;
        padding: 1.75rem 0;
        border-bottom: 1px solid var(--color-border);
        scroll-margin-top: 1rem;
      }
      .lg-num {
        font-family: var(--font-brand);
        font-size: 1.5rem;
        font-weight: 600;
        line-height: 1.2;
        color: color-mix(in srgb, var(--color-brand-accent) 70%, white);
        font-variant-numeric: tabular-nums;
      }
      .lg-sec h2 {
        margin: 0 0 0.6rem;
        font-size: 1.12rem;
        font-weight: 650;
        letter-spacing: -0.005em;
      }
      .lg-sec p {
        margin: 0 0 0.7rem;
        font-size: 0.95rem;
        line-height: 1.7;
        color: #44403c;
      }
      .lg-sec ul {
        list-style: none;
        margin: 0.4rem 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .lg-sec li {
        position: relative;
        padding-left: 1.25rem;
        font-size: 0.93rem;
        line-height: 1.6;
        color: #44403c;
      }
      .lg-sec li::before {
        content: '';
        position: absolute;
        left: 0.1rem;
        top: 0.55em;
        width: 0.4rem;
        height: 0.4rem;
        border-radius: 50%;
        background: var(--color-brand-accent);
      }

      .lg-foot {
        padding-top: 1.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      .lg-foot p {
        margin: 0;
        font-size: 0.8rem;
        color: var(--color-text-muted);
      }
      .lg-foot-links {
        display: flex;
        gap: 1.25rem;
        flex-wrap: wrap;
      }
      .lg-foot-links a {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--color-primary);
        text-decoration: none;
      }
      .lg-foot-links a:hover {
        text-decoration: underline;
        text-underline-offset: 3px;
      }

      @media (max-width: 860px) {
        .lg-body {
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }
        .lg-toc {
          display: none;
        }
      }
      @media (max-width: 600px) {
        .lg-hero-inner {
          padding: 1.25rem 1rem 2rem;
        }
        .lg-brand {
          margin-bottom: 1.75rem;
        }
        .lg-main {
          padding: 0 1rem 3rem;
        }
        .lg-stats {
          grid-template-columns: 1fr;
        }
        .lg-stat {
          flex-direction: row;
          align-items: center;
          gap: 0.9rem;
        }
        .lg-stat strong {
          min-width: 4.5rem;
        }
        .lg-article {
          padding: 0.25rem 1.1rem 1.25rem;
        }
        .lg-sec {
          grid-template-columns: 1fr;
          gap: 0.15rem;
        }
        .lg-switch {
          display: flex;
        }
        .lg-switch a {
          flex: 1;
          text-align: center;
          padding: 0.5rem 0.4rem;
          font-size: 0.8rem;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        * {
          transition: none !important;
        }
      }
    `,
  ],
})
export class LegalDocumentComponent {
  private readonly route = inject(ActivatedRoute);

  readonly lastUpdated = '22 de octubre de 2026';

  readonly kind = toSignal(
    this.route.data.pipe(map((d) => (d['legalDoc'] === 'privacy' ? 'privacy' : 'terms') as LegalDocKind)),
    { initialValue: 'terms' as LegalDocKind },
  );

  doc(): LegalDoc {
    return this.kind() === 'privacy' ? PRIVACY : TERMS;
  }

  pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  jump(ev: Event, n: number): void {
    ev.preventDefault();
    document.getElementById(`sec-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
