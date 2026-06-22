/**
 * DOM-free test for durable folders (Tier-2 U1). The folder mutators update an
 * optimistic local store (instant UI) and persist via `saveAppState` (the Walrus
 * write is mocked). Pins: the default seed, optimistic add/move/delete, reserved-
 * prefix rejection + dedup, the persisted value, and reseed-from-index on rebuild.
 */
import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../chain/core/src/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../chain/core/src/index.js')>()),
  writeTurn: vi.fn(),
}));
vi.mock('../web3/session', () => ({ getQuiltDeps: vi.fn() }));

import { VaultIndex, writeTurn, newNote } from '../../../chain/core/src/index.js';
import { getQuiltDeps } from '../web3/session';
import { vaultData, resetVaultData } from '../web3/vaultData';
import { appStateTag } from '../web3/appState';
import { addFolder, moveFolder, deleteFolder, getFoldersForTest, resetFoldersForTest } from './useCanvases';

const DEPS = { suiClient: {}, seal: {}, agentSigner: { toSuiAddress: () => '0xa' }, walletAddress: '0xo', vaultId: '0xv' } as never;
const RES = { perNote: [{ noteId: 'x', quiltPatchId: 'p', quiltBlobId: 'qb', blobObjectId: 'bo' }], quiltBlobId: 'qb', blobObjectId: 'bo' };
// 'unsorted' is the always-present inbox where new notes/canvases land (appended if absent).
const DEFAULT = ['research', 'trips', 'work', 'reading', 'product', 'unsorted'];
const flush = () => new Promise((r) => setTimeout(r, 0));
/** The folders array written to the latest persisted reserved note. */
const lastPersisted = (): string[] => JSON.parse(vi.mocked(writeTurn).mock.calls.at(-1)![1][0].body);

beforeEach(() => {
  resetVaultData();
  resetFoldersForTest();
  vi.clearAllMocks();
  vi.mocked(getQuiltDeps).mockReturnValue(DEPS);
  vi.mocked(writeTurn).mockResolvedValue(RES as never);
  vaultData.publish(VaultIndex.fromEntries([])); // a live (empty) index → folders reseed to DEFAULT
});

it('seeds the default folders when no durable note exists', () => {
  expect(getFoldersForTest()).toEqual(DEFAULT);
});

it('addFolder updates optimistically and persists the new list', async () => {
  addFolder('Ideas');
  expect(getFoldersForTest()).toEqual([...DEFAULT, 'ideas']); // lowercased, optimistic
  await flush();
  expect(writeTurn).toHaveBeenCalledTimes(1);
  expect(lastPersisted()).toEqual([...DEFAULT, 'ideas']);
});

it('rejects a reserved-prefix folder name and deduplicates existing names', () => {
  addFolder('anima:hack');
  addFolder('research'); // already present
  expect(getFoldersForTest()).toEqual(DEFAULT);
  expect(writeTurn).not.toHaveBeenCalled();
});

it('moveFolder reorders and persists', async () => {
  moveFolder('trips', -1); // trips moves above research
  expect(getFoldersForTest()).toEqual(['trips', 'research', 'work', 'reading', 'product', 'unsorted']);
  await flush();
  expect(lastPersisted()).toEqual(['trips', 'research', 'work', 'reading', 'product', 'unsorted']);
});

it('deleteFolder removes a folder from the order', async () => {
  deleteFolder('reading');
  expect(getFoldersForTest()).toEqual(['research', 'trips', 'work', 'product', 'unsorted']);
  await flush();
  expect(lastPersisted()).toEqual(['research', 'trips', 'work', 'product', 'unsorted']);
});

it('an empty folder added then "reloaded" (rebuild → fresh index) survives', () => {
  // simulate a durable folders note (incl. an empty folder) rebuilt from Walrus
  const note = newNote({ title: 'app:folders', body: JSON.stringify(['research', 'someday']), author: 'anima', tags: [appStateTag('folders')] });
  const rebuilt = VaultIndex.fromEntries([{ note, location: { quiltPatchId: '', quiltBlobId: '', blobObjectId: 'bo' } }]);
  vaultData.publish(rebuilt); // index ref swaps → folders reseed from the durable note
  expect(getFoldersForTest()).toEqual(['research', 'someday', 'unsorted']); // inbox appended
});
