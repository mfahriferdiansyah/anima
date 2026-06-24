/**
 * Unit tests for the collaborative-edit session (plan 2026-06-24 U2). Two sessions
 * are wired through a FAKE broadcast relay (no socket, no server) so the sync
 * handshake, the echo guard, loss recovery, and awareness are proven config-less
 * and DOM-free. The fake relay can DROP frames to exercise the lossy-bus path.
 */
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { CollabSession } from './collabSession';
import { bytesToB64, b64ToBytes } from './collabOps';
import type { PresenceMsg } from '../../../chain/core/src/index.js';

/**
 * A fake fan-out relay: every connected session receives every other session's
 * frames (never its own — the real relay suppresses the self-echo). `drop` makes
 * the next N frames vanish, modelling the slow-consumer drop.
 */
class FakeRelay {
  private peers: { session: CollabSession; deliver: (m: PresenceMsg) => void }[] = [];
  private dropNext = 0;

  connect(make: (send: (m: PresenceMsg) => void) => CollabSession): CollabSession {
    const send = (m: PresenceMsg) => this.broadcast(send, m);
    const session = make(send);
    this.peers.push({ session, deliver: (m) => session.onFrame(m) });
    return session;
  }

  private broadcast(from: (m: PresenceMsg) => void, msg: PresenceMsg): void {
    if (this.dropNext > 0) {
      this.dropNext -= 1;
      return; // the relay dropped this frame (slow consumer)
    }
    for (const p of this.peers) {
      // Don't echo back to the sender (matched by the send fn identity).
      if ((p.session as unknown as { _send?: unknown })._send === from) continue;
      p.deliver(msg);
    }
  }

  drop(n: number): void {
    this.dropNext = n;
  }
}

/** Wire a session into a relay, tagging its send fn so the relay can suppress self-echo. */
function join(relay: FakeRelay, selfId: string, opts: { reconcileMs?: number; authoritative?: boolean } = {}): CollabSession {
  let session!: CollabSession;
  session = relay.connect((send) => {
    const s = new CollabSession({ send, selfId, reconcileMs: opts.reconcileMs ?? 0, jitter: () => 0.5 });
    (s as unknown as { _send: unknown })._send = send;
    if (opts.authoritative) s.authoritative = true;
    return s;
  });
  return session;
}

const text = (s: CollabSession) => s.doc.getText('body').toString();

describe('CollabSession — sync handshake + convergence', () => {
  it('two peers typing at different offsets converge with no lost characters', () => {
    const relay = new FakeRelay();
    const a = join(relay, 'A');
    const b = join(relay, 'B');
    a.start();
    b.start();

    a.doc.getText('body').insert(0, 'hello');
    b.doc.getText('body').insert(0, 'WORLD ');

    // both converge to the identical merged text (CRDT — order is deterministic)
    expect(text(a)).toBe(text(b));
    expect(text(a)).toContain('hello');
    expect(text(a)).toContain('WORLD');

    a.destroy();
    b.destroy();
  });

  it('a fresh peer that joins after content exists hydrates via the sync handshake', () => {
    const relay = new FakeRelay();
    const a = join(relay, 'A');
    a.start();
    a.doc.getText('body').insert(0, 'pre-existing content');

    // B joins later and announces itself — A answers with the structs B lacks
    const b = join(relay, 'B');
    b.start();

    expect(text(b)).toBe('pre-existing content');
    a.destroy();
    b.destroy();
  });
});

describe('CollabSession — echo guard', () => {
  it('a remote-applied update is NOT re-broadcast (no amplification loop)', () => {
    // B builds a real Update frame; A applies it and must emit nothing in response.
    const sent: PresenceMsg[] = [];
    const a = new CollabSession({ send: (m) => sent.push(m), selfId: 'A', reconcileMs: 0 });
    const b = new CollabSession({ send: () => {}, selfId: 'B', reconcileMs: 0 });
    b.doc.getText('body').insert(0, 'from B');

    const bUpdate = Y.encodeStateAsUpdate(b.doc);
    const tagged = new Uint8Array(bUpdate.length + 1);
    tagged[0] = 2; // Tag.Update
    tagged.set(bUpdate, 1);

    sent.length = 0;
    a.onFrame({ t: 'y-sync', id: 'B', b: bytesToB64(tagged) });

    expect(a.doc.getText('body').toString()).toBe('from B'); // applied
    expect(sent).toHaveLength(0); // but the echo guard suppressed any re-broadcast

    a.destroy();
    b.destroy();
  });
});

