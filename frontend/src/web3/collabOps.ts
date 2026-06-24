/**
 * Live-collaboration transport helpers (plan 008 U1) — the security + concurrency
 * layer over the presence relay.
 *
 * The relay is an unauthenticated, opaque fan-out. During an active share it also
 * carries plaintext content ops (`note-op`/`canvas-op`/`note-writing`). Three
 * defenses live here, because the client-persisted agent key is the Seal decrypt
 * identity AND the note signer — an unsanitized guest frame would be an XSS path
 * to full-vault decryption and forged notes:
 *
 *  1. `sanitizeNoteHtml` — DOMPurify + markdown on every inbound guest/published
 *     body before it touches the DOM (no script, no event handlers, no raw HTML).
 *  2. `deriveRoomId` — a password-gated edit room is `PBKDF2(password, link-salt)`
 *     computed client-side, so the relay needs no secret and no join-token: the
 *     right password lands you in the room, a wrong one in a different empty room.
 *  3. `makeShareGate` — content ops are emitted ONLY while a share is active, so a
 *     private (unshared) edit never broadcasts and is not eavesdroppable.
 *
 * Concurrency is last-write-wins per object plus a per-note SOFT LOCK driven by
 * `note-writing` pings (auto-release + take-over). No CRDT, no conflict-free
 * guarantee. This module imports nothing from `@mysten/*` so the chromeless
 * reader can reuse it without pulling the wallet stack.
 */
import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import type { PresenceMsg, CanvasLayout } from '../../../chain/core/src/index.js';
import type { CanvasElement } from '../../../chain/core/src/elements.js';

const te = new TextEncoder();

// ---------------------------------------------------------------------------
// 1. Sanitize (DOM-bound) — runs in the browser or a jsdom test env.
// ---------------------------------------------------------------------------

let _purify: ReturnType<typeof createDOMPurify> | null = null;
function purify(): ReturnType<typeof createDOMPurify> {
  if (_purify) return _purify;
  const win = (globalThis as { window?: unknown }).window;
  if (!win) {
    // A loud failure beats a silent passthrough: sanitize must never no-op.
    throw new Error('sanitizeNoteHtml requires a DOM (browser or jsdom test env)');
  }
  _purify = createDOMPurify(win as Window & typeof globalThis);
  return _purify;
}

/**
 * Render a guest/published note body (markdown) to SAFE html: markdown is parsed
 * then DOMPurify-stripped of scripts, event handlers, and dangerous tags. Links
 * are kept but `javascript:`/`data:` URLs are dropped by DOMPurify; `style`,
 * `iframe`, `object`, `embed`, and `form` are forbidden outright.
 */
export function sanitizeNoteHtml(markdown: string): string {
  const html = marked.parse(markdown ?? '', { async: false }) as string;
  return purify().sanitize(html, {
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'script'],
    FORBID_ATTR: ['style'],
    ALLOW_DATA_ATTR: false,
  });
}

// ---------------------------------------------------------------------------
// 2. Password-gated edit room — client-derived room id (no relay secret).
// ---------------------------------------------------------------------------

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The relay room id for a password-gated edit link: `PBKDF2(password, link-salt)`.
 * The owner embeds a random `linkSalt` in the link and shares the password out of
 * band; everyone who knows the password derives the SAME id and meets in the same
 * room. A wrong password derives a DIFFERENT id (an empty room). 250k iterations
 * match the share password envelope, so brute-resistance is consistent. The only
 * weakness is offline brute-force of a weak password by a room-id observer — the
 * same tradeoff the view-link envelope already accepts, and the payoff is merely
 * joining an ephemeral room (the durable snapshot stays sealed + wallet-owned).
 */
export async function deriveRoomId(password: string, linkSalt: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: te.encode(linkSalt) as BufferSource, iterations: 250_000, hash: 'SHA-256' },
    base,
    256,
  );
  return hex(bits);
}

/** A high-entropy random id (hex) — the unguessable room id for a no-password edit link, or a link salt. */
export function randomShareId(bytes = 16): string {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)).buffer);
}

// ---------------------------------------------------------------------------
// 3. Share gate — emit content ops ONLY while a share is active.
// ---------------------------------------------------------------------------

const CONTENT_OPS = new Set([
  'note-op',
  'canvas-op',
  'note-writing',
  // plan-2026-06-24 collaborative-share ops — also share-gated.
  'sync-req',
  'y-sync',
  'el-op',
  'el-chunk',
  'el-need',
]);
export const isContentOp = (msg: PresenceMsg): boolean => CONTENT_OPS.has(msg.t);

export interface ShareGate {
  setActive(active: boolean): void;
  isActive(): boolean;
  /** Send a frame, dropping content ops while no share is active. Cursor/ping/hello/bye always pass. */
  emit(msg: PresenceMsg): void;
}

