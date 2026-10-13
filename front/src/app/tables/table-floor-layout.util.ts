/** Default floor-plan canvas size (matches tables-canvas.component). */
export const FLOOR_CANVAS_WIDTH = 1200;
export const FLOOR_CANVAS_HEIGHT = 800;

export interface FloorTableLayout {
  x_position?: number | null;
  y_position?: number | null;
  width?: number | null;
  height?: number | null;
  shape?: string | null;
}

const OVERLAP_EPS = 1e-6;
const PLACEMENT_PAD = 24;
const CANVAS_EDGE = 50;

export function tableCenter(t: FloorTableLayout): { x: number; y: number } {
  return { x: t.x_position ?? 0, y: t.y_position ?? 0 };
}

/** Axis-aligned bounds in floor SVG coordinates; center is x_position/y_position. */
export function tableCanvasBounds(t: FloorTableLayout): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
  cy: number;
} {
  const w = t.width ?? 100;
  const h = t.height ?? 70;
  const { x: cx, y: cy } = tableCenter(t);
  return {
    left: cx - w / 2,
    right: cx + w / 2,
    top: cy - h / 2,
    bottom: cy + h / 2,
    cx,
    cy,
  };
}

function isRectLikeTableShape(shape: string | null | undefined): boolean {
  if (!shape) return true;
  return shape === 'rectangle' || shape === 'booth' || shape === 'bar';
}

function isEllipseTableShape(shape: string | null | undefined): boolean {
  return shape === 'circle' || shape === 'oval';
}

function aabbStrictPositiveOverlap(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number }
): boolean {
  const iw = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const ih = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return iw > OVERLAP_EPS && ih > OVERLAP_EPS;
}

function axisAlignedEllipsesOverlapPositive(
  ba: { cx: number; cy: number },
  bb: { cx: number; cy: number },
  ta: FloorTableLayout,
  tb: FloorTableLayout
): boolean {
  const wa = ta.width ?? 100;
  const ha = ta.height ?? 70;
  const wb = tb.width ?? 100;
  const hb = tb.height ?? 70;
  const rxSum = wa / 2 + wb / 2;
  const rySum = ha / 2 + hb / 2;
  if (rxSum <= 0 || rySum <= 0) return false;
  const dx = ba.cx - bb.cx;
  const dy = ba.cy - bb.cy;
  const metric = (dx / rxSum) * (dx / rxSum) + (dy / rySum) * (dy / rySum);
  return metric < 1 - OVERLAP_EPS;
}

/** True when two table footprints overlap on the floor plan (layout / join geometry). */
export function tablesFootprintsOverlap(a: FloorTableLayout, b: FloorTableLayout): boolean {
  const ba = tableCanvasBounds(a);
  const bb = tableCanvasBounds(b);
  const sa = a.shape;
  const sb = b.shape;
  if (isRectLikeTableShape(sa) && isRectLikeTableShape(sb)) {
    return aabbStrictPositiveOverlap(ba, bb);
  }
  if (isEllipseTableShape(sa) && isEllipseTableShape(sb)) {
    return axisAlignedEllipsesOverlapPositive(ba, bb, a, b);
  }
  return aabbStrictPositiveOverlap(ba, bb);
}

/**
 * Grid search for a center position that does not overlap existing tables on the floor.
 */
export function findNonOverlappingDefaultPosition(
  existing: FloorTableLayout[],
  width: number,
  height: number,
  shape: string = 'rectangle',
  canvasWidth: number = FLOOR_CANVAS_WIDTH,
  canvasHeight: number = FLOOR_CANVAS_HEIGHT
): { x: number; y: number } {
  const candidate: FloorTableLayout = { width, height, shape };
  const cellW = width + PLACEMENT_PAD;
  const cellH = height + PLACEMENT_PAD;
  const maxCx = canvasWidth - CANVAS_EDGE;
  const maxCy = canvasHeight - CANVAS_EDGE;

  for (let row = 0; row < 24; row++) {
    for (let col = 0; col < 24; col++) {
      const cx = CANVAS_EDGE + col * cellW;
      const cy = CANVAS_EDGE + row * cellH;
      if (cx > maxCx || cy > maxCy) continue;
      candidate.x_position = cx;
      candidate.y_position = cy;
      const overlaps = existing.some(t => tablesFootprintsOverlap(candidate, t));
      if (!overlaps) return { x: cx, y: cy };
    }
  }

  const n = existing.length;
  return {
    x: Math.min(maxCx, CANVAS_EDGE + (n % 10) * cellW),
    y: Math.min(maxCy, CANVAS_EDGE + Math.floor(n / 10) * cellH),
  };
}
