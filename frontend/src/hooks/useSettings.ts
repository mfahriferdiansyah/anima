/**
 * Settings data layer (plan U8) — the real keys + balances behind the settings
 * page, mirroring the `web3/vaultData` singleton+factory shape (a pure
 * `createSettings()` core, a module singleton, a thin `useSettings` hook).
 *
 * `keys` are derived, not stored: the device key is the ready session's own
 * agent address (`agent.address`), and the external keys are the vault's
 * on-chain allowlist (`vault.agents`) MINUS the device (the device is already on
 * the allowlist — that is the rebuild condition) UNIONed with agents connected
 * in THIS session (which `discoverVault` won't re-surface on its own). `balances`
 * come from `funding.preflight(agentAddr)` with bigint MIST→SUI / FROST→WAL
 * conversion (÷1e9).
 *
 * Connect/revoke run one wallet PTB each. The wallet can only be reached through
 * React hooks, so — like the session engine — the layer takes `execTx` via
 * `configureSettingsExec()`, wired from `useWalletExecTx()` by the hook. The pure
 * derivations (`deriveKeys`, `toBalances`) are node-tested DOM-free; the wallet
 * round-trips are integration-deferred.
 *
 * A connected agent's secret is shown exactly once (the return value of
 * `connectExternalAgent`); the snapshot keeps only the `secretIssued` flag, never
 * the secret itself.
 */
import { useSyncExternalStore } from 'react';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  buildRegisterAgentTx,
  buildRevokeAgentTx,
  ensureAgentWal,
  preflight,
  type Preflight,
} from '../../../chain/core/src/index.js';
import { sessionStore, getQuiltDeps } from '@/web3/session';
import type { KeyEntry } from '../mocks/fixture';

export interface SettingsState {
  keys: KeyEntry[];
  balances: { sui: number; wal: number };
}

/** Mirror the onboarding/pairing fund amount (0.3 SUI clears both thresholds after the swap). */
const FUND_AGENT_MIST = 300_000_000n;
const MIST_PER_SUI = 1e9;

/** A `runWriteTx` that runs a PTB through the wallet, injected by the React layer. */
type ExecTx = (transaction: unknown) => Promise<unknown>;

/** An external agent connected in THIS session (held locally; not yet re-discovered on-chain). */
interface LocalExternal {
  address: string;
  label: string;
  addedAt: string;
}

/** bigint MIST/FROST → display SUI/WAL floats (÷1e9). PURE — node-tested. */
export function toBalances(pf: Pick<Preflight, 'sui' | 'wal'>): { sui: number; wal: number } {
  return { sui: Number(pf.sui) / MIST_PER_SUI, wal: Number(pf.wal) / MIST_PER_SUI };
}

/**
 * The device key (this session's agent address) + the external allowlist. PURE —
 * node-tested. External = (on-chain `vault.agents` ∪ locally-connected) MINUS the
 * device address, deduped. The device is already on `vault.agents` (the rebuild
 * condition), so it must be excluded there or it would list twice.
 */
export function deriveKeys(
  deviceAddress: string | null,
  vaultAgents: string[],
  localExternal: LocalExternal[],
): KeyEntry[] {
  const keys: KeyEntry[] = [];
  if (deviceAddress) {
    keys.push({
      id: `key-${deviceAddress}`,
      label: 'This device',
      kind: 'device',
      address: deviceAddress,
      addedAt: '',
      thisDevice: true,
      secretIssued: false,
    });
  }
  const localByAddress = new Map(localExternal.map((e) => [e.address, e]));
  const seen = new Set<string>(deviceAddress ? [deviceAddress] : []);
  // On-chain allowlist first (in vault order), then any locally-connected agent
  // not yet reflected on-chain.
  const ordered = [...vaultAgents, ...localExternal.map((e) => e.address)];
  for (const address of ordered) {
    if (address === deviceAddress || seen.has(address)) continue;
    seen.add(address);
    const local = localByAddress.get(address);
    keys.push({
      id: `key-${address}`,
      label: local?.label ?? 'external agent',
      kind: 'external',
      address,
      addedAt: local?.addedAt ?? '',
      thisDevice: false,
      secretIssued: Boolean(local),
    });
  }
  return keys;
}

