/**
 * The real session engine (plan U3) — the six-phase machine
 * (disconnected | checking | first-run | needs-pairing | rebuilding | ready)
 * driven by real `discoverVault` + agent-key allowlist membership + the
 * onboarding/pairing PTBs + the resurrection rebuild loop that publishes the
 * shared `vaultData` index. It replaces mocks/sessionStore.ts with the same
 * `SessionState` union and the same exported actions, so no page rewrites.
 *
 * The wallet/chain primitives can't be reached from a plain module (signing
 * needs React hooks), so the React layer (`useVaultSession`) injects them via
 * `configureSession`; the actions read the wired deps. The store + the pure
 * `deriveStartPhase` are node-testable; the async orchestration is integration-
 * only (a live wallet + backend prove it — those gates are run separately).
 *
 * A `generation` counter is the real analog of the mock's stale-timer guard: a
 * `readAll`/decrypt that resolves after a disconnect or ACCOUNT SWITCH must not
 * publish a wrong-account index into the shared spine.
 */
import type { Signer } from '@mysten/sui/cryptography';
import {
  VaultIndex,
  SealVault,
  discoverVault,
  listVaultQuilts,
  readAll,
  buildOnboardingTx,
  buildRegisterAgentTx,
  vaultIdFromCreateResult,
  ensureAgentWal,
  preflight,
  suiBalance,
  syncNewQuilts,
  NoAccessError,
  type QuiltDeps,
} from '../../../chain/core/src/index.js';
import { createStore } from '../mocks/store';
import { getSuiClient } from './suiClient';
import { vaultData } from './vaultData';
import { runWithReceipt, objectProvenanceUrl, txProvenanceUrl, digestOf } from './onchainToast';
import { loadIndexCache, saveIndexCache, clearIndexCache, enableIndexCache } from './indexCache';

// 0.3 SUI: clears ensureAgentWal's 0.25 SUI swap floor AND leaves ≥0.1 SUI gas
// after the swap, so a freshly-onboarded agent has WAL and can write (the 0.2
// default would leave it with 0 WAL and a "ready" that can't persist).
const FUND_AGENT_MIST = 300_000_000n;

// The pairing/onboarding tx splits FUND_AGENT_MIST out of the OWNER wallet to
// fund the device agent AND pays its own gas, so the wallet must hold the
// funding PLUS a gas reserve — otherwise the wallet approval bounces with a
// cryptic gas error and the user is left blind. We gate on funding + reserve.
const FUND_GAS_RESERVE_MIST = 50_000_000n; // ~0.05 SUI headroom for the funding tx's gas
const MIN_OWNER_FUND_MIST = FUND_AGENT_MIST + FUND_GAS_RESERVE_MIST; // 0.35 SUI

