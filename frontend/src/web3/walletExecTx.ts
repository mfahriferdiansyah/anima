/**
 * Wallet execution adapter (plan U5). dapp-kit's default
 * `useSignAndExecuteTransaction` runs the tx through the wallet's own
 * `signAndExecuteTransactionBlock`, which returns `rawEffects` ONLY — no
 * `objectChanges`. chain/core's `vaultIdFromCreateResult` scans
 * `res.objectChanges` for a newly-created `::vault::Vault`, so onboarding
 * breaks silently without an `execute` override that re-runs the signed tx
 * through OUR client with `showObjectChanges`. This is the browser replacement
 * for chain/core's Node-only `execTx` (vault.ts) — same discipline: force the
 * richer options, then `waitForTransaction` so dependent reads don't hit
 * stale-version errors.
 *
 * No Tier-0 consumer yet; it's a Tier-1 primitive onboarding/pairing will use.
 */
import { useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { TxExecutionError } from './onchainToast';

/** The slice of the client `makeExecuteOverride` needs — typed loosely so the real `SuiClient` satisfies it. */
interface ExecuteCapableClient {
  executeTransactionBlock: (args: {
    transactionBlock: string;
    signature: string;
    options: Record<string, boolean>;
  }) => Promise<unknown>;
}

/**
 * PURE factory (node-testable): builds the dapp-kit `execute` callback that
 * re-runs the wallet-signed tx through `client` with `showObjectChanges` (plus
 * `showRawEffects`/`showEffects`) forced on, so the result carries the
 * objectChanges chain/core parses. Returns the raw client result.
 */
export function makeExecuteOverride(client: ExecuteCapableClient) {
  return async ({ bytes, signature }: { bytes: string; signature: string }): Promise<unknown> =>
    client.executeTransactionBlock({
      transactionBlock: bytes,
      signature,
      options: { showRawEffects: true, showObjectChanges: true, showEffects: true },
    });
}

/**
 * PURE (node-testable): reads the on-chain effects status off an `execTx` result.
 * dapp-kit's default result carries rawEffects only, but `makeExecuteOverride`
 * forces `showEffects`, so a real wallet tx's result carries `effects.status`.
 * Returns a failure descriptor (digest + reason) when the tx EXECUTED but failed
 * (a Move abort); null when it succeeded OR the status is unreadable — fail-open,
 * so a shape we can't parse degrades to today's behavior, never a fabricated
 * failure. The on-chain failure path was the gap: without reading status a failed
 * tx resolved as success and the provenance receipt lied.
 */
export function txFailure(res: unknown): { digest?: string; reason: string } | null {
  if (!res || typeof res !== 'object') return null;
  const r = res as { digest?: unknown; effects?: { status?: { status?: unknown; error?: unknown } } };
  const status = r.effects?.status?.status;
  if (typeof status !== 'string' || status === 'success') return null;
  const digest = typeof r.digest === 'string' && r.digest ? r.digest : undefined;
  const error = r.effects?.status?.error;
  return { digest, reason: typeof error === 'string' && error ? error : 'Transaction failed on-chain' };
}

/**
 * THIN React hook: wires the dapp-kit client + `useSignAndExecuteTransaction`
 * with the override above, exposing `execTx(transaction)` that resolves to a
 * result carrying `objectChanges`. Mirrors chain/core's `execTx`: awaits
 * `waitForTransaction({ digest })`, then THROWS a `TxExecutionError` on a
 * non-success on-chain status before returning. Not unit-tested (hooks need a
 * DOM); the override factory and `txFailure` are the node-tested seams.
 */
export function useWalletExecTx() {
  const client = useSuiClient();
  // dapp-kit constrains the `execute` return to `ExecuteTransactionResult`
  // (`{ digest; rawEffects? } | { effects? }`) — which excludes objectChanges.
  // Cast the override to the digest-bearing member so `Result` infers cleanly;
  // the runtime object still carries the objectChanges our override forced on.
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction({
    execute: makeExecuteOverride(client) as (input: {
      bytes: string;
      signature: string;
    }) => Promise<{ digest: string }>,
  });

  async function execTx(transaction: unknown): Promise<unknown> {
    const res = await signAndExecute({ transaction: transaction as never });
    await client.waitForTransaction({ digest: res.digest });
    // A tx can COMMIT yet FAIL (Move abort): read the status so a failed tx
    // throws (carrying its digest for provenance) instead of resolving as a
    // success the receipt would then certify as sealed.
    const fail = txFailure(res);
    if (fail) throw new TxExecutionError(fail.reason, fail.digest ?? res.digest);
    return res;
  }

  return { execTx };
}
