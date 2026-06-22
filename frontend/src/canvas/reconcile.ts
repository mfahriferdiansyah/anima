/**
 * Pure element reconciliation for live multiplayer (plan 2026-06-22 U4).
 *
 * Deterministic merge so every peer converges on a dumb relay (no server logic):
 * the higher `version` wins; on a tie the LOWER `versionNonce` wins (NOT a
 * timestamp — ported from Excalidraw, this is the subtle correctness point).
 * Tombstones (`isDeleted`) ride the same rule, so a delete with a higher version
 * is not resurrected by a stale concurrent edit. Symmetric in its arguments, so
 * peer A reconciling B and peer B reconciling A reach the same element. Pure.
 */
import type { CanvasElement } from '../../../chain/core/src/elements.js';

/** Pick the winner between two versions of the same element id. */
export function reconcileElement(a: CanvasElement, b: CanvasElement): CanvasElement {
  if (a.version !== b.version) return a.version > b.version ? a : b;
  // Equal version → lower nonce wins (deterministic across peers). Exact tie → a.
  return a.versionNonce <= b.versionNonce ? a : b;
}

/**
 * Merge a remote element list into the local one by id. Unseen remote elements are
 * added; conflicting ids resolve via `reconcileElement`. Returns a new list; the
 * input order is preserved for locals, remotes-only appended in their order.
 */
export function reconcile(local: CanvasElement[], remote: CanvasElement[]): CanvasElement[] {
  const byId = new Map<string, CanvasElement>();
  const order: string[] = [];
  for (const el of local) {
    byId.set(el.id, el);
    order.push(el.id);
  }
  for (const el of remote) {
    const existing = byId.get(el.id);
    if (existing) {
      byId.set(el.id, reconcileElement(existing, el));
    } else {
      byId.set(el.id, el);
      order.push(el.id);
    }
  }
  return order.map((id) => byId.get(id)!);
}

/** Drop tombstoned elements (for rendering); persistence keeps them for collab safety. */
export function liveElements(elements: CanvasElement[]): CanvasElement[] {
  return elements.filter((el) => !el.isDeleted);
}
