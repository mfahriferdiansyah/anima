/**
 * DOM-free test for the deps assembler. chain/core, the singleton, the agent
 * key, and auth are mocked — this proves buildVaultDeps assembles the right
 * shape (the chain/core QuiltDeps subset + hasAgentKey + a LAZY ensureJwt) and
 * returns null on first-run. The provider/hook are thin dapp-kit wiring, not
 * unit-tested. '@mysten/dapp-kit' is stubbed only so VaultDeps.tsx loads in node.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mysten/dapp-kit', () => ({
  useCurrentAccount: () => null,
  useSignPersonalMessage: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./suiClient', () => ({ getSuiClient: () => ({ __mock: 'suiClient' }) }));
vi.mock('../../../chain/core/src/index.js', () => ({
  discoverVault: vi.fn(),
  SealVault: vi.fn().mockImplementation((opts: unknown) => ({ __mock: 'seal', opts })),
}));
vi.mock('./agentKey', () => ({
  getOrCreateAgentKey: vi.fn(async () => ({ __mock: 'agentKeypair' })),
  hasAgentKey: vi.fn(async () => true),
}));
vi.mock('./auth', () => ({ ensureJwt: vi.fn(async () => 'jwt.token') }));

import { buildVaultDeps } from './VaultDeps';
import { discoverVault } from '../../../chain/core/src/index.js';
import { ensureJwt } from './auth';
import { hasAgentKey } from './agentKey';

const OWNER = '0xowner';
const BACKEND = 'http://localhost:8080';
const sign = vi.fn(async () => ({ signature: 'sig' }));

beforeEach(() => vi.clearAllMocks());

describe('web3/VaultDeps buildVaultDeps', () => {
  it('assembles the QuiltDeps subset + extras when a vault exists, JWT stays lazy', async () => {
    vi.mocked(discoverVault).mockResolvedValue({ vaultId: '0xv', owner: OWNER, name: 'demo', agents: [] });
    vi.mocked(hasAgentKey).mockResolvedValue(true);

    const deps = await buildVaultDeps({ owner: OWNER, backendUrl: BACKEND, signPersonalMessage: sign });

    expect(deps).not.toBeNull();
    // the five fields chain/core's QuiltDeps requires, byte-for-byte
    expect(Object.keys(deps!)).toEqual(
      expect.arrayContaining(['suiClient', 'seal', 'agentSigner', 'walletAddress', 'vaultId']),
    );
    expect(deps!.walletAddress).toBe(OWNER);
    expect(deps!.vaultId).toBe('0xv');
    expect(deps!.hasAgentKey).toBe(true);
    expect(typeof deps!.ensureJwt).toBe('function');
    // assembly must NOT trigger the wallet-signing JWT path
    expect(ensureJwt).not.toHaveBeenCalled();
  });

  it('returns null when the wallet has no vault yet (first-run)', async () => {
    vi.mocked(discoverVault).mockResolvedValue(null);
    const deps = await buildVaultDeps({ owner: OWNER, backendUrl: BACKEND, signPersonalMessage: sign });
    expect(deps).toBeNull();
  });

  it('the ensureJwt thunk defers to auth.ensureJwt with the owner + backend', async () => {
    vi.mocked(discoverVault).mockResolvedValue({ vaultId: '0xv', owner: OWNER, name: 'demo', agents: [] });
    const deps = await buildVaultDeps({ owner: OWNER, backendUrl: BACKEND, signPersonalMessage: sign });

    await deps!.ensureJwt();
    expect(ensureJwt).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ensureJwt).mock.calls[0][0]).toMatchObject({ backendUrl: BACKEND, address: OWNER });
  });
});
