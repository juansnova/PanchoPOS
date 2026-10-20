/**
 * Decoration for the A4 invoice: soft orange blobs that bleed off the page and engraved-style
 * line drawings (cutlery, herbs, chili, garlic...). Plain SVG strings, positioned in mm by CSS.
 */

const LINE = '#8d8672';
const SOFT = '#b9b19c';
const PAPER = '#fbf6ec';
const BLOB_LIGHT = '#f8e4c6';
const BLOB_DEEP = '#f5d3a0';

const f = (n: number) => Math.round(n * 100) / 100;

/** Closed wobbly outline (leaf, pepper ring...) as an SVG path. */
function wobble(cx: number, cy: number, rx: number, ry: number, rot: number, amp: number, lobes: number, steps = 90): string {
  const pts: string[] = [];
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const k = 1 + amp * Math.sin(lobes * t);
    const x = rx * k * Math.cos(t);
    const y = ry * k * Math.sin(t);
    pts.push(`${f(cx + x * cr - y * sr)} ${f(cy + x * sr + y * cr)}`);
  }
  return 'M' + pts.join('L') + 'Z';
}

/** Feathery dill/fennel sprig: a curved stem with fine hair-like branches. */
function dill(): string {
  const parts: string[] = [];
  const stem = (t: number) => {
    // quadratic bezier P0(0,115) P1(60,95) P2(165,15)
    const x = (1 - t) ** 2 * 0 + 2 * (1 - t) * t * 60 + t * t * 165;
    const y = (1 - t) ** 2 * 115 + 2 * (1 - t) * t * 95 + t * t * 15;
    const dx = 2 * (1 - t) * 60 + 2 * t * (165 - 60);
    const dy = 2 * (1 - t) * (95 - 115) + 2 * t * (15 - 95);
    return { x, y, a: Math.atan2(dy, dx) };
  };
  parts.push('<path d="M0 115Q60 95 165 15"/>');
  for (let i = 1; i <= 11; i++) {
    const { x, y, a } = stem(i / 12);
    for (const side of [-1, 1]) {
      const ang = a + side * (0.95 - i * 0.02);
      const len = 30 - i * 1.6;
      const ex = x + Math.cos(ang) * len;
      const ey = y + Math.sin(ang) * len;
      parts.push(`<path d="M${f(x)} ${f(y)}L${f(ex)} ${f(ey)}"/>`);
      for (let h = 1; h <= 5; h++) {
        const bx = x + Math.cos(ang) * len * (h / 5.5);
        const by = y + Math.sin(ang) * len * (h / 5.5);
        const hl = 7 - h * 0.7;
        for (const hs of [-1, 1]) {
          const ha = ang + hs * 0.7;
          parts.push(`<path d="M${f(bx)} ${f(by)}L${f(bx + Math.cos(ha) * hl)} ${f(by + Math.sin(ha) * hl)}"/>`);
        }
      }
    }
  }
  return parts.join('');
}

/** Serrated parsley-like leaflet at (cx,cy). */
function leaflet(cx: number, cy: number, size: number, rot: number): string {
  return `<path d="${wobble(cx, cy, size, size * 0.72, rot, 0.14, 7)}"/><path d="M${f(cx - Math.cos(rot) * size * 0.7)} ${f(cy - Math.sin(rot) * size * 0.7)}L${f(cx + Math.cos(rot) * size * 0.8)} ${f(cy + Math.sin(rot) * size * 0.8)}" stroke="${SOFT}"/>`;
}

function hatch(x: number, y: number, n: number, dx: number, dy: number, len: number, lx: number, ly: number): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    d += `M${f(x + dx * i)} ${f(y + dy * i)}l${lx} ${ly}`;
  }
  return `<path d="${d}" stroke="${SOFT}" stroke-width=".8"/>`;
}

const SPOON = `
<svg class="deco spoon" viewBox="-10 -4 170 340" overflow="visible" aria-hidden="true">
  <defs><clipPath id="spoonBowl"><ellipse cx="75" cy="70" rx="40" ry="55"/></clipPath></defs>
  <path d="M75 8C112 8 126 40 126 72C126 108 102 134 88 138C86 190 88 262 86 316Q75 332 64 316C62 262 64 190 62 138C48 134 24 108 24 72C24 40 38 8 75 8Z" fill="${PAPER}"/>
  <ellipse cx="75" cy="70" rx="40" ry="55" fill="none"/>
  <path d="M52 52C46 74 52 100 66 116" stroke="#fff" stroke-width="5" opacity=".9"/>
  <path d="M52 52C46 74 52 100 66 116" stroke="${SOFT}" stroke-width=".8"/>
  <g clip-path="url(#spoonBowl)" stroke="${SOFT}" stroke-width=".8">${hatch(88, 30, 16, 3, 7, 0, 18, 14)}</g>
  <path d="M75 140C73 190 74 262 73 312" stroke="${SOFT}" stroke-width=".9"/>
  ${hatch(80, 150, 12, 0.6, 12, 0, 5, 7)}
  <path d="M84 146C85 200 85 262 84 312" stroke="${SOFT}" stroke-width=".8"/>
</svg>`;

