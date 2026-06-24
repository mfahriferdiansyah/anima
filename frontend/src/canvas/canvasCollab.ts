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
import { elOp, elChunk, elNeed, sanitizeElement, b64ToBytes, randomShareId } from '../web3/collabOps';
import { chunkSnapshot, SnapshotReceiver } from '../web3/collabSnapshotChunk';

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface CanvasCollabOpts {
  selfId: string;
  canvasId: string;
  send: (msg: PresenceMsg) => void;
  /** Read the current live element list (the board's elements ref). */
  getElements: () => CanvasElement[];
  /** Apply a reconciled element list back to the board (a React setState, etc.). */
  setElements: (next: CanvasElement[]) => void;
  /**
   * Whether this peer answers a `sync-req` with the full snapshot (the owner, or a
   * present-peer fallback when the owner is absent). Defaults to false — a guest
   * only re-announces. Read each time so the caller can flip it on owner presence.
   */
  isResponder?: () => boolean;
}

export interface CanvasCollab {
  /** Broadcast one locally-edited element (already version-bumped) as an el-op. */
  broadcast: (el: CanvasElement) => void;
  /** Broadcast several edited elements (a multi-select move/delete). */
  broadcastMany: (els: CanvasElement[]) => void;
  /** Ask the room for the current scene (broadcast on join). */
  requestSync: () => void;
  /** Feed an inbound relay frame; applies el-op / chunk / re-request / sync-req. */
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
  const isResponder = opts.isResponder ?? (() => false);

  // Cache the chunks of the snapshot we last served, keyed by gen, so an `el-need`
  // re-request resends only the missing seqs (selective, not a full re-flood).
  let servedGen: string | null = null;
  let servedChunks: ReturnType<typeof chunkSnapshot> = [];
  const receiver = new SnapshotReceiver();

  const broadcast = (el: CanvasElement): void => {
    send(elOp(selfId, canvasId, el));
  };

  const broadcastMany = (els: CanvasElement[]): void => {
    for (const el of els) broadcast(el);
  };

  const requestSync = (): void => {
    send({ t: 'sync-req', id: selfId });
  };

  /** Serialize the FULL element list (including tombstones) and send it as gen-tagged chunks. */
  const serveSnapshot = (): void => {
    const elements = getElements(); // tombstones included — the resurrection-safety guarantee
    const bytes = enc.encode(JSON.stringify(elements));
    servedGen = randomShareId(8);
    servedChunks = chunkSnapshot(bytes, servedGen);
    for (const c of servedChunks) send(elChunk(selfId, canvasId, c.gen, c.seq, c.total, c.payload));
  };

  const applyReceived = (bytes: Uint8Array): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(dec.decode(bytes));
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    const clean = parsed.map(sanitizeElement).filter((e): e is CanvasElement => e !== null);
    setElements(reconcile(getElements(), clean));
  };

  const onFrame = (msg: PresenceMsg): void => {
    if (msg.id === selfId) return; // our own echo
    switch (msg.t) {
      case 'el-op': {
        if (msg.canvasId !== canvasId) return;
        const clean = sanitizeElement(msg.el);
        if (!clean) return; // malformed / unsafe — dropped, never rendered
        setElements(reconcile(getElements(), [clean]));
        return;
      }
      case 'sync-req': {
        // Only the responder (owner / present-peer fallback) serves the full scene;
        // a non-responder ignores it (avoids the N-peer state storm on a bus).
        if (isResponder()) serveSnapshot();
        return;
      }
      case 'el-chunk': {
        if (msg.canvasId !== canvasId) return;
        const done = receiver.accept({ gen: msg.gen, seq: msg.seq, total: msg.total, payload: b64ToBytes(msg.b) });
        if (done) {
          applyReceived(done);
        } else {
          // a gap remains → selectively re-request ONLY the missing seqs of this gen
          const gaps = receiver.missing();
          if (gaps.length) send(elNeed(selfId, canvasId, msg.gen, gaps));
        }
        return;
      }
      case 'el-need': {
        // a peer is missing some chunks of a snapshot we served — resend just those
        if (msg.canvasId !== canvasId || msg.gen !== servedGen) return;
        for (const seq of msg.seqs) {
          const c = servedChunks[seq];
          if (c) send(elChunk(selfId, canvasId, c.gen, c.seq, c.total, c.payload));
        }
        return;
      }
    }
  };

  return { broadcast, broadcastMany, requestSync, onFrame };
}
