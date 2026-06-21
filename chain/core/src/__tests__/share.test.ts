import { describe, it, expect, vi } from 'vitest';
import { sealWithPassword, openWithPassword, isPasswordShare, unpublishNote } from '../share.js';
import { serializeNote, parseNote, newNote } from '../notes.js';

describe('share (R-share)', () => {
  it('password round-trip preserves the note', async () => {
    const note = newNote({ title: 'Secret trip', body: 'Kyoto in **autumn**.', author: 'owner', tags: ['travel'] });
    const sealed = await sealWithPassword(note, 'hunter2!');
    expect(isPasswordShare(sealed)).toBe(true);
    const opened = await openWithPassword(sealed, 'hunter2!');
    expect(opened).toEqual(note);
  });

  it('wrong password fails, never partial plaintext', async () => {
    const note = newNote({ title: 'x', body: 'y', author: 'a' });
    const sealed = await sealWithPassword(note, 'right');
    await expect(openWithPassword(sealed, 'wrong')).rejects.toThrow();
  });

  it('public payload is plain parseable markdown (aggregator-servable)', () => {
    const note = newNote({ title: 'Open post', body: 'hello world', author: 'owner' });
    const bytes = new TextEncoder().encode(serializeNote(note));
    expect(isPasswordShare(bytes)).toBe(false);
    expect(parseNote(new TextDecoder().decode(bytes)).title).toBe('Open post');
  });

  it('unpublishNote builds a wallet-signed delete tx for the published blob (caller signs)', async () => {
    // mirror the forget seam: core builds via buildDeleteQuiltsTx → walrus.deleteBlobTransaction
    const sentinel = { __tx: true };
    const deleteBlobTransaction = vi.fn().mockResolvedValue(sentinel);
    const deps = {
      suiClient: { walrus: { deleteBlobTransaction } },
      walletAddress: '0xowner',
    } as never;

    const tx = await unpublishNote(deps, '0xblobObject');

    expect(deleteBlobTransaction).toHaveBeenCalledTimes(1);
    expect(deleteBlobTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ blobObjectId: '0xblobObject', owner: '0xowner' }),
    );
    expect(tx).toBe(sentinel); // returns the built tx; no signing inside core
  });
});
