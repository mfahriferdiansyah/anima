/**
 * The shared dependency context every hook will consume (plan U6, R11). Its
 * core five fields are EXACTLY chain/core's `QuiltDeps`
 * (`{ suiClient, seal, agentSigner, walletAddress, vaultId }`) so `readAll` /
 * `writeTurn` / `listVaultQuilts` accept it unadapted; `hasAgentKey` and a lazy
 * `ensureJwt` ride alongside. It weaves together U1 (the walrus client
 * singleton), U4 (the agent keypair), U3 (the JWT), and chain/core's
 * `discoverVault` + `SealVault`.
 *
 * `buildVaultDeps` is a pure async assembler (node-testable); the provider/hook
 * is the thin dapp-kit + React Query wiring on top. Foundation only assembles
 * the deps — the on-chain allowlist-aware phase derivation that reads
 * `hasAgentKey` to choose first-run / needs-pairing / ready is Tier-1.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { discoverVault, SealVault } from '../../../chain/core/src/index.js';
import { getSuiClient } from './suiClient';
import { getOrCreateAgentKey, hasAgentKey } from './agentKey';
import { ensureJwt } from './auth';

export interface VaultDeps {
  suiClient: ReturnType<typeof getSuiClient>;
  seal: SealVault;
  agentSigner: Ed25519Keypair;
  /** The vault owner — the wallet that owns every blob (chain/core `QuiltDeps.walletAddress`). */
  walletAddress: string;
  vaultId: string;
  /** Local IDB presence of this device's agent key (U4). */
  hasAgentKey: boolean;
  /**
   * LAZY: ensures a backend JWT for the owner only when a backend call (chat /
   * distill) actually needs it. Resolving it eagerly at assembly would force a
   * wallet signature on every session even when the user never chats.
   */
  ensureJwt: () => Promise<string>;
}

/**
 * Pure assembler: discover the vault from the wallet, attach the agent key +
 * SealVault, and return the deps — or null when the wallet has no vault yet
 * (first-run). Does NOT trigger the JWT signature (that stays lazy).
 */
export async function buildVaultDeps(opts: {
  owner: string;
  backendUrl: string;
  signPersonalMessage: (msg: Uint8Array) => Promise<{ signature: string }>;
}): Promise<VaultDeps | null> {
  const suiClient = getSuiClient();
  const vault = await discoverVault(suiClient, opts.owner);
  if (!vault) return null;

  const agentSigner = await getOrCreateAgentKey(opts.owner);
  const seal = new SealVault({
    suiClient,
    signer: agentSigner,
    vaultId: vault.vaultId,
    ownerAddress: vault.owner,
  });
  const present = await hasAgentKey(opts.owner);

  return {
    suiClient,
    seal,
    agentSigner,
    walletAddress: vault.owner,
    vaultId: vault.vaultId,
    hasAgentKey: present,
    ensureJwt: () =>
      ensureJwt({ backendUrl: opts.backendUrl, address: opts.owner, signPersonalMessage: opts.signPersonalMessage }),
  };
}

const VaultDepsContext = createContext<VaultDeps | null>(null);

/**
 * Thin wiring: rebuilds the deps whenever the connected wallet changes
 * (React Query keys on the address and dedupes the in-flight build). Exposes
 * `null` until a wallet is connected AND its vault is discovered.
 */
export function VaultDepsProvider({ children }: { children: ReactNode }) {
  const account = useCurrentAccount();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const backendUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080';

  const { data } = useQuery({
    queryKey: ['vaultDeps', account?.address],
    enabled: !!account,
    queryFn: () =>
      buildVaultDeps({
        owner: account!.address,
        backendUrl,
        signPersonalMessage: (msg) => signPersonalMessage({ message: msg }).then(({ signature }) => ({ signature })),
      }),
  });

  return <VaultDepsContext.Provider value={data ?? null}>{children}</VaultDepsContext.Provider>;
}

/** The assembled deps, or null until a wallet is connected and its vault discovered. */
export function useVaultDeps(): VaultDeps | null {
  return useContext(VaultDepsContext);
}
