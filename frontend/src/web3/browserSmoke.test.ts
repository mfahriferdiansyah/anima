/**
 * DOM-free orchestration test for the smoke harness. The chain/core layer and
 * the SuiClient singleton are mocked — this proves the STEP SEQUENCING and the
 * failed-service labeling, not the live network surface (that is U2's live run
 * against the seeded vault). A real generated keypair signs the nonce.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

vi.mock('./suiClient', () => ({
  getSuiClient: () => ({ __mock: 'suiClient' }),
  WALRUS_WASM_URL: 'mock.wasm',
}));
vi.mock('../../../chain/core/src/index.js', () => ({
  discoverVault: vi.fn(),
  SealVault: vi.fn().mockImplementation(() => ({ __mock: 'seal' })),
  listVaultQuilts: vi.fn(),
  readAll: vi.fn(),
}));

import { runBrowserSmoke } from './browserSmoke';
import { discoverVault, listVaultQuilts, readAll } from '../../../chain/core/src/index.js';

const agent = new Ed25519Keypair();
const AGENT_SECRET = agent.getSecretKey();
const OWNER = '0xowner';
const BACKEND = 'http://localhost:8080';

function makeFetch(opts: { nonceOk?: boolean; verifyOk?: boolean } = {}) {
  const { nonceOk = true, verifyOk = true } = opts;
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith('/auth/nonce')) {
      return { ok: nonceOk, status: nonceOk ? 200 : 500, json: async () => ({ nonce: 'anima:1:abc' }) } as Response;
    }
    if (u.endsWith('/auth/verify')) {
      return { ok: verifyOk, status: verifyOk ? 200 : 401, json: async () => ({ token: verifyOk ? 'jwt.token' : '' }) } as Response;
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;
}

beforeEach(() => vi.clearAllMocks());

describe('web3/browserSmoke', () => {
  it('passes the full sequence when every leg is healthy', async () => {
    vi.mocked(discoverVault).mockResolvedValue({ vaultId: '0xv', owner: OWNER, name: 'demo', agents: [] });
    vi.mocked(listVaultQuilts).mockResolvedValue(['0xblob']);
    vi.mocked(readAll).mockResolvedValue([{ noteId: 'n1' } as never]);

    const res = await runBrowserSmoke({ backendUrl: BACKEND, agentSecret: AGENT_SECRET, ownerAddress: OWNER, fetchImpl: makeFetch() });

    expect(res.ok).toBe(true);
    expect(res.failedService).toBeUndefined();
    expect(res.steps.map((s) => s.name)).toEqual([
      'auth:nonce', 'auth:verify', 'discover', 'list-quilts', 'read+decrypt',
    ]);
    expect(res.steps.every((s) => s.ok)).toBe(true);
  });

  it('labels the backend and short-circuits when auth/verify is rejected', async () => {
    const res = await runBrowserSmoke({ backendUrl: BACKEND, agentSecret: AGENT_SECRET, ownerAddress: OWNER, fetchImpl: makeFetch({ verifyOk: false }) });

    expect(res.ok).toBe(false);
    expect(res.failedService).toBe('backend');
    expect(res.steps.find((s) => s.name === 'auth:verify')?.ok).toBe(false);
    expect(res.steps.find((s) => s.name === 'discover')).toBeUndefined();
  });

  it('labels the seal/walrus surface when nothing decrypts', async () => {
    vi.mocked(discoverVault).mockResolvedValue({ vaultId: '0xv', owner: OWNER, name: 'demo', agents: [] });
    vi.mocked(listVaultQuilts).mockResolvedValue(['0xblob']);
    vi.mocked(readAll).mockResolvedValue([]);

    const res = await runBrowserSmoke({ backendUrl: BACKEND, agentSecret: AGENT_SECRET, ownerAddress: OWNER, fetchImpl: makeFetch() });

    expect(res.ok).toBe(false);
    expect(res.failedService).toContain('seal');
    expect(res.steps.find((s) => s.name === 'read+decrypt')?.ok).toBe(false);
  });
});