/** MIST → SUI, trimmed for display (300_000_000n → "0.3"). */
function formatSui(mist: bigint): string {
  return (Number(mist) / 1e9).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/**
 * PURE affordability check for the pairing/onboarding approval (node-testable,
 * mirrors `deriveStartPhase`). The owner wallet must hold the agent funding plus
 * a gas reserve or the wallet signature fails; returns a ready-to-show top-up
 * message naming what it costs, what the wallet holds, and what to do.
 */
export function pairingAffordability(balanceMist: bigint): { ok: boolean; message: string | null } {
  if (balanceMist >= MIN_OWNER_FUND_MIST) return { ok: true, message: null };
  return {
    ok: false,
    message:
      `Pairing funds this device with ${formatSui(FUND_AGENT_MIST)} SUI and needs a little gas on top — ` +
      `about ${formatSui(MIN_OWNER_FUND_MIST)} SUI total. Your wallet holds ${formatSui(balanceMist)} SUI. ` +
      `Add SUI to this wallet, then retry.`,
  };
}

export type OnboardingStep = 'creating' | 'preparing' | 'done';

export interface VaultInfo {
  vaultId: string;
  owner: string;
  name: string;
  agents: string[];
}

export interface AgentInfo {
  name: string;
  address: string;
}

export type SessionState =
  | { phase: 'disconnected' }
  | { phase: 'checking' }
  | { phase: 'first-run'; address: string; onboarding: OnboardingStep | null; error: string | null }
  | { phase: 'needs-pairing'; vault: VaultInfo; agent: AgentInfo; error: string | null }
  | { phase: 'rebuilding'; done: number; total: number; error: string | null }
  | { phase: 'ready'; vault: VaultInfo; agent: AgentInfo; index: { count: number } };

const store = createStore<SessionState>({ phase: 'disconnected' });

export const sessionStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

/** Wallet/chain primitives injected by the React layer (null until a wallet connects). */
interface WiredDeps {
  owner: string;
  agentSigner: Signer;
  agentAddress: string;
  /** From useWalletExecTx — runs a PTB through the wallet, returns objectChanges. */
  execTx: (transaction: unknown) => Promise<unknown>;
}

let wired: WiredDeps | null = null;
let generation = 0;
/**
 * The owner `startSession` is already driving discovery for. EVERY page that
 * calls `useVaultSession()` (Home, Notes, Canvas, ...) fires `startSession` on
 * mount, and reaching `ready` mounts a page, so without this guard a page mount
 * would restart discovery, which unmounts the page, which restarts it: an
 * infinite rebuild loop. We only (re)drive on a real account change, a
 * disconnect/reconnect, or to recover from an error phase.
 */
let startedForOwner: string | null = null;
/** The vault under rebuild, stashed so retryRebuild can resume it. */
let pendingVault: VaultInfo | null = null;
/**
 * The assembled write/read deps for the ready vault — the `chain/core` QuiltDeps
 * the write-path hooks (notes save, chat distill, forget, layout save) pass to
 * `writeTurn`/`readAll`/`buildForgetPlan`. Null until a vault is ready; cleared
 * on disconnect/account-switch.
 */
let currentDeps: QuiltDeps | null = null;

export function configureSession(deps: WiredDeps): void {
  wired = deps;
}

/** The live QuiltDeps for the ready vault, or null. The write-path hooks consume this. */
export function getQuiltDeps(): QuiltDeps | null {
  return currentDeps;
}

/** Companion name = the on-chain vault name (Nova is the fixed default). */
const COMPANION_DEFAULT = 'Nova';

function toVaultInfo(v: { vaultId: string; owner: string; name: string; agents: string[] }): VaultInfo {
  return { vaultId: v.vaultId, owner: v.owner, name: v.name, agents: v.agents };
}

/**
 * PURE phase selection from discovery + allowlist membership (the node-tested
 * core). Given the discovered vault (or null) and this device's agent address,
 * decide which phase the session opens in.
 */
export function deriveStartPhase(
  vault: VaultInfo | null,
  agentAddress: string,
): 'first-run' | 'needs-pairing' | 'rebuild' {
  if (!vault) return 'first-run';
  if (!vault.agents.includes(agentAddress)) return 'needs-pairing';
  return 'rebuild';
}

const isDeclined = (e: unknown): boolean => {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return m.includes('reject') || m.includes('declin') || m.includes('denied') || m.includes('cancel');
};

/** Best-effort label for a wallet/tx failure that is really an out-of-SUI gas error. */
const isInsufficientFunds = (e: unknown): boolean => {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    m.includes('insufficient') ||
    m.includes('gas balance') ||
    m.includes('no valid gas') ||
    m.includes('balance too low') ||
    m.includes('can not find gas') ||
    m.includes('gas budget')
  );
};

/**
 * The resurrection rebuild: enumerate the vault's quilts and read+decrypt them
 * from Walrus + Seal ALONE (no DB, no relay — the AE3 acceptance gate by
 * construction), incrementing `done` per quilt, then publish the live index to
 * `vaultData` and go ready. Guarded by `generation` so a stale account's rebuild
 * never publishes.
 */
