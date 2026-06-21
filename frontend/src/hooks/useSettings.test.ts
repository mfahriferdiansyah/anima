/**
 * DOM-free test for the settings data layer (plan U8) — the PURE core only:
 * the bigint MIST/FROST → SUI/WAL conversion, the device + allowlist key
 * derivation (with the device deduped out of vault.agents), and that connect
 * issues a secret exactly once while keeping only the `secretIssued` flag.
 *
 * chain/core, the session engine, and the shared vaultData index are mocked, so
 * neither the walrus wasm singleton nor a wallet is ever touched. The thin hook
 * + the wallet round-trips are integration-deferred (the Tier-1 test posture).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the modules useSettings.ts pulls in so the real ones (and the walrus wasm
// `?url` import behind session/suiClient) never load under node. The shared
// mutable state goes through vi.hoisted so the hoisted vi.mock factories can see
// it (a plain top-level const would be referenced before initialization).
const h = vi.hoisted(() => {
  const sessionState: {
    phase: string;
    agent?: { address: string };
    vault?: { vaultId: string; agents: string[] };
  } = { phase: 'disconnected' };
  const defaultDeps = { suiClient: { __mock: 'suiClient' }, agentSigner: { toSuiAddress: () => '0xdevice' } };
  const box: { quiltDeps: typeof defaultDeps | null } = { quiltDeps: defaultDeps };
  return { sessionState, defaultDeps, box };
});
const { sessionState, defaultDeps, box } = h;

vi.mock('@/web3/session', () => ({
  sessionStore: { getSnapshot: () => h.sessionState, subscribe: () => () => {} },
  getQuiltDeps: () => h.box.quiltDeps,
}));
vi.mock('../../../chain/core/src/index.js', () => ({
  buildRegisterAgentTx: vi.fn(() => ({ __mock: 'registerTx' })),
  buildRevokeAgentTx: vi.fn(() => ({ __mock: 'revokeTx' })),
  ensureAgentWal: vi.fn(async () => true),
  preflight: vi.fn(async () => ({ sui: 0n, wal: 0n, ok: true, needsSui: false, needsWal: false })),
}));
vi.mock('@mysten/sui/keypairs/ed25519', () => ({
  Ed25519Keypair: class {
    toSuiAddress() {
      return '0xnewagent';
    }
    getSecretKey() {
      return 'suiprivkey_secret_once';
    }
  },
}));

import {
  toBalances,
  deriveKeys,
  connectExternalAgent,
  configureSettingsExec,
  resetSettingsStore,
} from './useSettings';

beforeEach(() => {
  vi.clearAllMocks();
  sessionState.phase = 'disconnected';
  sessionState.agent = undefined;
  sessionState.vault = undefined;
  box.quiltDeps = defaultDeps;
  resetSettingsStore();
  configureSettingsExec(null);
});

describe('toBalances — bigint MIST/FROST → SUI/WAL floats', () => {
  it('converts by ÷1e9', () => {
    expect(toBalances({ sui: 4_820_000_000n, wal: 310_000_000n })).toEqual({ sui: 4.82, wal: 0.31 });
  });
  it('a zero balance converts to 0', () => {
    expect(toBalances({ sui: 0n, wal: 0n })).toEqual({ sui: 0, wal: 0 });
  });
});

describe('deriveKeys — device + vault.agents → KeyEntry[]', () => {
  it('lists the device key + the external allowlist, device deduped out of vault.agents', () => {
    const keys = deriveKeys('0xdevice', ['0xdevice', '0xclaude'], []);
    expect(keys).toHaveLength(2);
    const device = keys.find((k) => k.thisDevice)!;
    expect(device).toMatchObject({ kind: 'device', address: '0xdevice', thisDevice: true, secretIssued: false });
    // the device must appear once, not twice (it is already on vault.agents)
    expect(keys.filter((k) => k.address === '0xdevice')).toHaveLength(1);
    const ext = keys.find((k) => k.address === '0xclaude')!;
    expect(ext).toMatchObject({ kind: 'external', thisDevice: false });
  });

  it('a locally-connected agent (secretIssued) merges without duplicating an on-chain entry', () => {
    const local = [{ address: '0xclaude', label: 'claude-code', addedAt: '2026-06-21T00:00:00Z' }];
    const keys = deriveKeys('0xdevice', ['0xdevice', '0xclaude'], local);
    expect(keys.filter((k) => k.address === '0xclaude')).toHaveLength(1);
    expect(keys.find((k) => k.address === '0xclaude')).toMatchObject({
      label: 'claude-code',
      secretIssued: true,
    });
  });

  it('no device address (not ready) yields only externals', () => {
    expect(deriveKeys(null, ['0xclaude'], [])).toHaveLength(1);
  });
});

describe('connectExternalAgent — issues a once-only secret', () => {
  it('returns the secret once, keeps only secretIssued in the snapshot', async () => {
    sessionState.phase = 'ready';
    sessionState.agent = { address: '0xdevice' };
    sessionState.vault = { vaultId: '0xvault', agents: ['0xdevice'] };
    const execTx = vi.fn(async () => ({ digest: '0xabc' }));
    configureSettingsExec(execTx);

    const { key, secret } = await connectExternalAgent('research bot');

    expect(secret).toBe('suiprivkey_secret_once');
    expect(execTx).toHaveBeenCalledTimes(1); // one wallet PTB (register + fund)
    expect(key).toMatchObject({ kind: 'external', address: '0xnewagent', label: 'research bot', secretIssued: true });
    // the returned key carries only the flag, never the secret itself
    expect(JSON.stringify(key)).not.toContain('suiprivkey_secret_once');
  });

  it('throws without a ready vault / wallet exec', async () => {
    box.quiltDeps = null;
    await expect(connectExternalAgent('x')).rejects.toThrow();
  });
});
