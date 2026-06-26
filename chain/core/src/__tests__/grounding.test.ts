/**
 * Unit tests for grounding.ts: the canvas serializer (U4) and the grounding
 * bundle builder + safety ceiling (U5). Pure over an in-memory VaultIndex.
 */
import { describe, it, expect } from 'vitest';
import { serializeCanvas, buildGrounding } from '../grounding.js';
import { canvasContentTag } from '../canvasContent.js';
import type { CanvasElement } from '../elements.js';
import { VaultIndex } from '../vaultIndex.js';
import { newNote } from '../notes.js';
import type { IndexedNote, Note } from '../types.js';

const loc = (i: number) => ({ quiltPatchId: `p${i}`, quiltBlobId: `b${i}`, blobObjectId: `o${i}` });
const entry = (note: Note, i = 1): IndexedNote => ({ note, location: loc(i) });

function userNote(title: string, body: string, tags: string[] = []): Note {
  return newNote({ title, body, author: 'owner', tags });
}

/** A canvas content note (reserved) carrying an elements list. */
function canvasNote(canvasId: string, elements: CanvasElement[]): Note {
  return newNote({
    title: `Canvas ${canvasId}`,
    body: JSON.stringify({ layout: {}, drawings: [], elements }),
    author: 'anima',
    tags: [canvasContentTag(canvasId)],
  });
}

function base(id: string, over: Partial<CanvasElement> = {}): any {
  return { id, x: 0, y: 0, w: 10, h: 10, angle: 0, index: 0, version: 1, versionNonce: 1, ...over };
}

describe('serializeCanvas (U4)', () => {
  it('serializes placed notes, text, labels, and arrow relationships', () => {
    const n1 = userNote('Lisbon trip', 'Flights booked for July.');
    const n2 = userNote('Packing list', 'Passport, chargers.');
    const elements: CanvasElement[] = [
      { ...base('e1'), type: 'note', noteId: n1.noteId },
      { ...base('e2'), type: 'note', noteId: n2.noteId },
      { ...base('e3'), type: 'text', text: 'Trip plan' },
      { ...base('e4'), type: 'arrow', points: [0, 0, 1, 1], startBinding: { elementId: 'e1', fixedPoint: [0, 0] }, endBinding: { elementId: 'e2', fixedPoint: [0, 0] } },
    ];
    const index = VaultIndex.fromEntries([entry(n1), entry(n2), entry(canvasNote('board1', elements))]);

    const out = serializeCanvas(index, 'board1');
    expect(out).toContain('Lisbon trip');
    expect(out).toContain('Flights booked for July.');
    expect(out).toContain('Trip plan');
    expect(out).toContain('"Lisbon trip" relates to "Packing list"');
  });

  it('excludes image refs and draw strokes', () => {
    const elements: CanvasElement[] = [
      { ...base('img'), type: 'image', ref: 'seal:secret-blob-id' },
      { ...base('d'), type: 'draw', points: [0, 0, 5, 5] },
      { ...base('t'), type: 'text', text: 'visible' },
    ];
    const index = VaultIndex.fromEntries([entry(canvasNote('b', elements))]);
    const out = serializeCanvas(index, 'b');
    expect(out).not.toContain('seal:secret-blob-id');
    expect(out).toContain('visible');
  });

  it('drops a dangling arrow whose endpoint is missing/unlabeled', () => {
    const n1 = userNote('Real note', 'body');
    const elements: CanvasElement[] = [
      { ...base('e1'), type: 'note', noteId: n1.noteId },
      // arrow to a bare unlabeled rect (not included) → must not serialize
      { ...base('e2'), type: 'rect' },
      { ...base('e3'), type: 'arrow', points: [0, 0, 1, 1], startBinding: { elementId: 'e1', fixedPoint: [0, 0] }, endBinding: { elementId: 'e2', fixedPoint: [0, 0] } },
    ];
    const index = VaultIndex.fromEntries([entry(n1), entry(canvasNote('b', elements))]);
    const out = serializeCanvas(index, 'b');
    expect(out).not.toContain('relates to');
  });

  it('returns empty string for an empty board', () => {
    const index = VaultIndex.fromEntries([entry(canvasNote('b', []))]);
    expect(serializeCanvas(index, 'b')).toBe('');
  });

  it('reserved canvas notes never leak into recall (R19)', () => {
    const n1 = userNote('Lisbon trip', 'Flights booked.');
    const elements: CanvasElement[] = [{ ...base('e1'), type: 'note', noteId: n1.noteId }];
    const index = VaultIndex.fromEntries([entry(n1), entry(canvasNote('board1', elements))]);
    serializeCanvas(index, 'board1');
    // the canvas content note must not surface via search()/notes()
    expect(index.notes().some((e) => e.note.tags.some((t) => t.startsWith('anima:')))).toBe(false);
    expect(index.search('canvas', 10).some((e) => e.note.tags.includes(canvasContentTag('board1')))).toBe(false);
  });
});

