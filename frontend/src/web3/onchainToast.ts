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

/**
 * Thrown when a wallet-signed tx EXECUTES but its on-chain effects report failure
 * (a Move abort, a runtime error) — as opposed to never reaching the chain (a
 * declined popup, a network drop). It carries the `digest` so the receipt can
 * still link the failed tx's provenance: honest, not a silent success.
 * `walletExecTx`'s `execTx` is the single throw site; `runWithReceipt` below is
 * the catch site that turns it into a `tx-failed` receipt. (Lives here, not in
 * walletExecTx, so onchainToast stays dapp-kit-free for its node tests.)
 */
export class TxExecutionError extends Error {
  readonly digest?: string;
  constructor(message: string, digest?: string) {
    super(message);
    this.name = 'TxExecutionError';
    this.digest = digest;
  }
}

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
 * A tx that EXECUTED but failed on-chain (a `TxExecutionError` carrying a digest)
 * is real provenance: the receipt terminalizes to an honest `tx-failed` pill that
 * KEEPS its "View provenance" link (App.tsx auto-dismisses it like a success).
 * Every OTHER failure (a declined popup, a network drop, no digest) keeps the
 * original behavior: the in-flight receipt is DISMISSED so the caller's own error
 * path (a dialog message, a chat retry, a thrown settings error) stays the single
 * source of truth — no duplicate error toast. Either way the error re-throws, so
 * the caller halts. Returns whatever `run` resolves as its `result`.
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
    if (e instanceof TxExecutionError && e.digest) {
      // Committed-but-failed: keep an honest, linkable receipt instead of a green
      // success. 'tx-failed' is terminal (not encrypting|certifying), so the
      // forgetEverything quiesce loop never strands on it.
      vaultData.updateWriteEvent(id, { phase: 'tx-failed', provenanceUrl: txProvenanceUrl(e.digest) });
      throw e;
    }
    // Never reached the chain (declined / network / no digest): terminalize the
    // inline write-state to a NON-blocking 'failed' BEFORE dropping the card.
    // `dismissWriteEvent` only removes the toast event — it never clears
    // `writeStates` — so a bare dismiss would strand this key at 'certifying', and
    // `forgetEverything`'s quiesce loop (which scans every writeState for an
    // in-flight write) would then spin forever. Both mutations run synchronously,
    // so React coalesces them — the card never flashes 'failed', it just
    // disappears (the op owns its own error surface).
    vaultData.updateWriteEvent(id, { phase: 'failed' });
    vaultData.dismissWriteEvent(id);
    throw e;
  }
}
