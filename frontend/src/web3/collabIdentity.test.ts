/**
 * Collaborator identity + owner anti-spoof (plan 2026-06-24 U9). Pure / node-env.
 * Proves deterministic color+glyph from the kit palette, and that the owner badge
 * is VERIFIED by signature (a real owner passes, a spoofer renders as a guest).
 */
import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import {
  identityFor,
  IDENTITY_COLORS,
  ownerChallenge,
  signOwnerProof,
  verifyOwnerProof,
} from './collabIdentity';

describe('identityFor — deterministic color + glyph', () => {
  it('the same peer id always yields the same identity', () => {
    const a = identityFor('read-abc123');
    const b = identityFor('read-abc123');
    expect(a).toEqual(b);
  });

  it('only uses the fixed kit palette (no invented colors)', () => {
    for (const id of ['a', 'b', 'guest-1', 'own-xyz', 'read-99', 'p', 'qqqq']) {
      expect(IDENTITY_COLORS).toContain(identityFor(id).color);
    }
  });

  it('the glyph is two unambiguous chars (no I/O/0/1 look-alikes)', () => {
    const g = identityFor('read-xyz').glyph;
    expect(g).toMatch(/^[A-HJ-NP-Z2-9]{2}$/);
  });

  it('different ids generally get different identities (best-effort distribution)', () => {
    const seen = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(identityFor(`peer-${i}`))));
    expect(seen.size).toBeGreaterThan(5); // not all collapsed to one
  });
});

describe('owner anti-spoof — signature verification', () => {
  const ROOM = 'room-abc';
  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

  it('a real owner proof verifies against the opk; a spoofer fails', async () => {
    const secret = ed.utils.randomSecretKey ? ed.utils.randomSecretKey() : (ed as unknown as { utils: { randomPrivateKey: () => Uint8Array } }).utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(secret);
    const opk = hex(pub);

    const proof = await signOwnerProof(ROOM, secret);
    expect(await verifyOwnerProof(ROOM, proof, opk)).toBe(true);

    // a spoofer with a DIFFERENT key can't forge a proof that validates against opk
    const otherSecret = ed.utils.randomSecretKey ? ed.utils.randomSecretKey() : (ed as unknown as { utils: { randomPrivateKey: () => Uint8Array } }).utils.randomPrivateKey();
    const forged = await signOwnerProof(ROOM, otherSecret);
    expect(await verifyOwnerProof(ROOM, forged, opk)).toBe(false);
  });

  it('a proof for a DIFFERENT room does not verify (room-bound challenge)', async () => {
    const secret = ed.utils.randomSecretKey ? ed.utils.randomSecretKey() : (ed as unknown as { utils: { randomPrivateKey: () => Uint8Array } }).utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(secret);
    const proof = await signOwnerProof('room-A', secret);
    expect(await verifyOwnerProof('room-B', proof, hex(pub))).toBe(false);
  });

  it('returns false on malformed / missing inputs (renders as a guest, never crashes)', async () => {
    expect(await verifyOwnerProof(ROOM, '', 'deadbeef')).toBe(false);
    expect(await verifyOwnerProof(ROOM, 'not-base64', null)).toBe(false);
    expect(await verifyOwnerProof(ROOM, 'AAAA', 'nothex!!')).toBe(false);
  });

  it('the challenge is the room-bound tag', () => {
    expect(new TextDecoder().decode(ownerChallenge('xyz'))).toBe('anima-owner:xyz');
  });
});
