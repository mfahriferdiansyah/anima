/**
 * The real share layer (plan 008 U2). DOM-free / node-env. The chain seam is
 * mocked: `publishNote`/`unpublishNote`/`listPublished` are stubbed (partial mock
 * of chain/core, like canvasRegistry.test), and the wallet seams `getQuiltDeps`
 * (./session) and `runDestructiveTx` (../hooks/useVault) are fully mocked so no
 * real chain runs. Pins the URL forms per the resolved decisions, publish/
 * unpublish wiring, the access flip, and dedup-on-noteId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// full-mock the wallet seams (importing the originals drags react/useChat into node-env)
vi.mock('./session', () => ({ getQuiltDeps: vi.fn() }));
vi.mock('../hooks/useVault', () => ({ runDestructiveTx: vi.fn() }));

// partial-mock chain/core: keep newNote/etc., stub only the chain-touching share ops
vi.mock('../../../chain/core/src/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../chain/core/src/index.js')>()),
  publishNote: vi.fn(),
  unpublishNote: vi.fn(),
  listPublished: vi.fn(),
}));

import { getQuiltDeps } from './session';
import { runDestructiveTx } from '../hooks/useVault';
import { publishNote, unpublishNote, listPublished, VaultIndex, newNote } from '../../../chain/core/src/index.js';
import { vaultData } from './vaultData';
import {
  createShareLink,
  setLinkAccess,
  setLinkPassword,
  unpublish,
  reconcilePublished,
  resetShareStore,
  shareStore,
} from './share';

const DEPS = { suiClient: {}, agentSigner: {}, walletAddress: '0xowner', vaultId: '0xv' } as never;
const links = () => shareStore.getSnapshot().links;
const link = (noteId: string) => links().find((l) => l.noteId === noteId);

/** Seed one note into the live vault index so publishView can find it. */
function seedNote(noteId: string) {
  const note = newNote({ noteId, title: 'My note', body: 'hello', author: 'owner' });
  vaultData.publish(VaultIndex.fromEntries([{ note, location: { quiltPatchId: '', quiltBlobId: '', blobObjectId: '' } }]));
  return note;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetShareStore();
  vaultData.reset();
  vi.mocked(getQuiltDeps).mockReturnValue(DEPS);
  vi.mocked(unpublishNote).mockResolvedValue({ __tx: true } as never);
  vi.mocked(listPublished).mockResolvedValue([]);
});

