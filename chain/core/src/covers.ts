/**
 * Cover blob operations: upload a cover image as a standalone Walrus blob
 * (Seal-encrypted for private, plain for public), reference it from the note's
 * `cover` frontmatter, and clean it up on forget.
 *
 * Cover blobs are tagged `app: 'anima-cover'` — a DISTINCT value from the quilt
 * tag `app: 'anima'` — so `listVaultQuilts` never picks them up, and the
 * resurrection rebuild never tries to parse a cover blob as a quilt.
 */
import { Transaction } from '@mysten/sui/transactions';
import type { QuiltDeps } from './quilts.js';
import { aggregatorUrl } from './share.js';

const STORAGE_EPOCHS = 53;

/** Upload a cover image blob. Private covers are Seal-encrypted per-note. */
export async function uploadCover(
  deps: QuiltDeps,
  bytes: Uint8Array,
  opts: { noteId: string; public?: boolean },
): Promise<{ blobId: string; ref: string; blobObjectId: string }> {
  const isPublic = opts.public ?? false;
  const payload = isPublic ? bytes : await deps.seal.encryptNote(opts.noteId, bytes);

  const result = await deps.suiClient.walrus.writeBlob({
    blob: payload,
    epochs: STORAGE_EPOCHS,
    deletable: true,
    signer: deps.agentSigner,
    attributes: {
      app: 'anima-cover',
      vault: deps.vaultId,
      noteId: opts.noteId,
      mode: isPublic ? 'public' : 'sealed',
    },
  });
  const blobObjectId: string = result.blobObject.id;

  // transfer the blob object to the wallet (wallet owns, wallet deletes)
  const tx = new Transaction();
  tx.transferObjects([tx.object(blobObjectId)], deps.walletAddress);
  const tRes = await deps.suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: deps.agentSigner,
    options: { showEffects: true },
  });
  if (tRes.effects?.status?.status !== 'success') throw new Error('cover transfer failed');
  await deps.suiClient.waitForTransaction({ digest: tRes.digest });

  const ref = `${isPublic ? 'blob' : 'seal'}:${result.blobId}`;
  return { blobId: result.blobId, ref, blobObjectId };
}

/** Parse a cover ref string into its kind + value. */
export function parseCoverRef(ref: string): { kind: 'preset' | 'blob' | 'seal'; value: string } {
  if (ref.startsWith('seal:')) return { kind: 'seal', value: ref.slice(5) };
  if (ref.startsWith('blob:')) return { kind: 'blob', value: ref.slice(5) };
  return { kind: 'preset', value: ref };
}

/** Fetch and decrypt (if sealed) a cover blob's raw image bytes. */
export async function readCoverBytes(
  deps: Pick<QuiltDeps, 'suiClient' | 'seal'>,
  ref: string,
  noteId: string,
): Promise<Uint8Array> {
  const { kind, value: blobId } = parseCoverRef(ref);
  if (kind === 'preset') throw new Error('readCoverBytes: presets are not blobs');
  const res = await fetch(aggregatorUrl(blobId));
  if (!res.ok) throw new Error(`cover fetch failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (kind === 'seal') return deps.seal.decryptNote(noteId, bytes);
  return bytes;
}

/**
 * Enumerate cover Blob objects owned by the wallet for this vault.
 * Optionally filter to a specific set of noteIds (for targeted forget cleanup).
 * Returns Sui OBJECT ids (for the delete PTB), mirroring listVaultQuilts.
 */
export async function listVaultCovers(
  deps: Pick<QuiltDeps, 'suiClient' | 'walletAddress' | 'vaultId'>,
  noteIds?: string[],
): Promise<string[]> {
  const blobType: string = await deps.suiClient.walrus.getBlobType();
  const ids: string[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const page: any = await deps.suiClient.getOwnedObjects({
      owner: deps.walletAddress,
      filter: { StructType: blobType },
      options: { showType: true },
      cursor,
    });
    ids.push(...page.data.map((o: any) => o.data?.objectId).filter(Boolean));
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);

  const mine: string[] = [];
  for (const id of ids) {
    try {
      const attrs = await deps.suiClient.walrus.readBlobAttributes({ blobObjectId: id });
      if (attrs?.app !== 'anima-cover' || attrs?.vault !== deps.vaultId) continue;
      if (noteIds && !noteIds.includes(attrs.noteId)) continue;
      mine.push(id);
    } catch {
      // not an attributed blob — skip
    }
  }
  return mine;
}
