/**
 * On-chain vault operations: creation (single-PTB onboarding), agent
 * register/revoke, and discovery — a fresh client finds the wallet's vault
 * via the VaultCreated event (the Vault is shared, not wallet-owned).
 */
import { Transaction } from '@mysten/sui/transactions';
import type { Signer } from '@mysten/sui/cryptography';
import { chainConfig } from './config.js';

const target = (fn: string) => `${chainConfig.packageId}::${chainConfig.vaultModule}::${fn}`;

export interface VaultInfo {
  vaultId: string;
  owner: string;
  name: string;
  agents: string[];
}

/** F0 single-popup PTB: create vault (registers first agent) + fund the agent with SUI gas. */
export function buildOnboardingTx(opts: {
  name: string;
  firstAgent: string;
  fundAgentMist?: bigint; // default 0.2 SUI — agent self-exchanges WAL silently afterwards
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target('create_vault'),
    arguments: [tx.pure.string(opts.name), tx.pure.address(opts.firstAgent)],
  });
  const fund = opts.fundAgentMist ?? 200_000_000n;
  if (fund > 0n) {
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(fund)]);
    tx.transferObjects([coin], opts.firstAgent);
  }
  return tx;
}

/** Pairing PTB (U8): register an external agent AND fund it in one wallet tx. */
export function buildRegisterAgentTx(opts: {
  vaultId: string;
  agent: string;
  fundAgentMist?: bigint;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target('register_agent'),
    arguments: [tx.object(opts.vaultId), tx.pure.address(opts.agent)],
  });
  const fund = opts.fundAgentMist ?? 200_000_000n;
  if (fund > 0n) {
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(fund)]);
    tx.transferObjects([coin], opts.agent);
  }
  return tx;
}

export function buildRevokeAgentTx(opts: { vaultId: string; agent: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target('revoke_agent'),
    arguments: [tx.object(opts.vaultId), tx.pure.address(opts.agent)],
  });
  return tx;
}

export async function execTx(suiClient: any, tx: Transaction, signer: Signer) {
  const res = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer,
    options: { showEffects: true, showObjectChanges: true },
  });
  if (res.effects?.status?.status !== 'success') {
    throw new Error(`tx failed: ${JSON.stringify(res.effects?.status)}`);
  }
  await suiClient.waitForTransaction({ digest: res.digest });
  return res;
}

export function vaultIdFromCreateResult(res: any): string {
  const change = (res.objectChanges ?? []).find(
    (c: any) => c.type === 'created' && String(c.objectType).endsWith('::vault::Vault'),
  );
  if (!change) throw new Error('no Vault object in tx result');
  return change.objectId;
}

/** Resurrection discovery: find the newest vault created by this owner. */
export async function discoverVault(suiClient: any, ownerAddress: string): Promise<VaultInfo | null> {
  let cursor: any = null;
  // newest first
  for (let page = 0; page < 20; page++) {
    const res = await suiClient.queryEvents({
      query: { MoveEventType: `${chainConfig.packageId}::${chainConfig.vaultModule}::VaultCreated` },
      order: 'descending',
      ...(cursor ? { cursor } : {}),
    });
    for (const ev of res.data) {
      const pj: any = ev.parsedJson;
      if (pj?.owner === ownerAddress) {
        return readVault(suiClient, pj.vault_id);
      }
    }
    if (!res.hasNextPage) break;
    cursor = res.nextCursor;
  }
  return null;
}

export async function readVault(suiClient: any, vaultId: string): Promise<VaultInfo> {
  const obj = await suiClient.getObject({ id: vaultId, options: { showContent: true } });
  const fields: any = obj.data?.content?.fields;
  if (!fields) throw new Error(`vault ${vaultId} not found`);
  return {
    vaultId,
    owner: fields.owner,
    name: fields.name,
    agents: fields.agents?.fields?.contents ?? [],
  };
}
