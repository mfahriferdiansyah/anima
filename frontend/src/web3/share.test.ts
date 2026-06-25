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
vi.mock('./session', () => ({
  getQuiltDeps: vi.fn(),
  isInsufficientFunds: (e: unknown) => String(e instanceof Error ? e.message : e).toLowerCase().includes('insufficient'),
}));
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
  generateView,
  removeStaleCopy,
  unpublish,
  reconcilePublished,
  resetShareStore,
  shareStore,
} from './share';
import { saveEditLinks, loadEditLinks } from './shareLinkCache';

const DEPS = { suiClient: {}, agentSigner: {}, walletAddress: '0xowner', vaultId: '0xv' } as never;
const links = () => shareStore.getSnapshot().links;
const link = (noteId: string) => links().find((l) => l.noteId === noteId);

/** Seed one note into the live vault index so publishView can find it. Title is
 *  empty by default so edit-link URL assertions stay clean; pass a title to test
 *  the header baked into the link. A fixed `updatedAt` keeps the baked `&up=`
 *  deterministic, and the seed location has no blobObjectId so no `&sl=` is added.
 *  Note: a baked edit link always carries `&up=<date>&rv=1` (the note's header). */
function seedNote(noteId: string, title = '') {
  const note = newNote({ noteId, title, body: 'hello', author: 'owner', updatedAt: '2026-06-22T00:00:00.000Z' });
  vaultData.publish(VaultIndex.fromEntries([{ note, location: { quiltPatchId: '', quiltBlobId: '', blobObjectId: '' } }]));
  return note;
}

/** The header suffix every baked note edit link carries (updated + rev; no seal id without a blob). */
const META = '&up=2026-06-22&rv=1';

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
    expect(l.url).toBe(`/read.html?room=${l.roomId}${META}`);
    expect(l.roomId).toMatch(/^[0-9a-f]{32}$/);
    expect(l.blobObjectId).toBeUndefined();
    expect(publishNote).not.toHaveBeenCalled();
  });

  it('with a password set later → `?salt=<salt>&edit=1`, carrying the salt not the derived room id', async () => {
    seedNote('n-1');
    await createShareLink('n-1', 'edit');
    await setLinkPassword('n-1', 'hunter2');
    const l = link('n-1')!;
    expect(l.url).toBe(`/read.html?salt=${l.salt}&edit=1${META}`);
    expect(l.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(l.roomId).toBeUndefined();
    expect(l.password).toBe('hunter2');
    expect(publishNote).not.toHaveBeenCalled(); // edit password is a relay gate, no blob
  });
});

describe('edit link carries kind + owner public key (collaborative-share routing)', () => {
  it('a note edit link omits kind (clean) and omits opk when no signer is wired', async () => {
    seedNote('n-1');
    await createShareLink('n-1', 'edit', 'note');
    const l = link('n-1')!;
    expect(l.url).toBe(`/read.html?room=${l.roomId}${META}`); // no &kind, no &opk (just the header)
  });

  it('a canvas edit link carries &kind=canvas so the reader mounts the board', async () => {
    seedNote('c-1');
    await createShareLink('c-1', 'edit', 'canvas');
    const l = link('c-1')!;
    expect(l.kind).toBe('canvas');
    // a canvas link carries no note header (title/updated/rev are note-only)
    expect(l.url).toBe(`/read.html?room=${l.roomId}&kind=canvas`);
  });

  it('bakes the note title into the link (&t=) so the header shows without waiting for the owner', async () => {
    seedNote('n-title', 'Roadmap Meeting');
    await createShareLink('n-title', 'edit', 'note');
    const l = link('n-title')!;
    expect(l.url).toBe(`/read.html?room=${l.roomId}&t=Roadmap%20Meeting${META}`);
  });

  it('bakes the owner agent public key as &opk=<hex> when a signer is wired (the guest trust anchor)', async () => {
    seedNote('n-2');
    const pub = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    vi.mocked(getQuiltDeps).mockReturnValue({
      suiClient: {},
      agentSigner: { getPublicKey: () => ({ toRawBytes: () => pub }) },
      walletAddress: '0xowner',
      vaultId: '0xv',
    } as never);
    await createShareLink('n-2', 'edit', 'note');
    const l = link('n-2')!;
    expect(l.url).toBe(`/read.html?room=${l.roomId}&opk=deadbeef${META}`);
  });

  it('a password canvas link carries the salt, kind, and opk together', async () => {
    seedNote('c-2');
    vi.mocked(getQuiltDeps).mockReturnValue({
      suiClient: {},
      agentSigner: { getPublicKey: () => ({ toRawBytes: () => new Uint8Array([0x01, 0x02]) }) },
      walletAddress: '0xowner',
      vaultId: '0xv',
    } as never);
    await createShareLink('c-2', 'edit', 'canvas');
    await setLinkPassword('c-2', 'pw');
    const l = link('c-2')!;
    expect(l.url).toBe(`/read.html?salt=${l.salt}&edit=1&kind=canvas&opk=0102`);
  });
});