/** Pure factory (mirrors `createVaultData`). The singleton below wraps one of these. */
export function createSettings() {
  let balances = { sui: 0, wal: 0 };
  const localExternal: LocalExternal[] = [];
  let execTx: ExecTx | null = null;
  const listeners = new Set<() => void>();

  function deviceAddress(): string | null {
    const s = sessionStore.getSnapshot();
    return s.phase === 'ready' ? s.agent.address : null;
  }
  function vaultAgents(): string[] {
    const s = sessionStore.getSnapshot();
    return s.phase === 'ready' ? s.vault.agents : [];
  }
  function vaultId(): string | null {
    const s = sessionStore.getSnapshot();
    return s.phase === 'ready' ? s.vault.vaultId : null;
  }

  function build(): SettingsState {
    return {
      keys: deriveKeys(deviceAddress(), vaultAgents(), localExternal),
      balances,
    };
  }
  // Cached so useSyncExternalStore sees a stable reference until something changes.
  let snapshot = build();
  function emit(): void {
    snapshot = build();
    for (const l of listeners) l();
  }

  // The key list is derived from the live session, so a session change (pairing,
  // disconnect, account switch) must re-emit the settings snapshot.
  const unsubSession = sessionStore.subscribe(emit);

  return {
    getSnapshot: (): SettingsState => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Wire the wallet-exec adapter (from the React layer). */
    configureExec(fn: ExecTx | null): void {
      execTx = fn;
    },
    /** Re-fetch balances for the device agent via `preflight`; no-op until a vault is ready. */
    async refreshBalances(): Promise<void> {
      const deps = getQuiltDeps();
      if (!deps) return;
      const pf = await preflight(deps.suiClient, deps.agentSigner.toSuiAddress());
      balances = toBalances(pf);
      emit();
    },
    /**
     * Authorize a fresh external agent on the vault: mint a key, wallet-sign
     * `register_agent` + fund (one popup), then the new agent self-swaps SUI→WAL
     * (no popup) so its first write succeeds — mirroring `pair.ts`. The secret is
     * returned ONCE; only `secretIssued` is kept. Optimistically lists the new key
     * (the session won't re-discover on its own).
     */
    async connectExternalAgent(label: string): Promise<{ key: KeyEntry; secret: string }> {
      const deps = getQuiltDeps();
      const vid = vaultId();
      if (!deps || !vid || !execTx) throw new Error('Connect an external agent only with a ready vault.');
      const kp = new Ed25519Keypair();
      const address = kp.toSuiAddress();
      const tx = buildRegisterAgentTx({ vaultId: vid, agent: address, fundAgentMist: FUND_AGENT_MIST });
      await execTx(tx); // wallet signature
      await ensureAgentWal(deps.suiClient, kp); // agent signature, no popup
      const entry: LocalExternal = { address, label: label.trim() || 'external agent', addedAt: new Date().toISOString() };
      localExternal.push(entry);
      emit();
      const key = snapshot.keys.find((k) => k.address === address)!;
      return { key, secret: kp.getSecretKey() };
    },
    /** Owner-signed `revoke_agent` (one popup), then drop the key locally. */
    async revokeKey(id: string): Promise<void> {
      const deps = getQuiltDeps();
      const vid = vaultId();
      const entry = snapshot.keys.find((k) => k.id === id);
      if (!deps || !vid || !execTx || !entry) return;
      const tx = buildRevokeAgentTx({ vaultId: vid, agent: entry.address });
      await execTx(tx); // wallet signature
      const i = localExternal.findIndex((e) => e.address === entry.address);
      if (i >= 0) localExternal.splice(i, 1);
      emit();
    },
    /**
     * An agent address is fixed on-chain, so a secret can't be rotated in place
     * (true rotation = revoke + connect a new agent, a new address). The dialog
     * only re-displays the secret it issued, which the layer never stored, so the
     * honest answer is none — there is nothing to re-show. Returns null.
     */
    regenerateAgentSecret(_id: string): string | null {
      return null;
    },
    reset(): void {
      balances = { sui: 0, wal: 0 };
      localExternal.length = 0;
      execTx = null;
      emit();
    },
    /** For tests: also detach the session subscription. */
    dispose(): void {
      unsubSession();
      listeners.clear();
    },
  };
}

/** The app-wide singleton (mirrors the vaultData / mock store singletons). */
const settings = createSettings();

/** Keys (devices + external agents) and balances for the settings page. */
export function useSettings(): SettingsState {
  return useSyncExternalStore(settings.subscribe, settings.getSnapshot);
}

/** Wire the wallet-exec adapter — called by the page/hook layer from `useWalletExecTx()`. */
export function configureSettingsExec(execTx: ExecTx | null): void {
  settings.configureExec(execTx);
}

/** Re-fetch balances (e.g. when a vault becomes ready or after a funding action). */
export function refreshBalances(): Promise<void> {
  return settings.refreshBalances();
}

/** Authorize + fund a fresh external agent; returns its key + once-shown secret. */
export function connectExternalAgent(label: string): Promise<{ key: KeyEntry; secret: string }> {
  return settings.connectExternalAgent(label);
}

/** Owner-signed revoke (one wallet tx), then drop the key locally. */
export function revokeKey(id: string): Promise<void> {
  return settings.revokeKey(id);
}

/** A fixed on-chain agent address can't rotate a secret in place; returns null (revoke + reconnect instead). */
export function regenerateAgentSecret(id: string): string | null {
  return settings.regenerateAgentSecret(id);
}

/** Test/lifecycle reset (mirrors the mocks' reset*Store()). */
export function resetSettingsStore(): void {
  settings.reset();
}

export type { KeyEntry } from '../mocks/fixture';
