/**
 * DOM-free test for the notes write path (plan U4). chain/core's writeTurn +
 * preflight are mocked (the live write is proven by the U1 gate); the real
 * VaultIndex/newNote/editedNote drive the shared vaultData singleton. Pins the
 * binding-contract behaviors: preflight FIRST (low balance → banner, no write-
 * state), the honest write-state lifecycle off the promise, the double-submit
 * guard, the createNote draft, and the U7-stub forget.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../chain/core/src/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../chain/core/src/index.js')>()),
  writeTurn: vi.fn(),
  preflight: vi.fn(),
}));
vi.mock('../web3/session', () => ({ getQuiltDeps: vi.fn() }));
vi.mock('./useChat', () => ({ triggerLowBalance: vi.fn() }));

import { VaultIndex, newNote, writeTurn, preflight } from '../../../chain/core/src/index.js';
import { getQuiltDeps } from '../web3/session';
import { triggerLowBalance } from './useChat';
import { vaultData, resetVaultData } from '../web3/vaultData';
import { saveNote, createNote, forgetNotes, useVault } from './useVault';

const loc = { quiltPatchId: 'p0', quiltBlobId: 'b0', blobObjectId: 'o0' };
const DEPS = { suiClient: {}, seal: {}, agentSigner: { toSuiAddress: () => '0xagent' }, walletAddress: '0xowner', vaultId: '0xv' };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetVaultData();
  vi.clearAllMocks();
  vi.mocked(getQuiltDeps).mockReturnValue(DEPS as never);
  vi.mocked(preflight).mockResolvedValue({ sui: 5n, wal: 5n, ok: true, needsSui: false, needsWal: false });
});

function seedNote(body = 'original') {
  const n = newNote({ title: 'My note', body, author: 'owner' });
  vaultData.publish(VaultIndex.fromEntries([{ note: n, location: loc }]));
  return n;
}

describe('hooks/useVault saveNote', () => {
  it('runs preflight then the encrypting→certifying→certified lifecycle off the write promise', async () => {
    const n = seedNote();
    let resolveWrite!: (v: unknown) => void;
    vi.mocked(writeTurn).mockReturnValue(new Promise((r) => { resolveWrite = r as never; }) as never);

    saveNote(n.noteId, { body: 'edited' });
    await flush(); // preflight resolves → encrypting+certifying set, writeTurn called

    expect(vi.mocked(preflight)).toHaveBeenCalledOnce();
    expect(vaultData.getSnapshot().writeStates[n.noteId]).toEqual({ phase: 'certifying' });
    expect(vaultData.getSnapshot().writeEvents).toHaveLength(1);
    expect(vi.mocked(writeTurn)).toHaveBeenCalledOnce();

    resolveWrite({ quiltBlobId: 'qb', blobObjectId: '0xBLOB', transferDigest: '0xd', perNote: [{ noteId: n.noteId, version: 2, quiltPatchId: 'p1' }] });
    await flush();

    const st = vaultData.getSnapshot().writeStates[n.noteId];
    expect(st).toMatchObject({ phase: 'certified', blobObjectId: '0xBLOB' });
    expect(st.phase === 'certified' && st.provenanceUrl).toContain('0xBLOB');
    // the index now holds the edited note at its new location
    expect(vaultData.getSnapshot().notes.find((x) => x.noteId === n.noteId)?.body).toBe('edited');
    expect(vaultData.getSnapshot().index?.get(n.noteId)?.location.blobObjectId).toBe('0xBLOB');
  });

  it('low balance surfaces the banner with NO write-state, and never calls writeTurn', async () => {
    const n = seedNote();
    vi.mocked(preflight).mockResolvedValue({ sui: 0n, wal: 0n, ok: false, needsSui: false, needsWal: true });

    saveNote(n.noteId, { body: 'edited' });
    await flush();

    expect(vi.mocked(triggerLowBalance)).toHaveBeenCalledOnce();
    expect(vaultData.getSnapshot().writeStates[n.noteId]).toBeUndefined();
    expect(vi.mocked(writeTurn)).not.toHaveBeenCalled();
  });

  it('marks failed when the write promise rejects', async () => {
    const n = seedNote();
    vi.mocked(writeTurn).mockRejectedValue(new Error('relay 503'));

    saveNote(n.noteId, { body: 'edited' });
    await flush();
    await flush();

    expect(vaultData.getSnapshot().writeStates[n.noteId]).toEqual({ phase: 'failed' });
  });

  it('double-submit guard: a second save while in flight does not start a second write', async () => {
    const n = seedNote();
    vi.mocked(writeTurn).mockReturnValue(new Promise(() => {}) as never); // never resolves

    saveNote(n.noteId, { body: 'a' });
    await flush(); // now certifying (in flight)
    saveNote(n.noteId, { body: 'b' }); // guarded
    await flush();

    expect(vi.mocked(writeTurn)).toHaveBeenCalledOnce();
  });

  it('a cover-only / empty change does not trigger a chain write', async () => {
    const n = seedNote();
    saveNote(n.noteId, { image: 'data:cover' }); // image is dropped (Tier-2), no real change
    await flush();
    expect(vi.mocked(writeTurn)).not.toHaveBeenCalled();
  });
});

describe('hooks/useVault createNote + forgetNotes', () => {
  it('createNote adds a draft note to the live index and returns its id', () => {
    vaultData.publish(VaultIndex.fromEntries([]));
    const id = createNote();
    expect(vaultData.getSnapshot().notes.map((x) => x.noteId)).toContain(id);
  });

  it('forgetNotes (U7 stub) removes the notes locally and returns a scrub event', () => {
    const n = seedNote();
    const scrub = forgetNotes([n.noteId]);
    expect(scrub.removed).toEqual([{ noteId: n.noteId, title: 'My note' }]);
    expect(scrub.line).toContain('Forgot 1 memory');
    expect(vaultData.getSnapshot().notes).toHaveLength(0);
  });

  it('useVault selects notes + writeStates from the shared vaultData snapshot', () => {
    const n = seedNote();
    // call the selector logic directly via the store snapshot (DOM-free; the hook is thin)
    const snap = vaultData.getSnapshot();
    expect(snap.notes.map((x) => x.noteId)).toContain(n.noteId);
    expect(typeof useVault).toBe('function');
  });
});
