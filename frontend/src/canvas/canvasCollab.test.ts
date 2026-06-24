/**
 * Canvas live co-edit core (plan 2026-06-24 U6). Two controllers are wired over a
 * fake relay (broadcast, no self-echo) so the el-op send/apply/reconcile loop is
 * proven without a board, a socket, or a wallet. Covers AE4 (different elements),
 * AE5 (same-element convergence + tombstone no-resurrect), the sanitize chokepoint,
 * and self / other-canvas filtering.
 */
import { describe, it, expect } from 'vitest';
import { makeCanvasCollab } from './canvasCollab';
import type { CanvasElement } from '../../../chain/core/src/elements.js';
import type { PresenceMsg } from '../../../chain/core/src/index.js';

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
function makePeer(relay: Set<(m: PresenceMsg) => void>, selfId: string, canvasId = 'board-1') {
  let elements: CanvasElement[] = [];
  const deliver = (m: PresenceMsg) => collab.onFrame(m);
  const send = (m: PresenceMsg) => {
    for (const d of relay) if (d !== deliver) d(m);
  };
  const collab = makeCanvasCollab({
    selfId,
    canvasId,
    send,
    getElements: () => elements,
    setElements: (next) => (elements = next),
  });
  relay.add(deliver);
  return {
    collab,
    get elements() {
      return elements;
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
    const a = makePeer(relay, 'A', 'board-1');
    a.collab.onFrame({ t: 'el-op', id: 'A', canvasId: 'board-1', el: el('self') }); // our own echo
    a.collab.onFrame({ t: 'el-op', id: 'B', canvasId: 'board-2', el: el('other') }); // other canvas
    expect(a.elements).toHaveLength(0);
  });
});
