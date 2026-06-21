/**
 * DOM-free test for the presence store's pure cores (plan U9). The live
 * WebSocket client and the real `saveLayout`/`loadLayout` chain calls are
 * integration-deferred (proven by the F6 live gate, not here); this pins the
 * three node-testable pieces:
 *   1. the PresenceMsg (de)serializer (round-trip + malformed rejection),
 *   2. the peers[] reducer (hello/cursor/writing/bye),
 *   3. the overlap-coalescing layout saver (one quilt per logical change,
 *      monotonic version, no duplicate same-version write).
 *
 * No timers and no real promises in the tested cores: `createLayoutSaver` takes
 * an INJECTED save, so coalescing is exercised with a controllable deferred.
 */
import { describe, it, expect } from 'vitest';
import {
  serializeMsg,
  parseMsg,
  reducePeers,
  createLayoutSaver,
  type Peer,
  type SaveFn,
} from '../mocks/presenceStore';
import type { PresenceMsg, CanvasLayout } from '../../../chain/core/src/index.js';

// --- 1. PresenceMsg (de)serialization ---------------------------------------

describe('presence wire (de)serialization', () => {
  const samples: PresenceMsg[] = [
    { t: 'hello', id: 'p1', label: 'Guest a1b2', kind: 'human' },
    { t: 'hello', id: 'nova', label: 'Nova', kind: 'agent' },
    { t: 'cursor', id: 'p1', x: 120, y: 340 },
    { t: 'writing', id: 'p1', on: true },
    { t: 'note-created', id: 'p1', noteId: 'n-xyz' },
    { t: 'bye', id: 'p1' },
  ];

  it('round-trips every PresenceMsg variant', () => {
    for (const msg of samples) {
      expect(parseMsg(serializeMsg(msg))).toEqual(msg);
    }
  });

  it('a serialized cursor frame stays far under the 4 KB relay cap', () => {
    const frame = serializeMsg({ t: 'cursor', id: 'p1', x: 1234.5, y: 6789.1 });
    expect(frame.length).toBeLessThan(4096);
  });

  it('rejects malformed / unknown / wrong-typed frames as null', () => {
    expect(parseMsg('not json')).toBeNull();
    expect(parseMsg('null')).toBeNull();
    expect(parseMsg('42')).toBeNull();
    expect(parseMsg(JSON.stringify({ t: 'mystery', id: 'p1' }))).toBeNull();
    expect(parseMsg(JSON.stringify({ t: 'hello', id: 'p1' }))).toBeNull(); // missing label/kind
    expect(parseMsg(JSON.stringify({ t: 'hello', id: 'p1', label: 'x', kind: 'robot' }))).toBeNull();
    expect(parseMsg(JSON.stringify({ t: 'cursor', id: 'p1', x: 'NaN', y: 0 }))).toBeNull();
    expect(parseMsg(JSON.stringify({ t: 'writing', id: 'p1', on: 'yes' }))).toBeNull();
  });
});

// --- 2. peers[] reducer ------------------------------------------------------

describe('peers reducer', () => {
  it('hello adds a peer with default position', () => {
    const peers = reducePeers([], { t: 'hello', id: 'p1', label: 'Guest a1', kind: 'human' });
    expect(peers).toEqual([{ id: 'p1', label: 'Guest a1', kind: 'human', x: 0, y: 0, isWriting: false }]);
  });

  it('cursor moves an existing peer, preserving label/kind/isWriting', () => {
    let peers = reducePeers([], { t: 'hello', id: 'p1', label: 'Guest a1', kind: 'human' });
    peers = reducePeers(peers, { t: 'writing', id: 'p1', on: true });
    peers = reducePeers(peers, { t: 'cursor', id: 'p1', x: 50, y: 60 });
    expect(peers).toEqual([{ id: 'p1', label: 'Guest a1', kind: 'human', x: 50, y: 60, isWriting: true }]);
  });

  it('cursor before hello tracks position with a placeholder, then hello keeps it', () => {
    let peers = reducePeers([], { t: 'cursor', id: 'p2', x: 10, y: 20 });
    expect(peers).toEqual([{ id: 'p2', label: '', kind: 'human', x: 10, y: 20, isWriting: false }]);
    peers = reducePeers(peers, { t: 'hello', id: 'p2', label: 'Nova', kind: 'agent' });
    expect(peers).toEqual([{ id: 'p2', label: 'Nova', kind: 'agent', x: 10, y: 20, isWriting: false }]);
  });

  it('writing toggles only the addressed peer', () => {
    const base: Peer[] = [
      { id: 'p1', label: 'a', kind: 'human', x: 0, y: 0, isWriting: false },
      { id: 'p2', label: 'b', kind: 'agent', x: 0, y: 0, isWriting: false },
    ];
    const peers = reducePeers(base, { t: 'writing', id: 'p2', on: true });
    expect(peers.find((p) => p.id === 'p1')?.isWriting).toBe(false);
    expect(peers.find((p) => p.id === 'p2')?.isWriting).toBe(true);
  });

  it('bye drops the peer; note-created leaves peers unchanged', () => {
    const base: Peer[] = [{ id: 'p1', label: 'a', kind: 'human', x: 0, y: 0, isWriting: false }];
    expect(reducePeers(base, { t: 'bye', id: 'p1' })).toEqual([]);
    expect(reducePeers(base, { t: 'note-created', id: 'p1', noteId: 'n1' })).toEqual(base);
  });

  it('never mutates the input array (snapshot identity)', () => {
    const base: Peer[] = [{ id: 'p1', label: 'a', kind: 'human', x: 0, y: 0, isWriting: false }];
    const next = reducePeers(base, { t: 'cursor', id: 'p1', x: 9, y: 9 });
    expect(next).not.toBe(base);
    expect(base[0].x).toBe(0); // original untouched
  });
});

