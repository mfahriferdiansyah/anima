/**
 * Anonymous collaborator identity (plan 2026-06-24 U9) — the MS-Docs "circle"
 * model. A peer gets a deterministic color + 2-char glyph from its stable id over
 * a FIXED kit palette (no invented colors), so every peer renders the same peer
 * the same way without the stateless relay arbitrating. Collisions are expected
 * (5 hues vs up to 32 peers); the glyph + an always-visible label disambiguate.
 *
 * Owner anti-spoof: the awareness `user` field is peer-settable, so a guest can
 * claim `label:'Owner'`. The owner badge / seal-state are therefore VERIFIED, not
 * trusted: the owner signs a room-bound challenge with its agent key, and every
 * peer verifies the signature against the link's `opk` (the owner agent PUBLIC
 * key, carried in the edit link — public material, no secret). A verify uses
 * `@noble/ed25519` (NOT `@mysten`), so the wallet-free guest stays isolated.
 */
import * as ed from '@noble/ed25519';
import { b64ToBytes, bytesToB64 } from './collabOps';

/**
 * The fixed identity palette — the five named non-neutral kit hues. Indexing is
 * deterministic from the peer id, so no new colors are ever invented.
 */
export const IDENTITY_COLORS = ['var(--blue-600)', 'var(--orange-500)', 'var(--pink-500)', 'var(--teal-500)', 'var(--red-500)'];

/** The glyph alphabet — uppercase + digits, an unambiguous 2-char tag. */
const GLYPH_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 (look-alikes)

/** A small, stable, non-cryptographic hash of a string → unsigned 32-bit int. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface CollabIdentity {
  color: string;
  glyph: string;
}

/** Deterministic color + 2-char glyph for a peer id (same id → same identity, every peer). */
export function identityFor(peerId: string): CollabIdentity {
  const h = hashId(peerId);
  const color = IDENTITY_COLORS[h % IDENTITY_COLORS.length];
  const a = GLYPH_ALPHABET[(h >>> 3) % GLYPH_ALPHABET.length];
  const b = GLYPH_ALPHABET[(h >>> 8) % GLYPH_ALPHABET.length];
  return { color, glyph: `${a}${b}` };
}

// ── owner signature verification (anti-spoof) ───────────────────────────────

const te = new TextEncoder();

/** The bytes the owner signs to prove ownership of a room: a fixed tag + the room id. */
export function ownerChallenge(roomId: string): Uint8Array {
  return te.encode(`anima-owner:${roomId}`);
}

/** The owner produces this proof (signs the room challenge with the agent private key). Returns base64. */
export async function signOwnerProof(roomId: string, agentSecretKey: Uint8Array): Promise<string> {
  const sig = await ed.signAsync(ownerChallenge(roomId), agentSecretKey);
  return bytesToB64(sig);
}

/**
 * A peer verifies an "owner"-claiming awareness entry: the signature (base64) over
 * the room challenge must validate against the link's `opk` (owner agent public
 * key, hex). Returns false on any malformed input — an unverified claim renders as
 * an ordinary guest, never the owner.
 */
export async function verifyOwnerProof(roomId: string, proofB64: string, opkHex: string | null | undefined): Promise<boolean> {
  if (!opkHex || !proofB64) return false;
  try {
    const pub = hexToBytes(opkHex);
    const sig = b64ToBytes(proofB64);
    if (pub.length === 0 || sig.length === 0) return false;
    return await ed.verifyAsync(sig, ownerChallenge(roomId), pub);
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return new Uint8Array(0);
    out[i] = byte;
  }
  return out;
}