describe('createShareLink view is local — no publish until generateView', () => {
  it('selecting view does NOT publish; the blob is written only on an explicit generateView', async () => {
    seedNote('n-1');
    vi.mocked(publishNote).mockResolvedValue({
      blobId: 'BLOB123', blobObjectId: '0xobj', noteId: 'n-1', mode: 'public', url: '/read.html?b=BLOB123',
    } as never);

    await createShareLink('n-1', 'view');
    expect(publishNote).not.toHaveBeenCalled(); // a mere card selection never stamps a blob
    expect(link('n-1')!.url).toBe(''); // empty until generated → dialog shows "Generate link"

    await generateView('n-1');
    const l = link('n-1')!;
    expect(publishNote).toHaveBeenCalledWith(DEPS, expect.objectContaining({ noteId: 'n-1' }), { kind: 'note' });
    expect(l.url).toBe('/read.html?b=BLOB123');
    expect(l.viewUrl).toBe('/read.html?b=BLOB123');
    expect(l.blobObjectId).toBe('0xobj');
    expect(l.phase).toBeUndefined(); // a fresh publish (no prior copy) has no cleanup step
  });

  it('generateView carries the link password → a locked `?b=...&locked=1` url', async () => {
    seedNote('n-1');
    vi.mocked(publishNote).mockResolvedValue({
      blobId: 'B', blobObjectId: '0xp', noteId: 'n-1', mode: 'password', url: '/read.html?b=B&locked=1',
    } as never);

    await createShareLink('n-1', 'edit'); // start as edit
    await setLinkPassword('n-1', 'pw');
    await setLinkAccess('n-1', 'view'); // flip to view is local — no publish
    expect(publishNote).not.toHaveBeenCalled();

    await generateView('n-1');
    expect(publishNote).toHaveBeenCalledWith(DEPS, expect.objectContaining({ noteId: 'n-1' }), { password: 'pw', kind: 'note' });
    expect(link('n-1')!.url).toBe('/read.html?b=B&locked=1');
  });

  it('an out-of-funds failure surfaces needsFunds (a Top up), not a raw chain error', async () => {
    seedNote('n-1');
    vi.mocked(publishNote).mockRejectedValue(
      new Error('Insufficient balance of 0xabc for owner 0xdef. Required: 100, Available: 10'),
    );
    await createShareLink('n-1', 'view');
    await generateView('n-1');
    const l = link('n-1')!;
    expect(l.needsFunds).toBe(true);
    expect(l.error).toBeUndefined();
    expect(l.phase).toBeUndefined();
  });

  it('a publish failure surfaces an error and clears the phase', async () => {
    seedNote('n-1');
    vi.mocked(publishNote).mockRejectedValue(new Error('aggregator down'));
    await createShareLink('n-1', 'view');
    await generateView('n-1');
    const l = link('n-1')!;
    expect(l.phase).toBeUndefined();
    expect(l.error).toBe('aggregator down');
    expect(l.url).toBe(''); // still ungenerated → the Generate affordance stays
  });
});

describe('setLinkAccess flip is local — no chain ops on a card switch', () => {
  it('view → edit keeps the published blob (no destructive delete) and shows a room', async () => {
    seedNote('n-1');
    vi.mocked(publishNote).mockResolvedValue({
      blobId: 'B', blobObjectId: '0xobj', noteId: 'n-1', mode: 'public', url: '/read.html?b=B',
    } as never);
    await createShareLink('n-1', 'view');
    await generateView('n-1');

    await setLinkAccess('n-1', 'edit');
    expect(unpublishNote).not.toHaveBeenCalled(); // toggling a card never deletes
    expect(runDestructiveTx).not.toHaveBeenCalled();
    const l = link('n-1')!;
    expect(l.access).toBe('edit');
    expect(l.blobObjectId).toBe('0xobj'); // blob is kept — Revoke is the only delete
    expect(l.viewUrl).toBe('/read.html?b=B'); // the generated link is remembered
    expect(l.url).toMatch(/\?room=/);
  });

  it('edit → view does NOT publish; the generated link returns on switch-back without re-publishing', async () => {
    seedNote('n-1');
    vi.mocked(publishNote).mockResolvedValue({
      blobId: 'B2', blobObjectId: '0xo2', noteId: 'n-1', mode: 'public', url: '/read.html?b=B2',
    } as never);
    await createShareLink('n-1', 'edit');

    await setLinkAccess('n-1', 'view');
    expect(publishNote).not.toHaveBeenCalled(); // selecting view is local
    expect(link('n-1')!.url).toBe(''); // → Generate affordance

    await generateView('n-1');
    expect(publishNote).toHaveBeenCalledTimes(1);
    expect(link('n-1')!.url).toBe('/read.html?b=B2');

    // toggle away and back: the link is restored from viewUrl, no second publish
    await setLinkAccess('n-1', 'edit');
    await setLinkAccess('n-1', 'view');
    expect(publishNote).toHaveBeenCalledTimes(1);
    expect(link('n-1')!.url).toBe('/read.html?b=B2');
  });
});