describe('createShareLink edit (instant, no chain write)', () => {
  it('no password → a `?room=<id>` link with a roomId, no blob', async () => {
    seedNote('n-1');
    await createShareLink('n-1', 'edit');
    const l = link('n-1')!;
    expect(l.access).toBe('edit');
    expect(l.url).toMatch(/^\/read\.html\?room=[0-9a-f]{32}$/);
    expect(l.roomId).toMatch(/^[0-9a-f]{32}$/);
    expect(l.blobObjectId).toBeUndefined();
    expect(publishNote).not.toHaveBeenCalled();
  });

  it('with a password set later → `?salt=<salt>&edit=1`, carrying the salt not the derived room id', async () => {
    seedNote('n-1');
    await createShareLink('n-1', 'edit');
    await setLinkPassword('n-1', 'hunter2');
    const l = link('n-1')!;
    expect(l.url).toMatch(/^\/read\.html\?salt=[0-9a-f]{32}&edit=1$/);
    expect(l.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(l.roomId).toBeUndefined();
    expect(l.password).toBe('hunter2');
    expect(publishNote).not.toHaveBeenCalled(); // edit password is a relay gate, no blob
  });
});

describe('createShareLink view (publishes a blob)', () => {
  it('no password → publishNote → a `?b=<blobId>` url + blobObjectId', async () => {
    seedNote('n-1');
    vi.mocked(publishNote).mockResolvedValue({
      blobId: 'BLOB123', blobObjectId: '0xobj', noteId: 'n-1', mode: 'public', url: '/read.html?b=BLOB123',
    } as never);

    await createShareLink('n-1', 'view');
    const l = link('n-1')!;
    expect(publishNote).toHaveBeenCalledWith(DEPS, expect.objectContaining({ noteId: 'n-1' }), {});
    expect(l.url).toBe('/read.html?b=BLOB123');
    expect(l.blobObjectId).toBe('0xobj');
    expect(l.publishing).toBe(false);
    expect(l.roomId).toBeUndefined();
  });

  it('with password → publishNote({password}) → a locked `?b=...&locked=1` url', async () => {
    seedNote('n-1');
    vi.mocked(publishNote).mockResolvedValue({
      blobId: 'B', blobObjectId: '0xp', noteId: 'n-1', mode: 'password', url: '/read.html?b=B&locked=1',
    } as never);

    await createShareLink('n-1', 'edit'); // start as edit
    await setLinkPassword('n-1', 'pw');
    await setLinkAccess('n-1', 'view'); // flip to view carries the password
    expect(publishNote).toHaveBeenCalledWith(DEPS, expect.objectContaining({ noteId: 'n-1' }), { password: 'pw' });
    expect(link('n-1')!.url).toBe('/read.html?b=B&locked=1');
  });

  it('publish failure surfaces an error and clears publishing', async () => {
    seedNote('n-1');
    vi.mocked(publishNote).mockRejectedValue(new Error('aggregator down'));
    await createShareLink('n-1', 'view');
    const l = link('n-1')!;
    expect(l.publishing).toBe(false);
    expect(l.error).toBe('aggregator down');
  });
});

describe('setLinkAccess flip', () => {
  it('view → edit unpublishes the blob and hands out a room', async () => {
    seedNote('n-1');
    vi.mocked(publishNote).mockResolvedValue({
      blobId: 'B', blobObjectId: '0xobj', noteId: 'n-1', mode: 'public', url: '/read.html?b=B',
    } as never);
    await createShareLink('n-1', 'view');

    await setLinkAccess('n-1', 'edit');
    expect(unpublishNote).toHaveBeenCalledWith(DEPS, '0xobj');
    expect(runDestructiveTx).toHaveBeenCalled();
    const l = link('n-1')!;
    expect(l.access).toBe('edit');
    expect(l.blobObjectId).toBeUndefined();
    expect(l.url).toMatch(/\?room=/);
  });

  it('edit → view publishes a blob and drops the room', async () => {
    seedNote('n-1');
    vi.mocked(publishNote).mockResolvedValue({
      blobId: 'B2', blobObjectId: '0xo2', noteId: 'n-1', mode: 'public', url: '/read.html?b=B2',
    } as never);
    await createShareLink('n-1', 'edit');

    await setLinkAccess('n-1', 'view');
    expect(publishNote).toHaveBeenCalledTimes(1);
    const l = link('n-1')!;
    expect(l.access).toBe('view');
    expect(l.roomId).toBeUndefined();
    expect(l.url).toBe('/read.html?b=B2');
  });
});

describe('setLinkPassword view re-publish (publish-before-delete)', () => {
  it('adding a password re-publishes the envelope, then deletes the prior plaintext blob', async () => {
    seedNote('n-1');
    vi.mocked(publishNote)
      .mockResolvedValueOnce({ blobId: 'P', blobObjectId: '0xplain', noteId: 'n-1', mode: 'public', url: '/read.html?b=P' } as never)
      .mockResolvedValueOnce({ blobId: 'E', blobObjectId: '0xenc', noteId: 'n-1', mode: 'password', url: '/read.html?b=E&locked=1' } as never);

    await createShareLink('n-1', 'view'); // plaintext blob 0xplain
    await setLinkPassword('n-1', 'secret');

    // second publish carried the password; then the prior plaintext blob is deleted
    expect(publishNote).toHaveBeenNthCalledWith(2, DEPS, expect.objectContaining({ noteId: 'n-1' }), { password: 'secret' });
    expect(unpublishNote).toHaveBeenCalledWith(DEPS, '0xplain'); // prior blob removed AFTER new one
    const l = link('n-1')!;
    expect(l.blobObjectId).toBe('0xenc');
    expect(l.url).toBe('/read.html?b=E&locked=1');
  });
});

describe('unpublish revoke under a wallet signature', () => {
  it('deletes the blob and removes the link', async () => {
    seedNote('n-1');
    vi.mocked(publishNote).mockResolvedValue({
      blobId: 'B', blobObjectId: '0xobj', noteId: 'n-1', mode: 'public', url: '/read.html?b=B',
    } as never);
    await createShareLink('n-1', 'view');

    await unpublish('n-1');
    expect(unpublishNote).toHaveBeenCalledWith(DEPS, '0xobj');
    expect(runDestructiveTx).toHaveBeenCalled();
    expect(link('n-1')).toBeUndefined();
  });
});

describe('dedup on noteId', () => {
  it('createShareLink twice returns the same single link', async () => {
    seedNote('n-1');
    await createShareLink('n-1', 'edit');
    const first = link('n-1');
    await createShareLink('n-1', 'edit');
    expect(links().filter((l) => l.noteId === 'n-1')).toHaveLength(1);
    expect(link('n-1')!.roomId).toBe(first!.roomId); // not regenerated
  });

  it('reconcilePublished adds a view link only for an unknown noteId (local intent wins)', async () => {
    seedNote('n-1');
    await createShareLink('n-1', 'edit'); // local edit link for n-1
    vi.mocked(listPublished).mockResolvedValue([
      { blobId: 'B1', blobObjectId: '0xa', noteId: 'n-1', mode: 'public', url: '/read.html?b=B1' }, // already known → skip
      { blobId: 'B2', blobObjectId: '0xb', noteId: 'n-2', mode: 'password', url: '/read.html?b=B2&locked=1' }, // new
    ] as never);

    await reconcilePublished();
    expect(link('n-1')!.access).toBe('edit'); // not clobbered by the chain registry
    const reconciled = link('n-2')!;
    expect(reconciled.access).toBe('view');
    expect(reconciled.blobObjectId).toBe('0xb');
    expect(reconciled.password).toBe(''); // password-mode marker (value unknown to the owner here)
  });
});

describe('reconcile trigger (lifecycle wiring)', () => {
  /** Let the module-level vaultData subscription run its async reconcile. */
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  it('a published-index swap reconciles view links in (not just the explicit call)', async () => {
    vi.mocked(listPublished).mockResolvedValue([
      { blobId: 'B', blobObjectId: '0xb', noteId: 'n-pub', mode: 'public', url: '/read.html?b=B' },
    ] as never);

    // publishing a fresh index is the swap the hooks see on session rebuild
    const note = newNote({ noteId: 'n-x', title: 't', body: 'b', author: 'owner' });
    vaultData.publish(VaultIndex.fromEntries([{ note, location: { quiltPatchId: '', quiltBlobId: '', blobObjectId: '' } }]));
    await flush();

    expect(listPublished).toHaveBeenCalled();
    expect(link('n-pub')?.access).toBe('view');
    expect(link('n-pub')?.blobObjectId).toBe('0xb');
  });

  it('a null swap (disconnect / account switch) clears the share store', async () => {
    seedNote('n-1');
    await createShareLink('n-1', 'edit');
    expect(link('n-1')).toBeDefined();

    vaultData.reset(); // index → null
    await flush();
    expect(links()).toHaveLength(0); // stale-account links never linger
  });
});
