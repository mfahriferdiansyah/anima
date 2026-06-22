import { describe, it, expect } from 'vitest';
import type { Shape } from '../canvasContent.js';
import type { CanvasLayout } from '../canvas.js';
import type { CanvasElement, LinearElement } from '../elements.js';
import {
  elementsFromLegacy,
  layoutFromElements,
  mergeLayoutIntoElements,
  normalizeLinear,
  bumpVersion,
  NOTE_W,
  NOTE_H,
} from '../elements.js';

describe('elementsFromLegacy (migrate-on-read)', () => {
  const drawings: Shape[] = [
    { id: 's1', kind: 'rect', x: 10, y: 20, w: 30, h: 40 },
    { id: 's2', kind: 'arrow', x1: 100, y1: 100, x2: 160, y2: 140 },
    { id: 's3', kind: 'draw', pts: [5, 5, 15, 25] },
    { id: 's4', kind: 'text', x: 0, y: 0, text: 'hi' },
    { id: 's5', kind: 'image', x: 1, y: 2, w: 50, h: 60, ref: 'blob:abc' },
  ];
  const layout: CanvasLayout = { noteA: { x: 200, y: 200 }, noteB: { x: 300, y: 320 } };

  it('maps every drawing and every layout note into one element list', () => {
    const els = elementsFromLegacy(layout, drawings);
    expect(els).toHaveLength(7);
    const byType = els.reduce<Record<string, number>>((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {});
    expect(byType).toEqual({ rect: 1, arrow: 1, draw: 1, text: 1, image: 1, note: 2 });
  });

  it('places notes from layout as note elements at the default card size', () => {
    const els = elementsFromLegacy(layout, drawings);
    const noteA = els.find((e) => e.type === 'note' && e.noteId === 'noteA') as Extract<CanvasElement, { type: 'note' }>;
    expect(noteA).toBeTruthy();
    expect({ x: noteA.x, y: noteA.y, w: noteA.w, h: noteA.h }).toEqual({ x: 200, y: 200, w: NOTE_W, h: NOTE_H });
  });

  it('converts an arrow into a normalized relative-point linear element', () => {
    const els = elementsFromLegacy({}, [{ id: 's2', kind: 'arrow', x1: 100, y1: 100, x2: 160, y2: 140 }]);
    const arrow = els[0] as Extract<CanvasElement, { type: 'arrow' }>;
    expect(arrow.points[0]).toBe(0);
    expect(arrow.points[1]).toBe(0); // first point re-anchored to [0,0]
    expect({ x: arrow.x, y: arrow.y, w: arrow.w, h: arrow.h }).toEqual({ x: 100, y: 100, w: 60, h: 40 });
  });
});

describe('layoutFromElements (derived mirror)', () => {
  it('derives the layout map from note elements only', () => {
    const els: CanvasElement[] = [
      { id: 'n', type: 'note', noteId: 'noteA', x: 5, y: 6, w: NOTE_W, h: NOTE_H, angle: 0, index: 0, version: 1, versionNonce: 1 },
      { id: 'r', type: 'rect', x: 0, y: 0, w: 10, h: 10, angle: 0, index: 1, version: 1, versionNonce: 1 },
    ];
    expect(layoutFromElements(els)).toEqual({ noteA: { x: 5, y: 6 } });
  });

  it('omits a tombstoned note from the mirror', () => {
    const els: CanvasElement[] = [
      { id: 'n', type: 'note', noteId: 'gone', x: 5, y: 6, w: NOTE_W, h: NOTE_H, angle: 0, index: 0, version: 2, versionNonce: 1, isDeleted: true },
    ];
    expect(layoutFromElements(els)).toEqual({});
  });
});

describe('mergeLayoutIntoElements (MCP wrote layout after elements were saved)', () => {
  it('adds layout noteIds missing from elements, keeps the existing note authoritative', () => {
    const els: CanvasElement[] = [
      { id: 'n', type: 'note', noteId: 'existing', x: 5, y: 6, w: NOTE_W, h: NOTE_H, angle: 0, index: 0, version: 3, versionNonce: 1 },
    ];
    const merged = mergeLayoutIntoElements(els, { existing: { x: 999, y: 999 }, fresh: { x: 40, y: 50 } });
    expect(merged).toHaveLength(2);
    const existing = merged.find((e) => e.type === 'note' && e.noteId === 'existing') as Extract<CanvasElement, { type: 'note' }>;
    expect({ x: existing.x, y: existing.y }).toEqual({ x: 5, y: 6 }); // element position wins, not the layout's 999
    const fresh = merged.find((e) => e.type === 'note' && e.noteId === 'fresh');
    expect(fresh).toBeTruthy();
  });
});

describe('normalizeLinear', () => {
  it('re-anchors points so the first is [0,0] and the box matches the bounds', () => {
    const el: LinearElement = { id: 'a', type: 'arrow', x: 10, y: 10, w: 0, h: 0, angle: 0, index: 0, version: 1, versionNonce: 1, points: [5, 5, 25, 35] };
    const out = normalizeLinear(el);
    expect(out.points).toEqual([0, 0, 20, 30]);
    expect({ x: out.x, y: out.y, w: out.w, h: out.h }).toEqual({ x: 15, y: 15, w: 20, h: 30 });
  });
});

describe('bumpVersion', () => {
  it('increments version and sets the provided nonce without mutating the input', () => {
    const el: CanvasElement = { id: 'r', type: 'rect', x: 0, y: 0, w: 1, h: 1, angle: 0, index: 0, version: 4, versionNonce: 7 };
    const out = bumpVersion(el, 123);
    expect({ version: out.version, versionNonce: out.versionNonce }).toEqual({ version: 5, versionNonce: 123 });
    expect(el.version).toBe(4); // unchanged
  });
});
