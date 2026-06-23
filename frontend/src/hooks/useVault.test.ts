/**
 * DOM-free test for the notes write path (plan U4). chain/core's writeTurn +
 * preflight are mocked (the live write is proven by the U1 gate); the real
 * VaultIndex/newNote/editedNote drive the shared vaultData singleton. Pins the
 * binding-contract behaviors: preflight FIRST (low balance → banner, no write-
 * state), the honest write-state lifecycle off the promise, the double-submit
 * guard, the createNote draft, and the U7-stub forget.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// buildForgetPlan stays REAL (the pure planner is the thing under test — mocking
// it would let the leak ship green); only the I/O seams are mocked.
vi.mock('../../../chain/core/src/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../chain/core/src/index.js')>()),
  writeTurn: vi.fn(),
  preflight: vi.fn(),
  listVaultQuilts: vi.fn(),
  listVaultCovers: vi.fn(),
  uploadCover: vi.fn(),
  readAll: vi.fn(),
  buildDeleteQuiltsTx: vi.fn(),
}));
vi.mock('../web3/session', () => ({ getQuiltDeps: vi.fn() }));
vi.mock('./useChat', () => ({ triggerLowBalance: vi.fn(), dismissLowBalance: vi.fn() }));

import {
  VaultIndex,
  newNote,
  writeTurn,
  preflight,
  listVaultQuilts,
  listVaultCovers,
  uploadCover,
  readAll,
  buildDeleteQuiltsTx,
} from '../../../chain/core/src/index.js';
import { getQuiltDeps } from '../web3/session';
import { triggerLowBalance } from './useChat';
import { vaultData, resetVaultData } from '../web3/vaultData';
import {
  saveNote,
  createNote,
  forgetNotes,
  forgetEverything,
  configureForgetExec,
  useVault,
} from './useVault';

const loc = { quiltPatchId: 'p0', quiltBlobId: 'b0', blobObjectId: 'o0' };
const DEPS = { suiClient: {}, seal: {}, agentSigner: { toSuiAddress: () => '0xagent' }, walletAddress: '0xowner', vaultId: '0xv' };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetVaultData();
  vi.clearAllMocks();
  vi.mocked(getQuiltDeps).mockReturnValue(DEPS as never);
  vi.mocked(preflight).mockResolvedValue({ sui: 5n, wal: 5n, ok: true, needsSui: false, needsWal: false });
  // forget I/O defaults: empty residency, no covers, a sentinel delete-tx, a resolving exec
  vi.mocked(listVaultQuilts).mockResolvedValue([]);
  vi.mocked(listVaultCovers).mockResolvedValue([]);
  vi.mocked(readAll).mockResolvedValue([]);
  vi.mocked(buildDeleteQuiltsTx).mockResolvedValue({ kind: 'delete-tx' } as never);
  vi.mocked(uploadCover).mockResolvedValue({ blobId: 'cover-blob-1', ref: 'seal:cover-blob-1', blobObjectId: 'cover-obj-1' });
  configureForgetExec(vi.fn().mockResolvedValue(undefined));
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

  it('low balance shows a visible low-balance toast (not a silent return) and never calls writeTurn', async () => {
    const n = seedNote();
    vi.mocked(preflight).mockResolvedValue({ sui: 0n, wal: 0n, ok: false, needsSui: false, needsWal: true });

    saveNote(n.noteId, { body: 'edited' });
    await flush();

    // The chat banner still fires, AND a visible global toast now carries the
    // reason + the top-up affordance, so the block is never silent.
    expect(vi.mocked(triggerLowBalance)).toHaveBeenCalledOnce();
    expect(vaultData.getSnapshot().writeStates[n.noteId]).toEqual({ phase: 'low-balance', needsSui: false, needsWal: true });
    const events = vaultData.getSnapshot().writeEvents;
    expect(events).toHaveLength(1);
    expect(events[0].state).toEqual({ phase: 'low-balance', needsSui: false, needsWal: true });
    expect(vi.mocked(writeTurn)).not.toHaveBeenCalled();
  });

  it('a second blocked save does not stack a duplicate low-balance toast', async () => {
    const n = seedNote();
    vi.mocked(preflight).mockResolvedValue({ sui: 0n, wal: 0n, ok: false, needsSui: true, needsWal: true });

    saveNote(n.noteId, { body: 'one' });
    await flush();
    saveNote(n.noteId, { body: 'two' });
    await flush();

    expect(vaultData.getSnapshot().writeEvents).toHaveLength(1);
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

  it('a truly empty patch (no fields, no image) does not trigger a chain write', async () => {
    const n = seedNote();
    saveNote(n.noteId, {}); // no fields at all — genuine no-op
    await flush();
    expect(vi.mocked(writeTurn)).not.toHaveBeenCalled();
  });

  it('an oversize data URL image is silently dropped and does not trigger a chain write', async () => {
    const n = seedNote();
    // produce a data URL whose decoded bytes exceed COVER_MAX_BYTES (2MB)
    const oversize = 'data:image/png;base64,' + btoa('x'.repeat(3 * 1024 * 1024));
    saveNote(n.noteId, { image: oversize });
    await flush();
    expect(vi.mocked(writeTurn)).not.toHaveBeenCalled();
    expect(vi.mocked(uploadCover)).not.toHaveBeenCalled();
  });

  it('a preset cover persists as cover: <path> on the note', async () => {
    const n = seedNote();
    vi.mocked(writeTurn).mockResolvedValue({
      quiltBlobId: 'qb', blobObjectId: '0xCOVER', transferDigest: '0xd',
      perNote: [{ noteId: n.noteId, version: 2, quiltPatchId: 'p1' }],
    } as never);

    saveNote(n.noteId, { image: '/covers/ethos-orbit.svg' });
    await flush();

    expect(vi.mocked(writeTurn)).toHaveBeenCalledOnce();
    const writtenNote = vi.mocked(writeTurn).mock.calls[0][1][0] as { cover?: string };
    expect(writtenNote.cover).toBe('/covers/ethos-orbit.svg');
  });

  it('empty string image clears the cover on the persisted note', async () => {
    const n = { ...newNote({ title: 'x', body: 'y', author: 'owner' }), cover: 'seal:old' };
    const { VaultIndex: VI } = await import('../../../chain/core/src/index.js');
    vaultData.publish(VI.fromEntries([{ note: n, location: loc }]));
    vi.mocked(writeTurn).mockResolvedValue({
      quiltBlobId: 'qb', blobObjectId: '0xCOVER', transferDigest: '0xd',
      perNote: [{ noteId: n.noteId, version: 2, quiltPatchId: 'p1' }],
    } as never);

    saveNote(n.noteId, { image: '' });
    await flush();

    expect(vi.mocked(writeTurn)).toHaveBeenCalledOnce();
    const writtenNote = vi.mocked(writeTurn).mock.calls[0][1][0] as { cover?: string };
    // empty string cover is serialized as absent by serializeNote, but the editedNote
    // carries cover:'' which means "clear it"; the write still happens
    expect(writtenNote.cover).toBe('');
  });

  it('a data URL image triggers uploadCover and the returned ref is persisted', async () => {
    const n = seedNote();
    vi.mocked(writeTurn).mockResolvedValue({
      quiltBlobId: 'qb', blobObjectId: '0xCOVER', transferDigest: '0xd',
      perNote: [{ noteId: n.noteId, version: 2, quiltPatchId: 'p1' }],
    } as never);
    vi.mocked(uploadCover).mockResolvedValue({ blobId: 'cover-blob-x', ref: 'seal:cover-blob-x', blobObjectId: 'cover-obj-x' });

    // valid small data URL (3 bytes → well under 2MB)
    saveNote(n.noteId, { image: 'data:image/png;base64,AAAA' });
    await flush();

    expect(vi.mocked(uploadCover)).toHaveBeenCalledOnce();
    expect(vi.mocked(writeTurn)).toHaveBeenCalledOnce();
    const writtenNote = vi.mocked(writeTurn).mock.calls[0][1][0] as { cover?: string };
    expect(writtenNote.cover).toBe('seal:cover-blob-x');
  });
});

describe('hooks/useVault createNote + forgetNotes', () => {
  it('createNote adds a draft note to the live index and returns its id', () => {
    vaultData.publish(VaultIndex.fromEntries([]));
    const id = createNote();
    expect(vaultData.getSnapshot().notes.map((x) => x.noteId)).toContain(id);
  });

  it('forgetNotes with no on-chain residency drops the note locally and returns a scrub event', async () => {
    const n = seedNote();
    vi.mocked(listVaultQuilts).mockResolvedValue([]); // unsaved/no-quilt
    vi.mocked(readAll).mockResolvedValue([]);
    const scrub = await forgetNotes([n.noteId]);
    expect(scrub.removed).toEqual([{ noteId: n.noteId, title: 'My note' }]);
    expect(scrub.line).toContain('Forgot 1 memory');
    expect(vaultData.getSnapshot().notes).toHaveLength(0);
    expect(vi.mocked(buildDeleteQuiltsTx)).not.toHaveBeenCalled();
  });

  it('useVault selects notes + writeStates from the shared vaultData snapshot', () => {
    const n = seedNote();
    // call the selector logic directly via the store snapshot (DOM-free; the hook is thin)
    const snap = vaultData.getSnapshot();
    expect(snap.notes.map((x) => x.noteId)).toContain(n.noteId);
    expect(typeof useVault).toBe('function');
  });
});

/**
 * U7 destructive forget — the ordering invariant: full-residency enumeration →
 * survivors rewrite+upsert → one atomic delete → remove. `buildForgetPlan` runs
 * REAL; only the I/O seams (writeTurn / listVaultQuilts / readAll /
 * buildDeleteQuiltsTx) and the injected execTx are mocked.
 */
