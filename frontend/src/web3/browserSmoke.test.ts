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
const PROBE = {
  noteId: 'nWrite', version: 1, updatedAt: 'x', author: 'agent:smoke',
  tags: [], links: [], title: 'tier1-write-smoke', body: 'tier1 write→read→decrypt probe',
};

vi.mock('../../../chain/core/src/index.js', () => ({
  discoverVault: vi.fn(),
  SealVault: vi.fn().mockImplementation(() => ({ __mock: 'seal' })),
  listVaultQuilts: vi.fn(),
  readAll: vi.fn(),
  writeTurn: vi.fn(),
  preflight: vi.fn(),
  newNote: vi.fn(() => PROBE),
}));

import { runBrowserSmoke } from './browserSmoke';
import { discoverVault, listVaultQuilts, readAll, writeTurn, preflight } from '../../../chain/core/src/index.js';

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

  describe('write round-trip leg (U1, opts.write)', () => {
    function healthyReadDiscover() {
      vi.mocked(discoverVault).mockResolvedValue({ vaultId: '0xv', owner: OWNER, name: 'demo', agents: [] });
      vi.mocked(listVaultQuilts).mockResolvedValue(['0xblob']);
    }

    it('proves preflight → write → read-back/decrypt-equal when funded', async () => {
      healthyReadDiscover();
      // readAll: the read+decrypt leg sees ≥1 note, and the read-back finds the probe.
      vi.mocked(readAll).mockResolvedValue([{ note: PROBE, location: {} } as never]);
      vi.mocked(preflight).mockResolvedValue({ sui: 200_000_000n, wal: 50_000_000n, ok: true, needsSui: false, needsWal: false });
      vi.mocked(writeTurn).mockResolvedValue({ quiltBlobId: 'q', blobObjectId: '0xb', transferDigest: '0xd', perNote: [] } as never);

      const res = await runBrowserSmoke({ backendUrl: BACKEND, agentSecret: AGENT_SECRET, ownerAddress: OWNER, write: true, fetchImpl: makeFetch() });

      expect(res.ok).toBe(true);
      expect(res.steps.map((s) => s.name)).toEqual([
        'auth:nonce', 'auth:verify', 'discover', 'list-quilts', 'read+decrypt', 'preflight', 'write', 'write:readback',
      ]);
      expect(res.steps.every((s) => s.ok)).toBe(true);
      expect(vi.mocked(writeTurn)).toHaveBeenCalledOnce();
    });

    it('short-circuits with a funding message when preflight is not ok, never calling writeTurn', async () => {
      healthyReadDiscover();
      vi.mocked(readAll).mockResolvedValue([{ note: PROBE, location: {} } as never]);
      vi.mocked(preflight).mockResolvedValue({ sui: 5n, wal: 0n, ok: false, needsSui: false, needsWal: true });

      const res = await runBrowserSmoke({ backendUrl: BACKEND, agentSecret: AGENT_SECRET, ownerAddress: OWNER, write: true, fetchImpl: makeFetch() });

      expect(res.ok).toBe(false);
      expect(res.failedService).toBe('sui-rpc');
      const pf = res.steps.find((s) => s.name === 'preflight');
      expect(pf?.ok).toBe(false);
      expect(pf?.detail).toContain('fund the agent key');
      expect(pf?.detail).toContain('WAL');
      expect(res.steps.find((s) => s.name === 'write')).toBeUndefined();
      expect(vi.mocked(writeTurn)).not.toHaveBeenCalled();
    });

    it('names the relay when writeTurn rejects', async () => {
      healthyReadDiscover();
      vi.mocked(readAll).mockResolvedValue([{ note: PROBE, location: {} } as never]);
      vi.mocked(preflight).mockResolvedValue({ sui: 200_000_000n, wal: 50_000_000n, ok: true, needsSui: false, needsWal: false });
      vi.mocked(writeTurn).mockRejectedValue(new Error('relay 503'));

      const res = await runBrowserSmoke({ backendUrl: BACKEND, agentSecret: AGENT_SECRET, ownerAddress: OWNER, write: true, fetchImpl: makeFetch() });

      expect(res.ok).toBe(false);
      expect(res.failedService).toBe('walrus-relay');
      expect(res.steps.find((s) => s.name === 'write')?.ok).toBe(false);
    });

    it('fails read-back (seal/walrus) when the written note does not round-trip', async () => {
      healthyReadDiscover();
      // read+decrypt leg passes (≥1 note), but the read-back set lacks the probe noteId.
      vi.mocked(readAll).mockResolvedValue([{ note: { ...PROBE, noteId: 'other' }, location: {} } as never]);
      vi.mocked(preflight).mockResolvedValue({ sui: 200_000_000n, wal: 50_000_000n, ok: true, needsSui: false, needsWal: false });
      vi.mocked(writeTurn).mockResolvedValue({ quiltBlobId: 'q', blobObjectId: '0xb', transferDigest: '0xd', perNote: [] } as never);

      const res = await runBrowserSmoke({ backendUrl: BACKEND, agentSecret: AGENT_SECRET, ownerAddress: OWNER, write: true, fetchImpl: makeFetch() });

      expect(res.ok).toBe(false);
      expect(res.failedService).toContain('seal');
      expect(res.steps.find((s) => s.name === 'write:readback')?.ok).toBe(false);
    });
  });
});
