/**
 * The per-device agent keypair, persisted in IndexedDB and keyed by the owner
 * wallet address so two wallets on one device never collide (`agentKey:${owner}`).
 * This is the Sui `Signer` the SealVault uses to self-sign its SessionKey — see
 * docs/plans/2026-06-21-004-feat-web3-foundation-plan.md (U4).
 *
 * Idempotency note: the plan frames get-or-create as a React Query `queryFn`;
 * here it is a module-level in-flight promise map instead — same StrictMode /
 * concurrent-safety guarantee, but DOM-free (TanStack's React adapter would pull
 * in DOM; these tests run under node-only vitest with no jsdom).
 *
 * Path A (raw secret bytes in IDB). Path B (WebCrypto-wrapped) is a harden-later
 * concern. `hasAgentKey` is a PURE local IDB-presence check; the allowlist-aware
 * first-run / needs-pairing / ready distinction is Tier-1 session logic, not here.
 */
import { get, set } from 'idb-keyval';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const idbKey = (owner: string) => `agentKey:${owner}`;

/**
 * In-flight get-or-create promises, keyed by owner. Registering the promise
 * synchronously (before the first `await`) makes a StrictMode double-mount or
 * two concurrent callers share one create — so `set` runs exactly once.
 */
const inFlight = new Map<string, Promise<Ed25519Keypair>>();

/**
 * Get-or-create the agent keypair for `owner`. On a miss, generates a fresh
 * keypair and persists its bech32 secret; on a hit, rehydrates from the store.
 * Concurrent-safe and idempotent via the in-flight map.
 */
export async function getOrCreateAgentKey(owner: string): Promise<Ed25519Keypair> {
  const existing = inFlight.get(owner);
  if (existing) return existing;

  const pending = (async () => {
    const stored = await get(idbKey(owner));
    if (stored != null) return Ed25519Keypair.fromSecretKey(stored as string);
    const keypair = new Ed25519Keypair();
    await set(idbKey(owner), keypair.getSecretKey());
    return keypair;
  })();

  inFlight.set(owner, pending);
  try {
    return await pending;
  } finally {
    inFlight.delete(owner);
  }
}

/** True iff a local agent key already exists for `owner` (pure IDB presence). */
export async function hasAgentKey(owner: string): Promise<boolean> {
  return (await get(idbKey(owner))) != null;
}

/** The agent's Sui address — its on-chain identity for allowlisting. */
export function agentAddress(kp: Ed25519Keypair): string {
  return kp.toSuiAddress();
}

/** Clears the in-flight map between tests (mirrors the mock stores' reset pattern). */
export function __resetAgentKeyForTests(): void {
  inFlight.clear();
}
