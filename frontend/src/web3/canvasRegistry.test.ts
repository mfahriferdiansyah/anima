/**
 * DOM-free test for the durable canvas registry (plan 007 U2). The registry is
 * an appState value (a CanvasDoc[]) backed by the `anima:canvas-registry`
 * reserved note; per-canvas content (layout + drawings) lives in the U1
 * `anima:canvas:<id>` notes. Only the Walrus write (`writeTurn`) is mocked.
 *
 * Pins: the fresh-vault fallback (incl. the always-present shared board), the
 * pure list transforms + shared/seed not deletable, the saveCanvases round-trip,
 * the AE3-full resurrection (both boards' registry + layout + drawings rebuild
 * from the index alone), R19 reserved-filtering, and the placed-note edge cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../chain/core/src/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../chain/core/src/index.js')>()),
  writeTurn: vi.fn(),
}));

import {
  VaultIndex,
  writeTurn,
  newNote,
  isReservedNote,
  loadCanvasContent,
  canvasContentTag,
  type Shape,
  type CanvasContent,
} from '../../../chain/core/src/index.js';
import {
  DEFAULT_REGISTRY,
  SHARED_CANVAS_ID,
  loadCanvases,
  saveCanvases,
  addCanvas,
  patchCanvas,
  removeCanvas,
  newCanvasId,
  type CanvasDoc,
} from './canvasRegistry';

const DEPS = { suiClient: {}, seal: {}, agentSigner: { toSuiAddress: () => '0xa' }, walletAddress: '0xo', vaultId: '0xv' } as never;
const RES = { perNote: [{ noteId: 'x', quiltPatchId: 'p', quiltBlobId: 'qb', blobObjectId: 'bo' }], quiltBlobId: 'qb', blobObjectId: 'bo' };
const emptyLoc = { quiltPatchId: '', quiltBlobId: '', blobObjectId: '' };

/** Build a real `anima:canvas-registry` fixture note. */
function registryNote(list: CanvasDoc[]) {
  return newNote({ title: 'app:canvas-registry', body: JSON.stringify(list), author: 'anima', tags: ['anima:canvas-registry'] });
}

/** Build a real `anima:canvas:<id>` content fixture note. */
function contentNote(canvasId: string, content: CanvasContent) {
  return newNote({ title: `Canvas ${canvasId}`, body: JSON.stringify(content), author: 'anima', tags: [canvasContentTag(canvasId)] });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(writeTurn).mockResolvedValue(RES as never);
});

describe('loadCanvases — fallback', () => {
  it('returns DEFAULT_REGISTRY (incl. the shared board) for a null index (pre-rebuild)', () => {
    expect(loadCanvases(null)).toEqual(DEFAULT_REGISTRY);
    expect(loadCanvases(null).some((c) => c.canvasId === SHARED_CANVAS_ID && c.seed)).toBe(true);
  });

  it('returns DEFAULT_REGISTRY for a fresh vault (no registry note)', () => {
    const list = loadCanvases(VaultIndex.fromEntries([]));
    expect(list).toEqual(DEFAULT_REGISTRY);
    expect(list).toHaveLength(1); // only the shared board, no demo fixtures
  });

  it('returns the persisted list when the registry note exists', () => {
    const list: CanvasDoc[] = [...DEFAULT_REGISTRY, { canvasId: 'c-a', title: 'A', desc: '', folder: 'work' }];
    const idx = VaultIndex.fromEntries([{ note: registryNote(list), location: emptyLoc }]);
    expect(loadCanvases(idx)).toEqual(list);
  });
});

describe('pure list transforms', () => {
  it('addCanvas appends a new doc', () => {
    const next = addCanvas(DEFAULT_REGISTRY, { canvasId: 'c-a', title: 'A', desc: '', folder: 'work' });
    expect(next).toHaveLength(2);
    expect(next.at(-1)).toEqual({ canvasId: 'c-a', title: 'A', desc: '', folder: 'work' });
    expect(DEFAULT_REGISTRY).toHaveLength(1); // input not mutated
  });

  it('patchCanvas edits the matching canvas only', () => {
    const list: CanvasDoc[] = [...DEFAULT_REGISTRY, { canvasId: 'c-a', title: 'A', desc: '', folder: 'work' }];
    const next = patchCanvas(list, 'c-a', { title: 'Renamed', image: '/covers/ethos-pulse.svg', folder: 'trips' });
    const a = next.find((c) => c.canvasId === 'c-a')!;
    expect(a).toEqual({ canvasId: 'c-a', title: 'Renamed', desc: '', folder: 'trips', image: '/covers/ethos-pulse.svg' });
    expect(next.find((c) => c.canvasId === SHARED_CANVAS_ID)).toEqual(DEFAULT_REGISTRY[0]); // shared untouched
  });

  it('patchCanvas is a no-op for an unknown id', () => {
    expect(patchCanvas(DEFAULT_REGISTRY, 'nope', { title: 'X' })).toEqual(DEFAULT_REGISTRY);
  });

  it('removeCanvas drops a real canvas', () => {
    const list: CanvasDoc[] = [...DEFAULT_REGISTRY, { canvasId: 'c-a', title: 'A', desc: '', folder: 'work' }];
    expect(removeCanvas(list, 'c-a')).toEqual(DEFAULT_REGISTRY);
  });

  it('removeCanvas does NOT delete the shared/seed board', () => {
    expect(removeCanvas(DEFAULT_REGISTRY, SHARED_CANVAS_ID)).toEqual(DEFAULT_REGISTRY);
  });

  it('newCanvasId mints distinct ids', () => {
    expect(newCanvasId()).not.toBe(newCanvasId());
  });
});

