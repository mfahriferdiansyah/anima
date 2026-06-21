/**
 * Pure crypto + URL leaf for per-note sharing (plan 008 U3, KTD6).
 *
 * Split out of `share.ts` so the chromeless reader's VIEW read path can open a
 * password envelope and build a reader URL WITHOUT pulling the wallet stack:
 * this module imports nothing from `@mysten/*` (only `notes.js`, which is itself
 * `@mysten`-free). `share.ts` re-exports every symbol here, so existing consumers
 * (`covers.ts`, the `index.ts` barrel, `share.test.ts`) keep importing unchanged.
 *
 * The chain-touching ops (`publishNote`/`listPublished`/`unpublishNote`/
 * `aggregatorUrl`) stay in `share.ts` — they use `chainConfig` + `Transaction`.
 */
import type { Note } from './types.js';
import { serializeNote, parseNote } from './notes.js';

const te = new TextEncoder();
const td = new TextDecoder();

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface PasswordEnvelope {
  v: 1;
  kind: 'anima-share';
  salt: string; // base64
  iv: string; // base64
  data: string; // base64 AES-GCM ciphertext of the serialized note
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 250_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealWithPassword(note: Note, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, te.encode(serializeNote(note))),
  );
  const env: PasswordEnvelope = { v: 1, kind: 'anima-share', salt: b64(salt), iv: b64(iv), data: b64(ct) };
  return te.encode(JSON.stringify(env));
}

export async function openWithPassword(bytes: Uint8Array, password: string): Promise<Note> {
  const env = JSON.parse(td.decode(bytes)) as PasswordEnvelope;
  if (env.kind !== 'anima-share') throw new Error('not an anima share envelope');
  const key = await deriveKey(password, unb64(env.salt));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(env.iv) as BufferSource },
    key,
    unb64(env.data) as BufferSource,
  );
  return parseNote(td.decode(new Uint8Array(plain)));
}

/** Is this blob a password envelope (vs plaintext markdown)? */
export function isPasswordShare(bytes: Uint8Array): boolean {
  try {
    const head = td.decode(bytes.slice(0, 64));
    return head.includes('"anima-share"');
  } catch {
    return false;
  }
}

export const shareUrl = (blobId: string, mode: 'public' | 'password') =>
  `/read.html?b=${encodeURIComponent(blobId)}${mode === 'password' ? '&locked=1' : ''}`;
