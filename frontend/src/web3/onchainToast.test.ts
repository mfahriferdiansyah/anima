/**
 * The shared on-chain receipt primitive that every wired write/delete routes
 * through (distill, publish, onboarding, pair, connect/top-up/revoke, cover,
 * forget). Asserts the receipt lifecycle and the URL/digest helpers against the
 * real `vaultData` singleton (the toast store App.tsx renders).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runWithReceipt, objectProvenanceUrl, txProvenanceUrl, digestOf } from './onchainToast';
import { vaultData, resetVaultData } from './vaultData';

beforeEach(() => resetVaultData());

describe('runWithReceipt', () => {
  it('opens a certifying receipt (with labels) then resolves to certified + provenance', async () => {
    const pending = runWithReceipt(
      { key: 'k1', title: 'My link', labels: { pending: 'Publishing link', success: 'Link published' } },
      () => Promise.resolve({ result: 42, provenanceUrl: 'https://suiscan.xyz/testnet/object/0xobj' }),
    );

    // synchronously (before the await resolves) the in-flight toast is visible
    const inflight = vaultData.getSnapshot().writeEvents;
    expect(inflight).toHaveLength(1);
    expect(inflight[0].state.phase).toBe('certifying');
    expect(inflight[0].noteTitle).toBe('My link');
    expect(inflight[0].labels).toEqual({ pending: 'Publishing link', success: 'Link published' });

    const result = await pending;
    expect(result).toBe(42); // run()'s result is returned to the caller

    const done = vaultData.getSnapshot().writeEvents[0];
    expect(done.state).toMatchObject({
      phase: 'certified',
      provenanceUrl: 'https://suiscan.xyz/testnet/object/0xobj',
    });
  });

  it('dismisses the in-flight receipt and rethrows on failure (op owns its error path)', async () => {
    const boom = new Error('publish failed');
    await expect(
      runWithReceipt(
        { key: 'k2', title: 't', labels: { pending: 'p', success: 's' } },
        () => Promise.reject(boom),
      ),
    ).rejects.toThrow('publish failed');

    expect(vaultData.getSnapshot().writeEvents).toHaveLength(0); // no lingering/error toast
  });

  it('leaves NO in-flight writeState after a failure (forgetEverything quiesce must not hang)', async () => {
    // A declined wallet popup is an expected failure path. If the receipt strands
    // its key at 'certifying', the bulk-wipe quiesce loop spins forever.
    await expect(
      runWithReceipt(
        { key: 'topup', title: 'Agent wallet', labels: { pending: 'Topping up', success: 'Funded' } },
        () => Promise.reject(new Error('user declined')),
      ),
    ).rejects.toThrow('user declined');

    const inFlight = Object.values(vaultData.getSnapshot().writeStates).some(
      (ws) => ws.phase === 'encrypting' || ws.phase === 'certifying',
    );
    expect(inFlight).toBe(false); // terminalized to 'failed', not stuck mid-write
  });
});

describe('provenance url + digest helpers', () => {
  it('builds object and tx suiscan urls', () => {
    expect(objectProvenanceUrl('0xabc')).toBe('https://suiscan.xyz/testnet/object/0xabc');
    expect(txProvenanceUrl('0xdef')).toBe('https://suiscan.xyz/testnet/tx/0xdef');
  });

  it('extracts a tx digest from a wallet execTx result, else undefined', () => {
    expect(digestOf({ digest: '0xd1' })).toBe('0xd1');
    expect(digestOf({ digest: '' })).toBeUndefined(); // empty digest is not usable
    expect(digestOf({})).toBeUndefined();
    expect(digestOf(null)).toBeUndefined();
    expect(digestOf(undefined)).toBeUndefined();
  });
});
