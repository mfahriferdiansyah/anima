/**
 * Funding helpers: balance preflight (edge #7), faucet, SUI→WAL exchange.
 * Proven at the U1 gate. The faucet is per-IP rate-limited — production demo
 * wallets are pre-funded; these helpers serve onboarding + scripts.
 */
import { Transaction } from '@mysten/sui/transactions';
import type { Signer } from '@mysten/sui/cryptography';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { TESTNET_WALRUS_PACKAGE_CONFIG } from '@mysten/walrus';
import { chainConfig } from './config.js';

export const MIN_AGENT_SUI = 100_000_000n; // 0.1 SUI gas reserve
export const MIN_AGENT_WAL = 20_000_000n; // 0.02 WAL ≈ dozens of turn-quilts

export async function suiBalance(suiClient: any, addr: string): Promise<bigint> {
  const b = await suiClient.getBalance({ owner: addr });
  return BigInt(b.totalBalance);
}

export async function walBalance(suiClient: any, addr: string): Promise<{ type: string | null; balance: bigint }> {
  const all = await suiClient.getAllBalances({ owner: addr });
  const wal = all.find((b: any) => b.coinType.toLowerCase().endsWith('::wal::wal'));
  return { type: wal?.coinType ?? null, balance: wal ? BigInt(wal.totalBalance) : 0n };
}

export interface Preflight {
  sui: bigint;
  wal: bigint;
  ok: boolean;
  needsSui: boolean;
  needsWal: boolean;
}

/** Edge #7: check the agent can afford the next write before attempting it. */
export async function preflight(suiClient: any, agentAddr: string): Promise<Preflight> {
  const [sui, wal] = await Promise.all([suiBalance(suiClient, agentAddr), walBalance(suiClient, agentAddr)]);
  const needsSui = sui < MIN_AGENT_SUI;
  const needsWal = wal.balance < MIN_AGENT_WAL;
  return { sui, wal: wal.balance, ok: !needsSui && !needsWal, needsSui, needsWal };
}

export async function faucetSui(addr: string): Promise<void> {
  await requestSuiFromFaucetV2({ host: getFaucetHost(chainConfig.network as 'testnet'), recipient: addr });
}

/** Programmatic `walrus get-wal`: swap SUI 1:1 for WAL via the official exchange. */
export async function exchangeSuiForWal(suiClient: any, signer: Signer, amountMist: bigint): Promise<string> {
  const exId = TESTNET_WALRUS_PACKAGE_CONFIG.exchangeIds![0];
  const obj = await suiClient.getObject({ id: exId, options: { showType: true } });
  const m = String(obj.data?.type ?? '').match(/^(0x[0-9a-f]+)::([a-zA-Z_]+)::/);
  if (!m) throw new Error('cannot resolve wal_exchange package');
  const [, pkg, module_] = m;

  const tx = new Transaction();
  const [suiCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
  const [walCoin] = tx.moveCall({
    target: `${pkg}::${module_}::exchange_all_for_wal`,
    arguments: [tx.object(exId), suiCoin],
  });
  tx.transferObjects([walCoin], signer.toSuiAddress());
  const res = await suiClient.signAndExecuteTransaction({ transaction: tx, signer, options: { showEffects: true } });
  if (res.effects?.status?.status !== 'success') throw new Error('exchange failed');
  await suiClient.waitForTransaction({ digest: res.digest });
  return res.digest;
}
