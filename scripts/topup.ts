/**
 * Check (and optionally refill) the .spike-keys.json owner wallet + agent.
 *   pnpm balance            # check balances, read-only
 *   pnpm topup              # faucet SUI where low + swap SUI→WAL for the agent
 *   pnpm topup:rebalance    # move 0.3 SUI agent→owner (no faucet — for when the faucet is rate-limited)
 * Never prints secrets — addresses + balances only. Testnet SUI faucet is per-IP
 * rate-limited; when only the owner is low, rebalance is the no-faucet fix.
 */
import { readFileSync } from 'node:fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { createSuiClient, nodeFetchWithLongConnect } from '../chain/core/src/index.js';
import {
  suiBalance,
  walBalance,
  faucetSui,
  ensureAgentWal,
  MIN_AGENT_SUI,
  MIN_AGENT_WAL,
} from '../chain/core/src/funding.js';

const REFILL = process.argv.includes('--refill');
const f = (m: bigint) => (Number(m) / 1e9).toFixed(4);

const j = JSON.parse(readFileSync(new URL('../chain/core/.spike-keys.json', import.meta.url), 'utf8'));
const wallet = Ed25519Keypair.fromSecretKey(j.wallet);
const agent = Ed25519Keypair.fromSecretKey(j.agent);
const suiClient = createSuiClient({ nodeFetch: await nodeFetchWithLongConnect() });

async function show(label: string, addr: string): Promise<{ sui: bigint; wal: bigint }> {
  const [sui, wal] = await Promise.all([suiBalance(suiClient, addr), walBalance(suiClient, addr)]);
  const lowSui = sui < MIN_AGENT_SUI ? '  ⚠ below min' : '';
  const lowWal = wal.balance < MIN_AGENT_WAL ? '  ⚠ below min' : '';
  console.log(`\n${label}\n  ${addr}`);
  console.log(`  SUI ${f(sui)}  (min ${f(MIN_AGENT_SUI)})${lowSui}`);
  console.log(`  WAL ${f(wal.balance)}  (min ${f(MIN_AGENT_WAL)})${lowWal}`);
  return { sui, wal: wal.balance };
}

const ownerAddr = wallet.toSuiAddress();
const agentAddr = agent.toSuiAddress();

console.log('=== BEFORE ===');
let o = await show('OWNER (wallet)', ownerAddr);
let a = await show('AGENT', agentAddr);

const REBALANCE = process.argv.includes('--rebalance');
if (REBALANCE) {
  // No faucet needed: move spare SUI agent → owner so the owner clears its min.
  const amount = 300_000_000n; // 0.3 SUI
  if (a.sui < amount + MIN_AGENT_SUI) {
    console.log(`\nagent can't spare ${f(amount)} SUI and keep its gas reserve — skipping rebalance`);
  } else {
    console.log(`\n=== REBALANCE: agent → owner ${f(amount)} SUI ===`);
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
    tx.transferObjects([coin], ownerAddr);
    const res = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: agent, options: { showEffects: true } });
    await suiClient.waitForTransaction({ digest: res.digest });
    console.log(`transfer ${res.effects?.status?.status} — ${res.digest}`);
    console.log('\n=== AFTER ===');
    o = await show('OWNER (wallet)', ownerAddr);
    a = await show('AGENT', agentAddr);
  }
}

if (REFILL) {
  console.log('\n=== REFILL ===');
  // Owner needs SUI for gas + to fund/pair the agent (≥0.3 buffer is healthy)
  if (o.sui < 300_000_000n) {
    console.log('owner: requesting faucet SUI…');
    try { await faucetSui(ownerAddr); console.log('owner: faucet OK'); }
    catch (e) { console.log('owner: faucet FAILED —', e instanceof Error ? e.message : e); }
  } else console.log('owner: SUI healthy, skip faucet');

  // Agent needs SUI (gas) AND WAL (storage). Faucet if it can't afford the swap.
  if (a.sui < 250_000_000n) {
    console.log('agent: requesting faucet SUI…');
    try { await faucetSui(agentAddr); console.log('agent: faucet OK'); }
    catch (e) { console.log('agent: faucet FAILED —', e instanceof Error ? e.message : e); }
  } else console.log('agent: SUI sufficient to swap, skip faucet');

  // Swap SUI→WAL for the agent if WAL low (self-gates on SUI ≥ 0.25)
  console.log('agent: ensureAgentWal (swap SUI→WAL if low)…');
  try { const swapped = await ensureAgentWal(suiClient, agent); console.log(`agent: ${swapped ? 'swapped SUI→WAL' : 'no swap needed / not enough SUI'}`); }
  catch (e) { console.log('agent: swap FAILED —', e instanceof Error ? e.message : e); }

  console.log('\n=== AFTER ===');
  o = await show('OWNER (wallet)', ownerAddr);
  a = await show('AGENT', agentAddr);
}

console.log('\ndone.');