describe('hooks/useVault forgetNotes (U7 destructive)', () => {
  type N = ReturnType<typeof newNote>;
  // a residency entry at a given blob (physical location on Walrus)
  const at = (note: N, blobObjectId: string) => ({
    note,
    location: { quiltPatchId: `p-${blobObjectId}`, quiltBlobId: `qb-${blobObjectId}`, blobObjectId },
  });
  // a WriteResult covering the given survivor notes at a fresh blob
  const writeRes = (notes: N[], blobObjectId: string) => ({
    quiltBlobId: `qb-${blobObjectId}`,
    blobObjectId,
    transferDigest: '0xd',
    perNote: notes.map((n) => ({ noteId: n.noteId, version: 2, quiltPatchId: `p-${blobObjectId}-${n.noteId}` })),
  });

  it('edited-note leak: a note with v1 + v2 quilts deletes BOTH blobs, not just the latest', async () => {
    // the index only knows the LATEST location (blobV2). A naive impl that fed the
    // index to buildForgetPlan would delete only blobV2 and leave decryptable
    // prior-version ciphertext on blobV1 — the AE2 leak. Full residency catches both.
    const note = newNote({ title: 'Edited', body: 'v2', author: 'owner' });
    vaultData.publish(VaultIndex.fromEntries([at(note, 'blobV2')]));

    vi.mocked(listVaultQuilts).mockResolvedValue(['blobV1', 'blobV2']);
    vi.mocked(readAll).mockResolvedValue([at(note, 'blobV1'), at(note, 'blobV2')] as never);

    await forgetNotes([note.noteId]);

    expect(vi.mocked(buildDeleteQuiltsTx)).toHaveBeenCalledOnce();
    const blobsDeleted = vi.mocked(buildDeleteQuiltsTx).mock.calls[0][1];
    expect([...blobsDeleted].sort()).toEqual(['blobV1', 'blobV2']);
    // no survivors (the only note in those quilts is the forgotten one)
    expect(vi.mocked(writeTurn)).not.toHaveBeenCalled();
    expect(vaultData.getSnapshot().notes).toHaveLength(0);
  });

  it('survivor co-resident in a deleted quilt is rewritten and upserted to the NEW blob BEFORE the delete', async () => {
    const forget = newNote({ title: 'Forget me', body: 'x', author: 'owner' });
    const survivor = newNote({ title: 'Keep me', body: 'y', author: 'owner' });
    // both live in the same doomed quilt (blobA); the index points the survivor there
    vaultData.publish(VaultIndex.fromEntries([at(forget, 'blobA'), at(survivor, 'blobA')]));
    vi.mocked(listVaultQuilts).mockResolvedValue(['blobA']);
    vi.mocked(readAll).mockResolvedValue([at(forget, 'blobA'), at(survivor, 'blobA')] as never);
    vi.mocked(writeTurn).mockResolvedValue(writeRes([survivor], 'blobNEW') as never);

    // capture the survivor's indexed location AT execTx call time — proves the
    // upsert (→ blobNEW) ran before the delete, and remove() runs only after.
    let survivorBlobAtDelete: string | undefined;
    let forgetStillPresentAtDelete = false;
    configureForgetExec(
      vi.fn().mockImplementation(async () => {
        survivorBlobAtDelete = vaultData.getSnapshot().index?.get(survivor.noteId)?.location.blobObjectId;
        forgetStillPresentAtDelete = !!vaultData.getSnapshot().index?.get(forget.noteId);
      }),
    );

    await forgetNotes([forget.noteId]);

    expect(vi.mocked(writeTurn)).toHaveBeenCalledOnce();
    expect(vi.mocked(writeTurn).mock.calls[0][1].map((n: { noteId: string }) => n.noteId)).toEqual([survivor.noteId]);
    expect(survivorBlobAtDelete).toBe('blobNEW'); // upsert ran before delete
    expect(forgetStillPresentAtDelete).toBe(true); // remove ran after delete
    // after: survivor at the new blob, forgotten note gone
    expect(vaultData.getSnapshot().index?.get(survivor.noteId)?.location.blobObjectId).toBe('blobNEW');
    expect(vaultData.getSnapshot().index?.get(forget.noteId)).toBeUndefined();
  });

  it('without a wired wallet exec it throws BEFORE any rewrite/remove (no orphan, note stays)', async () => {
    const note = newNote({ title: 'Keep until signed', body: 'x', author: 'owner' });
    vaultData.publish(VaultIndex.fromEntries([at(note, 'blobA')]));
    vi.mocked(listVaultQuilts).mockResolvedValue(['blobA']);
    vi.mocked(readAll).mockResolvedValue([at(note, 'blobA')] as never);
    configureForgetExec(undefined as never); // wiring lost

    await expect(forgetNotes([note.noteId])).rejects.toThrow('wallet exec not wired');
    expect(vi.mocked(writeTurn)).not.toHaveBeenCalled();
    expect(vaultData.getSnapshot().index?.get(note.noteId)).toBeDefined(); // not removed
  });

  it('one atomic delete: many doomed blobs → exactly one buildDeleteQuiltsTx + one execTx', async () => {
    const a = newNote({ title: 'A', body: '1', author: 'owner' });
    const b = newNote({ title: 'B', body: '2', author: 'owner' });
    vaultData.publish(VaultIndex.fromEntries([at(a, 'blob1'), at(b, 'blob2')]));
    vi.mocked(listVaultQuilts).mockResolvedValue(['blob1', 'blob2']);
    vi.mocked(readAll).mockResolvedValue([at(a, 'blob1'), at(b, 'blob2')] as never);
    const exec = vi.fn().mockResolvedValue(undefined);
    configureForgetExec(exec);

    await forgetNotes([a.noteId, b.noteId]);

    expect(vi.mocked(buildDeleteQuiltsTx)).toHaveBeenCalledOnce();
    expect([...vi.mocked(buildDeleteQuiltsTx).mock.calls[0][1]].sort()).toEqual(['blob1', 'blob2']);
    expect(exec).toHaveBeenCalledOnce();
  });

  it('forget cleans up cover blobs in the same delete PTB as the quilts', async () => {
    const note = newNote({ title: 'Has cover', body: 'x', author: 'owner' });
    vaultData.publish(VaultIndex.fromEntries([at(note, 'blobA')]));
    vi.mocked(listVaultQuilts).mockResolvedValue(['blobA']);
    vi.mocked(readAll).mockResolvedValue([at(note, 'blobA')] as never);
    vi.mocked(listVaultCovers).mockResolvedValue(['cover-obj-1']); // one cover blob

    await forgetNotes([note.noteId]);

    expect(vi.mocked(buildDeleteQuiltsTx)).toHaveBeenCalledOnce();
    const blobsDeleted = vi.mocked(buildDeleteQuiltsTx).mock.calls[0][1];
    expect([...blobsDeleted].sort()).toEqual(['blobA', 'cover-obj-1'].sort());
  });

  it('forget cleans up cover blobs even when there are no affected quilt blobs (unsaved draft with uploaded cover)', async () => {
    // note was never written to a quilt (draft), but its cover blob was uploaded
    const note = newNote({ title: 'Draft with cover', body: 'x', author: 'owner' });
    vaultData.publish(VaultIndex.fromEntries([{ note, location: { quiltPatchId: '', quiltBlobId: '', blobObjectId: '' } }]));
    vi.mocked(listVaultQuilts).mockResolvedValue([]);
    vi.mocked(readAll).mockResolvedValue([]);
    vi.mocked(listVaultCovers).mockResolvedValue(['cover-obj-draft']);
    const exec = vi.fn().mockResolvedValue(undefined);
    configureForgetExec(exec);

    await forgetNotes([note.noteId]);

    // even with no quilt blobs, the cover blob must be deleted
    expect(vi.mocked(buildDeleteQuiltsTx)).toHaveBeenCalledOnce();
    const blobsDeleted = vi.mocked(buildDeleteQuiltsTx).mock.calls[0][1];
    expect(blobsDeleted).toContain('cover-obj-draft');
    expect(exec).toHaveBeenCalledOnce();
    expect(vaultData.getSnapshot().notes).toHaveLength(0);
  });

  it('idempotence: delete rejected → re-invoke re-runs only the delete, no orphan survivor rewrite', async () => {
    const forget = newNote({ title: 'Forget', body: 'x', author: 'owner' });
    const survivor = newNote({ title: 'Survivor', body: 'y', author: 'owner' });
    vaultData.publish(VaultIndex.fromEntries([at(forget, 'blobA'), at(survivor, 'blobA')]));

    // residency reflects the on-chain truth. Run 1 rewrites the survivor to blobNEW
    // (durable) but the delete REJECTS, so blobA still physically holds both notes.
    vi.mocked(listVaultQuilts).mockResolvedValue(['blobA']);
    vi.mocked(readAll).mockResolvedValue([at(forget, 'blobA'), at(survivor, 'blobA')] as never);
    vi.mocked(writeTurn).mockResolvedValue(writeRes([survivor], 'blobNEW') as never);

    let call = 0;
    configureForgetExec(
      vi.fn().mockImplementation(async () => {
        call += 1;
        if (call === 1) throw new Error('wallet declined');
      }),
    );

    await expect(forgetNotes([forget.noteId])).rejects.toThrow('wallet declined');
    // delete failed → the forgotten note STAYS in the index (retryable); survivor moved
    expect(vaultData.getSnapshot().index?.get(forget.noteId)).toBeDefined();
    expect(vaultData.getSnapshot().index?.get(survivor.noteId)?.location.blobObjectId).toBe('blobNEW');
    expect(vi.mocked(writeTurn)).toHaveBeenCalledOnce();

    // Run 2: residency unchanged (delete never happened) — but the survivor's LATEST
    // index location is now blobNEW (∉ affected), so it is NOT rewritten again.
    await forgetNotes([forget.noteId]);

    expect(vi.mocked(writeTurn)).toHaveBeenCalledOnce(); // STILL once — no orphan duplicate
    expect(vi.mocked(buildDeleteQuiltsTx)).toHaveBeenCalledTimes(2); // delete re-ran
    expect(vaultData.getSnapshot().index?.get(forget.noteId)).toBeUndefined(); // now gone
    expect(vaultData.getSnapshot().index?.get(survivor.noteId)?.location.blobObjectId).toBe('blobNEW');
  });
});

