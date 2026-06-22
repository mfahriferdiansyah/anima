/**
 * Seal integration. One identity per vault (id = owner address bytes) so a
 * session needs a single fetchKeys round-trip; per-note AAD binds each
 * ciphertext to (vaultId, noteId) preventing cross-vault replay.
 */
import { SealClient, SessionKey, NoAccessError } from '@mysten/seal';
import type { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { chainConfig } from './config.js';

export { NoAccessError };

const hexToBytes = (hex: string) =>
  Uint8Array.from(hex.replace(/^0x/, '').match(/.{2}/g)!.map((b) => parseInt(b, 16)));

export const identityForOwner = (ownerAddress: string) => ownerAddress.replace(/^0x/, '');

function aadFor(vaultId: string, noteId: string): Uint8Array {
  const v = hexToBytes(vaultId);
  const n = new TextEncoder().encode(noteId);
  const out = new Uint8Array(v.length + n.length);
  out.set(v);
  out.set(n, v.length);
  return out;
}

export class SealVault {
  readonly client: SealClient;
  #session: SessionKey | null = null;
  #signer: Signer;
  #suiClient: any;
  readonly vaultId: string;
  readonly ownerAddress: string;

  constructor(opts: { suiClient: any; signer: Signer; vaultId: string; ownerAddress: string }) {
    this.#suiClient = opts.suiClient;
    this.#signer = opts.signer;
    this.vaultId = opts.vaultId;
    this.ownerAddress = opts.ownerAddress;
    this.client = new SealClient({
      suiClient: opts.suiClient,
      serverConfigs: chainConfig.keyServers,
      verifyKeyServers: false,
    });
  }

  /** Self-signed session (the keystone): works for owner AND allowlisted agents. */
  async session(): Promise<SessionKey> {
    if (this.#session && !this.#session.isExpired()) return this.#session;
    this.#session = await SessionKey.create({
      address: this.#signer.toSuiAddress(),
      packageId: chainConfig.packageId,
      ttlMin: 25,
      suiClient: this.#suiClient,
      signer: this.#signer,
    });
    return this.#session;
  }

  async #approveTxBytes(): Promise<Uint8Array> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${chainConfig.packageId}::${chainConfig.vaultModule}::seal_approve`,
      arguments: [
        tx.pure.vector('u8', hexToBytes(identityForOwner(this.ownerAddress))),
        tx.object(this.vaultId),
      ],
    });
    return tx.build({ client: this.#suiClient, onlyTransactionKind: true });
  }

  /**
   * Warm the Seal key cache for this vault in a SINGLE fetchKeys round-trip.
   * Every note shares one identity (the owner), so after this the per-note
   * decryptNote calls are cache hits — no further key-server traffic. This is
   * what lets the quilts decrypt in parallel without each racing its own
   * fetchKeys and tripping the key servers' per-second rate limit. Retries ride
   * out the brief indexing lag after a fresh pairing (the key server's node has
   * to see the agent in vault.agents before seal_approve passes); a genuine
   * NoAccessError (not allowlisted) is terminal and thrown immediately.
   */
  async prewarmKeys(attempts = 3): Promise<void> {
    const sessionKey = await this.session();
    const txBytes = await this.#approveTxBytes();
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.client.fetchKeys({
          ids: [identityForOwner(this.ownerAddress)],
          txBytes,
          sessionKey,
          threshold: chainConfig.sealThreshold,
        });
        return;
      } catch (e: any) {
        lastErr = e;
        if (e instanceof NoAccessError) throw e; // terminal — agent not allowlisted
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      }
    }
    throw lastErr;
  }

  async encryptNote(noteId: string, plaintext: Uint8Array): Promise<Uint8Array> {
    const { encryptedObject } = await this.client.encrypt({
      threshold: chainConfig.sealThreshold,
      packageId: chainConfig.packageId,
      id: identityForOwner(this.ownerAddress),
      data: plaintext,
      aad: aadFor(this.vaultId, noteId),
    });
    return encryptedObject;
  }

  /** Decrypt with retry on transient indexing lag (InvalidParameter). */
  async decryptNote(noteId: string, encrypted: Uint8Array, attempts = 3): Promise<Uint8Array> {
    const sessionKey = await this.session();
    const txBytes = await this.#approveTxBytes();
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.client.decrypt({
          data: encrypted,
          sessionKey,
          txBytes,
          aad: aadFor(this.vaultId, noteId),
        } as any);
      } catch (e: any) {
        lastErr = e;
        if (e instanceof NoAccessError) throw e; // terminal — wrong key/revoked
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      }
    }
    throw lastErr;
  }
}