const FORK = `
<svg class="deco fork" viewBox="-10 -4 150 340" overflow="visible" aria-hidden="true">
  <path d="M28 100V24a8 8 0 0 1 16 0V88a4 4 0 0 0 8 0V24a8 8 0 0 1 16 0V88a4 4 0 0 0 8 0V24a8 8 0 0 1 16 0V88a4 4 0 0 0 8 0V24a8 8 0 0 1 16 0V100C116 124 98 126 92 142C90 162 88 224 88 316Q72 332 56 316C56 224 54 162 52 142C46 126 28 124 28 100Z" fill="${PAPER}"/>
  <path d="M36 30V82M60 30V82M84 30V82M108 30V82" stroke="#fff" stroke-width="4" opacity=".9"/>
  <path d="M36 30V82M60 30V82M84 30V82M108 30V82" stroke="${SOFT}" stroke-width=".8"/>
  ${hatch(41, 34, 7, 0, 8, 0, 2, 5)}${hatch(65, 34, 7, 0, 8, 0, 2, 5)}${hatch(89, 34, 7, 0, 8, 0, 2, 5)}${hatch(113, 34, 7, 0, 8, 0, 2, 5)}
  <path d="M60 128C62 150 64 224 64 312" stroke="#fff" stroke-width="4" opacity=".9"/>
  <path d="M72 150C72 200 72 262 72 314" stroke="${SOFT}" stroke-width=".9"/>
  ${hatch(78, 152, 12, 0.5, 12, 0, 5, 7)}
</svg>`;

const STALKS = `
<svg class="deco stalks" viewBox="-6 0 100 130" overflow="visible" aria-hidden="true">
  <g transform="rotate(-14 20 60)">
    <path d="M4 14L8 114Q20 124 32 114L36 14Z" fill="${PAPER}"/><ellipse cx="20" cy="14" rx="16" ry="8" fill="${PAPER}"/>
    <ellipse cx="20" cy="14" rx="9" ry="4.5"/><path d="M14 12l12 3M16 16l8-4" stroke="${SOFT}" stroke-width=".8"/>
    <path d="M12 26L14 108M20 24V112M28 26L27 108" stroke="${SOFT}" stroke-width=".8"/>
  </g>
  <g transform="translate(52 6) rotate(10 20 60)">
    <path d="M4 14L8 114Q20 124 32 114L36 14Z" fill="${PAPER}"/><ellipse cx="20" cy="14" rx="16" ry="8" fill="${PAPER}"/>
    <ellipse cx="20" cy="14" rx="9" ry="4.5"/><path d="M14 12l12 3M16 16l8-4" stroke="${SOFT}" stroke-width=".8"/>
    <path d="M12 26L14 108M20 24V112M28 26L27 108" stroke="${SOFT}" stroke-width=".8"/>
  </g>
</svg>`;

const PEA = `
<svg class="deco pea" viewBox="0 0 20 20" aria-hidden="true">
  <ellipse cx="10" cy="10" rx="8" ry="7.5" fill="${PAPER}"/><path d="M6 8C7 5.5 10 5 12 6" stroke="${SOFT}" stroke-width=".9"/>
</svg>`;

const DILL = `<svg class="deco dill" viewBox="-4 -4 176 126" overflow="visible" fill="none" stroke="${LINE}" stroke-width=".9" stroke-linecap="round" aria-hidden="true">${dill()}</svg>`;

const PARSLEY = `
<svg class="deco parsley" viewBox="-10 -10 150 170" overflow="visible" fill="none" stroke="${LINE}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M30 150C36 110 52 70 78 30"/><path d="M52 92C70 86 86 92 100 104M44 112C28 104 14 106 4 116M64 66C54 52 52 36 56 20"/>
  ${leaflet(94, 24, 24, 0.4)}${leaflet(110, 108, 20, 0.2)}${leaflet(0, 118, 18, -0.5)}${leaflet(56, 12, 18, -1.2)}${leaflet(24, 62, 17, 2.4)}${leaflet(100, 66, 16, 0.9)}
</svg>`;

const LEAF = `
<svg class="deco leaf" viewBox="-4 -4 100 80" overflow="visible" fill="${PAPER}" stroke="${LINE}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2 62C6 20 46 0 88 6C84 44 50 70 2 62Z"/>
  <path d="M2 62C26 44 52 28 80 12" fill="none"/><path d="M20 52C26 40 28 30 26 22M36 44C44 34 48 24 46 14M52 34C60 28 66 20 68 12M14 54C22 54 32 52 38 50M30 46C38 46 48 42 54 40" fill="none" stroke="${SOFT}" stroke-width=".9"/>
</svg>`;