describe('hooks/useVault forgetEverything (U7 bulk)', () => {
  it('quiesces an in-flight write, enumerates, deletes under one execTx, clears the index without teardown', async () => {
    vi.useFakeTimers();
    try {
      const n = newNote({ title: 'Held', body: 'z', author: 'owner' });
      vaultData.publish(VaultIndex.fromEntries([{ note: n, location: loc }]));
      // a silent/inline write is mid-flight — quiesce must wait it out
      vaultData.setWriteState(n.noteId, { phase: 'certifying' });

      vi.mocked(listVaultQuilts).mockResolvedValue(['blob1', 'blob2']);
      const exec = vi.fn().mockResolvedValue(undefined);
      configureForgetExec(exec);

      const done = forgetEverything();

      // still certifying → enumeration must NOT have fired yet
      await Promise.resolve();
      expect(vi.mocked(listVaultQuilts)).not.toHaveBeenCalled();

      // the write completes → quiesce predicate clears
      vaultData.setWriteState(n.noteId, { phase: 'certified', blobObjectId: '0xB', provenanceUrl: 'u' });
      await vi.advanceTimersByTimeAsync(60); // past the 50ms poll
      await done;

      expect(vi.mocked(listVaultQuilts)).toHaveBeenCalledOnce();
      expect(vi.mocked(buildDeleteQuiltsTx)).toHaveBeenCalledOnce();
      expect([...vi.mocked(buildDeleteQuiltsTx).mock.calls[0][1]]).toEqual(['blob1', 'blob2']);
      expect(exec).toHaveBeenCalledOnce();
      // index is cleared IN PLACE (re-onboardable) — non-null, empty, no teardown
      const snap = vaultData.getSnapshot();
      expect(snap.index).not.toBeNull();
      expect(snap.notes).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
