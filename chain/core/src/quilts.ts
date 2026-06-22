/**
 * Quilt-level vault operations (option-b ownership, proven at the U1 gate):
 * the agent key signs writes (owner = agent during the flow), then the Blob
 * object is transferred to the WALLET in a follow-up tx — so every memory
 * blob sits in the user's wallet on-chain, and only the wallet can delete.
 *
 * One quilt per chat turn. Forget = rewrite survivors FIRST, then delete the
 * old quilt (per-patch deletion does not exist on Walrus).
 */
import { WalrusFile, blobIdFromInt } from '@mysten/walrus';
import type { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import type { Note, WriteResult, IndexedNote } from './types.js';
import { serializeNote, parseNote, noteIdentifier } from './notes.js';
import type { SealVault } from './seal.js';

const STORAGE_EPOCHS = 53; // max ahead — testnet epochs ≈ 1 day; survives the judging window

export interface QuiltDeps {
  suiClient: any; // SuiJsonRpcClient + walrus extension
  seal: SealVault;
  agentSigner: Signer;
  walletAddress: string;
  vaultId: string;
}

/** Write a batch of notes (one chat turn) as a single quilt; transfer the blob to the wallet. */
export async function writeTurn(deps: QuiltDeps, notes: Note[]): Promise<WriteResult> {
  if (notes.length === 0) throw new Error('writeTurn: empty batch');

  const files = await Promise.all(
    notes.map(async (n) =>
      WalrusFile.from({
        contents: await deps.seal.encryptNote(n.noteId, new TextEncoder().encode(serializeNote(n))),
        identifier: noteIdentifier(n),
        tags: { app: 'anima', noteId: n.noteId, version: String(n.version) },
      }),
    ),
  );

  const written = await deps.suiClient.walrus.writeFiles({
    files,
    epochs: STORAGE_EPOCHS,
    deletable: true,
    signer: deps.agentSigner,
    attributes: { app: 'anima', vault: deps.vaultId },
  });

  const blobObjectId: string = written[0].blobObject.id;

  // option (b): move the Blob object into the user's wallet
  const tx = new Transaction();
  tx.transferObjects([tx.object(blobObjectId)], deps.walletAddress);
  const tRes = await deps.suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: deps.agentSigner,
    options: { showEffects: true },
  });
  if (tRes.effects?.status?.status !== 'success') {
    throw new Error(`blob transfer to wallet failed: ${JSON.stringify(tRes.effects?.status)}`);
  }
  await deps.suiClient.waitForTransaction({ digest: tRes.digest });

  return {
    quiltBlobId: written[0].blobId,
    blobObjectId,
    transferDigest: tRes.digest,
    perNote: notes.map((n, i) => ({ noteId: n.noteId, version: n.version, quiltPatchId: written[i].id })),
  };
}

/** Enumerate the vault's quilt Blob objects owned by the wallet (option-b discovery). */
export async function listVaultQuilts(deps: Pick<QuiltDeps, 'suiClient' | 'walletAddress' | 'vaultId'>): Promise<string[]> {
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

  // keep only ANIMA blobs for THIS vault (on-chain blob attributes)
  const mine: string[] = [];
  for (const id of ids) {
    try {
      const attrs = await deps.suiClient.walrus.readBlobAttributes({ blobObjectId: id });
      if (attrs?.app === 'anima' && attrs?.vault === deps.vaultId) mine.push(id);
    } catch {
      // not a walrus-attribute blob — skip
    }
  }
  return mine;
}

/**
 * Route a walrus client's blob-byte reads through the Walrus AGGREGATOR (one HTTP
 * GET, reconstruction done server-side) instead of the SDK's direct storage-node
 * read. The browser cannot read slivers directly: the per-storage-node sliver
 * endpoints are not CORS-enabled, so `getBlob().files()` fans a primary-sliver
 * request out across the WHOLE committee, every one fails, and `readOneQuilt`'s
 * retry loop re-runs it — hundreds of canceled requests per quilt. (Node has no
 * CORS, so its targeted-sliver read works in ~3 requests; this is browser-only.)
 *
 * Two overrides, applied once to the shared browser client:
 *  - `readBlob` → fetch `{aggregator}/v1/blobs/{blobId}` (the same Seal-encrypted,
 *    erasure-reconstructed bytes the storage nodes would yield).
 *  - `getBlob` → eagerly prime that full blob the moment it is opened, so the
 *    quilt reader serves its index + every patch from cached bytes and never
 *    attempts a (CORS-doomed) secondary-sliver or blob-metadata committee read.
 *
 * The SDK still parses the quilt index + tags and the caller still Seal-decrypts
 * each patch client-side, so the resurrection gate (Walrus + Seal alone, no DB)
 * is unchanged — only the byte-transport for an already-public blob moves to the
 * aggregator. Pure (injected `fetchImpl`) so it is node-testable without the wasm.
 */
