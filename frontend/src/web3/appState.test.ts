/**
 * DOM-free test for the durable app-state helper (Tier-2 U1). The real
 * VaultIndex/newNote/editedNote drive the round-trip; only the Walrus write
 * (`writeTurn`) is mocked. Pins: fallback semantics, mint-vs-bump (one note,
 * not N), the reserved tag, the round-trip, and R19 (never in recall/library).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../chain/core/src/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../chain/core/src/index.js')>()),
  writeTurn: vi.fn(),
}));

import { VaultIndex, writeTurn, newNote } from '../../../chain/core/src/index.js';
import { loadAppState, saveAppState, appStateTag } from './appState';

const DEPS = { suiClient: {}, seal: {}, agentSigner: { toSuiAddress: () => '0xa' }, walletAddress: '0xo', vaultId: '0xv' } as never;
const RES = { perNote: [{ noteId: 'x', quiltPatchId: 'p', quiltBlobId: 'qb', blobObjectId: 'bo' }], quiltBlobId: 'qb', blobObjectId: 'bo' };
const emptyLoc = { quiltPatchId: '', quiltBlobId: '', blobObjectId: '' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(writeTurn).mockResolvedValue(RES as never);
});

describe('loadAppState', () => {
  it('returns the fallback for a null index (pre-rebuild)', () => {
    expect(loadAppState(null, 'folders', ['a'])).toEqual(['a']);
  });

  it('returns the fallback when the note is absent (fresh vault)', () => {
    expect(loadAppState(VaultIndex.fromEntries([]), 'folders', ['a'])).toEqual(['a']);
  });

  it('returns the parsed body when the note exists', () => {
    const note = newNote({ title: 'app:folders', body: JSON.stringify(['x', 'y']), author: 'anima', tags: [appStateTag('folders')] });
    const idx = VaultIndex.fromEntries([{ note, location: emptyLoc }]);
    expect(loadAppState(idx, 'folders', [])).toEqual(['x', 'y']);
  });

  it('returns the fallback on a malformed body (does not throw)', () => {
    const note = newNote({ title: 'app:folders', body: '{not json', author: 'anima', tags: [appStateTag('folders')] });
    const idx = VaultIndex.fromEntries([{ note, location: emptyLoc }]);
    expect(loadAppState(idx, 'folders', ['def'])).toEqual(['def']);
  });
});

describe('saveAppState', () => {
  it('mints v1 then bumps the version — one reserved note, not N', async () => {
    const idx = VaultIndex.fromEntries([]);
    const n1 = await saveAppState(DEPS, idx, 'folders', ['a']);
    expect(n1.version).toBe(1);
    expect(n1.tags).toContain('anima:folders');

    const n2 = await saveAppState(DEPS, idx, 'folders', ['a', 'b']);
    expect(n2.version).toBe(2);
    expect(n2.noteId).toBe(n1.noteId); // same note, new version
    expect(writeTurn).toHaveBeenCalledTimes(2);
    expect(idx.all().filter((e) => e.note.tags.includes('anima:folders'))).toHaveLength(1);
  });

  it('round-trips: loadAppState reads back what saveAppState wrote', async () => {
    const idx = VaultIndex.fromEntries([]);
    await saveAppState(DEPS, idx, 'folders', ['research', 'trips']);
    expect(loadAppState(idx, 'folders', [])).toEqual(['research', 'trips']);
  });

  it('keeps the reserved note out of recall + the library (R19)', async () => {
    const idx = VaultIndex.fromEntries([]);
    await saveAppState(DEPS, idx, 'folders', ['secretfolder']);
    expect(idx.notes().some((e) => e.note.tags.includes('anima:folders'))).toBe(false);
    expect(idx.search('secretfolder').some((e) => e.note.tags.includes('anima:folders'))).toBe(false);
  });
});
