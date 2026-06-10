/**
 * Per-note sharing: publish a memory as a standalone Walrus blob —
 * public (plaintext, anyone with the link) or password-protected (AES-GCM,
 * key derived client-side; the password never leaves the device).
 *
 * Published blobs are wallet-owned like everything else; UNpublish is a
 * wallet-signed delete (destructive = wallet, the custody asymmetry).
 * The share registry is the CHAIN itself: published copies are found by
 * scanning wallet-owned blobs with `app: anima-pub` attributes — no local state.
 */
import { Transaction } from '@mysten/sui/transactions';
import type { Note } from './types.js';
import { serializeNote, parseNote } from './notes.js';
import type { QuiltDeps } from './quilts.js';
import { chainConfig } from './config.js';

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

export interface PublishedShare {
  blobId: string;
  blobObjectId: string;
  noteId: string;
  mode: 'public' | 'password';
  url: string; // reader URL (relative); aggregator URL also valid for public mode
}

export const shareUrl = (blobId: string, mode: 'public' | 'password') =>
  `/read.html?b=${encodeURIComponent(blobId)}${mode === 'password' ? '&locked=1' : ''}`;

export const aggregatorUrl = (blobId: string) => `${chainConfig.aggregator}/v1/blobs/${encodeURIComponent(blobId)}`;

/** Publish one note as a standalone blob (plaintext or password envelope), wallet-owned. */
export async function publishNote(
  deps: QuiltDeps,
  note: Note,
  opts: { password?: string; epochs?: number } = {},
): Promise<PublishedShare> {
  const mode: 'public' | 'password' = opts.password ? 'password' : 'public';
  const bytes = opts.password ? await sealWithPassword(note, opts.password) : te.encode(serializeNote(note));

  const result = await deps.suiClient.walrus.writeBlob({
    blob: bytes,
    epochs: opts.epochs ?? 53,
    deletable: true,
    signer: deps.agentSigner,
    attributes: { app: 'anima-pub', noteId: note.noteId, mode },
  });
  const blobObjectId: string = result.blobObject.id;

  // wallet owns the published artifact (unpublish = wallet-signed delete)
  const tx = new Transaction();
  tx.transferObjects([tx.object(blobObjectId)], deps.walletAddress);
  const tRes = await deps.suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: deps.agentSigner,
    options: { showEffects: true },
  });
  if (tRes.effects?.status?.status !== 'success') throw new Error('share transfer failed');
  await deps.suiClient.waitForTransaction({ digest: tRes.digest });

  return { blobId: result.blobId, blobObjectId, noteId: note.noteId, mode, url: shareUrl(result.blobId, mode) };
}

/** Chain-as-registry: list published copies (optionally for one note). */
export async function listPublished(
  deps: Pick<QuiltDeps, 'suiClient' | 'walletAddress'>,
  noteId?: string,
): Promise<PublishedShare[]> {
  const blobType: string = await deps.suiClient.walrus.getBlobType();
  const out: PublishedShare[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const page: any = await deps.suiClient.getOwnedObjects({
      owner: deps.walletAddress,
      filter: { StructType: blobType },
      cursor,
    });
    for (const o of page.data) {
      const id = o.data?.objectId;
      if (!id) continue;
      try {
        const attrs = await deps.suiClient.walrus.readBlobAttributes({ blobObjectId: id });
        if (attrs?.app !== 'anima-pub') continue;
        if (noteId && attrs.noteId !== noteId) continue;
        const obj = await deps.suiClient.walrus.getBlobObject(id);
        const { blobIdFromInt } = await import('@mysten/walrus');
        const raw: string = obj.blob_id ?? obj.blobId;
        const blobId = /^[0-9]+$/.test(raw) ? blobIdFromInt(BigInt(raw)) : raw;
        const mode = (attrs.mode as 'public' | 'password') ?? 'public';
        out.push({ blobId, blobObjectId: id, noteId: attrs.noteId, mode, url: shareUrl(blobId, mode) });
      } catch {
        /* not an attributed blob — skip */
      }
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return out;
}
