/**
 * The session brain of the app: wallet state → vault discovery (R15
 * returning-user vs first-run) → agent key readiness → index.
 * Drives which screen App renders.
 */
import { useCallback, useEffect, useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { discoverVault, type VaultInfo, VaultIndex } from '@core/index.js';
import { getSuiClient, getSealVault, loadCachedIndex, rebuildIndex } from './chain.js';
import { loadOrCreateAgentKey } from './agentKey.js';

export type SessionPhase =
  | { phase: 'disconnected' }
  | { phase: 'checking' }
  | { phase: 'first-run' } // no vault → onboarding
  | { phase: 'needs-pairing'; vault: VaultInfo; agent: Ed25519Keypair } // vault exists, this client's key not allowlisted
  | { phase: 'rebuilding'; vault: VaultInfo; done: number; total: number }
  | { phase: 'ready'; vault: VaultInfo; agent: Ed25519Keypair; index: VaultIndex };

export function useVaultSession(ns: string) {
  const account = useCurrentAccount();
  const [state, setState] = useState<SessionPhase>({ phase: 'disconnected' });
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!account) return setState({ phase: 'disconnected' });
      setState({ phase: 'checking' });

      const suiClient = getSuiClient();
      const agent = await loadOrCreateAgentKey(ns);
      const vault = await discoverVault(suiClient, account.address);
      if (cancelled) return;

      if (!vault) return setState({ phase: 'first-run' });

      if (!vault.agents.includes(agent.toSuiAddress())) {
        return setState({ phase: 'needs-pairing', vault, agent });
      }

      const seal = getSealVault({ signer: agent, vaultId: vault.vaultId, ownerAddress: vault.owner });

      // warm cache → instant; else cold rebuild with progress (R15 / resurrection)
      const cached = await loadCachedIndex(ns, vault.vaultId);
      if (cached) {
        if (!cancelled) setState({ phase: 'ready', vault, agent, index: cached });
        // background freshness pass
        rebuildIndex({ ns, vaultId: vault.vaultId, seal, walletAddress: vault.owner })
          .then((idx) => !cancelled && setState({ phase: 'ready', vault, agent, index: idx }))
          .catch(() => void 0);
        return;
      }

      setState({ phase: 'rebuilding', vault, done: 0, total: 1 });
      const index = await rebuildIndex({
        ns,
        vaultId: vault.vaultId,
        seal,
        walletAddress: vault.owner,
        onProgress: (done, total) => !cancelled && setState({ phase: 'rebuilding', vault, done, total }),
      });
      if (!cancelled) setState({ phase: 'ready', vault, agent, index });
    })().catch((e) => {
      console.error('session init failed', e);
      if (!cancelled) setState({ phase: 'disconnected' });
    });
    return () => {
      cancelled = true;
    };
  }, [account?.address, ns, refreshTick]);

  return { state, account, refresh };
}