describe('saveCanvases — round-trip', () => {
  it('loadCanvases reads back what saveCanvases wrote (one reserved note, not N)', async () => {
    const idx = VaultIndex.fromEntries([]);
    const list = addCanvas(DEFAULT_REGISTRY, { canvasId: 'c-a', title: 'A', desc: 'desc', folder: 'work' });

    await saveCanvases(DEPS, idx, list);
    expect(loadCanvases(idx)).toEqual(list);

    // a second save bumps the SAME note (version up), not a second registry note
    await saveCanvases(DEPS, idx, removeCanvas(list, 'c-a'));
    expect(loadCanvases(idx)).toEqual(DEFAULT_REGISTRY);
    expect(idx.all().filter((e) => e.note.tags.includes('anima:canvas-registry'))).toHaveLength(1);
  });
});

describe('AE3-full — both boards rebuild from the index alone (Walrus + chain, no DB/relay)', () => {
  it('rebuilds two canvases\' registry entry + layout + drawings', () => {
    const cA: CanvasDoc = { canvasId: 'c-a', title: 'Trip board', desc: 'routes', folder: 'trips', image: '/covers/ethos-field.svg' };
    const cB: CanvasDoc = { canvasId: 'c-b', title: 'Pitch board', desc: 'spine', folder: 'work' };
    const list: CanvasDoc[] = [...DEFAULT_REGISTRY, cA, cB];

    const contentA: CanvasContent = {
      layout: { 'note-1': { x: 10, y: 20 }, 'note-2': { x: 30, y: 40 } },
      drawings: [
        { id: 'a1', kind: 'draw', pts: [0, 0, 5, 5] },
        { id: 'a2', kind: 'rect', x: 1, y: 2, w: 8, h: 9 },
      ],
    };
    const contentB: CanvasContent = {
      layout: { 'note-3': { x: 99, y: 88 } },
      drawings: [{ id: 'b1', kind: 'text', x: 4, y: 5, text: 'hello' }],
    };

    // a fresh index rebuilt from Walrus + chain: the registry note + both content notes
    const index = VaultIndex.fromEntries([
      { note: registryNote(list), location: emptyLoc },
      { note: contentNote('c-a', contentA), location: emptyLoc },
      { note: contentNote('c-b', contentB), location: emptyLoc },
    ]);

    // registry rebuilds both boards
    expect(loadCanvases(index)).toEqual(list);

    // each board's layout + drawings rebuild from its content note
    expect(loadCanvasContent(index, 'c-a')).toEqual(contentA);
    expect(loadCanvasContent(index, 'c-b')).toEqual(contentB);
  });
});

describe('R19 — registry + content never leak into recall/library/search', () => {
  it('the registry and content notes are reserved and excluded from notes()/search()', () => {
    const list: CanvasDoc[] = [...DEFAULT_REGISTRY, { canvasId: 'c-a', title: 'Secret board', desc: 'hush', folder: 'work' }];
    const userNote = newNote({ title: 'a real memory', body: 'about coffee', author: 'owner', tags: ['prefs'] });
    const reg = registryNote(list);
    const content = contentNote('c-a', { layout: { n: { x: 0, y: 0 } }, drawings: [] });

    const index = VaultIndex.fromEntries([
      { note: userNote, location: emptyLoc },
      { note: reg, location: emptyLoc },
      { note: content, location: emptyLoc },
    ]);

    expect(isReservedNote(reg)).toBe(true);
    expect(isReservedNote(content)).toBe(true);

    const userFacing = index.notes().map((e) => e.note.noteId);
    expect(userFacing).toEqual([userNote.noteId]); // only the real memory

    // reserved notes never surface in recall
    const searchIds = index.search('Secret board').map((e) => e.note.noteId);
    expect(searchIds).not.toContain(reg.noteId);
    expect(searchIds).not.toContain(content.noteId);
  });
});

describe('placed-note edge cases', () => {
  it('two canvases referencing the SAME noteId both resolve it', () => {
    const shared: Shape[] = [];
    const cA: CanvasContent = { layout: { 'shared-note': { x: 1, y: 1 } }, drawings: shared };
    const cB: CanvasContent = { layout: { 'shared-note': { x: 9, y: 9 } }, drawings: shared };
    const index = VaultIndex.fromEntries([
      { note: contentNote('c-a', cA), location: emptyLoc },
      { note: contentNote('c-b', cB), location: emptyLoc },
    ]);

    // both boards' layouts reference the same note id, at their own positions
    expect(loadCanvasContent(index, 'c-a').layout['shared-note']).toEqual({ x: 1, y: 1 });
    expect(loadCanvasContent(index, 'c-b').layout['shared-note']).toEqual({ x: 9, y: 9 });
  });

  it('a canvas with no content loads as an empty board', () => {
    const index = VaultIndex.fromEntries([{ note: registryNote([...DEFAULT_REGISTRY, { canvasId: 'c-empty', title: 'E', desc: '', folder: 'work' }]), location: emptyLoc }]);
    // registered, but no anima:canvas:c-empty content note exists yet
    expect(loadCanvasContent(index, 'c-empty')).toEqual({ layout: {}, drawings: [] });
  });
});
