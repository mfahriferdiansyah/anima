/**
 * Pure document operations over the element list (plan 2026-06-22 U6).
 *
 * The select/drag/delete/z-order/duplicate orchestration that Canvas.tsx dispatches,
 * factored as pure functions so the behavior (a bound arrow follows a moved note; a
 * deleted target leaves its arrows floating; z-order reindexes correctly) is
 * node-tested rather than only eyeballed. Composes the U1/U3 cores. Single-user
 * delete REMOVES (the persisted scene stays clean); live collab uses tombstones via
 * the U4 reconcile path instead.
 */
import type { CanvasElement } from '../../../chain/core/src/elements.js';
import { newElementId, newVersionNonce } from '../../../chain/core/src/elements.js';
import { translateElement } from './transform';
import { updateBoundEndpoints, dropBindingsTo, type BindableLinear } from './linear';

function isBindableLinear(el: CanvasElement): el is BindableLinear {
  return el.type === 'arrow' || el.type === 'line';
}

/** Append an element on top (highest z-index). Pure. */
export function addElement(elements: CanvasElement[], el: CanvasElement): CanvasElement[] {
  const topIndex = elements.reduce((m, e) => Math.max(m, e.index), -1) + 1;
  return [...elements, { ...el, index: topIndex }];
}

/**
 * Translate the selected elements by (dx, dy); any arrow bound to a moved target
 * re-routes to follow it. Selected arrows move as a unit (their bindings are not
 * recomputed). Pure.
 */
export function moveElements(elements: CanvasElement[], ids: Iterable<string>, dx: number, dy: number): CanvasElement[] {
  const sel = new Set(ids);
  const moved = elements.map((el) => (sel.has(el.id) ? translateElement(el, dx, dy) : el));
  const byId = new Map(moved.map((e) => [e.id, e]));
  return moved.map((el) => (isBindableLinear(el) && !sel.has(el.id) ? updateBoundEndpoints(el, byId) : el));
}

/** Remove the selected elements and drop any arrow bindings that referenced them. Pure. */
export function deleteElements(elements: CanvasElement[], ids: Iterable<string>): CanvasElement[] {
  const sel = new Set(ids);
  let next = elements.filter((el) => !sel.has(el.id));
  for (const id of sel) {
    next = next.map((el) => (isBindableLinear(el) ? dropBindingsTo(el, id) : el));
  }
  return next;
}

/** Duplicate the selected elements (new ids, offset). Returns the list and the new ids. Pure. */
export function duplicateElements(
  elements: CanvasElement[],
  ids: Iterable<string>,
  dx = 12,
  dy = 12,
): { elements: CanvasElement[]; newIds: string[] } {
  const sel = new Set(ids);
  let topIndex = elements.reduce((m, e) => Math.max(m, e.index), -1);
  const clones: CanvasElement[] = [];
  const newIds: string[] = [];
  for (const el of elements) {
    if (!sel.has(el.id)) continue;
    const id = newElementId();
    newIds.push(id);
    topIndex += 1;
    // A clone of a bound arrow drops its bindings (it is not attached to anything yet).
    const { startBinding: _s, endBinding: _e, ...rest } = el as BindableLinear & CanvasElement;
    clones.push({ ...(rest as CanvasElement), id, index: topIndex, version: 1, versionNonce: newVersionNonce(), x: el.x + dx, y: el.y + dy });
  }
  return { elements: [...elements, ...clones], newIds };
}

export type ReorderOp = 'front' | 'back' | 'forward' | 'backward';

function shiftByOne(order: CanvasElement[], sel: Set<string>, dir: 1 | -1): CanvasElement[] {
  const a = order.slice();
  if (dir > 0) {
    for (let i = a.length - 2; i >= 0; i--) {
      if (sel.has(a[i].id) && !sel.has(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]];
    }
  } else {
    for (let i = 1; i < a.length; i++) {
      if (sel.has(a[i].id) && !sel.has(a[i - 1].id)) [a[i], a[i - 1]] = [a[i - 1], a[i]];
    }
  }
  return a;
}

/** Re-stack the selected elements (z-order) and re-assign contiguous indices. Pure. */
export function reorder(elements: CanvasElement[], ids: Iterable<string>, op: ReorderOp): CanvasElement[] {
  const sel = new Set(ids);
  const sorted = [...elements].sort((a, b) => a.index - b.index);
  const selected = sorted.filter((e) => sel.has(e.id));
  const rest = sorted.filter((e) => !sel.has(e.id));
  let ordered: CanvasElement[];
  if (op === 'front') ordered = [...rest, ...selected];
  else if (op === 'back') ordered = [...selected, ...rest];
  else ordered = shiftByOne(sorted, sel, op === 'forward' ? 1 : -1);
  const indexById = new Map(ordered.map((e, i) => [e.id, i]));
  return elements.map((el) => ({ ...el, index: indexById.get(el.id)! }));
}
