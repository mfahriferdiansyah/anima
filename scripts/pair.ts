/**
 * pair — owner-run pairing for anima-mcp.
 *
 * Authorizes and funds an agent on your vault, then emits a working four-var
 * env so an external agent (Claude Code, Cursor) can read and write your notes
 * over anima-mcp. `register_agent` is owner-only, so this runs owner-signed.
 *
 * Funding is two-signer: the owner funds the agent SUI during register, then
 * the agent swaps a little SUI for WAL. The MCP write path requires WAL and
 * never self-heals, so a SUI-only agent connects but fails its first write.
 * We fund 0.3 SUI and swap 0.15, leaving the agent above both thresholds.
 *
 * Owner key: read from ANIMA_OWNER_KEY (suiprivkey…) or the gitignored
 * chain/core/.spike-keys.json. Never passed as a CLI argument, never logged.
 *
 *   pnpm pair                    mint + register + fund a fresh agent
 *   pnpm pair --print-key        also print the agent secret to stdout
 *   pnpm pair revoke 0x<agent>   owner-signed revoke of an agent address
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createSuiClient,
  nodeFetchWithLongConnect,
  buildRegisterAgentTx,
  buildRevokeAgentTx,
  execTx,
  readVault,
  discoverVault,
  preflight,
  exchangeSuiForWal,
  MIN_AGENT_SUI,
  MIN_AGENT_WAL,
} from '../chain/core/src/index.js';

// stderr for logs; stdout is reserved for the env block so it can be redirected.
const log = (...a: unknown[]) => console.error(...a);

const FUND_MIST = 300_000_000n; // 0.3 SUI: after a 0.15 swap the agent keeps 0.15 > MIN_AGENT_SUI (0.1)
const SWAP_MIST = 150_000_000n; // 0.15 SUI → WAL (1:1), well over MIN_AGENT_WAL (0.02)
const ENV_FILE = fileURLToPath(new URL('../.anima-agent.env', import.meta.url));
const HEX_ID = /^0x[0-9a-fA-F]{1,64}$/;

/** Register (if not already on the allowlist) + fund + swap so the agent can actually write. */
export async function pairAgent(opts: {
  suiClient: any;
  owner: Ed25519Keypair;
  vaultId: string;
  agent: Ed25519Keypair;
  agentNames?: string[];
}): Promise<{ agentAddr: string; alreadyPaired: boolean; ok: boolean; sui: bigint; wal: bigint }> {
  const { suiClient, owner, vaultId, agent } = opts;
  const agentAddr = agent.toSuiAddress();
  const vault = await readVault(suiClient, vaultId);
  const alreadyPaired = vault.agents.includes(agentAddr);

  if (alreadyPaired) {
    log(`agent ${agentAddr} is already on the vault allowlist — not re-registering.`);
  } else {
    log(`registering + funding agent ${agentAddr} on vault ${vaultId} (owner-signed)…`);
    await execTx(suiClient, buildRegisterAgentTx({ vaultId, agent: agentAddr, fundAgentMist: FUND_MIST }), owner);
  }

  let pf = await preflight(suiClient, agentAddr);
  if (pf.needsWal && pf.sui >= SWAP_MIST + MIN_AGENT_SUI) {
    log('swapping SUI → WAL (agent-signed) so the first write succeeds…');
    await exchangeSuiForWal(suiClient, agent, SWAP_MIST);
    pf = await preflight(suiClient, agentAddr);
  }
  return { agentAddr, alreadyPaired, ok: pf.ok, sui: pf.sui, wal: pf.wal };
}

export async function revokeAgent(opts: {
  suiClient: any;
  owner: Ed25519Keypair;
  vaultId: string;
  agentAddr: string;
}): Promise<void> {
  await execTx(opts.suiClient, buildRevokeAgentTx({ vaultId: opts.vaultId, agent: opts.agentAddr }), opts.owner);
}

/** Owner key from env or the gitignored demo file. Never a CLI arg, never logged. */
export function loadOwner(): Ed25519Keypair {
  const fromEnv = process.env.ANIMA_OWNER_KEY?.trim();
  if (fromEnv) {
    if (!fromEnv.startsWith('suiprivkey')) throw new Error('ANIMA_OWNER_KEY must be a suiprivkey… secret.');
    return Ed25519Keypair.fromSecretKey(fromEnv);
  }
  try {
    const keys = JSON.parse(
      readFileSync(fileURLToPath(new URL('../chain/core/.spike-keys.json', import.meta.url)), 'utf8'),
    );
    return Ed25519Keypair.fromSecretKey(keys.wallet);
  } catch {
    throw new Error(
      'No owner key found. Set ANIMA_OWNER_KEY (suiprivkey…) in your environment, or provide chain/core/.spike-keys.json. ' +
        'Never pass the owner key as a command-line argument (it lands in shell history).',
    );
  }
}

