/**
 * U1 KEYSTONE smoke: prove Seal key servers honor our allowlist policy —
 * a NON-owner allowlisted agent, with a SELF-SIGNED SessionKey, can decrypt
 * data encrypted to the owner's identity. Plus: outsider denied, and the
 * honest revocation semantics (cached key still serves; fresh client+session denied).
 *
 * Requires: contract published (PACKAGE_ID below), funded wallet+agent in .spike-keys.json.
 * Run: pnpm spike:seal
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { SealClient, SessionKey, NoAccessError } from '@mysten/seal';
import { readFileSync, writeFileSync } from 'node:fs';

const PACKAGE_ID = '0xdd5609e700b89eae1c11948e89bc45c506ee3a3a1a025d4eaad964c7203108d4';
const KEY_SERVERS = [
  { objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75', weight: 1 }, // mysten-testnet-1
  { objectId: '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8', weight: 1 }, // mysten-testnet-2
  { objectId: '0x6068c0acb197dddbacd4746a9de7f025b2ed5a5b6c1b1ab44dade4426d141da2', weight: 1 }, // Ruby Nodes
  { objectId: '0x5466b7df5c15b508678d51496ada8afab0d6f70a01c10613123382b1b8131007', weight: 1 }, // NodeInfra
];
const THRESHOLD = 2;

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a: unknown[]) => console.log(`[${ts()}]`, ...a);
const hexNo0x = (addr: string) => addr.replace(/^0x/, '');
const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });

function keys() {
  const j = JSON.parse(readFileSync(new URL('../.spike-keys.json', import.meta.url).pathname, 'utf8'));
  return { wallet: Ed25519Keypair.fromSecretKey(j.wallet), agent: Ed25519Keypair.fromSecretKey(j.agent) };
}

function newSealClient() {
  return new SealClient({ suiClient: suiClient as any, serverConfigs: KEY_SERVERS, verifyKeyServers: false });
}

async function exec(tx: Transaction, signer: Ed25519Keypair) {
  const res = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer,
    options: { showEffects: true, showObjectChanges: true },
  });
  if (res.effects?.status?.status !== 'success') throw new Error(`tx failed: ${JSON.stringify(res.effects?.status)}`);
  await suiClient.waitForTransaction({ digest: res.digest });
  return res;
}

async function approveTxBytes(vaultId: string, idHex: string) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::vault::seal_approve`,
    arguments: [tx.pure.vector('u8', hexToBytes(idHex)), tx.object(vaultId)],
  });
  return tx.build({ client: suiClient, onlyTransactionKind: true });
}

async function tryDecrypt(opts: {
  who: Ed25519Keypair; label: string; encrypted: Uint8Array; vaultId: string; idHex: string; client?: SealClient;
}) {
  const { who, label, encrypted, vaultId, idHex } = opts;
  const client = opts.client ?? newSealClient();
  const t0 = Date.now();
  try {
    const sessionKey = await SessionKey.create({
      address: who.toSuiAddress(),
      packageId: PACKAGE_ID,
      ttlMin: 10,
      suiClient: suiClient as any,
      signer: who,
    });
    const txBytes = await approveTxBytes(vaultId, idHex);
    const out = await client.decrypt({ data: encrypted, sessionKey, txBytes });
    const text = new TextDecoder().decode(out);
    log(`${label}: DECRYPTED in ${Date.now() - t0}ms → "${text}"`);
    return { ok: true, text, ms: Date.now() - t0 };
  } catch (e: any) {
    const kind = e instanceof NoAccessError ? 'NoAccessError' : e.constructor?.name ?? 'Error';
    log(`${label}: DENIED (${kind}) in ${Date.now() - t0}ms — ${String(e.message).slice(0, 120)}`);
    return { ok: false, kind, ms: Date.now() - t0 };
  }
}

async function main() {
  const { wallet, agent } = keys();
  const walletAddr = wallet.toSuiAddress();
  const agentAddr = agent.toSuiAddress();
  const outsider = Ed25519Keypair.generate();
  const results: Record<string, unknown> = { packageId: PACKAGE_ID };

  // 1) create vault (wallet) — spike contract has no initial-agent param; two txs here.
  //    DESIGN NOTE for U2 final: create_vault(name, first_agent) → single F0 PTB.
  const tx1 = new Transaction();
  tx1.moveCall({ target: `${PACKAGE_ID}::vault::create_vault`, arguments: [tx1.pure.string('Spike Vault')] });
  const r1 = await exec(tx1, wallet);
  const vaultChange = (r1.objectChanges ?? []).find(
    (c: any) => c.type === 'created' && String(c.objectType).endsWith('::vault::Vault'),
  ) as any;
  const vaultId = vaultChange.objectId;
  log(`vault created: ${vaultId}`);
  results.vaultId = vaultId;

  // 2) register agent (wallet)
  const tx2 = new Transaction();
  tx2.moveCall({
    target: `${PACKAGE_ID}::vault::register_agent`,
    arguments: [tx2.object(vaultId), tx2.pure.address(agentAddr)],
  });
  await exec(tx2, wallet);
  log(`agent registered: ${agentAddr.slice(0, 12)}…`);

  // 3) encrypt to the owner identity
  const idHex = hexNo0x(walletAddr);
  const sealClient = newSealClient();
  const t0 = Date.now();
  const { encryptedObject } = await sealClient.encrypt({
    threshold: THRESHOLD,
    packageId: PACKAGE_ID,
    id: idHex,
    data: new TextEncoder().encode('keystone proof: anima memory'),
  });
  log(`encrypted in ${Date.now() - t0}ms (${encryptedObject.length} bytes)`);

  // 4) KEYSTONE: non-owner allowlisted agent decrypts via self-signed session
  const keystone = await tryDecrypt({ who: agent, label: 'KEYSTONE agent (allowlisted)', encrypted: encryptedObject, vaultId, idHex });
  results.keystone = keystone;
  if (!keystone.ok) throw new Error('KEYSTONE FAILED — allowlist path not honored by key servers');

  // 5) negative: outsider (never registered) denied
  const neg = await tryDecrypt({ who: outsider, label: 'outsider (unregistered)', encrypted: encryptedObject, vaultId, idHex });
  results.outsiderDenied = !neg.ok;

  // 6) owner decrypts too (sanity)
  const own = await tryDecrypt({ who: wallet, label: 'owner', encrypted: encryptedObject, vaultId, idHex });
  results.ownerOk = own.ok;

  // 7) revoke agent → honest semantics:
  const tx3 = new Transaction();
  tx3.moveCall({
    target: `${PACKAGE_ID}::vault::revoke_agent`,
    arguments: [tx3.object(vaultId), tx3.pure.address(agentAddr)],
  });
  await exec(tx3, wallet);
  log('agent REVOKED on-chain');

  //    (a) same SealClient (cached derived key) — expected to still decrypt (the honest caveat)
  const cached = await tryDecrypt({ who: agent, label: 'revoked agent w/ CACHED client', encrypted: encryptedObject, vaultId, idHex, client: sealClient });
  //    (b) FRESH client + fresh session — expected DENIED (the R16 demo beat)
  const fresh = await tryDecrypt({ who: agent, label: 'revoked agent w/ FRESH client+session', encrypted: encryptedObject, vaultId, idHex });
  results.revokedCachedStillServes = cached.ok;
  results.revokedFreshDenied = !fresh.ok;

  writeFileSync(new URL('../spike-seal-results.json', import.meta.url).pathname, JSON.stringify(results, null, 2));
  log('KEYSTONE SMOKE COMPLETE:', JSON.stringify(results));
}

main().catch((e) => {
  console.error('KEYSTONE SMOKE FAILED:', e);
  process.exit(1);
});
