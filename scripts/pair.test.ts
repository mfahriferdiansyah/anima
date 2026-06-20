import { describe, it, expect, afterEach } from 'vitest';
import { loadOwner, resolveVaultId } from './pair.js';

// Pure-logic / validation tests for the pairing command. The on-chain path
// (register + fund + swap) is exercised by scripts/pair-smoke.ts against
// testnet, not here.

describe('loadOwner', () => {
  const saved = process.env.ANIMA_OWNER_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANIMA_OWNER_KEY;
    else process.env.ANIMA_OWNER_KEY = saved;
  });

  it('rejects an owner key that is not a suiprivkey', () => {
    process.env.ANIMA_OWNER_KEY = 'not-a-suiprivkey';
    expect(() => loadOwner()).toThrow(/suiprivkey/);
  });
});

describe('resolveVaultId', () => {
  const saved = process.env.ANIMA_VAULT_ID;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANIMA_VAULT_ID;
    else process.env.ANIMA_VAULT_ID = saved;
  });

  it('rejects a malformed vault id from env before touching the network', async () => {
    process.env.ANIMA_VAULT_ID = 'nope';
    // suiClient is never used because validation throws first.
    await expect(resolveVaultId({} as never, '0xowner')).rejects.toThrow(/0x/);
  });

  it('returns a well-formed vault id from env', async () => {
    process.env.ANIMA_VAULT_ID = '0xabc123';
    await expect(resolveVaultId({} as never, '0xowner')).resolves.toBe('0xabc123');
  });
});
