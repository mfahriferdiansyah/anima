/**
 * On-chain receipt toasts — the general-purpose sibling of the note-save
 * write-state (useVault `persist`). Every operation that lands a NEW on-chain
 * artifact (a published blob, a registered agent, a forget tx, a cover upload…)
 * routes through `runWithReceipt` so it surfaces the SAME global bottom-stack
 * toast a note save does: a "…ing" pill while the tx is in flight, resolving to a
 * success pill with a clickable **View provenance** link.
 *
 * Note saves keep their own richer lifecycle (encrypting → certifying →
 * certified, with retry/top-up) in useVault; this is for the one-shot ops whose
 * only states are "in flight" → "done(provenance)" → (their own error path).
 *
 * The high-frequency canvas content autosaves (layout/drawings) deliberately do
 * NOT use this — they fire continuously while editing and supersede their own
 * blob each save, so a per-save provenance link would flicker and point at a
 * stale blob. They keep the quiet `savingLayout` indicator instead.
 */
import { vaultData } from './vaultData';
import type { OnchainLabels } from '../components/WriteStateCard';

const SUISCAN = 'https://suiscan.xyz/testnet';

/** Provenance link for a created/owned object (a blob object, a Vault, …). */
export function objectProvenanceUrl(objectId: string): string {
  return `${SUISCAN}/object/${objectId}`;
}

/** Provenance link for a transaction (deletes/registers, where the artifact is the tx itself). */
export function txProvenanceUrl(digest: string): string {
  return `${SUISCAN}/tx/${digest}`;
}

/** Best-effort tx digest from a wallet `execTx` result (used for tx-provenance receipts). */
export function digestOf(res: unknown): string | undefined {
  if (res && typeof res === 'object' && 'digest' in res) {
    const d = (res as { digest: unknown }).digest;
    if (typeof d === 'string' && d) return d;
  }
  return undefined;
}

export interface ReceiptOpts {
  /** Dedupe slot in the write-state map (reuses the `noteId` field; any stable id). */
  key: string;
  /** The toast's secondary line while in flight (the affected thing's name). */
  title: string;
  /** Pending + success copy ("Publishing" → "Link published"). */
  labels: OnchainLabels;
}

/**
 * Run an on-chain op behind a global provenance toast: opens a `certifying`
 * receipt with `opts.labels`, and on success resolves it to `certified` carrying
 * the `provenanceUrl` the `run` callback returns → the "View provenance" link.
 *
 * On failure the in-flight receipt is DISMISSED and the error re-thrown, so the
 * caller's own error path (a dialog message, a chat retry, a thrown settings
 * error) stays the single source of truth for failures — no duplicate error
 * toast. Returns whatever `run` resolves as its `result`.
 */
export async function runWithReceipt<T>(
  opts: ReceiptOpts,
  run: () => Promise<{ result: T; provenanceUrl: string }>,
): Promise<T> {
  const id = vaultData.beginWriteEvent({
    noteId: opts.key,
    noteTitle: opts.title,
    state: { phase: 'certifying' },
    labels: opts.labels,
  });
  try {
    const { result, provenanceUrl } = await run();
    vaultData.updateWriteEvent(id, { phase: 'certified', blobObjectId: '', provenanceUrl });
    return result;
  } catch (e) {
    // Terminalize the inline write-state to a NON-blocking 'failed' BEFORE dropping
    // the card. `dismissWriteEvent` only removes the toast event — it never clears
    // `writeStates` — so a bare dismiss would strand this key at 'certifying', and
    // `forgetEverything`'s quiesce loop (which scans every writeState for an
    // in-flight write) would then spin forever. A declined wallet popup is an
    // expected path here, so this must not poison a later wipe. Both mutations run
    // synchronously in this catch, so React coalesces them — the card never flashes
    // 'failed', it just disappears (the op owns its own error surface).
    vaultData.updateWriteEvent(id, { phase: 'failed' });
    vaultData.dismissWriteEvent(id);
    throw e;
  }
}
