/**
 * Pure hit-testing + marquee selection for canvas elements (plan 2026-06-22 U2).
 *
 * `hitElement` answers "is this world point on this element?" (rotation-aware:
 * the point is mapped into the element's un-rotated local frame, then tested per
 * type — filled box for rect/note/text/image, ellipse equation, stroke proximity
 * for linear/freehand). `marqueeSelect` returns the elements FULLY contained by a
 * rubber-band rectangle (Excalidraw's full-containment rule — a clipped element is
 * excluded). Pure and node-testable.
 */
import type { CanvasElement } from '../../../chain/core/src/elements.js';
import { isLinear } from '../../../chain/core/src/elements.js';

/** Click tolerance (world px) for thin elements (arrows, lines, freehand, text). */
export const HIT_THRESHOLD = 8;

interface Point {
  x: number;
  y: number;
}

/** Map a world point into an element's un-rotated local frame (rotation is about the box centre). */
function toLocal(p: Point, el: CanvasElement): Point {
  if (el.angle === 0) return p;
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const cos = Math.cos(-el.angle);
  const sin = Math.sin(-el.angle);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  const projx = a.x + t * vx;
  const projy = a.y + t * vy;
  return Math.hypot(p.x - projx, p.y - projy);
}

/** True if the world point hits the element. */
export function hitElement(point: Point, el: CanvasElement): boolean {
  if (el.isDeleted) return false;
  const p = toLocal(point, el);

  if (isLinear(el)) {
    // Polyline in the element's local frame: absolute-unrotated = (x+px, y+py).
    const pts = el.points;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const a = { x: el.x + pts[i], y: el.y + pts[i + 1] };
      const b = { x: el.x + pts[i + 2], y: el.y + pts[i + 3] };
      if (distToSegment(p, a, b) <= HIT_THRESHOLD) return true;
    }
    // A zero-length / single-point linear: treat as a point hit.
    if (pts.length >= 2 && pts.length < 4) {
      return Math.hypot(p.x - (el.x + pts[0]), p.y - (el.y + pts[1])) <= HIT_THRESHOLD;
    }
    return false;
  }

  if (el.type === 'ellipse') {
    const rx = el.w / 2;
    const ry = el.h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (p.x - (el.x + rx)) / rx;
    const ny = (p.y - (el.y + ry)) / ry;
    return nx * nx + ny * ny <= 1;
  }

  // rect / note / image / text — filled box (text gets a small pad so thin labels are clickable).
  const pad = el.type === 'text' ? HIT_THRESHOLD : 0;
  return p.x >= el.x - pad && p.x <= el.x + el.w + pad && p.y >= el.y - pad && p.y <= el.y + el.h + pad;
}

/** The topmost element hit by a point (highest `index` wins), or null. */
export function hitTopElement(point: Point, elements: CanvasElement[]): CanvasElement | null {
  let best: CanvasElement | null = null;
  for (const el of elements) {
    if (hitElement(point, el) && (best === null || el.index > best.index)) best = el;
  }
  return best;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True if the element's (un-rotated) bounds lie entirely within the rect. */
export function fullyContained(el: CanvasElement, rect: Rect): boolean {
  return el.x >= rect.x && el.y >= rect.y && el.x + el.w <= rect.x + rect.w && el.y + el.h <= rect.y + rect.h;
}

/** Marquee select: every element fully contained by `rect` (clipped elements excluded). */
export function marqueeSelect(rect: Rect, elements: CanvasElement[]): CanvasElement[] {
  // Normalize a rect drawn in any direction.
  const norm: Rect = {
    x: Math.min(rect.x, rect.x + rect.w),
    y: Math.min(rect.y, rect.y + rect.h),
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  };
  return elements.filter((el) => !el.isDeleted && fullyContained(el, norm));
}
