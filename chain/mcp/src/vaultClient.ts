/**
 * Thin glue over @anima/core for the MCP process: lazy testnet connection,
 * pairing check against the vault's on-chain allowlist (edge #6), a 60s-fresh
 * local index cached to disk, funding preflight (edge #7), write-through on
 * remember. Core does the heavy lifting — nothing chain-shaped lives here.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  createSuiClient, nodeFetchWithLongConnect,
  SealVault, writeTurn, readAll, listVaultQuilts, readVault,
  VaultIndex, newNote, preflight,
  type QuiltDeps, type IndexedNote, type Note, type WriteResult,
} from '../../core/src/index.js';
import type { McpConfig } from './config.js';

const INDEX_TTL_MS = 60_000;

/** Agent key exists but is not on the vault's allowlist (or was revoked). */
export class PairingError extends Error {}

/** Agent key cannot afford the next write. */
export class FundingError extends Error {}

export function pairingMessage(agentAddress: string, vaultId: string): string {
  return (
    `Agent key not paired: ${agentAddress} is not an allowlisted agent of vault ${vaultId}. ` +
    'Register it in the ANIMA app (Settings → Connect external agent), then retry. ' +
    'If it was paired before, the key may have been revoked — generate and pair a fresh one.'
  );
}

export class VaultClient {
  readonly agentAddress: string;
  readonly #cfg: McpConfig;
  readonly #agent: Ed25519Keypair;
  #deps: QuiltDeps | null = null;
  #paired = false;
  #index: VaultIndex | null = null;
  #fetchedAt = 0;

  constructor(cfg: McpConfig) {
    this.#cfg = cfg;
    try {
      this.#agent = Ed25519Keypair.fromSecretKey(cfg.agentKey);
    } catch {
      throw new Error(
        'ANIMA_AGENT_KEY is not a valid suiprivkey — copy it exactly from the ANIMA app pairing screen.',
      );
    }
    this.agentAddress = this.#agent.toSuiAddress();
  }

  async search(query: string): Promise<IndexedNote[]> {
    return (await this.#freshIndex()).search(query);
  }

  async list(): Promise<IndexedNote[]> {
    return (await this.#freshIndex()).all();
  }

  async read(noteId: string): Promise<IndexedNote | undefined> {
    return (await this.#freshIndex()).get(noteId);
  }

  /** remember(): preflight → writeTurn → write-through upsert into the cached index. */
  async write(input: { title: string; body: string; tags?: string[] }): Promise<{ note: Note; result: WriteResult }> {
    const index = await this.#freshIndex(); // also connects + verifies pairing
    const deps = this.#deps!;

    const pf = await preflight(deps.suiClient, this.agentAddress);
    if (!pf.ok) {
      throw new FundingError(
        `Agent address ${this.agentAddress} cannot afford this write — ` +
          `SUI: ${pf.sui} MIST${pf.needsSui ? ' (needs ≥ 0.1 SUI)' : ''}, ` +
          `WAL: ${pf.wal} FROST${pf.needsWal ? ' (needs ≥ 0.02 WAL)' : ''}. ` +
          `Fund it with testnet SUI (faucet) and exchange some for WAL, then retry.`,
      );
    }

    const note = newNote({ ...input, author: this.#cfg.agentName });
    const result = await writeTurn(deps, [note]);
    index.upsert(note, {
      quiltPatchId: result.perNote[0].quiltPatchId,
      quiltBlobId: result.quiltBlobId,
      blobObjectId: result.blobObjectId,
    });
    this.#fetchedAt = Date.now(); // the write-through index IS fresh as of this write
    this.#saveCache();
    return { note, result };
  }

  async #connect(): Promise<QuiltDeps> {
    if (this.#deps) return this.#deps;
    const suiClient = createSuiClient({ nodeFetch: await nodeFetchWithLongConnect() });
    const seal = new SealVault({
      suiClient,
      signer: this.#agent,
      vaultId: this.#cfg.vaultId,
      ownerAddress: this.#cfg.ownerAddress,
    });
    this.#deps = {
      suiClient,
      seal,
      agentSigner: this.#agent,
      walletAddress: this.#cfg.ownerAddress,
      vaultId: this.#cfg.vaultId,
    };
    return this.#deps;
  }

  /** Edge #6: surface "not paired" as an actionable error, not a NoAccessError mid-decrypt. */
  async #ensurePaired(deps: QuiltDeps): Promise<void> {
    if (this.#paired) return;
    let vault;
    try {
      vault = await readVault(deps.suiClient, this.#cfg.vaultId);
    } catch {
      throw new Error(`Vault ${this.#cfg.vaultId} not found on testnet — check ANIMA_VAULT_ID.`);
    }
    if (vault.owner !== this.agentAddress && !vault.agents.includes(this.agentAddress)) {
      throw new PairingError(pairingMessage(this.agentAddress, this.#cfg.vaultId));
    }
    this.#paired = true;
  }

  /** 60s freshness: memory → disk cache → full rebuild from chain. */
  async #freshIndex(): Promise<VaultIndex> {
    const deps = await this.#connect();
    await this.#ensurePaired(deps);

    if (this.#index && Date.now() - this.#fetchedAt < INDEX_TTL_MS) return this.#index;

    const cached = this.#loadCache();
    if (cached && Date.now() - cached.fetchedAt < INDEX_TTL_MS) {
      this.#index = VaultIndex.load(cached.index);
      this.#fetchedAt = cached.fetchedAt;
      return this.#index;
    }

    const t0 = Date.now();
    const quilts = await listVaultQuilts(deps);
    const entries = await readAll(deps, quilts);
    this.#index = VaultIndex.fromEntries(entries);
    this.#fetchedAt = Date.now();
    this.#saveCache();
    console.error(
      `[anima-mcp] index rebuilt: ${this.#index.size} notes from ${quilts.length} quilt(s) in ${Date.now() - t0}ms`,
    );
    return this.#index;
  }

  get #cacheFile(): string {
    return join(this.#cfg.cacheDir, `${this.#cfg.vaultId}.json`);
  }

  #loadCache(): { fetchedAt: number; index: string } | null {
    try {
      const raw = JSON.parse(readFileSync(this.#cacheFile, 'utf8'));
      if (typeof raw.fetchedAt === 'number' && typeof raw.index === 'string') return raw;
    } catch {
      // missing or corrupt — disposable by design, rebuild from chain
    }
    return null;
  }

  #saveCache(): void {
    if (!this.#index) return;
    try {
      mkdirSync(this.#cfg.cacheDir, { recursive: true });
      writeFileSync(this.#cacheFile, JSON.stringify({ fetchedAt: this.#fetchedAt, index: this.#index.serialize() }));
    } catch (e) {
      console.error(`[anima-mcp] cache write failed (continuing without): ${e}`);
    }
  }
}