export async function resolveVaultId(suiClient: any, ownerAddr: string): Promise<string> {
  const envVault = process.env.ANIMA_VAULT_ID?.trim();
  if (envVault) {
    if (!HEX_ID.test(envVault)) throw new Error('ANIMA_VAULT_ID must be a 0x… vault object id.');
    return envVault;
  }
  const v = await discoverVault(suiClient, ownerAddr);
  if (!v) throw new Error(`No vault found for ${ownerAddr}. Set ANIMA_VAULT_ID, or create a vault in the app first.`);
  return v.vaultId;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0] && !args[0].startsWith('-') ? args[0] : 'pair';

  const owner = loadOwner();
  const ownerAddr = owner.toSuiAddress();
  const suiClient = createSuiClient({ nodeFetch: await nodeFetchWithLongConnect() });
  const vaultId = await resolveVaultId(suiClient, ownerAddr);

  const vault = await readVault(suiClient, vaultId);
  if (vault.owner !== ownerAddr) {
    throw new Error(
      `The loaded owner key (${ownerAddr}) does not own vault ${vaultId} (owner is ${vault.owner}). ` +
        'register_agent and revoke are owner-only.',
    );
  }

  if (cmd === 'revoke') {
    const target = args[1];
    if (!target || !HEX_ID.test(target)) throw new Error('Usage: pnpm pair revoke <agentAddress 0x…>');
    log(`revoking agent ${target} on vault ${vaultId}…`);
    await revokeAgent({ suiClient, owner, vaultId, agentAddr: target });
    log('revoked. The agent is denied on its next session (a fresh SessionKey re-checks the allowlist).');
    return;
  }

  // pair: reuse ANIMA_AGENT_KEY if provided (idempotent re-pair), else mint a fresh agent.
  // Validate symmetrically with loadOwner: a malformed key must error, not silently
  // mint and fund a new agent (which would also overwrite the only stored copy).
  const existing = process.env.ANIMA_AGENT_KEY?.trim();
  if (existing && !existing.startsWith('suiprivkey')) {
    throw new Error(
      'ANIMA_AGENT_KEY is set but is not a suiprivkey… secret. Unset it to mint a fresh agent, or fix the value.',
    );
  }
  const reusing = Boolean(existing);
  const agent = existing ? Ed25519Keypair.fromSecretKey(existing) : Ed25519Keypair.generate();
  const agentName = process.env.ANIMA_AGENT_NAME?.trim() || 'mcp-agent';

  const res = await pairAgent({ suiClient, owner, vaultId, agent });
  if (res.ok) {
    log(`agent funded: ${res.sui} MIST SUI, ${res.wal} FROST WAL — ready to read and write.`);
  } else {
    // An already-paired agent skips the owner-signed funding tx, so topping the
    // owner wallet does nothing; only a direct top-up of the agent address helps.
    const tip = res.alreadyPaired
      ? `This agent was already registered, so no funding tx ran. Send SUI directly to ${res.agentAddr} and re-run, or revoke it and pair a fresh agent.`
      : 'Top up the owner wallet (it funds the agent) and re-run.';
    log(
      `warning: the agent is still under threshold (sui ${res.sui}, wal ${res.wal}; need ${MIN_AGENT_SUI} SUI and ${MIN_AGENT_WAL} WAL). ${tip}`,
    );
  }

  // Emit env: write all four vars to a gitignored file (0600); print non-secret
  // vars to stdout, and the agent secret only behind --print-key.
  if (!reusing && existsSync(ENV_FILE)) {
    log(
      `note: overwriting an existing ${ENV_FILE}. Any previously paired agent stays authorized until you revoke it (pnpm pair revoke <its-address>).`,
    );
  }
  const secret = agent.getSecretKey();
  writeFileSync(
    ENV_FILE,
    [
      `ANIMA_AGENT_KEY=${secret}`,
      `ANIMA_VAULT_ID=${vaultId}`,
      `ANIMA_OWNER_ADDRESS=${ownerAddr}`,
      `ANIMA_AGENT_NAME=${agentName}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  // writeFileSync's mode option only applies when the file is created; enforce
  // 0600 on re-runs too so the full-vault agent secret is never left readable.
  chmodSync(ENV_FILE, 0o600);
  log(`\nWrote the agent env to ${ENV_FILE} (gitignored). Paste these into your agent's MCP config:`);

  const printKey = args.includes('--print-key');
  console.log(
    `ANIMA_AGENT_KEY=${printKey ? secret : `<secret in ${ENV_FILE}; full-vault credential, treat like a password>`}`,
  );
  console.log(`ANIMA_VAULT_ID=${vaultId}`);
  console.log(`ANIMA_OWNER_ADDRESS=${ownerAddr}`);
  console.log(`ANIMA_AGENT_NAME=${agentName}`);

  log(`\nThe agent key grants full read and write of this vault. Revoke any time:`);
  log(`  pnpm pair revoke ${res.agentAddr}`);
}

// Run as a CLI only when invoked directly (so pair-smoke.ts can import the helpers).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error('PAIR FAILED:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