describe('buildGrounding (U5)', () => {
  function vaultWith(n: number): VaultIndex {
    const entries: IndexedNote[] = [];
    for (let i = 0; i < n; i++) entries.push(entry(userNote(`Lisbon note ${i}`, `Lisbon detail ${i}`), i));
    return VaultIndex.fromEntries(entries);
  }

  it('widens the candidate set well past the old top-6', () => {
    const g = buildGrounding({ index: vaultWith(10), query: 'lisbon' });
    expect(g.context.length).toBeGreaterThan(6);
    expect(g.trimmed).toBe(0);
  });

  it('includes the relevant canvas and calendar, nothing dropped in the normal case', () => {
    const n1 = userNote('Lisbon trip', 'Flights booked.');
    const elements: CanvasElement[] = [{ ...base('e1'), type: 'note', noteId: n1.noteId }];
    const index = VaultIndex.fromEntries([entry(n1), entry(canvasNote('board1', elements))]);
    const g = buildGrounding({
      index,
      query: 'lisbon',
      canvases: [{ id: 'board1', title: 'Trips' }],
      calendar: [{ title: 'Lisbon call', start: '2026-07-01T10:00:00Z', end: '2026-07-01T11:00:00Z' }],
    });
    expect(g.canvas.find((c) => c.title === 'Trips')).toBeTruthy();
    expect(g.calendar).toHaveLength(1);
    expect(g.trimmed).toBe(0);
  });

  it('drops least-relevant notes above the ceiling, keeps canvas, adds a marker, deterministically (AE1)', () => {
    const n1 = userNote('Lisbon trip', 'Flights booked.');
    const elements: CanvasElement[] = [{ ...base('e1'), type: 'note', noteId: n1.noteId }];
    const index = VaultIndex.fromEntries([
      entry(n1, 0),
      entry(canvasNote('board1', elements), 1),
      ...Array.from({ length: 8 }, (_, i) => entry(userNote(`Lisbon note ${i}`, 'Lisbon '.repeat(40)), i + 2)),
    ]);
    const input = { index, query: 'lisbon', canvases: [{ id: 'board1', title: 'Trips' }] };
    const opts = { charCeiling: 600 };

    const g1 = buildGrounding(input, opts);
    const g2 = buildGrounding(input, opts);
    expect(g1.trimmed).toBeGreaterThan(0);
    expect(g1.context.length).toBeGreaterThan(0); // never zero when notes exist
    expect(g1.canvas.find((c) => c.title === 'Trips')).toBeTruthy(); // canvas never dropped
    expect(g1.canvas.find((c) => c.title === 'grounding status')).toBeTruthy(); // completeness marker
    expect(g1.context.map((c) => c.noteId)).toEqual(g2.context.map((c) => c.noteId)); // deterministic
  });
});
