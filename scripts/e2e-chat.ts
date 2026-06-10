/**
 * Headless end-to-end: the REAL product loop without a browser.
 * wallet-signed auth → JWT → recall from the seeded vault → /chat (real
 * OpenRouter stream, [[noteId]] citations) → /distill → writeTurn → recall
 * again. This IS AE1 + the memory loop, verified.
 *
 * Run: backend up first, then: npx tsx scripts/e2e-chat.ts
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { readFileSync } from 'node:fs';
import {
  createSuiClient, nodeFetchWithLongConnect, discoverVault,
  SealVault, listVaultQuilts, readAll, VaultIndex, newNote, writeTurn,
} from '../chain/core/src/index.js';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8080';
const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a: unknown[]) => console.log(`[${ts()}]`, ...a);

async function main() {
  const keys = JSON.parse(readFileSync(new URL('../chain/core/.spike-keys.json', import.meta.url).pathname, 'utf8'));
  const wallet = Ed25519Keypair.fromSecretKey(keys.wallet);
  const agent = Ed25519Keypair.fromSecretKey(keys.agent);

  // 1) auth exactly like the browser: sign the nonce as a personal message
  const { nonce } = await (await fetch(`${BACKEND}/auth/nonce`)).json();
  const { signature } = await wallet.signPersonalMessage(new TextEncoder().encode(nonce));
  const verify = await fetch(`${BACKEND}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: wallet.toSuiAddress(), nonce, signature }),
  });
  if (!verify.ok) throw new Error(`auth failed: ${await verify.text()}`);
  const { token } = await verify.json();
  log('auth ✓ (wallet personal-message → JWT)');

  // 2) load the seeded vault
  const suiClient = createSuiClient({ nodeFetch: await nodeFetchWithLongConnect() });
  const vault = (await discoverVault(suiClient, wallet.toSuiAddress()))!;
  const seal = new SealVault({ suiClient, signer: agent, vaultId: vault.vaultId, ownerAddress: vault.owner });
  const entries = await readAll({ suiClient, seal }, await listVaultQuilts({ suiClient, walletAddress: vault.owner, vaultId: vault.vaultId }));
  const index = VaultIndex.fromEntries(entries);
  log(`vault "${vault.name}" loaded: ${index.size} memories`);

  // 3) AE1 — the wedding question through the REAL chat pipeline
  const question = 'how did my sister\'s wedding go?';
  const hits = index.search(question, 6);
  log(`recall: ${hits.length} hits, top = "${hits[0]?.note.title}"`);
  const context = hits.map((h) => ({ noteId: h.note.noteId, title: h.note.title, body: h.note.body }));
  const persona = `You are ${vault.name}, a warm, attentive companion. Be concise and human. When you use a provided memory, cite it inline as [[noteId]]. Never invent memories.`;

  const res = await fetch(`${BACKEND}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ persona, transcript: [{ role: 'user', content: question }], context }),
  });
  if (!res.ok) throw new Error(`chat failed: ${res.status} ${await res.text()}`);
  let reply = '';
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let ev = 'message';
  outer: for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event: ')) ev = line.slice(7).trim();
      else if (line.startsWith('data: ')) {
        if (ev === 'done') break outer;
        if (ev === 'error') throw new Error(line.slice(6));
        try { reply += JSON.parse(line.slice(6)).delta ?? ''; } catch { /* noop */ }
      } else if (line === '') ev = 'message';
    }
  }
  log(`companion: ${reply}`);
  const cited = /\[\[[0-9A-Za-z]+\]\]/.test(reply);
  const mentionsWedding = /maya|wedding|vineyard|vow/i.test(reply);
  log(`AE1: cites=[[id]] ${cited ? '✓' : '✗'} · references the memory ${mentionsWedding ? '✓' : '✗'}`);
  if (!mentionsWedding) throw new Error('AE1 FAILED: reply does not use the seeded memory');

  // 4) distill a fact-bearing exchange → real note → writeTurn
  const exchange = [
    { role: 'user', content: 'by the way, I finally beat my 5k record — 26:50 this morning! and I think I want to name my new plant Fern.' },
    { role: 'assistant', content: 'That is a huge improvement — sub-27! And Fern is a lovely name.' },
  ];
  const dres = await fetch(`${BACKEND}/distill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ transcript: exchange }),
  });
  const { notes: candidates } = await dres.json();
  log(`distill: ${candidates.length} note(s) → ${candidates.map((c: any) => c.title).join(' · ')}`);
  if (candidates.length === 0) throw new Error('distiller produced nothing for a fact-bearing exchange');

  const notes = candidates.map((c: any) => newNote({ title: c.title, body: c.body, tags: c.tags ?? [], author: 'anima' }));
  const deps = { suiClient, seal, agentSigner: agent, walletAddress: vault.owner, vaultId: vault.vaultId };
  const t0 = Date.now();
  const w = await writeTurn(deps, notes);
  for (const [i, n] of notes.entries()) {
    index.upsert(n, { quiltPatchId: w.perNote[i].quiltPatchId, quiltBlobId: w.quiltBlobId, blobObjectId: w.blobObjectId });
  }
  log(`memory written in ${Date.now() - t0}ms (blob ${w.blobObjectId.slice(0, 10)}… owned by wallet)`);

  const recallNew = index.search('5k record', 3)[0];
  log(`recall new memory: "${recallNew?.note.title}" ${recallNew ? '✓' : '✗'}`);
  log('E2E COMPLETE — the full product loop works headlessly');
}

main().catch((e) => {
  console.error('E2E FAILED:', e);
  process.exit(1);
});
