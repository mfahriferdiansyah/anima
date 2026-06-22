/**
 * DOM-free test for the wallet execution adapter. Only the PURE override
 * factory is exercised (the hook needs a DOM). The integration case is the
 * point of this unit: it proves the override's `showObjectChanges` output is
 * exactly the shape chain/core's `vaultIdFromCreateResult` scans — the gotcha
 * guard against dapp-kit's default rawEffects-only result.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeExecuteOverride, txFailure } from './walletExecTx';
import { vaultIdFromCreateResult } from '../../../chain/core/src/index.js';

describe('web3/walletExecTx makeExecuteOverride', () => {
  it('forces showObjectChanges and returns the client result', async () => {
    const resolved = { digest: '0xdeadbeef', objectChanges: [] };
    const executeTransactionBlock = vi.fn().mockResolvedValue(resolved);
    const override = makeExecuteOverride({ executeTransactionBlock });

    const out = await override({ bytes: 'b64', signature: 'sig' });

    expect(executeTransactionBlock).toHaveBeenCalledTimes(1);
    expect(executeTransactionBlock).toHaveBeenCalledWith({
      transactionBlock: 'b64',
      signature: 'sig',
      options: { showRawEffects: true, showObjectChanges: true, showEffects: true },
    });
    expect(executeTransactionBlock.mock.calls[0][0].options.showObjectChanges).toBe(true);
    expect(out).toBe(resolved);
  });

  it('produces objectChanges parseable by vaultIdFromCreateResult', async () => {
    // The synthetic result models what the override yields with showObjectChanges
    // on — the exact shape vault.ts scans: a `created` change whose objectType
    // ends in `::vault::Vault`.
    const result = {
      objectChanges: [
        { type: 'created', objectType: '0xpkg::vault::Vault', objectId: '0xVAULTID' },
      ],
    };
    const executeTransactionBlock = vi.fn().mockResolvedValue(result);
    const override = makeExecuteOverride({ executeTransactionBlock });

    const out = await override({ bytes: 'b64', signature: 'sig' });

    expect(vaultIdFromCreateResult(out)).toBe('0xVAULTID');
  });

  it('propagates errors instead of swallowing them', async () => {
    const executeTransactionBlock = vi.fn().mockRejectedValue(new Error('rpc boom'));
    const override = makeExecuteOverride({ executeTransactionBlock });

    await expect(override({ bytes: 'b64', signature: 'sig' })).rejects.toThrow('rpc boom');
  });
});

describe('web3/walletExecTx txFailure', () => {
  it('returns null for a successful tx', () => {
    expect(txFailure({ digest: '0xd', effects: { status: { status: 'success' } } })).toBeNull();
  });

  it('returns digest + on-chain reason for a committed-but-failed tx', () => {
    expect(txFailure({ digest: '0xfail', effects: { status: { status: 'failure', error: 'MoveAbort(x, 3)' } } })).toEqual({
      digest: '0xfail',
      reason: 'MoveAbort(x, 3)',
    });
  });

  it('falls back to a generic reason when the failure carries no error string', () => {
    expect(txFailure({ digest: '0xd', effects: { status: { status: 'failure' } } })).toEqual({
      digest: '0xd',
      reason: 'Transaction failed on-chain',
    });
  });

  it('fails OPEN (null) when status is missing/unreadable — never fabricates a failure', () => {
    expect(txFailure({ digest: '0xd' })).toBeNull();
    expect(txFailure({ digest: '0xd', effects: {} })).toBeNull();
    expect(txFailure(null)).toBeNull();
    expect(txFailure(undefined)).toBeNull();
    expect(txFailure('nope')).toBeNull();
  });
});
