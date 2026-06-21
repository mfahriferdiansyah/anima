/**
 * DOM-free test for the wallet execution adapter. Only the PURE override
 * factory is exercised (the hook needs a DOM). The integration case is the
 * point of this unit: it proves the override's `showObjectChanges` output is
 * exactly the shape chain/core's `vaultIdFromCreateResult` scans — the gotcha
 * guard against dapp-kit's default rawEffects-only result.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeExecuteOverride } from './walletExecTx';
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