/** Wrap a raw `send` so content ops are suppressed unless a share is active. Pure (injected send) so it is node-testable. */
export function makeShareGate(send: (msg: PresenceMsg) => void): ShareGate {
  let active = false;
  return {
    setActive(a) {
      active = a;
    },
    isActive: () => active,
    emit(msg) {
      if (isContentOp(msg) && !active) return;
      send(msg);
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Soft lock — last-write-wins + a per-note "someone is editing" lock.
// ---------------------------------------------------------------------------

export const LOCK_TTL_MS = 5_000;

/** Per-note lock: which peer is editing and when their last `note-writing` ping arrived. */
export type LockMap = Record<string, { peerId: string; at: number }>;

/**
 * Fold a `note-writing` frame into the lock map. An `on` ping (re)claims the note
 * and refreshes its timestamp; an `off` ping clears the lock IF the same peer held
 * it. Other frame types pass through unchanged. Pure — returns a new map.
 */
export function reduceLocks(locks: LockMap, msg: PresenceMsg, now: number): LockMap {
  if (msg.t !== 'note-writing') return locks;
  if (msg.on) return { ...locks, [msg.noteId]: { peerId: msg.id, at: now } };
  const cur = locks[msg.noteId];
  if (cur && cur.peerId === msg.id) {
    const { [msg.noteId]: _drop, ...rest } = locks;
    return rest;
  }
  return locks;
}

/**
 * Who (if anyone) holds the soft lock on `noteId` against `selfId` right now.
 * Returns the holder's peer id, or null when the note is free — unheld, held by
 * self, or the lock has gone stale (auto-release `ttl` ms after the last ping).
 */
export function lockedBy(
  locks: LockMap,
  noteId: string,
  selfId: string,
  now: number,
  ttl = LOCK_TTL_MS,
): string | null {
  const cur = locks[noteId];
  if (!cur) return null;
  if (cur.peerId === selfId) return null;
  if (now - cur.at > ttl) return null; // auto-released
  return cur.peerId;
}

/** Take over a note: drop any other peer's lock locally so this client can edit (it then emits its own writing ping). */
export function takeOver(locks: LockMap, noteId: string): LockMap {
  if (!locks[noteId]) return locks;
  const { [noteId]: _drop, ...rest } = locks;
  return rest;
}

// ---------------------------------------------------------------------------
// 5. Content-frame builders.
// ---------------------------------------------------------------------------

export const noteOp = (id: string, noteId: string, body: string): PresenceMsg => ({ t: 'note-op', id, noteId, body });
export const noteWriting = (id: string, noteId: string, on: boolean): PresenceMsg => ({ t: 'note-writing', id, noteId, on });
export const canvasOp = (id: string, canvasId: string, layout: CanvasLayout): PresenceMsg => ({ t: 'canvas-op', id, canvasId, layout });

// ---------------------------------------------------------------------------
// 6. Base64 for binary payloads — the relay protocol is JSON text, Yjs is
//    binary, so a `y-sync` / `el-chunk` payload rides as base64. Pure, no DOM.
// ---------------------------------------------------------------------------

/** Encode bytes to a base64 string (browser btoa-free; works in node tests too). */
export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // btoa exists in the browser + jsdom; a node-only fallback via Buffer keeps the
  // pure cores testable without a DOM.
  const g = globalThis as { btoa?: (s: string) => string };
  if (g.btoa) return g.btoa(bin);
  return Buffer.from(bytes).toString('base64');
}

/** Decode a base64 string back to bytes. Returns an empty array on malformed input. */
export function b64ToBytes(b64: string): Uint8Array {
  const g = globalThis as { atob?: (s: string) => string };
  try {
    const bin = g.atob ? g.atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

// ---------------------------------------------------------------------------
// 7. Collaborative-share frame builders (plan 2026-06-24).
// ---------------------------------------------------------------------------

/** "I just joined this room — current state, please." Broadcast on join; the owner (or a present-peer fallback) answers. */
export const syncReq = (id: string): PresenceMsg => ({ t: 'sync-req', id });

/** A Yjs sync/awareness binary frame for note co-editing, carried as base64. */
export const ySync = (id: string, payload: Uint8Array): PresenceMsg => ({ t: 'y-sync', id, b: bytesToB64(payload) });

/** One full board element for canvas co-editing (applied through reconcile after sanitize). */
export const elOp = (id: string, canvasId: string, el: CanvasElement): PresenceMsg => ({ t: 'el-op', id, canvasId, el });

/** A chunk of a large board resync snapshot; `gen` tags one snapshot generation so chunks never interleave. */
export const elChunk = (
  id: string,
  canvasId: string,
  gen: string,
  seq: number,
  total: number,
  payload: Uint8Array,
): PresenceMsg => ({ t: 'el-chunk', id, canvasId, gen, seq, total, b: bytesToB64(payload) });

/** A selective re-request for the missing chunk seqs of one snapshot generation. */
export const elNeed = (id: string, canvasId: string, gen: string, seqs: number[]): PresenceMsg => ({ t: 'el-need', id, canvasId, gen, seqs });
