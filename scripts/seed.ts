/**
 * Seed v0 — purge-and-rewrite demo memories into the demo wallet's vault.
 * Re-runnable: deletes every existing quilt in the vault, then writes fresh
 * (testnet-wipe recovery + demo reset in one script).
 *
 * Demo path: the demo wallet's key is imported into the browser wallet so the
 * seeded vault is the one on camera. Honest label: notes are backdated
 * "simulated history" — the demo SAYS so.
 *
 * Run: pnpm seed
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { readFileSync } from 'node:fs';
import {
  createSuiClient, nodeFetchWithLongConnect,
  buildOnboardingTx, execTx, vaultIdFromCreateResult, discoverVault,
  SealVault, writeTurn, listVaultQuilts,
  newNote, type Note, preflight, exchangeSuiForWal,
} from '../chain/core/src/index.js';

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a: unknown[]) => console.log(`[${ts()}]`, ...a);
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const n = (title: string, body: string, tags: string[], ageDays: number, links: string[] = []): Note =>
  newNote({ title, body, author: 'anima', tags, links, updatedAt: daysAgo(ageDays) });

// ---- the simulated history (turn batches → separate quilts) ----
const SISTER_WEDDING = n(
  "Sister Maya's wedding",
  "Maya got married on a vineyard last month. Owner walked her down the aisle and cried during the vows. The band played their childhood song; Owner said it was 'the happiest day of the year so far'.",
  ['family', 'event', 'maya'],
  21,
);

const turns: Note[][] = [
  // turn 1 — family & self
  [
    SISTER_WEDDING,
    n('Coffee preference', 'Owner loves cappuccino in the morning — exactly one, before any meetings. Dislikes overly sweet drinks.', ['prefs', 'food'], 28),
    n("Mom's birthday", "Mom's birthday is July 3rd. Owner wants to plan a small dinner — Italian, probably at Lucia's.", ['family', 'dates'], 26),
    n('Peanut allergy', 'Owner has a mild peanut allergy — itchy throat, not anaphylactic. Avoids satay and most Thai desserts.', ['health'], 25),
  ],
  // turn 2 — work & projects
  [
    n('Sui Overflow project', 'Owner is building ANIMA for the Sui Overflow 2026 hackathon — an owned memory vault for AI companions. Deadline June 21. Stressed but excited.', ['work', 'hackathon', 'sui'], 14),
    n('Guitar progress', "Practicing guitar ~3 nights a week. Can now play 'Blackbird' almost cleanly; struggles with barre chords.", ['hobby', 'music'], 12),
    n('Running habit', 'Runs 5k on Tuesday and Saturday mornings along the river. Best time so far: 27:40. Goal: sub-26 by August.', ['health', 'habit'], 10),
  ],
  // turn 3 — plans & people
  [
    n('Kyoto trip plan', "Planning a Kyoto trip for late September: wants the Philosopher's Path in early autumn, a ryokan night, and a knife shop visit.", ['travel', 'plans'], 7),
    n("Sam's startup", "Friend Sam quit their job to build a logistics startup. Owner promised to review Sam's pitch deck next week.", ['people', 'sam'], 5, []),
    n('Apartment hunt', 'Considering moving closer to the city center in autumn. Budget cap ~$1,800/mo; wants a balcony and afternoon light.', ['life', 'plans'], 4),
    n('Favorite film', "Rewatched 'Spirited Away' — calls it the comfort film. Wants to see it in a theater someday.", ['prefs', 'culture'], 3),
  ],
  // turn 4 — the forget-target quilt (own quilt → clean forget beat)
  [
    n('About Alex', "Owner talked about their ex, Alex. They broke up in winter; Owner still finds salt-rosemary bread hard to bake because it was 'their thing'.", ['people', 'sensitive'], 9),
    n("Alex's dog", "Owner sometimes misses Biscuit, Alex's beagle. Saw a similar dog at the park and went quiet.", ['people', 'sensitive'], 8),
  ],
];

async function main() {
  const keys = JSON.parse(readFileSync(new URL('../chain/core/.spike-keys.json', import.meta.url).pathname, 'utf8'));
  const wallet = Ed25519Keypair.fromSecretKey(keys.wallet);
  const agent = Ed25519Keypair.fromSecretKey(keys.agent);
  const walletAddr = wallet.toSuiAddress();
  const suiClient = createSuiClient({ nodeFetch: await nodeFetchWithLongConnect() });

  // funding preflight (agent pays writes)
  const pf = await preflight(suiClient, agent.toSuiAddress());
  log(`agent balances: ${pf.sui} MIST, ${pf.wal} FROST (${pf.ok ? 'ok' : 'NEEDS FUNDING'})`);
  if (pf.needsWal && pf.sui > 200_000_000n) {
    await exchangeSuiForWal(suiClient, agent, 150_000_000n);
    log('exchanged SUI→WAL for seeding');
  }

  // vault: newest "Anima" vault or create
  let vault = await discoverVault(suiClient, walletAddr);
  if (!vault || vault.name !== 'Anima') {
    const res = await execTx(suiClient, buildOnboardingTx({ name: 'Anima', firstAgent: agent.toSuiAddress(), fundAgentMist: 0n }), wallet);
    const vaultId = vaultIdFromCreateResult(res);
    vault = { vaultId, owner: walletAddr, name: 'Anima', agents: [agent.toSuiAddress()] };
    log(`created demo vault: ${vaultId}`);
  } else {
    log(`reusing vault: ${vault.vaultId}`);
  }

  const seal = new SealVault({ suiClient, signer: agent, vaultId: vault.vaultId, ownerAddress: walletAddr });
  const deps = { suiClient, seal, agentSigner: agent, walletAddress: walletAddr, vaultId: vault.vaultId };

  // purge: delete every existing quilt in this vault (wallet owns them)
  const existing = await listVaultQuilts(deps);
  for (const blobObjectId of existing) {
    await suiClient.walrus.executeDeleteBlobTransaction({ blobObjectId, signer: wallet });
    log(`purged old quilt ${blobObjectId.slice(0, 10)}…`);
  }

  // rewrite fresh
  let total = 0;
  for (const [i, batch] of turns.entries()) {
    const t0 = Date.now();
    const w = await writeTurn(deps, batch);
    total += batch.length;
    log(`turn ${i + 1}: ${batch.length} notes in ${Date.now() - t0}ms (quilt ${w.quiltBlobId.slice(0, 10)}…)`);
  }

  log(`SEED COMPLETE: ${total} notes across ${turns.length} quilts in vault ${vault.vaultId}`);
  log(`demo wallet: ${walletAddr}`);
  log("AE1 check: ask the companion 'how did my sister's wedding go?'");
}

main().catch((e) => {
  console.error('SEED FAILED:', e);
  process.exit(1);
});