async function rebuildAndReady(vault: VaultInfo): Promise<void> {
  if (!wired) return;
  const gen = generation;
  pendingVault = vault;
  const suiClient = getSuiClient();
  const seal = new SealVault({ suiClient, signer: wired.agentSigner, vaultId: vault.vaultId, ownerAddress: vault.owner });
  // Assemble the live QuiltDeps now (vault + seal + agent signer known) so the
  // write-path hooks can persist/forget the moment the vault is ready.
  currentDeps = { suiClient, seal, agentSigner: wired.agentSigner, walletAddress: vault.owner, vaultId: vault.vaultId };

  // CACHE-FIRST: a same-tab refresh restores the decrypted index from
  // sessionStorage instantly, then pulls only NEW quilts in the background,
  // instead of re-decrypting the whole vault every refresh.
  const cached = loadIndexCache(vault.vaultId);
  if (cached) {
    if (gen !== generation) return;
    vaultData.publish(cached);
    goReady(vault, cached);
    void backgroundSync(vault, cached, gen);
    return;
  }

  store.update(() => ({ phase: 'rebuilding', done: 0, total: 0, error: null }));

  let blobIds: string[];
  try {
    blobIds = await listVaultQuilts(currentDeps);
  } catch {
    if (gen !== generation) return;
    store.update(() => ({ phase: 'rebuilding', done: 0, total: 0, error: 'Could not list the vault. Retry when the connection settles.' }));
    return;
  }
  if (gen !== generation) return;

  const total = blobIds.length;
  store.update(() => ({ phase: 'rebuilding', done: 0, total, error: null }));

  // Warm the Seal key cache once before reading. Every note shares the vault
  // identity, so this single fetchKeys lets all quilts below decrypt from cache
  // instead of each racing a key-server round-trip (which rate-limits). It also
  // surfaces a not-allowlisted device as one clear error instead of N decrypt
  // failures.
  // Skip when the vault is empty (a fresh onboard): there is nothing to decrypt,
  // so don't gate "ready" on a key fetch that the just-allowlisted device's node
  // may not have indexed yet.
  if (total > 0) {
    try {
      await seal.prewarmKeys();
    } catch {
      if (gen !== generation) return;
      store.update(() => ({ phase: 'rebuilding', done: 0, total, error: 'Could not unlock the vault keys. Retry when the connection settles.' }));
      return;
    }
    if (gen !== generation) return;
  }

  // Read the quilts with a bounded concurrency: 25 sequential Walrus reads is
  // the slow part of resurrection, and the decrypts are local now that keys are
  // warmed. Results are kept in blob order; the first failure stops the batch.
  const CONCURRENCY = 6;
  const results: Awaited<ReturnType<typeof readAll>>[] = new Array(blobIds.length);
  let done = 0;
  let failed = false;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (!failed && gen === generation) {
      const i = cursor++;
      if (i >= blobIds.length) return;
      try {
        results[i] = await readAll({ suiClient, seal }, [blobIds[i]]);
        if (failed || gen !== generation) return;
        done += 1;
        store.update(() => ({ phase: 'rebuilding', done, total, error: null }));
      } catch {
        failed = true;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, blobIds.length) }, worker));
  if (gen !== generation) return;
  if (failed) {
    store.update(() => ({ phase: 'rebuilding', done, total, error: `Could not decrypt a quilt (${done} of ${total} done). Retry when the connection settles.` }));
    return;
  }

  const index = VaultIndex.fromEntries(results.flat());
  if (gen !== generation) return;
  vaultData.publish(index);
  saveIndexCache(vault.vaultId, index);
  goReady(vault, index);
}

/**
 * Re-validate a cache-restored index: pull only quilts the index has not seen
 * (cheap when nothing changed, e.g. a single-device user), publish if anything
 * landed, and refresh the cache. Best-effort: a flaky network leaves the cached
 * view standing. Generation-guarded so an account switch mid-sync never wins.
 */
