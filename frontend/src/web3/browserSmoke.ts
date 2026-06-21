/**
 * The day-one browser smoke test (plan U2, R10). A thin
 * connect→auth→discoverVault→read-one-quilt→decrypt probe that ASSERTS each
 * step and names the failing service, proving the unproven browser surface:
 * CORS to the Sui RPC + Walrus aggregator/relay + the 4 Seal key servers, and
 * walrus WASM bundling under Vite. It mirrors scripts/e2e-chat.ts (the headless
 * reference) but runs in the browser bundle.
 *
 * Dev-signer mode: the allowlisted agent key + owner address are INJECTED AT
 * RUNTIME (passed to window.__anima.runSmoke in the console), never via a
 * VITE_* var (Vite would inline it into the build) and never imported. The
 * whole harness is mode-gated out of production builds in main.tsx.
 *
 * The live run is gated on prerequisites (backend up + CORS origin reconciled
 * + the agent key currently allowlisted on the seeded vault) — see the plan.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { discoverVault, SealVault, listVaultQuilts, readAll } from '../../../chain/core/src/index.js';
import { getSuiClient } from './suiClient';

export interface SmokeStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SmokeResult {
  ok: boolean;
  steps: SmokeStep[];
  /** The service implicated when a step fails — so a red run points at the cause. */
  failedService?: string;
}

export interface SmokeOpts {
  backendUrl: string;
  /** An allowlisted ed25519 agent key (`suiprivkey1...`), injected at runtime. */
  agentSecret: string;
  /** The seeded vault's owner address. */
  ownerAddress: string;
  /** Injectable for unit tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Runs the probe, recording each step. Never throws — returns a structured
 * result so the caller (console / CI) can see exactly which leg failed.
 */
export async function runBrowserSmoke(opts: SmokeOpts): Promise<SmokeResult> {
  const steps: SmokeStep[] = [];
  const f = opts.fetchImpl ?? fetch;
  const suiClient = getSuiClient();
  const agent = Ed25519Keypair.fromSecretKey(opts.agentSecret);
  const agentAddress = agent.toSuiAddress();

  async function step<T>(name: string, service: string, fn: () => Promise<T>): Promise<T> {
    try {
      const value = await fn();
      steps.push({ name, ok: true, detail: 'ok' });
      return value;
    } catch (e) {
      steps.push({ name, ok: false, detail: `${service}: ${errMsg(e)}` });
      throw Object.assign(new Error(`smoke step "${name}" failed`), { service });
    }
  }

  try {
    // 1) auth — exactly like scripts/e2e-chat.ts, but signed by the agent key
    const { nonce } = await step('auth:nonce', 'backend', async () => {
      const r = await f(`${opts.backendUrl}/auth/nonce`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { nonce: string };
    });
    const { signature } = await agent.signPersonalMessage(new TextEncoder().encode(nonce));
    await step('auth:verify', 'backend', async () => {
      const r = await f(`${opts.backendUrl}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: agentAddress, nonce, signature }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} (CORS? ed25519-only?)`);
      const { token } = (await r.json()) as { token: string };
      if (!token) throw new Error('no token in response');
      return token;
    });

    // 2) discover the vault from the wallet alone (the resurrection primitive)
    const vault = await step('discover', 'sui-rpc', async () => {
      const v = await discoverVault(suiClient, opts.ownerAddress);
      if (!v) throw new Error(`no vault for owner ${opts.ownerAddress}`);
      return v;
    });

    // 3) seal + read + decrypt — the keystone (agent-self-signed SessionKey)
    const seal = new SealVault({
      suiClient,
      signer: agent,
      vaultId: vault.vaultId,
      ownerAddress: vault.owner,
    });
    const blobIds = await step('list-quilts', 'sui-rpc/walrus', () =>
      listVaultQuilts({ suiClient, walletAddress: vault.owner, vaultId: vault.vaultId }),
    );
    await step('read+decrypt', 'walrus-aggregator+seal-keyservers', async () => {
      const notes = await readAll({ suiClient, seal }, blobIds);
      if (notes.length < 1) throw new Error('no decryptable notes (key allowlisted? blobs present?)');
      return notes;
    });

    return { ok: true, steps };
  } catch (e) {
    return { ok: false, steps, failedService: (e as { service?: string }).service };
  }
}
