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
import { serializeNote } from './notes.js';
import { buildDeleteQuiltsTx, type QuiltDeps } from './quilts.js';
import { chainConfig } from './config.js';
import { sealWithPassword, shareUrl } from './share-crypto.js';

const te = new TextEncoder();

// The crypto + URL leaf (`share-crypto.ts`) is `@mysten`-free so the chromeless
// reader's view path can reuse it without pulling the wallet stack (KTD6). Those
// symbols are re-exported here so existing consumers keep importing from `share.js`.
export {
  sealWithPassword,
  openWithPassword,
  isPasswordShare,
  shareUrl,
  type PasswordEnvelope,
} from './share-crypto.js';

export interface PublishedShare {
  blobId: string;
  blobObjectId: string;
  noteId: string;
  mode: 'public' | 'password';
  /** 'note' = a published memory; 'canvas' = a read-only board snapshot. */
  kind: 'note' | 'canvas';
  url: string; // reader URL (relative); aggregator URL also valid for public mode
}

/** Walrus `app` attribute per kind — distinct so a canvas snapshot never lists as a note. */
const APP_BY_KIND = { note: 'anima-pub', canvas: 'anima-canvas-pub' } as const;
const KIND_BY_APP: Record<string, 'note' | 'canvas'> = { 'anima-pub': 'note', 'anima-canvas-pub': 'canvas' };

export const aggregatorUrl = (blobId: string) => `${chainConfig.aggregator}/v1/blobs/${encodeURIComponent(blobId)}`;

/**
 * Publish one note as a standalone blob (plaintext or password envelope),
 * wallet-owned. A canvas read-only snapshot rides the SAME path (`kind: 'canvas'`):
 * the snapshot JSON is carried as the note body, so crypto, transfer and the
 * reader's decode are reused unchanged — only the `app` attribute differs.
 */
export async function publishNote(
  deps: QuiltDeps,
  note: Note,
  opts: { password?: string; epochs?: number; kind?: 'note' | 'canvas' } = {},
): Promise<PublishedShare> {
  const mode: 'public' | 'password' = opts.password ? 'password' : 'public';
  const kind = opts.kind ?? 'note';
  const bytes = opts.password ? await sealWithPassword(note, opts.password) : te.encode(serializeNote(note));

  const result = await deps.suiClient.walrus.writeBlob({
    blob: bytes,
    epochs: opts.epochs ?? 53,
    deletable: true,
    signer: deps.agentSigner,
    attributes: { app: APP_BY_KIND[kind], noteId: note.noteId, mode },
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

  return { blobId: result.blobId, blobObjectId, noteId: note.noteId, mode, kind, url: shareUrl(result.blobId, mode) };
}

/**
 * Unpublish a view link: build the wallet-signed delete of its `anima-pub` blob.
 * Core builds, the caller signs (the wallet owns the published artifact, so the
 * destructive op is wallet-gated (the custody asymmetry). Mirrors the forget /
 * cover delete seam: returns the Transaction for the frontend's `runDestructiveTx`.
 */
export function unpublishNote(
  deps: Pick<QuiltDeps, 'suiClient' | 'walletAddress'>,
  blobObjectId: string,
): Promise<Transaction> {
  return buildDeleteQuiltsTx(deps, [blobObjectId]);
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
        const kind = attrs?.app ? KIND_BY_APP[attrs.app] : undefined;
        if (!kind) continue;
        if (noteId && attrs.noteId !== noteId) continue;
        const obj = await deps.suiClient.walrus.getBlobObject(id);
        const { blobIdFromInt } = await import('@mysten/walrus');
        const raw: string = obj.blob_id ?? obj.blobId;
        const blobId = /^[0-9]+$/.test(raw) ? blobIdFromInt(BigInt(raw)) : raw;
        const mode = (attrs.mode as 'public' | 'password') ?? 'public';
        out.push({ blobId, blobObjectId: id, noteId: attrs.noteId, mode, kind, url: shareUrl(blobId, mode) });
      } catch {
        /* not an attributed blob — skip */
      }
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return out;
}
