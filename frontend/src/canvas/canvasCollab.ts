/**
 * Canvas live co-edit core (plan 2026-06-24 U6) — the pure broadcast/apply logic
 * shared by the in-app board (`pages/Canvas.tsx`, owner) and the guest board
 * (`reader/CanvasEdit.tsx`, U13). Connects the already-built version+nonce
 * `reconcile` core to the wire: a local element edit becomes an `el-op`; an
 * inbound `el-op` is sanitized then reconciled into the live element list.
 *
 * Pure + injected I/O (a `send` and a `getElements`/`setElements` pair) so it is
 * node-testable without a board, a socket, or a wallet. The security chokepoint
 * (`sanitizeElement`) runs on EVERY inbound op before it touches the element list,
 * the canvas counterpart of the note path's `sanitizeNoteHtml`.
 */
import type { CanvasElement } from '../../../chain/core/src/elements.js';
import type { PresenceMsg } from '../../../chain/core/src/index.js';
import { reconcile } from './reconcile';
import { elOp, sanitizeElement } from '../web3/collabOps';

export interface CanvasCollabOpts {
  selfId: string;
  canvasId: string;
  send: (msg: PresenceMsg) => void;
  /** Read the current live element list (the board's elements ref). */
  getElements: () => CanvasElement[];
  /** Apply a reconciled element list back to the board (a React setState, etc.). */
  setElements: (next: CanvasElement[]) => void;
}

export interface CanvasCollab {
  /** Broadcast one locally-edited element (already version-bumped) as an el-op. */
  broadcast: (el: CanvasElement) => void;
  /** Broadcast several edited elements (a multi-select move/delete). */
  broadcastMany: (els: CanvasElement[]) => void;
  /** Feed an inbound relay frame; applies an el-op (sanitize → reconcile), ignores the rest. */
  onFrame: (msg: PresenceMsg) => void;
}

/**
 * Build the co-edit controller. `onFrame` applies a sanitized inbound el-op
 * through `reconcile` (higher version wins, ties on nonce, tombstones safe), so
 * concurrent edits to different elements never collide and a stale move can't
 * resurrect a deleted element. A frame from ourselves, or for another canvas, is
 * ignored.
 */
export function makeCanvasCollab(opts: CanvasCollabOpts): CanvasCollab {
  const { selfId, canvasId, send, getElements, setElements } = opts;

  const broadcast = (el: CanvasElement): void => {
    send(elOp(selfId, canvasId, el));
  };

  const broadcastMany = (els: CanvasElement[]): void => {
    for (const el of els) broadcast(el);
  };

  const onFrame = (msg: PresenceMsg): void => {
    if (msg.t !== 'el-op') return;
    if (msg.id === selfId || msg.canvasId !== canvasId) return;
    const clean = sanitizeElement(msg.el);
    if (!clean) return; // malformed / unsafe element — dropped, never rendered
    setElements(reconcile(getElements(), [clean]));
  };

  return { broadcast, broadcastMany, onFrame };
}
