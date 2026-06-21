/**
 * Unit tests for canvasContent.ts. Chain I/O (walrus, seal, suiClient) is fully
 * mocked; the live blob round-trip is NOT tested here (requires a real wallet +
 * chain). Covers: per-canvas mint/edit, the shared-board read-alias → migrate →
 * delete-old flow, partial read-modify-write, the AE3 drawings round-trip, and
 * R19 reserved-note filtering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadCanvasContent,
  saveCanvasContent,
  canvasContentTag,
  type Shape,
  type CanvasContent,
} from '../canvasContent.js';
import { LAYOUT_TAG, findLayoutNote, type CanvasLayout } from '../canvas.js';
import { VaultIndex, isReservedNote } from '../vaultIndex.js';
import { newNote } from '../notes.js';
import type { IndexedNote, Note } from '../types.js';

// --- mock deps (mirror covers.test.ts) ---

function makeWriteResult(noteId: string, version: number, i: number) {
  return {
    quiltBlobId: `qb-${i}`,
    blobObjectId: `obj-${i}`,
    transferDigest: '0xdigest',
    perNote: [{ noteId, version, quiltPatchId: `qp-${i}` }],
  };
}

function makeDeps() {
  let writes = 0;
  const suiClient = {
    walrus: {
      // writeTurn path
      writeFiles: vi.fn().mockImplementation(async () => [
        { blobObject: { id: `obj-${++writes}` }, blobId: `qb-${writes}` },
      ]),
      // buildDeleteQuiltsTx path — appends a delete to the tx, returns it
      deleteBlobTransaction: vi.fn().mockImplementation(async ({ transaction, blobObjectId }) => {
        (transaction as any).__deleted ??= [];
        (transaction as any).__deleted.push(blobObjectId);
        return transaction;
      }),
    },
    signAndExecuteTransaction: vi.fn().mockResolvedValue({
      effects: { status: { status: 'success' } },
      digest: '0xtransfer',
    }),
    waitForTransaction: vi.fn().mockResolvedValue(undefined),
  };
  return {
    suiClient,
    seal: {
      encryptNote: vi.fn().mockImplementation(async (_id: string, bytes: Uint8Array) => bytes),
      decryptNote: vi.fn(),
    },
    agentSigner: { toSuiAddress: () => '0x' + 'c'.repeat(64) } as any,
    walletAddress: '0x' + 'a'.repeat(64),
    vaultId: '0x' + 'b'.repeat(64),
  };
}

// fixture seeding (mirror vaultIndex.test.ts)
const loc = (i: number) => ({ quiltPatchId: `p${i}`, quiltBlobId: `b${i}`, blobObjectId: `o${i}` });
const entry = (note: Note, i = 1): IndexedNote => ({ note, location: loc(i) });

/** A real legacy `anima:canvas-layout` fixture note (live shared-board data). */
function legacyLayoutNote(layout: CanvasLayout): Note {
  return newNote({ title: 'Canvas layout', body: JSON.stringify(layout), author: 'anima', tags: [LAYOUT_TAG] });
}

let deps: ReturnType<typeof makeDeps>;
beforeEach(() => {
  deps = makeDeps();
});

describe('loadCanvasContent', () => {
  it('returns {layout:{}, drawings:[]} for a canvas with no content (never throws)', () => {
    const index = new VaultIndex();
    expect(loadCanvasContent(index, 'board-x')).toEqual({ layout: {}, drawings: [] });
  });

  it('shared read-aliases the legacy anima:canvas-layout note pre-migration', () => {
    const layout = { 'note-1': { x: 10, y: 20 } };
    const index = VaultIndex.fromEntries([entry(legacyLayoutNote(layout))]);
    // no anima:canvas:shared yet → falls back to the legacy layout, no drawings
    expect(loadCanvasContent(index, 'shared')).toEqual({ layout, drawings: [] });
  });

  it('parses an existing content note body', () => {
    const content: CanvasContent = { layout: { n1: { x: 1, y: 2 } }, drawings: [] };
    const note = newNote({ title: 'Canvas b', body: JSON.stringify(content), author: 'anima', tags: [canvasContentTag('b')] });
    const index = VaultIndex.fromEntries([entry(note)]);
    expect(loadCanvasContent(index, 'b')).toEqual(content);
  });
});