async function backgroundSync(vault: VaultInfo, index: VaultIndex, gen: number): Promise<void> {
  const deps = currentDeps;
  if (!deps) return;
  try {
    const added = await syncNewQuilts(deps, index);
    if (gen !== generation) return;
    if (added.length > 0) vaultData.publish(index);
    saveIndexCache(vault.vaultId, index);
  } catch (e) {
    if (gen !== generation) return;
    // A TERMINAL NoAccessError is the one error we must NOT swallow: a quilt the
    // device can no longer decrypt means this agent lost access (the owner revoked
    // it, or it was never allowlisted on a quorum of key servers). Silently keeping
    // the cached view would show stale, now-unauthorized notes as if live. Drop the
    // cache (also stops the auto-cache subscription) and send the device back to
    // pairing — pair() re-runs seal_approve, so re-authorization is the recovery.
    // Every OTHER error (offline, one flaky key server, transient indexing lag —
    // which is tolerated below the throw and short-circuits when nothing is new)
    // keeps the cached view and retries next load, which is the whole point of the cache.
    if (e instanceof NoAccessError && wired) {
      clearIndexCache();
      store.update(() => ({
        phase: 'needs-pairing',
        vault,
        agent: { name: vault.name || COMPANION_DEFAULT, address: wired.agentAddress },
        error: 'This device’s access to the vault was revoked. Pair again to restore it.',
      }));
    }
    // else: offline / flaky key servers — keep the cached view, try again next load
  }
}

function goReady(vault: VaultInfo, index: VaultIndex): void {
  if (!wired) return;
  enableIndexCache(vault.vaultId); // auto-cache subsequent index changes for an instant refresh
  store.update(() => ({
    phase: 'ready',
    vault,
    agent: { name: vault.name || COMPANION_DEFAULT, address: wired!.agentAddress },
    index: { count: index.notes().length },
  }));
}

/**
 * Begin (or restart) discovery for the wired account. Bumps the generation so a
 * prior account's in-flight async can't win. Called by the hook on account
 * change; safe to call when not wired (→ disconnected).
 */
export async function startSession(): Promise<void> {
  if (!wired) {
    startedForOwner = null;
    generation += 1;
    store.update(() => ({ phase: 'disconnected' }));
    return;
  }
  const { owner, agentAddress } = wired;

  // Idempotency: a redundant page-mount call for the SAME account that is already
  // active (and not sitting on an error to recover from) is a no-op. Crucially we
  // skip BEFORE bumping `generation`, so we never abort the in-flight rebuild.
  const snap = store.getSnapshot();
  const sameAccountActive =
    startedForOwner === owner && snap.phase !== 'disconnected' && !('error' in snap && snap.error);
  if (sameAccountActive) return;
  startedForOwner = owner;

  generation += 1;
  const gen = generation;
  store.update(() => ({ phase: 'checking' }));

  let vault: VaultInfo | null = null;
  try {
    const v = await discoverVault(getSuiClient(), owner);
    vault = v ? toVaultInfo(v) : null;
  } catch {
    if (gen !== generation) return;
    store.update(() => ({ phase: 'first-run', address: owner, onboarding: null, error: 'Could not reach the network. Reconnect and try again.' }));
    return;
  }
  if (gen !== generation) return;

  switch (deriveStartPhase(vault, agentAddress)) {
    case 'first-run':
      store.update(() => ({ phase: 'first-run', address: owner, onboarding: null, error: null }));
      return;
    case 'needs-pairing':
      store.update(() => ({ phase: 'needs-pairing', vault: vault!, agent: { name: vault!.name || COMPANION_DEFAULT, address: agentAddress }, error: null }));
      return;
    case 'rebuild':
      await rebuildAndReady(vault!);
  }
}

/**
 * Onboarding (F1): wallet-signed create+register+fund-SUI, THEN a separate
 * agent-signed WAL swap (no popup). Idempotent + resumable: it re-discovers
 * first, so a retry after a vault already exists skips creation and just retries
 * the swap. If the swap can't fund the agent, it surfaces a resumable
 * under-funded error (the agent address + a prompt to fund and retry) rather than
 * a silent ready.
 */
