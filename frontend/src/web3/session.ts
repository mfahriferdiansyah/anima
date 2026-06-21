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
  type QuiltDeps,
} from '../../../chain/core/src/index.js';
import { createStore } from '../mocks/store';
import { getSuiClient } from './suiClient';
import { vaultData } from './vaultData';

// 0.3 SUI: clears ensureAgentWal's 0.25 SUI swap floor AND leaves ≥0.1 SUI gas
// after the swap, so a freshly-onboarded agent has WAL and can write (the 0.2
// default would leave it with 0 WAL and a "ready" that can't persist).
const FUND_AGENT_MIST = 300_000_000n;

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
  store.update(() => ({ phase: 'rebuilding', done: 0, total: 0, error: null }));

  let blobIds: string[];
  try {
    blobIds = await listVaultQuilts({ suiClient, walletAddress: vault.owner, vaultId: vault.vaultId });
  } catch {
    if (gen !== generation) return;
    store.update(() => ({ phase: 'rebuilding', done: 0, total: 0, error: 'Could not list the vault. Retry when the connection settles.' }));
    return;
  }
  if (gen !== generation) return;

  const total = blobIds.length;
  store.update(() => ({ phase: 'rebuilding', done: 0, total, error: null }));

  const seal = new SealVault({ suiClient, signer: wired.agentSigner, vaultId: vault.vaultId, ownerAddress: vault.owner });
  // Assemble the live QuiltDeps now (vault + seal + agent signer known) so the
  // write-path hooks can persist/forget the moment the vault is ready.
  currentDeps = { suiClient, seal, agentSigner: wired.agentSigner, walletAddress: vault.owner, vaultId: vault.vaultId };
  const entries = [];
  let done = 0;
  for (const blobId of blobIds) {
    try {
      const part = await readAll({ suiClient, seal }, [blobId]);
      if (gen !== generation) return;
      entries.push(...part);
      done += 1;
      store.update(() => ({ phase: 'rebuilding', done, total, error: null }));
    } catch {
      if (gen !== generation) return;
      store.update(() => ({ phase: 'rebuilding', done, total, error: `Could not decrypt quilt ${done + 1} of ${total}. Retry when the connection settles.` }));
      return;
    }
  }

  const index = VaultIndex.fromEntries(entries);
  if (gen !== generation) return;
  vaultData.publish(index);
  goReady(vault, index);
}

function goReady(vault: VaultInfo, index: VaultIndex): void {
  if (!wired) return;
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
      const tx = buildOnboardingTx({ name: vaultName, firstAgent: agentAddress, fundAgentMist: FUND_AGENT_MIST });
      const res = await execTx(tx); // wallet signature
      const vaultId = vaultIdFromCreateResult(res);
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
    setError(isDeclined(e) ? 'Signature request was declined. Nothing was created, sign again when you are ready.' : `Onboarding failed: ${e instanceof Error ? e.message : String(e)}. Retry when ready.`);
  }
}

/** Pair this device: wallet-signed register-agent + fund, then rebuild. */
export async function pair(): Promise<void> {
  const state = store.getSnapshot();
  if (state.phase !== 'needs-pairing' || !wired) return;
  const { agentAddress, agentSigner, execTx } = wired;
  const vault = state.vault;
  try {
    const suiClient = getSuiClient();
    const tx = buildRegisterAgentTx({ vaultId: vault.vaultId, agent: agentAddress, fundAgentMist: FUND_AGENT_MIST });
    await execTx(tx); // wallet signature
    await ensureAgentWal(suiClient, agentSigner);
    const refreshed = await discoverVault(suiClient, vault.owner);
    await rebuildAndReady(refreshed ? toVaultInfo(refreshed) : { ...vault, agents: [...vault.agents, agentAddress] });
  } catch (e) {
    store.update(() => ({
      phase: 'needs-pairing',
      vault,
      agent: { name: vault.name || COMPANION_DEFAULT, address: agentAddress },
      error: isDeclined(e) ? 'Pairing signature was declined. This device stays unpaired until you approve it.' : `Pairing failed: ${e instanceof Error ? e.message : String(e)}.`,
    }));
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