export function installAggregatorReads(
  walrus: any,
  aggregatorUrl: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): void {
  walrus.readBlob = async ({ blobId }: { blobId: string }): Promise<Uint8Array> => {
    const res = await fetchImpl(`${aggregatorUrl}/v1/blobs/${encodeURIComponent(blobId)}`);
    if (!res.ok) throw new Error(`aggregator read failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const origGetBlob = walrus.getBlob.bind(walrus);
  walrus.getBlob = async (args: { blobId: string }): Promise<any> => {
    const blob = await origGetBlob(args);
    await blob.asFile().bytes(); // -> readBlob -> aggregator; cached on the blob reader
    return blob;
  };
}

/** Read + decrypt every note in the given quilt blob objects. */
export async function readAll(
  deps: Pick<QuiltDeps, 'suiClient' | 'seal'>,
  blobObjectIds: string[],
): Promise<IndexedNote[]> {
  const out: IndexedNote[] = [];
  for (const blobObjectId of blobObjectIds) {
    out.push(...(await readOneQuilt(deps, blobObjectId)));
  }
  return out;
}

/**
 * Read + decrypt one quilt blob. WalrusFile is lazy — metadata fetch fires at
 * bytes()/getTags(), so the WHOLE extraction sits inside the retry loop
 * (freshly-certified blobs can lag on storage nodes for tens of seconds).
 */
async function readOneQuilt(
  deps: Pick<QuiltDeps, 'suiClient' | 'seal'>,
  blobObjectId: string,
): Promise<IndexedNote[]> {
  const obj = await deps.suiClient.walrus.getBlobObject(blobObjectId);
  // on-chain blob_id is a decimal u256 — convert to the base64url blob id walrus APIs expect
  const rawId: string = obj.blob_id ?? obj.blobId;
  const blobId: string = /^[0-9]+$/.test(rawId) ? blobIdFromInt(BigInt(rawId)) : rawId;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const blob = await deps.suiClient.walrus.getBlob({ blobId });
      const files = await blob.files();
      const result: IndexedNote[] = [];
      for (const f of files) {
        const tags = await f.getTags();
        if (tags.app !== 'anima') continue;
        const encrypted = await f.bytes();
        const plain = await deps.seal.decryptNote(tags.noteId, encrypted);
        const note = parseNote(new TextDecoder().decode(plain));
        result.push({
          note,
          location: {
            quiltPatchId: (await f.getIdentifier()) ?? noteIdentifier(note),
            quiltBlobId: blobId,
            blobObjectId,
          },
        });
      }
      return result;
    } catch (e: any) {
      lastErr = e;
      if (e?.constructor?.name === 'NoAccessError') throw e; // terminal
      try { (deps.suiClient.walrus as any).reset?.(); } catch { /* noop */ }
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * Forget planning (shared by browser + node paths): which notes must be
 * rewritten (survivors sharing a quilt with a forgotten note) and which
 * quilt blobs die. Survivors-first ordering is the caller's contract (edge #4).
 */
export function buildForgetPlan(current: IndexedNote[], noteIdsToForget: string[]) {
  const forget = new Set(noteIdsToForget);
  const affectedBlobs = new Set(
    current.filter((c) => forget.has(c.note.noteId)).map((c) => c.location.blobObjectId),
  );
  const survivors = current
    .filter((c) => affectedBlobs.has(c.location.blobObjectId) && !forget.has(c.note.noteId))
    .map((c) => c.note);
  const forgotten = current.filter((c) => forget.has(c.note.noteId)).map((c) => c.note);
  return { survivors, forgotten, affectedBlobObjectIds: [...affectedBlobs] };
}

/** Build ONE wallet PTB deleting multiple quilt blobs (one popup, many deletions). */
export async function buildDeleteQuiltsTx(
  deps: Pick<QuiltDeps, 'suiClient' | 'walletAddress'>,
  blobObjectIds: string[],
): Promise<Transaction> {
  let tx = new Transaction();
  for (const blobObjectId of blobObjectIds) {
    tx = await deps.suiClient.walrus.deleteBlobTransaction({
      blobObjectId,
      owner: deps.walletAddress,
      transaction: tx,
    });
  }
  return tx;
}

/**
 * Forget notes for real (node path — scripts/MCP with a raw wallet Signer).
 * Survivors-first ordering (edge #4): notes sharing a quilt with a forgotten
 * note are REWRITTEN into a new quilt before the old quilt is deleted.
 * Deletion is signed by the WALLET (it owns the blobs — the wallet-gate is real).
 */
export async function forgetNotes(
  deps: QuiltDeps & { walletSigner: Signer },
  current: IndexedNote[],
  noteIdsToForget: string[],
): Promise<{ rewritten: WriteResult | null; deletedBlobObjects: string[] }> {
  const forget = new Set(noteIdsToForget);
  const affectedBlobs = new Set(
    current.filter((c) => forget.has(c.note.noteId)).map((c) => c.location.blobObjectId),
  );
  if (affectedBlobs.size === 0) return { rewritten: null, deletedBlobObjects: [] };

  const survivors = current
    .filter((c) => affectedBlobs.has(c.location.blobObjectId) && !forget.has(c.note.noteId))
    .map((c) => c.note);

  // 1) rewrite survivors first
  let rewritten: WriteResult | null = null;
  if (survivors.length > 0) {
    rewritten = await writeTurn(deps, survivors);
  }

  // 2) delete old quilts (wallet signs — it owns them)
  const deleted: string[] = [];
  for (const blobObjectId of affectedBlobs) {
    await deps.suiClient.walrus.executeDeleteBlobTransaction({
      blobObjectId,
      signer: deps.walletSigner,
    });
    deleted.push(blobObjectId);
  }
  return { rewritten, deletedBlobObjects: deleted };
}
