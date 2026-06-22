/**
 * Pure transform math for canvas elements (plan 2026-06-22 U1).
 *
 * Resize (8 handles), rotate (with optional 15° snap) and translate, plus group
 * resize, computed as pure functions over the serializable `CanvasElement` model
 * so they are node-testable (tsc/build cannot prove "feels like Excalidraw"; these
 * tests can). Geometry only — the caller bumps `version` on commit. Ported from
 * Excalidraw's documented behavior: corner handles resize both axes (Shift locks
 * aspect about the opposite corner), edge handles resize one axis, rotation snaps
 * to 15° with Shift. Linear elements scale their relative `points` with the box.
 */
import type { CanvasElement } from '../../../chain/core/src/elements.js';
import { isLinear, normalizeLinear, type LinearElement } from '../../../chain/core/src/elements.js';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const MIN_SIZE = 1;
const ROTATE_SNAP = Math.PI / 12; // 15 degrees

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Resize a box by dragging `handle` a pointer delta of (dx, dy). Without
 * `lockAspect`, corner handles move two edges and edge handles move one. With
 * `lockAspect` (corners only) the box scales uniformly about the opposite corner.
 * The opposite edge/corner stays anchored. Sizes clamp to MIN_SIZE.
 */
export function resizeBox(box: Box, handle: ResizeHandle, dx: number, dy: number, lockAspect = false): Box {
  const left = handle.includes('w');
  const right = handle.includes('e');
  const top = handle.includes('n');
  const bottom = handle.includes('s');
  const isCorner = (left || right) && (top || bottom);

  if (lockAspect && isCorner && box.w > 0 && box.h > 0) {
    // Drive the scale off the width delta, derive height to preserve aspect,
    // and anchor at the corner opposite the dragged one.
    const signedDw = right ? dx : -dx;
    const nw = Math.max(MIN_SIZE, box.w + signedDw);
    const scale = nw / box.w;
    const nh = Math.max(MIN_SIZE, box.h * scale);
    const anchorX = left ? box.x + box.w : box.x; // opposite x edge
    const anchorY = top ? box.y + box.h : box.y; // opposite y edge
    const nx = left ? anchorX - nw : anchorX;
    const ny = top ? anchorY - nh : anchorY;
    return { x: nx, y: ny, w: nw, h: nh };
  }

  let { x, y, w, h } = box;
  if (left) {
    x = box.x + dx;
    w = box.w - dx;
  }
  if (right) w = box.w + dx;
  if (top) {
    y = box.y + dy;
    h = box.h - dy;
  }
  if (bottom) h = box.h + dy;

  // Clamp to a minimum, keeping the anchored edge fixed (re-derive the moved edge).
  if (w < MIN_SIZE) {
    if (left) x = box.x + box.w - MIN_SIZE;
    w = MIN_SIZE;
  }
  if (h < MIN_SIZE) {
    if (top) y = box.y + box.h - MIN_SIZE;
    h = MIN_SIZE;
  }
  return { x, y, w, h };
}

/** Scale a linear element's relative points so they fill `newBox` (degenerate axis kept). */
function scaleLinearPoints(el: LinearElement, oldBox: Box, newBox: Box): number[] {
  const sx = oldBox.w !== 0 ? newBox.w / oldBox.w : 1;
  const sy = oldBox.h !== 0 ? newBox.h / oldBox.h : 1;
  const out: number[] = [];
  for (let i = 0; i < el.points.length; i += 2) {
    out.push(el.points[i] * sx, el.points[i + 1] * sy);
  }
  return out;
}

/** Apply a new box to an element, scaling linear points to match. Pure. */
export function applyBox<T extends CanvasElement>(el: T, newBox: Box): T {
  if (isLinear(el)) {
    const oldBox = { x: el.x, y: el.y, w: el.w, h: el.h };
    const points = scaleLinearPoints(el, oldBox, newBox);
    return normalizeLinear({ ...el, ...newBox, points } as LinearElement) as unknown as T;
  }
  return { ...el, ...newBox };
}

/** Resize a single element by dragging `handle` a delta of (dx, dy). Pure. */
export function resizeElement<T extends CanvasElement>(el: T, handle: ResizeHandle, dx: number, dy: number, lockAspect = false): T {
  const box = resizeBox({ x: el.x, y: el.y, w: el.w, h: el.h }, handle, dx, dy, lockAspect);
  return applyBox(el, box);
}

/** Set an element's rotation to `angle` (radians), snapping to 15° when `snap`. Pure. */
export function rotateElement<T extends CanvasElement>(el: T, angle: number, snap = false): T {
  let a = snap ? Math.round(angle / ROTATE_SNAP) * ROTATE_SNAP : angle;
  a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return { ...el, angle: a };
}

/** Move an element by (dx, dy). Pure. */
export function translateElement<T extends CanvasElement>(el: T, dx: number, dy: number): T {
  return { ...el, x: el.x + dx, y: el.y + dy };
}

/** Centre of an element's box (the rotation pivot). */
export function elementCenter(el: CanvasElement): { cx: number; cy: number } {
  return { cx: el.x + el.w / 2, cy: el.y + el.h / 2 };
}

/**
 * Resize a multi-selection as a unit: the group's common bounds resize by the
 * handle drag, and every member keeps its relative position and scales with the
 * group. Pure.
 */
export function resizeMultiple(els: CanvasElement[], handle: ResizeHandle, dx: number, dy: number, lockAspect = false): CanvasElement[] {
  if (els.length === 0) return els;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of els) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  }
  const gb: Box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const ngb = resizeBox(gb, handle, dx, dy, lockAspect);
  const sx = gb.w !== 0 ? ngb.w / gb.w : 1;
  const sy = gb.h !== 0 ? ngb.h / gb.h : 1;
  return els.map((el) => {
    const box: Box = {
      x: ngb.x + (el.x - gb.x) * sx,
      y: ngb.y + (el.y - gb.y) * sy,
      w: el.w * sx,
      h: el.h * sy,
    };
    return applyBox(el, box);
  });
}
