/**
 * DOM-free unit check for the walrus-extended SuiClient singleton. The live
 * read/decrypt proof is U2's browser smoke test; here we only guard the two
 * cheap-but-fatal wiring facts: the wasm URL is actually resolved, and the
 * client is memoized.
 */
import { describe, expect, it } from 'vitest';
import { getSuiClient, WALRUS_WASM_URL } from './suiClient';

describe('web3/suiClient', () => {
  it('resolves a non-empty wasm asset URL (guards the silent-WASM-fail gotcha)', () => {
    expect(typeof WALRUS_WASM_URL).toBe('string');
    expect(WALRUS_WASM_URL.length).toBeGreaterThan(0);
  });

  it('returns a memoized singleton', () => {
    const a = getSuiClient();
    const b = getSuiClient();
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });
});
