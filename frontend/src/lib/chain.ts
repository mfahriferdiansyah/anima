/**
 * Browser chain wiring: one Sui+Walrus client (WASM via Vite url import),
 * one SealVault per (vault, signer). Canonical memory lives on Walrus; the
 * index here is a rebuildable IndexedDB cache.
 */
// @ts-expect-error — Vite ?url import
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url';
import { get, set } from 'idb-keyval';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  createSuiClient, SealVault, VaultIndex,
  listVaultQuilts, readAll,
  type IndexedNote,
} from '@core/index.js';

let suiClient: ReturnType<typeof createSuiClient> | null = null;
export function getSuiClient() {
  if (!suiClient) suiClient = createSuiClient({ wasmUrl: walrusWasmUrl });
  return suiClient;
}

let sealVault: SealVault | null = null;
export function getSealVault(opts: { signer: Ed25519Keypair; vaultId: string; ownerAddress: string }) {
  if (
    !sealVault ||
    sealVault.vaultId !== opts.vaultId ||
    // new signer (e.g. re-pair) → new session
    (sealVault as any)._signerAddr !== opts.signer.toSuiAddress()
  ) {
    sealVault = new SealVault({ suiClient: getSuiClient(), ...opts });
    (sealVault as any)._signerAddr = opts.signer.toSuiAddress();
  }
  return sealVault;
}

const indexKey = (ns: string, vaultId: string) => `${ns}:index:${vaultId}`;

export async function loadCachedIndex(ns: string, vaultId: string): Promise<VaultIndex | null> {
  const json = await get<string>(indexKey(ns, vaultId));
  return json ? VaultIndex.load(json) : null;
}

export async function persistIndex(ns: string, vaultId: string, index: VaultIndex): Promise<void> {
  await set(indexKey(ns, vaultId), index.serialize());
}

/** Cold rebuild from chain (resurrection + reconnect). Reports progress for the spinner-as-feature. */
export async function rebuildIndex(opts: {
  ns: string;
  vaultId: string;
  seal: SealVault;
  walletAddress: string;
  onProgress?: (done: number, total: number, latest?: IndexedNote) => void;
}): Promise<VaultIndex> {
  const suiClient = getSuiClient();
  const quilts = await listVaultQuilts({ suiClient, walletAddress: opts.walletAddress, vaultId: opts.vaultId });
  const all: IndexedNote[] = [];
  let done = 0;
  for (const q of quilts) {
    const entries = await readAll({ suiClient, seal: opts.seal }, [q]);
    all.push(...entries);
    done++;
    opts.onProgress?.(done, quilts.length, entries[entries.length - 1]);
  }
  const index = VaultIndex.fromEntries(all);
  await persistIndex(opts.ns, opts.vaultId, index);
  return index;
}