export async function completeOnboarding(name: string): Promise<void> {
  const state = store.getSnapshot();
  if (state.phase !== 'first-run' || state.onboarding !== null || !wired) return;
  const { owner, agentAddress, agentSigner, execTx } = wired;
  const vaultName = name.trim() || COMPANION_DEFAULT;
  const setStep = (onboarding: OnboardingStep) => store.update(() => ({ phase: 'first-run', address: owner, onboarding, error: null }));
  const setError = (error: string) => store.update(() => ({ phase: 'first-run', address: owner, onboarding: null, error }));

  setStep('creating');
  try {
    const suiClient = getSuiClient();
    let core = await discoverVault(suiClient, owner);
    if (!core) {
      // Same fund-from-wallet gate as pairing: creating the vault funds the first
      // agent with 0.3 SUI and pays gas, so a low wallet fails the create
      // signature with a cryptic gas error. Preflight and prompt instead of
      // letting the popup bounce. A balance-read blip is non-fatal.
      try {
        const balance = await suiBalance(suiClient, owner);
        if (!pairingAffordability(balance).ok) {
          setError(
            `Creating ${vaultName} funds it with ${formatSui(FUND_AGENT_MIST)} SUI and needs a little gas — ` +
              `about ${formatSui(MIN_OWNER_FUND_MIST)} SUI total. Your wallet holds ${formatSui(balance)} SUI. ` +
              `Add SUI to this wallet, then retry.`,
          );
          return;
        }
      } catch {
        /* balance read failed — don't block; the create tx is the judge */
      }
      const tx = buildOnboardingTx({ name: vaultName, firstAgent: agentAddress, fundAgentMist: FUND_AGENT_MIST });
      // The created Vault object IS the provenance — receipt links to it on-chain.
      const vaultId = await runWithReceipt(
        { key: 'onboarding', title: vaultName, labels: { pending: 'Creating vault', success: 'Vault created', fail: 'Vault not created' } },
        async () => {
          const res = await execTx(tx); // wallet signature
          const id = vaultIdFromCreateResult(res);
          return { result: id, provenanceUrl: objectProvenanceUrl(id) };
        },
      );
      core = (await discoverVault(suiClient, owner)) ?? { vaultId, owner, name: vaultName, agents: [agentAddress] };
    }

    setStep('preparing');
    await ensureAgentWal(suiClient, agentSigner); // agent signature, no popup
    const pf = await preflight(suiClient, agentAddress);
    if (!pf.ok) {
      const need = [pf.needsSui && 'SUI', pf.needsWal && 'WAL'].filter(Boolean).join(' + ');
      setError(`Vault created. The agent ${agentAddress} still needs ${need} before it can save — fund it, then retry.`);
      return;
    }

    setStep('done');
    await rebuildAndReady(toVaultInfo(core));
  } catch (e) {
    setError(
      isDeclined(e)
        ? 'Signature request was declined. Nothing was created, sign again when you are ready.'
        : isInsufficientFunds(e)
          ? `The transaction ran out of SUI. Add a little more to this wallet (about ${formatSui(MIN_OWNER_FUND_MIST)} SUI covers the vault funding + gas), then retry. (${e instanceof Error ? e.message : String(e)})`
          : `Onboarding failed: ${e instanceof Error ? e.message : String(e)}. Retry when ready.`,
    );
  }
}

