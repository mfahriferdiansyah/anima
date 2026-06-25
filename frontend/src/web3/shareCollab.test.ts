// @vitest-environment jsdom
/**
 * Owner-side note co-edit (plan 2026-06-24 U5). The plan-008 LWW `makeOwnerCollab`
 * is gone — the owner now speaks the same Yjs CRDT as the guest (proven in
 * collabSession.test.ts) and seals on idle (sealOnIdle.test.ts) under a single-
 * sealer lease (ownerLock.test.ts). This file pins the OWNER↔GUEST interop that
 * makes the two halves one system: an owner CollabSession acting as the
 * authoritative responder hydrates a late guest, and a guest edit converges back
 * onto the owner's doc (the body the owner would then seal).
 */
import { describe, it, expect } from 'vitest';
import { CollabSession } from './collabSession';
import { serializeMsg, parseMsg } from '../mocks/presenceStore';
import type { PresenceMsg } from '../../../chain/core/src/index.js';

/** A fake relay: broadcast to every other peer, no self-echo (mirrors the real hub). */
function relay() {
  const socks: ((m: PresenceMsg) => void)[] = [];
  return {
    join(deliver: (m: PresenceMsg) => void) {
      const send = (m: PresenceMsg) => {
        const wire = serializeMsg(m);
        for (const s of socks) if (s !== deliver) s(parseMsg(wire)!);
      };
      socks.push(deliver);
      return send;
    },
  };
}

describe('owner ↔ guest note interop (U5)', () => {
  it('the owner (authoritative) hydrates a late guest from the seeded body', () => {
    const bus = relay();
    let owner!: CollabSession;
    const ownerSend = bus.join((m) => owner.onFrame(m));
    owner = new CollabSession({ send: ownerSend, selfId: 'OWNER', reconcileMs: 0 });
    owner.authoritative = true;
    owner.doc.getText('body').insert(0, 'the durable note body'); // seeded from the vault

    // a guest joins late and asks for state
    let guest!: CollabSession;
    const guestSend = bus.join((m) => guest.onFrame(m));
    guest = new CollabSession({ send: guestSend, selfId: 'GUEST', reconcileMs: 0 });
    guestSend({ t: 'sync-req', id: 'GUEST' });

    expect(guest.doc.getText('body').toString()).toBe('the durable note body');
    owner.destroy();
    guest.destroy();
  });

  it('a guest edit converges onto the owner doc (the body the owner then seals)', () => {
    const bus = relay();
    let owner!: CollabSession;
    const ownerSend = bus.join((m) => owner.onFrame(m));
    owner = new CollabSession({ send: ownerSend, selfId: 'OWNER', reconcileMs: 0 });
    owner.authoritative = true;

    let guest!: CollabSession;
    const guestSend = bus.join((m) => guest.onFrame(m));
    guest = new CollabSession({ send: guestSend, selfId: 'GUEST', reconcileMs: 0 });
    owner.start();
    guest.start();

    guest.doc.getText('body').insert(0, 'a guest typed this');
    // the owner's doc converges to the guest's edit — this is what seal-on-idle reads
    expect(owner.doc.getText('body').toString()).toBe('a guest typed this');
    owner.destroy();
    guest.destroy();
  });
});