describe('CollabSession — loss recovery (lossy relay)', () => {
  it('a dropped update is back-filled by the periodic reconcile while a peer survives', () => {
    vi.useFakeTimers();
    const relay = new FakeRelay();
    const a = join(relay, 'A', { reconcileMs: 1000 });
    const b = join(relay, 'B', { reconcileMs: 1000 });
    a.start();
    b.start();

    // A types, but the relay DROPS the update frame → B never sees it.
    relay.drop(1);
    a.doc.getText('body').insert(0, 'dropped edit');
    expect(text(b)).toBe(''); // B is behind

    // The periodic STEP1 reconcile fires — B re-requests, A answers, B converges.
    vi.advanceTimersByTime(1600);
    expect(text(b)).toBe('dropped edit');

    a.destroy();
    b.destroy();
    vi.useRealTimers();
  });

  it('a drop whose only holder leaves is NOT recovered (honest boundary)', () => {
    vi.useFakeTimers();
    const relay = new FakeRelay();
    const a = join(relay, 'A', { reconcileMs: 1000 });
    const b = join(relay, 'B', { reconcileMs: 1000 });
    a.start();
    b.start();

    relay.drop(1);
    a.doc.getText('body').insert(0, 'lost forever');
    a.destroy(); // the only holder leaves before any reconcile

    vi.advanceTimersByTime(2000);
    expect(text(b)).toBe(''); // unrecoverable — the durable seal is the backstop, not the relay

    b.destroy();
    vi.useRealTimers();
  });
});

describe('CollabSession — awareness (presence)', () => {
  it('a local awareness field surfaces on the peer; removal drops it', () => {
    const relay = new FakeRelay();
    const a = join(relay, 'A');
    const b = join(relay, 'B');
    a.start();
    b.start();

    a.awareness.setLocalStateField('user', { label: 'Owner', color: 'blue' });
    // B sees A's awareness state (plus its own — getStates includes the local client).
    const aClient = a.doc.clientID;
    expect(b.awareness.getStates().get(aClient)).toEqual({ user: { label: 'Owner', color: 'blue' } });

    a.destroy(); // destroy broadcasts a removal
    expect(b.awareness.getStates().has(aClient)).toBe(false);

    b.destroy();
  });
});

describe('CollabSession — authoritative sync responder', () => {
  it('the authoritative peer answers a sync-req so a late joiner hydrates', () => {
    const relay = new FakeRelay();
    const owner = join(relay, 'OWNER', { authoritative: true });
    owner.start();
    owner.doc.getText('body').insert(0, 'owner content');

    // A late joiner connects and broadcasts a sync-req; the owner answers with STEP2.
    const late = join(relay, 'LATE');
    late['send']({ t: 'sync-req', id: 'LATE' });

    expect(text(late)).toBe('owner content');

    owner.destroy();
    late.destroy();
  });

  it('a non-authoritative peer answers a sync-req with its own STEP1, not full state', () => {
    // A guest receiving a sync-req re-announces (STEP1) rather than serving STEP2.
    const sent: PresenceMsg[] = [];
    const guest = new CollabSession({ send: (m) => sent.push(m), selfId: 'GUEST', reconcileMs: 0 });
    guest.authoritative = false;
    guest.doc.getText('body').insert(0, 'guest local');

    sent.length = 0;
    guest.onFrame({ t: 'sync-req', id: 'LATE' });
    // It emitted exactly a STEP1 (tag 0), never a STEP2 (tag 1).
    const tags = sent.filter((m) => m.t === 'y-sync').map((m) => (m.t === 'y-sync' ? b64ToBytes(m.b)[0] : -1));
    expect(tags).toEqual([0]); // STEP1 only

    guest.destroy();
  });
});