describe('saveCanvasContent — mint then edit (one note per canvas)', () => {
  it('mints v1 on first write, editedNote-bumps on subsequent writes', async () => {
    const index = new VaultIndex();

    const r1 = await saveCanvasContent(deps as any, index, 'b', { layout: { n1: { x: 1, y: 1 } } });
    expect(r1.note.version).toBe(1);
    expect(r1.note.tags).toEqual([canvasContentTag('b')]);

    const r2 = await saveCanvasContent(deps as any, index, 'b', { layout: { n1: { x: 2, y: 2 } } });
    expect(r2.note.version).toBe(2);
    // SAME note (one per canvas), not a second one
    expect(r2.note.noteId).toBe(r1.note.noteId);
    expect(index.all().filter((e) => e.note.tags.includes(canvasContentTag('b')))).toHaveLength(1);
  });
});

describe('saveCanvasContent — shared-board migration (KTD4)', () => {
  it('pre-migration loads legacy, post-migration loads canvas:shared AND legacy note is gone', async () => {
    const layout = { 'note-1': { x: 10, y: 20 }, 'note-2': { x: 30, y: 40 } };
    const legacy = legacyLayoutNote(layout);
    const index = VaultIndex.fromEntries([entry(legacy)]);

    // pre-migration: shared reads the legacy layout
    expect(loadCanvasContent(index, 'shared')).toEqual({ layout, drawings: [] });

    const { migrationTx } = await saveCanvasContent(deps as any, index, 'shared', {
      drawings: [{ id: 's1', kind: 'rect', x: 0, y: 0, w: 5, h: 5 }],
    });

    // the live layout data SURVIVED into anima:canvas:shared
    const after = loadCanvasContent(index, 'shared');
    expect(after.layout).toEqual(layout);
    expect(after.drawings).toEqual([{ id: 's1', kind: 'rect', x: 0, y: 0, w: 5, h: 5 }]);

    // the old anima:canvas-layout note no longer exists in the index (no stale resurrection)
    expect(findLayoutNote(index)).toBeUndefined();
    expect(index.get(legacy.noteId)).toBeUndefined();

    // and the caller is handed a delete tx targeting the legacy blob (seeded at loc(1).blobObjectId === 'o1')
    expect(migrationTx).toBeDefined();
    expect((migrationTx as any).__deleted).toContain('o1');
  });

  it('drawings-only first shared write must NOT drop the live legacy layout', async () => {
    // regression: first save carries no layout — the read base must be the
    // legacy content, not empty, or the live shared-board layout is silently gone
    const layout = { 'live-note': { x: 99, y: 88 } };
    const index = VaultIndex.fromEntries([entry(legacyLayoutNote(layout))]);

    await saveCanvasContent(deps as any, index, 'shared', {
      drawings: [{ id: 'd1', kind: 'draw', pts: [0, 0, 1, 1] }],
    });

    expect(loadCanvasContent(index, 'shared').layout).toEqual(layout);
  });

  it('does not migrate or build a delete tx when no legacy note exists', async () => {
    const index = new VaultIndex();
    const { migrationTx } = await saveCanvasContent(deps as any, index, 'shared', { layout: { n: { x: 0, y: 0 } } });
    expect(migrationTx).toBeUndefined();
    expect(deps.suiClient.walrus.deleteBlobTransaction).not.toHaveBeenCalled();
  });

  it('does not re-migrate on the second shared write', async () => {
    const index = VaultIndex.fromEntries([entry(legacyLayoutNote({ n: { x: 1, y: 1 } }))]);
    await saveCanvasContent(deps as any, index, 'shared', { layout: { n: { x: 1, y: 1 } } });
    deps.suiClient.walrus.deleteBlobTransaction.mockClear();

    const { migrationTx } = await saveCanvasContent(deps as any, index, 'shared', { drawings: [] });
    expect(migrationTx).toBeUndefined();
    expect(deps.suiClient.walrus.deleteBlobTransaction).not.toHaveBeenCalled();
  });
});