describe('setLinkPassword view is local — re-publish only on the next generateView', () => {
  it('changing the password invalidates the link; generateView publishes the envelope, then deletes the prior plaintext blob', async () => {
    seedNote('n-1');
    vi.mocked(publishNote)
      .mockResolvedValueOnce({ blobId: 'P', blobObjectId: '0xplain', noteId: 'n-1', mode: 'public', url: '/read.html?b=P' } as never)
      .mockResolvedValueOnce({ blobId: 'E', blobObjectId: '0xenc', noteId: 'n-1', mode: 'password', url: '/read.html?b=E&locked=1' } as never);

    await createShareLink('n-1', 'view');
    await generateView('n-1'); // plaintext blob 0xplain

    await setLinkPassword('n-1', 'secret');
    expect(publishNote).toHaveBeenCalledTimes(1); // setting the password does NOT re-publish
    expect(link('n-1')!.url).toBe(''); // invalidated → Generate again
    expect(link('n-1')!.password).toBe('secret');

    await generateView('n-1');
    expect(publishNote).toHaveBeenNthCalledWith(2, DEPS, expect.objectContaining({ noteId: 'n-1' }), { password: 'secret', kind: 'note' });
    expect(unpublishNote).toHaveBeenCalledWith(DEPS, '0xplain'); // prior blob removed AFTER the new one
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
    await generateView('n-1');

    await unpublish('n-1');
    expect(unpublishNote).toHaveBeenCalledWith(DEPS, '0xobj');
    expect(runDestructiveTx).toHaveBeenCalled();
    expect(link('n-1')).toBeUndefined();
  });
});

describe('re-publish cleanup (publish-before-delete) — narrated, with a stale-copy retry', () => {
  it('a rejected prior-copy delete records staleBlob; removeStaleCopy retries it', async () => {
    seedNote('n-1');
    vi.mocked(publishNote)
      .mockResolvedValueOnce({ blobId: 'P', blobObjectId: '0xplain', noteId: 'n-1', mode: 'public', kind: 'note', url: '/read.html?b=P' } as never)
      .mockResolvedValueOnce({ blobId: 'E', blobObjectId: '0xenc', noteId: 'n-1', mode: 'password', kind: 'note', url: '/read.html?b=E&locked=1' } as never);

    await createShareLink('n-1', 'view');
    await generateView('n-1'); // first publish, no prior copy → 0xplain, no cleanup
    expect(link('n-1')!.staleBlob).toBeUndefined();

    // the next publish must delete the prior copy — the user rejects that wallet step
    vi.mocked(runDestructiveTx).mockRejectedValueOnce(new Error('User rejected the request'));
    await setLinkPassword('n-1', 'secret'); // local: clears the link, keeps blobObjectId as the prior
    await generateView('n-1'); // publishes 0xenc, then the 0xplain delete is rejected

    let l = link('n-1')!;
    expect(l.url).toBe('/read.html?b=E&locked=1'); // the NEW copy is already live
    expect(l.phase).toBeUndefined();
    expect(l.staleBlob).toBe('0xplain'); // the old copy lingers (its earlier link still opens)

    // retry the cleanup — succeeds, clears the warning
    vi.mocked(runDestructiveTx).mockResolvedValueOnce({} as never);
    await removeStaleCopy('n-1');
    l = link('n-1')!;
    expect(unpublishNote).toHaveBeenCalledWith(DEPS, '0xplain');
    expect(l.staleBlob).toBeUndefined();
  });
});