// --- 3. overlap-coalescing layout saver -------------------------------------

/** A save mock returning a deferred whose resolve the test controls, recording
 *  the layout (and a synthetic monotonic base-version) of each fired write. */
function makeDeferredSave() {
  const calls: Array<{ layout: CanvasLayout; baseVersion: number; resolve: () => void }> = [];
  let version = 0; // every fire reads-then-bumps, mirroring the real index version
  const save: SaveFn = (layout) =>
    new Promise<void>((resolve) => {
      const baseVersion = version;
      version += 1; // the write emits baseVersion+1; the NEXT fire must read a higher base
      calls.push({ layout, baseVersion, resolve });
    });
  return { save, calls };
}

const L = (n: number): CanvasLayout => ({ note: { x: n, y: n } });

describe('layout saver — overlap coalescing', () => {
  it('fires immediately when idle', () => {
    const { save, calls } = makeDeferredSave();
    const saver = createLayoutSaver(save);
    saver.requestSave(L(1));
    expect(calls).toHaveLength(1);
    expect(saver.isSaving()).toBe(true);
  });

  it('coalesces a burst during an in-flight save into ONE follow-up with the LATEST snapshot', () => {
    const { save, calls } = makeDeferredSave();
    const saver = createLayoutSaver(save);

    saver.requestSave(L(1)); // fires (call #1)
    saver.requestSave(L(2)); // coalesced (pending = L2)
    saver.requestSave(L(3)); // coalesced (pending = L3, overwrites L2)
    saver.requestSave(L(4)); // coalesced (pending = L4)
    expect(calls).toHaveLength(1); // still only the first write in flight

    calls[0].resolve(); // first write done → fire the single coalesced follow-up
    return Promise.resolve().then(() => {
      expect(calls).toHaveLength(2); // exactly ONE follow-up, not three
      expect(calls[1].layout).toEqual(L(4)); // the LATEST snapshot, not L2/L3
    });
  });

  it('every fired write reads a strictly higher base version (no duplicate same-version quilt)', () => {
    const { save, calls } = makeDeferredSave();
    const saver = createLayoutSaver(save);

    saver.requestSave(L(1));
    saver.requestSave(L(2)); // coalesced
    calls[0].resolve();
    return Promise.resolve()
      .then(() => {
        expect(calls).toHaveLength(2);
        calls[1].resolve();
      })
      .then(() => {
        // The two fires must NOT share a base version (the duplicate-quilt bug).
        expect(calls[0].baseVersion).toBe(0);
        expect(calls[1].baseVersion).toBe(1);
        expect(calls[1].baseVersion).toBeGreaterThan(calls[0].baseVersion);
      });
  });

  it('a request AFTER a save resolves (no overlap) fires a fresh write, not a coalesce', () => {
    const { save, calls } = makeDeferredSave();
    const saver = createLayoutSaver(save);
    saver.requestSave(L(1));
    calls[0].resolve();
    return Promise.resolve().then(() => {
      expect(saver.isSaving()).toBe(false);
      saver.requestSave(L(2));
      expect(calls).toHaveLength(2);
      expect(calls[1].layout).toEqual(L(2));
    });
  });

  it('pulses savingLayout true→false around the (chained) write sequence', () => {
    const flags: boolean[] = [];
    const { save, calls } = makeDeferredSave();
    const saver = createLayoutSaver(save, (saving) => flags.push(saving));

    saver.requestSave(L(1)); // true
    saver.requestSave(L(2)); // coalesced — stays saving, no extra flag
    calls[0].resolve();
    return Promise.resolve()
      .then(() => {
        calls[1].resolve();
      })
      .then(() => {
        // exactly one true at the start and one false at the very end — the
        // coalesced chain never flickers the pulse off between the two writes.
        expect(flags[0]).toBe(true);
        expect(flags[flags.length - 1]).toBe(false);
        expect(flags.filter((f) => f === true)).toHaveLength(1);
        expect(flags.filter((f) => f === false)).toHaveLength(1);
      });
  });
});