describe('saveCanvasContent — read-modify-write (KTD2)', () => {
  it('a layout-only save does not clobber existing drawings', async () => {
    // seed a content note that already holds drawings (a prior drawings write)
    const prior: CanvasContent = {
      layout: { old: { x: 1, y: 1 } },
      drawings: [{ id: 'd1', kind: 'draw', pts: [0, 0, 5, 5] }],
    };
    const note = newNote({ title: 'Canvas b', body: JSON.stringify(prior), author: 'anima', tags: [canvasContentTag('b')] });
    const index = VaultIndex.fromEntries([entry(note)]);

    // a layout-only save arrives (simulating a concurrent layout change)
    const newLayout: CanvasLayout = { fresh: { x: 9, y: 9 } };
    await saveCanvasContent(deps as any, index, 'b', { layout: newLayout });

    const after = loadCanvasContent(index, 'b');
    expect(after.layout).toEqual(newLayout); // layout updated
    expect(after.drawings).toEqual(prior.drawings); // drawings SURVIVED
  });

  it('a drawings-only save does not clobber existing layout', async () => {
    const prior: CanvasContent = { layout: { keep: { x: 7, y: 7 } }, drawings: [] };
    const note = newNote({ title: 'Canvas b', body: JSON.stringify(prior), author: 'anima', tags: [canvasContentTag('b')] });
    const index = VaultIndex.fromEntries([entry(note)]);

    const drawings: Shape[] = [{ id: 'd2', kind: 'text', x: 1, y: 2, text: 'hi' }];
    await saveCanvasContent(deps as any, index, 'b', { drawings });

    const after = loadCanvasContent(index, 'b');
    expect(after.layout).toEqual(prior.layout); // layout SURVIVED
    expect(after.drawings).toEqual(drawings);
  });
});

describe('saveCanvasContent — AE3 drawings round-trip', () => {
  it('placed notes + every shape kind round-trip identically', async () => {
    const index = new VaultIndex();
    const layout: CanvasLayout = { 'placed-1': { x: 100, y: 200 }, 'placed-2': { x: 50, y: 60 } };
    const drawings: Shape[] = [
      { id: 'a', kind: 'draw', pts: [0, 0, 10, 10, 20, 5] },
      { id: 'b', kind: 'rect', x: 1, y: 2, w: 30, h: 40 },
      { id: 'c', kind: 'arrow', x1: 0, y1: 0, x2: 100, y2: 100 },
      { id: 'd', kind: 'text', x: 5, y: 6, text: 'hello board' },
      { id: 'e', kind: 'image', x: 7, y: 8, w: 64, h: 64, ref: 'blob:imgblob123' },
    ];

    await saveCanvasContent(deps as any, index, 'board-ae3', { layout, drawings });
    const loaded = loadCanvasContent(index, 'board-ae3');

    expect(loaded.layout).toEqual(layout);
    expect(loaded.drawings).toEqual(drawings);
  });

  it('no base64 src appears in the stored body — image shapes carry a blob:/seal: ref', async () => {
    const index = new VaultIndex();
    const drawings: Shape[] = [{ id: 'img', kind: 'image', x: 0, y: 0, w: 10, h: 10, ref: 'blob:imgblob' }];
    await saveCanvasContent(deps as any, index, 'b', { drawings });

    const body = index.all().find((e) => e.note.tags.includes(canvasContentTag('b')))!.note.body;
    expect(body).not.toContain('data:image');
    expect(body).not.toContain('base64');
    expect(body).not.toContain('"src"');
    expect(body).toContain('blob:imgblob');
  });
});

describe('R19 — reserved-note filtering', () => {
  it('anima:canvas:<id> and anima:canvas-registry never appear in index.notes()', async () => {
    const userNote = newNote({ title: 'a real memory', body: 'about coffee', author: 'owner', tags: ['prefs'] });
    const registryNote = newNote({ title: 'registry', body: '[]', author: 'anima', tags: ['anima:canvas-registry'] });
    const index = VaultIndex.fromEntries([entry(userNote, 1), entry(registryNote, 2)]);

    await saveCanvasContent(deps as any, index, 'b', { layout: { n: { x: 0, y: 0 } } });

    // the anima: prefix already covers both reserved tags
    expect(isReservedNote(registryNote)).toBe(true);
    const contentNote = index.all().find((e) => e.note.tags.includes(canvasContentTag('b')))!.note;
    expect(isReservedNote(contentNote)).toBe(true);

    const userFacing = index.notes().map((e) => e.note.noteId);
    expect(userFacing).toEqual([userNote.noteId]); // only the real memory
    expect(index.backlinks(userNote.noteId)).toHaveLength(0);
    // reserved notes never surface in recall (search is over notes() only)
    const searchIds = index.search('registry').map((e) => e.note.noteId);
    expect(searchIds).not.toContain(registryNote.noteId);
    expect(searchIds).not.toContain(contentNote.noteId);
  });
});
