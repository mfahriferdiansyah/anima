/**
 * Canvas live co-edit core (plan 2026-06-24 U6). Two controllers are wired over a
 * fake relay (broadcast, no self-echo) so the el-op send/apply/reconcile loop is
 * proven without a board, a socket, or a wallet. Covers AE4 (different elements),
 * AE5 (same-element convergence + tombstone no-resurrect), the sanitize chokepoint,
 * and self / other-canvas filtering.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeCanvasCollab } from './canvasCollab';
import { roomState } from '../web3/collabOps';
import type { CanvasElement } from '../../../chain/core/src/elements.js';
import type { PresenceMsg } from '../../../chain/core/src/index.js';

const enc = new TextEncoder();

function el(id: string, over: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    type: 'rect',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    angle: 0,
    index: 0,
    version: 1,
    versionNonce: 100,
    ...over,
  } as CanvasElement;
}

/** A peer: an element list + a controller, joined to a shared relay. */
function makePeer(
  relay: Set<(m: PresenceMsg) => void>,
  selfId: string,
  opts: { canvasId?: string; responder?: boolean; dropFor?: (m: PresenceMsg) => boolean } = {},
) {
  const canvasId = opts.canvasId ?? 'board-1';
  let elements: CanvasElement[] = [];
  const deliver = (m: PresenceMsg) => collab.onFrame(m);
  const send = (m: PresenceMsg) => {
    for (const d of relay) {
      if (d === deliver) continue;
      // model a lossy relay: drop selected frames to a slow consumer
      if (opts.dropFor && d === (opts.dropFor as unknown as (mm: PresenceMsg) => void)) continue;
      d(m);
    }
  };
  const collab = makeCanvasCollab({
    selfId,
    canvasId,
    send,
    getElements: () => elements,
    setElements: (next) => (elements = next),
    isResponder: () => opts.responder ?? false,
  });
  relay.add(deliver);
  return {
    collab,
    deliver,
    get elements() {
      return elements;
    },
    seed(els: CanvasElement[]) {
      elements = els;
    },
    place(e: CanvasElement) {
      elements = [...elements, e];
      collab.broadcast(e);
    },
    edit(e: CanvasElement) {
      elements = elements.map((x) => (x.id === e.id ? e : x));
      collab.broadcast(e);
    },
  };
}

describe('makeCanvasCollab — el-op broadcast + reconcile apply', () => {
  it('Covers AE4: two peers each move a DIFFERENT element; both land, neither dropped', () => {
    const relay = new Set<(m: PresenceMsg) => void>();
    const a = makePeer(relay, 'A');
    const b = makePeer(relay, 'B');

    a.place(el('e1', { x: 5 }));
    b.place(el('e2', { x: 9 }));

    // both peers now hold both elements
    const idsA = a.elements.map((e) => e.id).sort();
    const idsB = b.elements.map((e) => e.id).sort();
    expect(idsA).toEqual(['e1', 'e2']);
    expect(idsB).toEqual(['e1', 'e2']);
    expect(a.elements.find((e) => e.id === 'e2')!.x).toBe(9);
    expect(b.elements.find((e) => e.id === 'e1')!.x).toBe(5);
  });

  it('Covers AE5: concurrent edits to the SAME element converge (higher version, then lower nonce)', () => {
    const relay = new Set<(m: PresenceMsg) => void>();
    const a = makePeer(relay, 'A');
    const b = makePeer(relay, 'B');
    a.place(el('e1', { x: 0, version: 1, versionNonce: 100 }));

    // both edit e1 concurrently at version 2; lower nonce wins the tie
    a.edit(el('e1', { x: 10, version: 2, versionNonce: 500 }));
    b.edit(el('e1', { x: 20, version: 2, versionNonce: 200 }));

    // deterministic convergence: version 2, nonce 200 (b's) wins on both peers
    expect(a.elements.find((e) => e.id === 'e1')!.x).toBe(20);
    expect(b.elements.find((e) => e.id === 'e1')!.x).toBe(20);
  });

  it('Covers AE5: a stale concurrent move does NOT resurrect a deleted element', () => {
    const relay = new Set<(m: PresenceMsg) => void>();
    const a = makePeer(relay, 'A');
    const b = makePeer(relay, 'B');
    a.place(el('e1', { version: 1 }));

    // A deletes e1 at version 3 (tombstone)
    a.edit(el('e1', { version: 3, isDeleted: true }));
    // B sends a STALE move at version 2 — must lose to the higher-versioned tombstone
    b.collab.broadcast(el('e1', { x: 99, version: 2 }));

    const onA = a.elements.find((e) => e.id === 'e1')!;
    expect(onA.isDeleted).toBe(true); // stayed deleted, not resurrected
  });

  it('runs the sanitize chokepoint: an inbound el-op with a hostile image ref is dropped', () => {
    const relay = new Set<(m: PresenceMsg) => void>();
    const a = makePeer(relay, 'A');
    // a malicious peer sends an image el-op with a remote ref directly onto the relay
    a.collab.onFrame({
      t: 'el-op',
      id: 'attacker',
      canvasId: 'board-1',
      el: el('evil', { type: 'image', ref: 'https://attacker/pixel.gif' } as Partial<CanvasElement>),
    });
    expect(a.elements.find((e) => e.id === 'evil')).toBeUndefined(); // never reached the list
  });

  it('ignores our own echo and a frame for a different canvas', () => {
    const relay = new Set<(m: PresenceMsg) => void>();
    const a = makePeer(relay, 'A', { canvasId: 'board-1' });
    a.collab.onFrame({ t: 'el-op', id: 'A', canvasId: 'board-1', el: el('self') }); // our own echo
    a.collab.onFrame({ t: 'el-op', id: 'B', canvasId: 'board-2', el: el('other') }); // other canvas
    expect(a.elements).toHaveLength(0);
  });
});

