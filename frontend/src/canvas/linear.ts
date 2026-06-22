/**
 * Pure linear-element editing + arrow binding (plan 2026-06-22 U3).
 *
 * Reshape arrows/lines after placement: move an endpoint (the tip), insert/drag a
 * midpoint to bend, delete a point (min two). Bindings attach an endpoint to a
 * target element via a `fixedPoint` normalized to [0,1] of the target's bounds,
 * so the endpoint follows when the target moves/resizes/rotates. Ported from
 * Excalidraw: `points` are RELATIVE to `x,y` (first point re-anchored to [0,0]),
 * fixedPoint normalize/denormalize against target bounds. Pure + node-testable.
 */
import type { CanvasElement, LinearElement, ElementBinding } from '../../../chain/core/src/elements.js';
import { normalizeLinear } from '../../../chain/core/src/elements.js';

/** Arrows and lines carry bindings (freehand `draw` does not). */
export type BindableLinear = Extract<CanvasElement, { type: 'arrow' | 'line' }>;

interface Point {
  x: number;
  y: number;
}
interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** World coordinate of the start (`'start'`) or last (`'end'`) point. */
export function endpointWorld(el: LinearElement, which: 'start' | 'end'): Point {
  const pts = el.points;
  const i = which === 'start' ? 0 : pts.length - 2;
  return { x: el.x + pts[i], y: el.y + pts[i + 1] };
}

/** Move an endpoint to a world point (lengthens/shortens/re-aims). Re-normalizes. Pure. */
export function moveEndpoint<T extends LinearElement>(el: T, which: 'start' | 'end', to: Point): T {
  const pts = el.points.slice();
  const i = which === 'start' ? 0 : pts.length - 2;
  pts[i] = to.x - el.x;
  pts[i + 1] = to.y - el.y;
  return normalizeLinear({ ...el, points: pts });
}

/** Insert a new point after segment `segIndex` (between point segIndex and segIndex+1). Pure. */
export function insertMidpoint<T extends LinearElement>(el: T, segIndex: number, at: Point): T {
  const pts = el.points.slice();
  pts.splice((segIndex + 1) * 2, 0, at.x - el.x, at.y - el.y);
  return normalizeLinear({ ...el, points: pts });
}

/** Move an existing interior/edge point by index. Pure. */
export function movePoint<T extends LinearElement>(el: T, pointIndex: number, to: Point): T {
  const pts = el.points.slice();
  pts[pointIndex * 2] = to.x - el.x;
  pts[pointIndex * 2 + 1] = to.y - el.y;
  return normalizeLinear({ ...el, points: pts });
}

/** Delete a point; a linear element keeps a minimum of two points (no-op below that). Pure. */
export function deletePoint<T extends LinearElement>(el: T, pointIndex: number): T {
  if (el.points.length / 2 <= 2) return el;
  const pts = el.points.slice();
  pts.splice(pointIndex * 2, 2);
  return normalizeLinear({ ...el, points: pts });
}

/** Normalize a world point to [0,1] of a target's bounds ([0,0]=top-left, [1,1]=bottom-right). */
export function normalizeFixedPoint(world: Point, b: Bounds): [number, number] {
  return [b.w === 0 ? 0.5 : (world.x - b.x) / b.w, b.h === 0 ? 0.5 : (world.y - b.y) / b.h];
}

/** Inverse of `normalizeFixedPoint`: a world point from a fixedPoint + current bounds. */
export function denormalizeFixedPoint(fp: [number, number], b: Bounds): Point {
  return { x: b.x + fp[0] * b.w, y: b.y + fp[1] * b.h };
}

function bounds(el: CanvasElement): Bounds {
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

/** Attach an endpoint to a target element, recording the fixedPoint of the current tip. Pure. */
export function bindEndpoint<T extends BindableLinear>(el: T, which: 'start' | 'end', target: CanvasElement): T {
  const fp = normalizeFixedPoint(endpointWorld(el, which), bounds(target));
  const binding: ElementBinding = { elementId: target.id, fixedPoint: fp };
  return which === 'start' ? { ...el, startBinding: binding } : { ...el, endBinding: binding };
}

/** Remove a binding from an endpoint. Pure. */
export function breakBinding<T extends BindableLinear>(el: T, which: 'start' | 'end'): T {
  if (which === 'start') {
    const { startBinding: _drop, ...rest } = el;
    return rest as T;
  }
  const { endBinding: _drop, ...rest } = el;
  return rest as T;
}

/**
 * Re-position any bound endpoints from their bindings + the current target bounds
 * (call when a target moved/resized/rotated). Bindings whose target is gone are
 * left as-is (the endpoint floats at its last position). Pure.
 */
export function updateBoundEndpoints<T extends BindableLinear>(el: T, targetById: Map<string, CanvasElement>): T {
  let next: T = el;
  if (next.startBinding) {
    const t = targetById.get(next.startBinding.elementId);
    if (t) next = moveEndpoint(next, 'start', denormalizeFixedPoint(next.startBinding.fixedPoint, bounds(t)));
  }
  if (next.endBinding) {
    const t = targetById.get(next.endBinding.elementId);
    if (t) next = moveEndpoint(next, 'end', denormalizeFixedPoint(next.endBinding.fixedPoint, bounds(t)));
  }
  return next;
}

/**
 * When a target element is deleted, drop bindings that reference it so the arrow
 * floats instead of snapping to a stale point. Pure.
 */
export function dropBindingsTo<T extends BindableLinear>(el: T, deletedId: string): T {
  let next: T = el;
  if (next.startBinding?.elementId === deletedId) next = breakBinding(next, 'start');
  if (next.endBinding?.elementId === deletedId) next = breakBinding(next, 'end');
  return next;
}