describe('canvas view — generateView publishes a read-only board snapshot (kind canvas)', () => {
  it('is local until Generate, then publishes a snapshot note with kind:canvas', async () => {
    seedNote('n-keep'); // ensures the vault index is non-null so the snapshot can build
    vi.mocked(publishNote).mockResolvedValue({
      blobId: 'CB', blobObjectId: '0xcanvas', noteId: 'c-1', mode: 'public', kind: 'canvas', url: '/read.html?b=CB',
    } as never);

    await createShareLink('c-1', 'view', 'canvas', 'My board');
    expect(publishNote).not.toHaveBeenCalled(); // selecting view never stamps a blob
    expect(link('c-1')!.kind).toBe('canvas');

    await generateView('c-1');
    expect(publishNote).toHaveBeenCalledTimes(1);
    const call = vi.mocked(publishNote).mock.calls[0];
    const snapNote = call[1] as { body: string; tags: string[] };
    const opts = call[2] as { kind?: string };
    expect(opts.kind).toBe('canvas');
    expect(snapNote.tags).toContain('anima:canvas-snapshot');
    expect(JSON.parse(snapNote.body).anima).toBe('canvas'); // the body is the snapshot, marker present
    expect(link('c-1')!.url).toBe('/read.html?b=CB');
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
      { blobId: 'B1', blobObjectId: '0xa', noteId: 'n-1', mode: 'public', kind: 'note', url: '/read.html?b=B1' }, // already known → skip
      { blobId: 'B2', blobObjectId: '0xb', noteId: 'n-2', mode: 'password', kind: 'note', url: '/read.html?b=B2&locked=1' }, // new
    ] as never);

    await reconcilePublished();
    expect(link('n-1')!.access).toBe('edit'); // not clobbered by the chain registry
    const reconciled = link('n-2')!;
    expect(reconciled.access).toBe('view');
    expect(reconciled.kind).toBe('note');
    expect(reconciled.blobObjectId).toBe('0xb');
    expect(reconciled.password).toBe(''); // password-mode marker (value unknown to the owner here)
  });
});

describe('reconcile trigger (lifecycle wiring)', () => {
  /** Let the module-level vaultData subscription run its async reconcile. */
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  it('a published-index swap reconciles view links in (not just the explicit call)', async () => {
    vi.mocked(listPublished).mockResolvedValue([
      { blobId: 'B', blobObjectId: '0xb', noteId: 'n-pub', mode: 'public', kind: 'note', url: '/read.html?b=B' },
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

describe('absolute links — the browser origin is stamped so a copied link has a host', () => {
  // node-env has no `window`; emulate the browser edge for this one case, then restore.
  const g = globalThis as unknown as { window?: { location: { origin: string } } };

  it('an edit link and a generated view link both carry the origin', async () => {
    seedNote('n-1');
    vi.mocked(publishNote).mockResolvedValue({
      blobId: 'B', blobObjectId: '0xo', noteId: 'n-1', mode: 'public', url: '/read.html?b=B',
    } as never);
    g.window = { location: { origin: 'https://anima.app' } };
    try {
      await createShareLink('n-1', 'edit');
      expect(link('n-1')!.url).toBe(`https://anima.app/read.html?room=${link('n-1')!.roomId}${META}`);

      await setLinkAccess('n-1', 'view');
      await generateView('n-1');
      expect(link('n-1')!.url).toBe('https://anima.app/read.html?b=B');
    } finally {
      delete g.window;
    }
  });
});

describe('edit-link persistence — survives reload so the owner re-arms the room', () => {
  // node-env has no localStorage; install a Map-backed stub for this group.
  beforeEach(() => {
    const m = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      },
    } as Storage;
  });

  it('caches only edit links, and only their capability fields', () => {
    saveEditLinks('0xv', [
      { noteId: 'e1', access: 'edit', kind: 'note', password: 'pw', url: 'u', salt: 's', title: 'T', phase: 'publishing', error: 'x', blobObjectId: '0xb' } as never,
      { noteId: 'v1', access: 'view', kind: 'note', password: null, url: 'u2' } as never,
    ]);
    const got = loadEditLinks('0xv');
    expect(got).toHaveLength(1); // the view link is excluded
    expect(got[0].noteId).toBe('e1');
    expect(got[0].salt).toBe('s');
    expect((got[0] as Record<string, unknown>).phase).toBeUndefined(); // transient field dropped
    expect((got[0] as Record<string, unknown>).blobObjectId).toBeUndefined();
  });

  it('rehydrates a persisted edit link when the vault index loads (local intent wins on dedup)', async () => {
    saveEditLinks('0xv', [
      { noteId: 'n-room', access: 'edit', kind: 'canvas', password: null, url: 'https://anima.app/read.html?room=R9&kind=canvas', roomId: 'R9' } as never,
    ]);
    seedNote('n-room'); // index swap to vault 0xv → the module-scope subscribe rehydrates
    await new Promise((r) => setTimeout(r, 0));
    expect(link('n-room')?.access).toBe('edit');
    expect(link('n-room')?.roomId).toBe('R9');
  });

  it('persists a new edit link to localStorage as the store changes', async () => {
    vi.useFakeTimers();
    try {
      seedNote('n-keep'); // sets the active vault so the persist subscription engages
      await createShareLink('n-keep', 'edit');
      vi.advanceTimersByTime(500); // past the 400ms persist debounce
      expect(loadEditLinks('0xv').some((l) => l.noteId === 'n-keep')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
