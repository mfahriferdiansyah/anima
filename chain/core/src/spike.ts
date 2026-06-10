/**
 * U1 Day-1 commit-gate spike (CLI-free part).
 * Proves on Sui testnet: faucet funding, SUI→WAL exchange, quilt write→read
 * round-trip (relayer), deletable delete round-trip, and the blob-ownership
 * experiment (options a/b per plan). Keystone Seal smoke runs separately
 * (needs a Move publish — see spike-seal.ts).
 *
 * Run: pnpm --filter @anima/core spike
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { walrus, TESTNET_WALRUS_PACKAGE_CONFIG, WalrusFile } from '@mysten/walrus';
import { Agent, fetch as undiciFetch } from 'undici';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const KEYS_FILE = new URL('../.spike-keys.json', import.meta.url).pathname;
const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a: unknown[]) => console.log(`[${ts()}]`, ...a);
const SUI = 1_000_000_000n;

// ---------- clients ----------
const suiClient = new SuiJsonRpcClient({
  url: getJsonRpcFullnodeUrl('testnet'),
  network: 'testnet',
}).$extend(
  walrus({
    uploadRelay: {
      host: 'https://upload-relay.testnet.walrus.space',
      sendTip: { max: 1_000 },
    },
    storageNodeClientOptions: {
      timeout: 60_000,
      // Node undici default connectTimeout (10s) trips on slow storage nodes
      fetch: ((url: any, init: any) =>
        undiciFetch(url, {
          ...init,
          dispatcher: new Agent({ connectTimeout: 60_000 }),
        })) as unknown as typeof globalThis.fetch,
    },
  }),
);

// ---------- keys (persisted so re-runs reuse funded keys) ----------
function loadOrCreateKeys() {
  if (existsSync(KEYS_FILE)) {
    const j = JSON.parse(readFileSync(KEYS_FILE, 'utf8'));
    return {
      wallet: Ed25519Keypair.fromSecretKey(j.wallet),
      agent: Ed25519Keypair.fromSecretKey(j.agent),
    };
  }
  const wallet = Ed25519Keypair.generate();
  const agent = Ed25519Keypair.generate();
  writeFileSync(
    KEYS_FILE,
    JSON.stringify({ wallet: wallet.getSecretKey(), agent: agent.getSecretKey() }, null, 2),
  );
  return { wallet, agent };
}

async function suiBalance(addr: string) {
  const b = await suiClient.getBalance({ owner: addr });
  return BigInt(b.totalBalance);
}
async function walBalance(addr: string) {
  const all = await suiClient.getAllBalances({ owner: addr });
  const wal = all.find((b) => b.coinType.toLowerCase().endsWith('::wal::WAL'.toLowerCase()));
  return { type: wal?.coinType ?? null, balance: wal ? BigInt(wal.totalBalance) : 0n };
}

async function ensureSui(addr: string, min: bigint) {
  const have = await suiBalance(addr);
  if (have >= min) return;
  log(`faucet → ${addr.slice(0, 10)}… (have ${have})`);
  try {
    await requestSuiFromFaucetV2({ host: getFaucetHost('testnet'), recipient: addr });
  } catch (e: any) {
    if (have >= min / 2n) {
      log(`faucet rate-limited; continuing on existing balance ${have}`);
      return;
    }
    throw e;
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if ((await suiBalance(addr)) >= min) return;
  }
  throw new Error(`faucet did not fund ${addr} in time`);
}

// ---------- SUI→WAL exchange (programmatic walrus get-wal) ----------
async function discoverExchange() {
  const exId = TESTNET_WALRUS_PACKAGE_CONFIG.exchangeIds![0];
  const obj = await suiClient.getObject({ id: exId, options: { showType: true } });
  const type = obj.data?.type ?? '';
  // type looks like 0xPKG::wal_exchange::Exchange
  const m = type.match(/^(0x[0-9a-f]+)::([a-zA-Z_]+)::/);
  if (!m) throw new Error(`cannot parse exchange type: ${type}`);
  const [, pkg, module_] = m;
  const mod = await suiClient.getNormalizedMoveModule({ package: pkg, module: module_ });
  const fns = Object.keys(mod.exposedFunctions ?? {});
  log(`exchange pkg=${pkg.slice(0, 10)}… module=${module_} fns=[${fns.join(', ')}]`);
  return { exId, pkg, module: module_, fns };
}

async function exchangeSuiForWal(signer: Ed25519Keypair, amountMist: bigint) {
  const { exId, pkg, module: mod, fns } = await discoverExchange();
  const fn = fns.includes('exchange_all_for_wal') ? 'exchange_all_for_wal' : fns.find((f) => f.includes('for_wal'));
  if (!fn) throw new Error(`no for_wal fn among: ${fns.join(', ')}`);
  const tx = new Transaction();
  const [suiCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
  const [walCoin] = tx.moveCall({ target: `${pkg}::${mod}::${fn}`, arguments: [tx.object(exId), suiCoin] });
  tx.transferObjects([walCoin], signer.toSuiAddress());
  const res = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer,
    options: { showEffects: true },
  });
  if (res.effects?.status?.status !== 'success') throw new Error(`exchange failed: ${JSON.stringify(res.effects?.status)}`);
  await suiClient.waitForTransaction({ digest: res.digest });
  const w = await walBalance(signer.toSuiAddress());
  log(`exchanged ${amountMist} MIST → WAL (tx ${res.digest.slice(0, 10)}…), balance: ${w.balance} FROST (${w.type})`);
}

// ---------- main ----------
async function main() {
  const results: Record<string, unknown> = {};
  const { wallet, agent } = loadOrCreateKeys();
  const walletAddr = wallet.toSuiAddress();
  const agentAddr = agent.toSuiAddress();
  log(`wallet ${walletAddr}`);
  log(`agent  ${agentAddr}`);

  // 1) fund: faucet → wallet; wallet → agent transfer (mirrors the F0 onboarding PTB)
  await ensureSui(walletAddr, 300_000_000n);
  if ((await suiBalance(agentAddr)) < 300_000_000n) {
    const txF = new Transaction();
    const [c] = txF.splitCoins(txF.gas, [txF.pure.u64(600_000_000n)]);
    txF.transferObjects([c], agentAddr);
    const fRes = await suiClient.signAndExecuteTransaction({ transaction: txF, signer: wallet, options: { showEffects: true } });
    if (fRes.effects?.status?.status !== 'success') throw new Error('wallet→agent funding failed');
    await suiClient.waitForTransaction({ digest: fRes.digest });
    log(`wallet funded agent with 0.6 SUI (tx ${fRes.digest.slice(0, 10)}…)`);
  }
  if ((await walBalance(agentAddr)).balance < 100_000_000n) {
    await exchangeSuiForWal(agent, 300_000_000n); // 0.3 SUI → 0.3 WAL
  }
  // option (a) discovery: with owner=wallet the SDK sources WAL from the OWNER — fund wallet with WAL too
  if ((await walBalance(walletAddr)).balance < 50_000_000n) {
    try {
      await exchangeSuiForWal(wallet, 100_000_000n); // 0.1 SUI → 0.1 WAL
    } catch (e: any) {
      if (String(e.message).includes('rebuilt') || e.code === -32002) {
        log('retrying wallet exchange after settle…');
        await new Promise((r) => setTimeout(r, 3000));
        await exchangeSuiForWal(wallet, 100_000_000n);
      } else throw e;
    }
  }
  results.funding = 'ok';

  // 2) quilt write→read round-trip (agent signs, default owner = agent)
  const noteA = `---\nnoteId: 01TESTAAAA\nversion: 1\nauthor: anima\ntags: [spike]\n---\n# Wedding\nSister's wedding was lovely.`;
  const noteB = `---\nnoteId: 01TESTBBBB\nversion: 1\nauthor: anima\ntags: [spike]\n---\n# Coffee\nOwner prefers cappuccino.`;
  const files = [
    WalrusFile.from({ contents: new TextEncoder().encode(noteA), identifier: '01TESTAAAA@1', tags: { t: 'spike' } }),
    WalrusFile.from({ contents: new TextEncoder().encode(noteB), identifier: '01TESTBBBB@1', tags: { t: 'spike' } }),
  ];
  let t0 = Date.now();
  const written = await suiClient.walrus.writeFiles({
    files,
    epochs: 5,
    deletable: true,
    signer: agent,
  });
  const writeMs = Date.now() - t0;
  log(`WRITE ok in ${writeMs}ms →`, written.map((w) => ({ id: w.id.slice(0, 16) + '…', blobId: w.blobId.slice(0, 12) + '…' })));
  results.write = { ms: writeMs, blobId: written[0].blobId, quiltPatchIds: written.map((w) => w.id) };

  t0 = Date.now();
  const readBack = await suiClient.walrus.getFiles({ ids: [written[0].id, written[1].id] });
  const texts = await Promise.all(readBack.map((f) => f.text()));
  const readMs = Date.now() - t0;
  if (texts[0] !== noteA || texts[1] !== noteB) throw new Error('round-trip mismatch!');
  log(`READ ok in ${readMs}ms — byte-identical ✓`);
  results.read = { ms: readMs, identical: true };

  // 3) ownership experiment
  // (a) owner = wallet, signer = agent — does the flow survive certify?
  let optionA = 'unknown';
  try {
    const w2 = await suiClient.walrus.writeFiles({
      files: [WalrusFile.from({ contents: new TextEncoder().encode('owner-test'), identifier: 'OWNERTEST@1' })],
      epochs: 1,
      deletable: true,
      signer: agent,
      owner: walletAddr,
    });
    // verify on-chain owner of the Blob object
    const obj = await suiClient.getObject({ id: (w2[0].blobObject as any).id.id, options: { showOwner: true } });
    optionA = `SUCCEEDED — blob owner: ${JSON.stringify(obj.data?.owner)}`;
  } catch (e: any) {
    optionA = `FAILED: ${e.message?.slice(0, 200)}`;
  }
  log(`option (a) owner=wallet, signer=agent → ${optionA}`);
  results.optionA = optionA;

  // (b) default owner (=agent), then transfer Blob object to wallet; wallet deletes
  const bo = written[0].blobObject as any;
  log('blobObject shape:', JSON.stringify(bo).slice(0, 300));
  const blobObjectId: string = typeof bo.id === 'string' ? bo.id : bo.id?.id ?? bo.objectId;
  if (!blobObjectId) throw new Error('cannot determine blob object id from: ' + JSON.stringify(bo).slice(0, 200));
  const txT = new Transaction();
  txT.transferObjects([txT.object(blobObjectId)], walletAddr);
  const tRes = await suiClient.signAndExecuteTransaction({ transaction: txT, signer: agent, options: { showEffects: true } });
  if (tRes.effects?.status?.status !== 'success') throw new Error('transfer to wallet failed');
  await suiClient.waitForTransaction({ digest: tRes.digest });
  await new Promise((r) => setTimeout(r, 2000));
  log(`option (b) transfer blob → wallet ok (tx ${tRes.digest.slice(0, 10)}…)`);

  // acceptance (i): WALLET deletes the quilt blob it now owns
  t0 = Date.now();
  const del = await suiClient.walrus.executeDeleteBlobTransaction({ blobObjectId, signer: wallet });
  log(`DELETE by wallet ok in ${Date.now() - t0}ms (tx ${del.digest.slice(0, 10)}…)`);
  results.optionB = { transferred: true, walletDeleted: true };

  // verify read now fails (eventually)
  try {
    await suiClient.walrus.getFiles({ ids: [written[0].id] });
    log('post-delete read: still served (cache/grace) — acceptable, deletion is on-chain');
    results.postDeleteRead = 'served-from-cache';
  } catch {
    log('post-delete read: gone ✓');
    results.postDeleteRead = 'gone';
  }

  writeFileSync(new URL('../spike-results.json', import.meta.url).pathname, JSON.stringify(results, null, 2));
  log('SPIKE (CLI-free part) COMPLETE — results in chain/core/spike-results.json');
}

main().catch((e) => {
  console.error('SPIKE FAILED:', e);
  process.exit(1);
});