const PEPPER = `
<svg class="deco pepper" viewBox="-4 -4 84 84" overflow="visible" fill="${PAPER}" stroke="${LINE}" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true">
  <path d="${wobble(38, 38, 34, 32, 0.3, 0.07, 5)}"/><path d="${wobble(38, 38, 27, 25, 0.3, 0.07, 5)}" fill="none"/>
  <path d="M26 22C32 14 44 14 52 22M20 38C20 30 22 28 26 24M56 30C60 38 58 48 52 54M30 56C38 60 46 60 52 54" fill="none" stroke="${SOFT}" stroke-width=".9"/>
  <ellipse cx="40" cy="36" rx="4" ry="2.4" fill="none" stroke="${SOFT}" transform="rotate(30 40 36)"/><ellipse cx="32" cy="44" rx="3.4" ry="2" fill="none" stroke="${SOFT}"/>
</svg>`;

const CHILI = `
<svg class="deco chili" viewBox="0 0 100 150" fill="${PAPER}" stroke="${LINE}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M62 24C78 26 86 40 80 58C70 92 50 124 22 142C10 148 6 138 14 128C34 104 42 70 46 44C48 32 54 26 62 24Z"/>
  <path d="M62 24C58 14 64 6 74 6C72 12 74 18 80 20" fill="none"/>
  <path d="M60 38C58 66 44 108 20 134" fill="none" stroke="#fff" stroke-width="5" opacity=".9"/>
  <path d="M60 38C58 66 44 108 20 134" fill="none" stroke="${SOFT}" stroke-width=".8"/>
  ${hatch(70, 46, 9, -3.2, 8, 0, -4, 8)}
</svg>`;

const GARLIC = `
<svg class="deco garlic" viewBox="0 0 70 80" fill="${PAPER}" stroke="${LINE}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M34 6C40 18 62 28 62 50C62 68 48 76 34 76C20 76 6 68 6 50C6 28 28 18 34 6Z"/>
  <path d="M34 8C26 26 22 52 34 76M34 8C44 26 48 52 34 76M20 24C12 38 12 56 24 72M48 24C56 38 56 56 44 72" fill="none" stroke="${SOFT}" stroke-width=".9"/>
</svg>`;

const BLOBS = `
<svg class="deco blob blob-top" viewBox="0 0 300 220" overflow="visible" aria-hidden="true">
  <path d="M70 -30C40 30 70 118 150 138C210 152 262 124 340 160L340 -30Z" fill="${BLOB_LIGHT}"/>
  <path d="M160 -30C150 20 188 70 240 78C282 84 312 74 340 90L340 -30Z" fill="${BLOB_DEEP}" opacity=".55"/>
</svg>
<svg class="deco blob blob-bottom" viewBox="0 0 320 300" overflow="visible" aria-hidden="true">
  <path d="M-30 110C30 56 120 86 158 144C198 206 262 206 312 306L-30 306Z" fill="${BLOB_LIGHT}"/>
  <path d="M-30 190C20 150 80 168 108 214C130 250 150 270 176 306L-30 306Z" fill="${BLOB_DEEP}" opacity=".55"/>
</svg>`;

export const DECOR_HTML = `${BLOBS}${PARSLEY}${LEAF}${PEPPER}${GARLIC}${CHILI}${SPOON}${FORK}${STALKS}${PEA}${DILL}`;

/** Positions in mm on the A4 page (the page clips whatever bleeds off its edges). */
export const DECOR_CSS = `
.deco { position: absolute; pointer-events: none; overflow: visible; }
.deco path, .deco ellipse { vector-effect: non-scaling-stroke; }
.spoon, .fork, .stalks, .pea, .chili, .garlic, .pepper, .leaf, .parsley { fill: none; }
.spoon, .fork { stroke: ${LINE}; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
.stalks { stroke: ${LINE}; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; }
.pea { stroke: ${LINE}; stroke-width: 1.2; }
.blob-top { top: 0; right: 0; width: 118mm; }
.blob-bottom { bottom: 0; left: 0; width: 104mm; }
.parsley { top: 4mm; left: 92mm; width: 34mm; }
.leaf { top: 92mm; left: 80mm; width: 24mm; transform: rotate(8deg); }
.pepper { top: 82mm; left: -14mm; width: 32mm; }
.garlic { top: 46mm; right: 12mm; width: 15mm; transform: rotate(14deg); }
.chili { bottom: 12mm; left: 14mm; width: 22mm; transform: rotate(-4deg); }
.spoon { bottom: -14mm; right: 84mm; width: 28mm; transform: rotate(18deg); transform-origin: 50% 100%; }
.fork { bottom: -16mm; right: 52mm; width: 26mm; transform: rotate(22deg); transform-origin: 50% 100%; }
.stalks { bottom: 3mm; right: 10mm; width: 21mm; }
.pea { bottom: 8mm; right: 35mm; width: 5mm; }
.dill { bottom: 40mm; right: -6mm; width: 40mm; }
`;
