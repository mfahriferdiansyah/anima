/**
 * pair-smoke — end-to-end testnet gate for the pairing command (AE2).
 *
 * Mints a fresh agent, pairs + funds it via pairAgent(), then writes a real
 * note AS that agent (a real `remember`) and reads it back. Passing loadConfig
 * or preflight does NOT prove write-success, so the gate is an actual write.
 *
 * This SPENDS testnet SUI/WAL and writes a note to the vault. Opt-in only:
 *   pnpm pair:smoke
 * Owner key + vault are resolved exactly as `pnpm pair` does (env or the
 * gitignored .spike-keys.json; ANIMA_VAULT_ID or discovery).
 *
 * NOT a vitest case (vitest has no testnet wallet); run it by hand.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  createSuiClient,
  nodeFetchWithLongConnect,
  SealVault,
  writeTurn,
  readAll,
  listVaultQuilts,
  newNote,
} from '../chain/core/src/index.js';
import { loadOwner, resolveVaultId, pairAgent } from './pair.js';

const log = (...a: unknown[]) => console.error('[pair-smoke]', ...a);

async function main(): Promise<void> {
  const owner = loadOwner();
  const ownerAddr = owner.toSuiAddress();
  const suiClient = createSuiClient({ nodeFetch: await nodeFetchWithLongConnect() });
  const vaultId = await resolveVaultId(suiClient, ownerAddr);

  const agent = Ed25519Keypair.generate();
  const res = await pairAgent({ suiClient, owner, vaultId, agent });
  if (!res.ok) throw new Error(`pairing left the agent under threshold (sui ${res.sui}, wal ${res.wal})`);
  log(`paired ${res.agentAddr}: ${res.sui} SUI, ${res.wal} WAL`);

  const seal = new SealVault({ suiClient, signer: agent, vaultId, ownerAddress: ownerAddr });
  const deps = { suiClient, seal, agentSigner: agent, walletAddress: ownerAddr, vaultId };

  const note = newNote({
    title: 'pair-smoke',
    body: 'Written by a freshly paired agent to prove the emitted env can actually write.',
    author: 'pair-smoke',
    tags: ['smoke'],
    links: [],
  });
  const t0 = Date.now();
  const w = await writeTurn(deps, [note]);
  log(`remember OK in ${Date.now() - t0}ms (quilt ${w.quiltBlobId.slice(0, 10)}…)`);

  const quilts = await listVaultQuilts(deps);
  const all = await readAll(deps, quilts);
  const found = all.some((x) => x.note.title === 'pair-smoke');
  if (!found) throw new Error('wrote the note but could not read it back');
  log('read-back OK — pairing emits a working write credential. AE2 ✓');
}

main().catch((e) => {
  console.error('PAIR-SMOKE FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
