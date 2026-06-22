/**
 * One-off: check / faucet / fund an ARBITRARY address (no key needed).
 *   pnpm tsx scripts/_fund-addr.ts <addr>                 # check
 *   pnpm tsx scripts/_fund-addr.ts <addr> --faucet        # + testnet SUI faucet
 *   pnpm tsx scripts/_fund-addr.ts <addr> --send-sui 0.3  # + transfer SUI from agent key
 *   pnpm tsx scripts/_fund-addr.ts <addr> --send-wal 0.05 # + transfer WAL from agent key
 */
import { readFileSync } from 'node:fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { createSuiClient, nodeFetchWithLongConnect } from '../chain/core/src/index.js';
import { suiBalance, walBalance, faucetSui } from '../chain/core/src/funding.js';

const addr = process.argv[2];
if (!addr?.startsWith('0x') || addr.length !== 66) throw new Error(`bad address: ${addr}`);
const arg = (name: string): number | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : null;
};
const toMist = (sui: number) => BigInt(Math.round(sui * 1e9));
const f = (m: bigint) => (Number(m) / 1e9).toFixed(4);

const suiClient = createSuiClient({ nodeFetch: await nodeFetchWithLongConnect() });

async function show(label: string) {
  const [s, w] = await Promise.all([suiBalance(suiClient, addr), walBalance(suiClient, addr)]);
  console.log(`${label}\n  ${addr}\n  SUI ${f(s)}   WAL ${f(w.balance)}`);
  return { sui: s, wal: w.balance, walType: w.type };
}

console.log('=== BEFORE ===');
await show('target');

if (process.argv.includes('--faucet')) {
  console.log('\nfaucet SUI…');
  try { await faucetSui(addr); console.log('faucet OK'); }
  catch (e) { console.log('faucet FAILED —', e instanceof Error ? e.message : e); }
}

const sendSui = arg('--send-sui');
const sendWal = arg('--send-wal');
if (sendSui || sendWal) {
  const j = JSON.parse(readFileSync(new URL('../chain/core/.spike-keys.json', import.meta.url), 'utf8'));
  const fromArg = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : 'agent';
  const agent = Ed25519Keypair.fromSecretKey(fromArg === 'owner' ? j.wallet : j.agent); // funded source
  console.log(`source: ${fromArg} (${agent.toSuiAddress()})`);
  const tx = new Transaction();
  if (sendSui) {
    const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(toMist(sendSui))]);
    tx.transferObjects([c], addr);
  }
  if (sendWal) {
    const { type } = await walBalance(suiClient, agent.toSuiAddress());
    if (!type) throw new Error('agent has no WAL to send');
    const coins = await suiClient.getCoins({ owner: agent.toSuiAddress(), coinType: type });
    const [primary, ...rest] = coins.data.map((c: any) => c.coinObjectId);
    if (rest.length) tx.mergeCoins(tx.object(primary), rest.map((id: string) => tx.object(id)));
    const [w] = tx.splitCoins(tx.object(primary), [tx.pure.u64(toMist(sendWal))]);
    tx.transferObjects([w], addr);
  }
  console.log(`\ntransfer from agent → target (SUI ${sendSui ?? 0}, WAL ${sendWal ?? 0})…`);
  const res = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: agent, options: { showEffects: true } });
  await suiClient.waitForTransaction({ digest: res.digest });
  console.log(`transfer ${res.effects?.status?.status} — ${res.digest}`);
}

if (process.argv.includes('--faucet') || sendSui || sendWal) {
  console.log('\n=== AFTER ===');
  await show('target');
}
console.log('\ndone.');