describe('makeCanvasCollab — late-joiner chunked resync (U7)', () => {
  it('a late joiner hydrates the full scene from the responder (sync-req → chunks)', () => {
    const relay = new Set<(m: PresenceMsg) => void>();
    const owner = makePeer(relay, 'OWNER', { responder: true });
    owner.seed([el('e1', { x: 1 }), el('e2', { x: 2 }), el('e3', { x: 3 })]);

    const late = makePeer(relay, 'LATE');
    late.collab.requestSync(); // broadcast sync-req; only the owner answers

    const ids = late.elements.map((e) => e.id).sort();
    expect(ids).toEqual(['e1', 'e2', 'e3']);
    expect(late.elements.find((e) => e.id === 'e2')!.x).toBe(2);
  });

  it('the resync snapshot INCLUDES tombstones, so a stale move cannot resurrect a delete', () => {
    const relay = new Set<(m: PresenceMsg) => void>();
    const owner = makePeer(relay, 'OWNER', { responder: true });
    owner.seed([el('e1', { version: 5, isDeleted: true })]); // a deleted element

    const late = makePeer(relay, 'LATE');
    late.collab.requestSync();

    // the late joiner received the tombstone (kept, not dropped from the snapshot)
    const t = late.elements.find((e) => e.id === 'e1');
    expect(t?.isDeleted).toBe(true);

    // a stale concurrent move at a LOWER version must lose to the tombstone
    late.collab.onFrame({ t: 'el-op', id: 'X', canvasId: 'board-1', el: el('e1', { x: 99, version: 2 }) });
    expect(late.elements.find((e) => e.id === 'e1')!.isDeleted).toBe(true);
  });

  it('a non-responder does NOT serve the snapshot (avoids the N-peer storm)', () => {
    const relay = new Set<(m: PresenceMsg) => void>();
    const guest = makePeer(relay, 'GUEST', { responder: false });
    guest.seed([el('e1')]);

    let served = false;
    const spy = (m: PresenceMsg) => {
      if (m.t === 'el-chunk') served = true;
    };
    relay.add(spy);
    guest.collab.onFrame({ t: 'sync-req', id: 'LATE' });
    expect(served).toBe(false); // guest re-announces nothing here, never serves chunks
  });

  it('a dropped chunk triggers a selective re-request and still reassembles (no livelock)', () => {
    // Drive the chunk protocol directly with a large snapshot so it splits.
    const owner = makePeer(new Set(), 'OWNER', { responder: true });
    const big: CanvasElement[] = [];
    for (let i = 0; i < 4000; i++) big.push(el('e' + i, { x: i }));
    owner.seed(big);

    // Capture the chunks the owner serves.
    const served: PresenceMsg[] = [];
    const relay = new Set<(m: PresenceMsg) => void>();
    const owner2 = makePeer(relay, 'O2', { responder: true });
    owner2.seed(big);
    relay.add((m) => served.push(m));
    owner2.collab.onFrame({ t: 'sync-req', id: 'LATE' });
    const chunks = served.filter((m) => m.t === 'el-chunk');
    expect(chunks.length).toBeGreaterThan(1); // it actually split

    // A late joiner receives all but one chunk → must re-request the gap, then converge.
    const late = makeCanvasCollabReceiverHarness('board-1');
    const dropIdx = 1;
    let reRequested: number[] | null = null;
    late.setSend((m) => {
      if (m.t === 'el-need') reRequested = m.seqs;
    });
    chunks.forEach((c, i) => {
      if (i === dropIdx) return; // drop one
      late.feed(c);
    });
    expect(late.elements.length).toBe(0); // incomplete — nothing applied yet
    expect(reRequested).toContain(dropIdx); // asked for ONLY the missing seq

    // owner resends the missing chunk → late joiner completes
    late.feed(chunks[dropIdx]);
    expect(late.elements.length).toBe(big.length);
  });
});

