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
 * THIN React hook: wires the dapp-kit client + `useSignAndExecuteTransaction`
 * with the override above, exposing `execTx(transaction)` that resolves to a
 * result carrying `objectChanges`. Mirrors chain/core's `execTx`: awaits
 * `waitForTransaction({ digest })` before returning. Not unit-tested (hooks
 * need a DOM); the override factory is the node-tested seam.
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
    return res;
  }

  return { execTx };
}