/** Pair this device: wallet-signed register-agent + fund, then rebuild. */
export async function pair(): Promise<void> {
  const state = store.getSnapshot();
  if (state.phase !== 'needs-pairing' || !wired) return;
  const { agentAddress, agentSigner, execTx } = wired;
  const vault = state.vault;
  const setError = (error: string) =>
    store.update(() => ({
      phase: 'needs-pairing',
      vault,
      agent: { name: vault.name || COMPANION_DEFAULT, address: agentAddress },
      error,
    }));
  const suiClient = getSuiClient();

  // Preflight the OWNER wallet BEFORE the approval popup: the pairing tx splits
  // 0.3 SUI out of the wallet to fund this device's agent and pays gas on top, so
  // a wallet under ~0.35 SUI makes the signature fail with a cryptic gas error.
  // Show a clear top-up prompt instead of a doomed popup. A balance-read blip is
  // non-fatal — fall through and let the tx itself be the judge.
  try {
    const afford = pairingAffordability(await suiBalance(suiClient, vault.owner));
    if (!afford.ok) {
      setError(afford.message!);
      return;
    }
  } catch {
    /* couldn't read balance — don't block; the approval below still runs */
  }

  try {
    const tx = buildRegisterAgentTx({ vaultId: vault.vaultId, agent: agentAddress, fundAgentMist: FUND_AGENT_MIST });
    // Registering this device on the vault allowlist — the tx is the provenance.
    await runWithReceipt(
      { key: 'pair', title: vault.name || COMPANION_DEFAULT, labels: { pending: 'Pairing device', success: 'Device paired', fail: 'Pairing failed' } },
      async () => {
        const res = await execTx(tx); // wallet signature
        const digest = digestOf(res);
        return { result: res, provenanceUrl: digest ? txProvenanceUrl(digest) : '' };
      },
    );
    await ensureAgentWal(suiClient, agentSigner);
    const refreshed = await discoverVault(suiClient, vault.owner);
    await rebuildAndReady(refreshed ? toVaultInfo(refreshed) : { ...vault, agents: [...vault.agents, agentAddress] });
  } catch (e) {
    setError(
      isDeclined(e)
        ? 'Pairing signature was declined. This device stays unpaired until you approve it.'
        : isInsufficientFunds(e)
          ? `The pairing transaction ran out of SUI. Add a little more to this wallet (about ${formatSui(MIN_OWNER_FUND_MIST)} SUI covers the device funding + gas), then retry. (${e instanceof Error ? e.message : String(e)})`
          : `Pairing failed: ${e instanceof Error ? e.message : String(e)}.`,
    );
  }
}

/** The wallet declined the creation signature: back to the sign step with an inline error. */
export function rejectSignature(): void {
  const state = store.getSnapshot();
  if (state.phase !== 'first-run') return;
  store.update(() => ({ phase: 'first-run', address: state.address, onboarding: null, error: 'Signature request was declined. Nothing was created, sign again when you are ready.' }));
}

/** Ceremony closed before signing: stay in first-run, the UI returns to the landing view. */
export function closeBeforeSign(): void {
  const state = store.getSnapshot();
  if (state.phase !== 'first-run') return;
  store.update(() => ({ phase: 'first-run', address: state.address, onboarding: null, error: null }));
}

/** Pairing signature declined: error with retry, the device stays unpaired. */
export function rejectPairing(): void {
  const state = store.getSnapshot();
  if (state.phase !== 'needs-pairing') return;
  store.update(() => ({ ...state, error: 'Pairing signature was declined. This device stays unpaired until you approve it.' }));
}

/** Resume a failed rebuild (re-runs the read loop for the stashed vault). */
export function retryRebuild(): void {
  const state = store.getSnapshot();
  if (state.phase !== 'rebuilding' || !state.error || !pendingVault) return;
  void rebuildAndReady(pendingVault);
}

/**
 * Rename the companion locally (non-destructive, no wallet): the ready-phase
 * vault/agent display names update in place. The on-chain vault name is fixed at
 * creation; this only follows the header (Nova stays the default).
 */
export function renameCompanion(name: string): void {
  const state = store.getSnapshot();
  const trimmed = name.trim();
  if (state.phase !== 'ready' || !trimmed) return;
  store.update(() => ({
    ...state,
    vault: { ...state.vault, name: trimmed },
    agent: { ...state.agent, name: trimmed },
  }));
}

/** Disconnect: cancel any in-flight async, clear the shared index, go disconnected. */
export function disconnect(): void {
  generation += 1;
  startedForOwner = null;
  pendingVault = null;
  currentDeps = null;
  clearIndexCache(); // drop the cached decrypted index so a stale account never shows
  vaultData.reset();
  store.update(() => ({ phase: 'disconnected' }));
}

/** Test/lifecycle reset (mirrors the mocks' reset*Store()). */
export function resetSessionStore(): void {
  generation += 1;
  startedForOwner = null;
  pendingVault = null;
  currentDeps = null;
  wired = null;
  store.update(() => ({ phase: 'disconnected' }));
}