describe('makeCanvasCollab — room-state catch-up (owner-offline) + reconcile', () => {
  it('a guest hydrates from a relay room-state snapshot, sanitizing each element', () => {
    let elements: CanvasElement[] = [];
    const collab = makeCanvasCollab({
      selfId: 'GUEST',
      canvasId: 'board-1',
      send: () => {},
      getElements: () => elements,
      setElements: (n) => (elements = n),
      isResponder: () => false,
      reconcileMs: 0,
    });
    const snapshot = [
      el('e1', { x: 1 }),
      el('e2', { x: 2 }),
      el('evil', { type: 'image', ref: 'https://attacker/p.gif' } as Partial<CanvasElement>),
    ];
    collab.onFrame(roomState('owner', 1, enc.encode(JSON.stringify(snapshot))));
    // The two legit elements land; the hostile image ref is dropped by sanitize —
    // the SAME chokepoint as an el-op, so a poisoned snapshot can't reach the DOM.
    expect(elements.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
    collab.dispose();
  });

  it('the responder posts room-state on sync-req; a guest never posts', () => {
    const ownerSends: PresenceMsg[] = [];
    let ownerEls: CanvasElement[] = [el('e1')];
    const owner = makeCanvasCollab({
      selfId: 'O',
      canvasId: 'r',
      send: (m) => ownerSends.push(m),
      getElements: () => ownerEls,
      setElements: (n) => (ownerEls = n),
      isResponder: () => true,
      reconcileMs: 0,
    });
    owner.onFrame({ t: 'sync-req', id: 'LATE' });
    expect(ownerSends.some((m) => m.t === 'room-state')).toBe(true);

    const guestSends: PresenceMsg[] = [];
    const guest = makeCanvasCollab({
      selfId: 'G',
      canvasId: 'r',
      send: (m) => guestSends.push(m),
      getElements: () => [el('e1')],
      setElements: () => {},
      isResponder: () => false,
      reconcileMs: 0,
    });
    guest.postRoomState();
    expect(guestSends.some((m) => m.t === 'room-state')).toBe(false);
    owner.dispose();
    guest.dispose();
  });

  it('skips posting room-state when the scene exceeds one relay frame (chunked path covers it)', () => {
    const sends: PresenceMsg[] = [];
    const big: CanvasElement[] = [];
    for (let i = 0; i < 4000; i++) big.push(el('e' + i, { x: i }));
    const owner = makeCanvasCollab({
      selfId: 'O',
      canvasId: 'r',
      send: (m) => sends.push(m),
      getElements: () => big,
      setElements: () => {},
      isResponder: () => true,
      reconcileMs: 0,
    });
    owner.postRoomState();
    expect(sends.some((m) => m.t === 'room-state')).toBe(false);
    owner.dispose();
  });

  it('periodically re-requests sync (loss recovery), and dispose() stops it', () => {
    vi.useFakeTimers();
    try {
      const sends: PresenceMsg[] = [];
      const collab = makeCanvasCollab({
        selfId: 'G',
        canvasId: 'r',
        send: (m) => sends.push(m),
        getElements: () => [],
        setElements: () => {},
        reconcileMs: 4000,
        jitter: () => 0, // delay = 4000 * 0.75 = 3000
      });
      const syncReqs = () => sends.filter((m) => m.t === 'sync-req').length;
      expect(syncReqs()).toBe(0);
      vi.advanceTimersByTime(3001);
      expect(syncReqs()).toBe(1);
      vi.advanceTimersByTime(3001);
      expect(syncReqs()).toBe(2);
      collab.dispose();
      vi.advanceTimersByTime(10000);
      expect(syncReqs()).toBe(2); // no further reconciles after dispose
    } finally {
      vi.useRealTimers();
    }
  });
});

/** A bare receiver harness: one collab controller whose send is observable, fed chunks manually. */
function makeCanvasCollabReceiverHarness(canvasId: string) {
  let elements: CanvasElement[] = [];
  let send: (m: PresenceMsg) => void = () => {};
  const collab = makeCanvasCollab({
    selfId: 'RX',
    canvasId,
    send: (m) => send(m),
    getElements: () => elements,
    setElements: (next) => (elements = next),
  });
  return {
    setSend(fn: (m: PresenceMsg) => void) {
      send = fn;
    },
    feed(m: PresenceMsg) {
      collab.onFrame(m);
    },
    get elements() {
      return elements;
    },
  };
}
