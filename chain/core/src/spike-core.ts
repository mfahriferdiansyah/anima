/**
 * U3 integration: the FULL memory lifecycle against testnet using @anima/core —
 * onboard (one PTB) → writeTurn → discover → rebuild → search → edit →
 * latest-wins → forget (wallet-signed, survivors-first) → export zip.
 * Proves edges #2 (ownership), #4 (survivors-first), #5 (cold rebuild: edits
 * show latest, forgotten absent).
 *
 * Run: pnpm spike:core
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  createSuiClient, nodeFetchWithLongConnect,
  buildOnboardingTx, execTx, vaultIdFromCreateResult, discoverVault, readVault,
  SealVault, writeTurn, listVaultQuilts, readAll, forgetNotes,
  VaultIndex, newNote, editedNote, exportVaultZip,
} from './index.js';

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a: unknown[]) => console.log(`[${ts()}]`, ...a);

async function main() {
  const keys = JSON.parse(readFileSync(new URL('../.spike-keys.json', import.meta.url).pathname, 'utf8'));
  const wallet = Ed25519Keypair.fromSecretKey(keys.wallet);
  const agent = Ed25519Keypair.fromSecretKey(keys.agent);
  const walletAddr = wallet.toSuiAddress();

  const suiClient = createSuiClient({ nodeFetch: await nodeFetchWithLongConnect() });

  // 1) onboarding: ONE PTB — create vault (first agent registered) + fund agent
  const onb = buildOnboardingTx({ name: 'Core Spike Vault', firstAgent: agent.toSuiAddress(), fundAgentMist: 0n });
  const created = await execTx(suiClient, onb, wallet);
  const vaultId = vaultIdFromCreateResult(created);
  log(`onboarded: vault ${vaultId}`);

  // 2) discovery (the resurrection primitive): find vault from wallet address alone
  const found = await discoverVault(suiClient, walletAddr);
  if (found?.vaultId !== vaultId) throw new Error('discoverVault did not find the newest vault');
  log(`discovery ✓ (name="${found.name}", agents=${found.agents.length})`);

  const seal = new SealVault({ suiClient, signer: agent, vaultId, ownerAddress: walletAddr });
  const deps = { suiClient, seal, agentSigner: agent, walletAddress: walletAddr, vaultId };

  // 3) writeTurn: 3 notes in one quilt
  const wedding = newNote({ title: 'Sister wedding', body: 'The wedding was lovely. Maya cried during the vows.', author: 'anima', tags: ['family', 'event'] });
  const coffee = newNote({ title: 'Coffee preference', body: 'Owner loves cappuccino in the morning.', author: 'anima', tags: ['prefs'] });
  const ex = newNote({ title: 'About Alex', body: 'Owner mentioned their ex, Alex. Sensitive topic.', author: 'anima', tags: ['people'] });
  let t0 = Date.now();
  const w1 = await writeTurn(deps, [wedding, coffee, ex]);
  log(`writeTurn(3 notes) in ${Date.now() - t0}ms → quilt ${w1.quiltBlobId.slice(0, 10)}…, blob obj ${w1.blobObjectId.slice(0, 10)}…`);

  // edge #2: blob owned by the WALLET
  const obj = await suiClient.getObject({ id: w1.blobObjectId, options: { showOwner: true } });
  const owner = (obj.data?.owner as any)?.AddressOwner;
  if (owner !== walletAddr) throw new Error(`blob not wallet-owned: ${JSON.stringify(obj.data?.owner)}`);
  log('edge #2 ✓ blob object owned by wallet');

  // 4) cold rebuild from chain (listVaultQuilts → readAll → index)
  t0 = Date.now();
  const quilts = await listVaultQuilts(deps);
  const entries = await readAll(deps, quilts);
  let index = VaultIndex.fromEntries(entries);
  log(`rebuild in ${Date.now() - t0}ms: ${quilts.length} quilt(s), ${index.size} notes`);
  if (index.size !== 3) throw new Error(`expected 3 notes, got ${index.size}`);

  // 5) search (AE1 foundation)
  const hit = index.search('how did the wedding go')[0];
  if (hit?.note.noteId !== wedding.noteId) throw new Error('search did not surface the wedding note');
  log(`search ✓ "${hit.note.title}" surfaced for wedding query`);

  // 6) edit → new version → rebuild shows LATEST (edge #5 part 1)
  const coffeeV2 = editedNote(coffee, { body: 'Owner switched to matcha lattes.' }, 'owner');
  await writeTurn(deps, [coffeeV2]);
  const entries2 = await readAll(deps, await listVaultQuilts(deps));
  index = VaultIndex.fromEntries(entries2);
  const coffeeNow = index.get(coffee.noteId);
  if (coffeeNow?.note.version !== 2 || !coffeeNow.note.body.includes('matcha')) {
    throw new Error('rebuild did not surface the edited version');
  }
  log('edit + latest-wins rebuild ✓ (v2 matcha)');

  // 7) forget Alex (wallet signs; wedding+coffee survive via rewrite-first) — edge #4
  t0 = Date.now();
  const { rewritten, deletedBlobObjects } = await forgetNotes(
    { ...deps, walletSigner: wallet },
    index.all(),
    [ex.noteId],
  );
  log(`forget in ${Date.now() - t0}ms: rewrote ${rewritten?.perNote.length ?? 0} survivors, deleted ${deletedBlobObjects.length} quilt(s)`);

  // 8) cold rebuild again: forgotten absent, survivors intact (edge #5 part 2)
  const entries3 = await readAll(deps, await listVaultQuilts(deps));
  const index3 = VaultIndex.fromEntries(entries3);
  if (index3.get(ex.noteId)) throw new Error('forgotten note still present after rebuild!');
  if (!index3.get(wedding.noteId) || !index3.get(coffee.noteId)) throw new Error('survivor lost during forget!');
  if (index3.get(coffee.noteId)?.note.version !== 2) throw new Error('survivor lost its latest version!');
  log(`forget + rebuild ✓ (${index3.size} notes; Alex gone, survivors intact at latest versions)`);

  // 9) export zip (R14)
  const zip = exportVaultZip(index3.all());
  writeFileSync('/tmp/anima-export.zip', zip);
  log(`export ✓ ${zip.length} bytes → /tmp/anima-export.zip`);

  log('U3 INTEGRATION COMPLETE — full memory lifecycle proven on testnet');
}

main().catch((e) => {
  console.error('U3 INTEGRATION FAILED:', e);
  process.exit(1);
});
