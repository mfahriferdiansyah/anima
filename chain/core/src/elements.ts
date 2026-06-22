/**
 * The unified canvas ELEMENT model (plan 2026-06-22 U1/U5).
 *
 * One serializable element list per board replaces the split `Shape[]` drawings
 * plus `layout` note-placement map. A note is a first-class element here (a
 * positioned reference, `type: 'note'`), beside vector shapes, text and images —
 * so selection, drag and transform are built once over a single model. This lives
 * in `chain/core` (NOT `frontend`) so the per-board content note (canvasContent)
 * and the MCP can serialize it, mirroring how `Shape` lives here.
 *
 * Coordinate conventions (ported from Excalidraw, see the 2026-06-22 research):
 * - Every element has an axis-aligned `x,y` (top-left of its local box), `w,h`
 *   and `angle` (radians, [0, 2π)). Rendering rotates about the box centre.
 * - LINEAR elements (`arrow`, `line`, `draw`) additionally carry `points`: a flat
 *   `[x0,y0,x1,y1,…]` list RELATIVE to `x,y`, first point always `[0,0]`. Storing
 *   absolute coordinates is a bug (the element could not translate as a unit).
 * - `index` is a numeric z-order (ascending = front). Simple integer for now; a
 *   fractional-index scheme can replace it later without changing the type.
 * - `version` + `versionNonce` drive deterministic multiplayer reconciliation
 *   (higher version wins; tie → LOWER nonce wins — NOT a timestamp). `isDeleted`
 *   is a tombstone so a delete is not resurrected by a stale concurrent edit.
 */
import type { Shape } from './canvasContent.js';
import type { CanvasLayout } from './canvas.js';

/** A linear element's binding to another element (arrow tip attached to a shape/note). */
export interface ElementBinding {
  /** The target element's id. */
  elementId: string;
  /** Attachment point on the target, normalized to [0,1] of its bounds ([0,0]=top-left). */
  fixedPoint: [number, number];
}

/** Fields shared by every element. */
export interface ElementBase {
  id: string;
  /** Local box top-left (world coordinates). */
  x: number;
  y: number;
  /** Local box size. For linear elements this is the bounds of `points`. */
  w: number;
  h: number;
  /** Rotation in radians about the box centre, normalized to [0, 2π). */
  angle: number;
  /** Z-order; ascending renders in front. */
  index: number;
  /** Edit counter; increments on every change. Drives reconciliation. */
  version: number;
  /** Random integer reset on every version bump; tie-breaker for equal versions. */
  versionNonce: number;
  /** Tombstone — a deleted element is kept (not removed) so collab does not resurrect it. */
  isDeleted?: boolean;
}

/** Default rendered size of a placed note card (kept in one place for migration + placement). */
export const NOTE_W = 190;
export const NOTE_H = 88;

/** The serializable element union. A note is just another element (opens its note on click). */
export type CanvasElement =
  | (ElementBase & { type: 'note'; noteId: string })
  | (ElementBase & { type: 'rect' })
  | (ElementBase & { type: 'ellipse' })
  | (ElementBase & { type: 'text'; text: string })
  | (ElementBase & { type: 'image'; ref: string })
  | (ElementBase & { type: 'draw'; points: number[] })
  | (ElementBase & { type: 'arrow'; points: number[]; startBinding?: ElementBinding; endBinding?: ElementBinding })
  | (ElementBase & { type: 'line'; points: number[]; startBinding?: ElementBinding; endBinding?: ElementBinding });

/** Element kinds whose geometry is a `points` polyline relative to `x,y`. */
export type LinearElement = Extract<CanvasElement, { points: number[] }>;

export function isLinear(el: CanvasElement): el is LinearElement {
  return el.type === 'arrow' || el.type === 'line' || el.type === 'draw';
}

export function isBindable(el: CanvasElement): boolean {
  // An arrow tip can bind to a shape, note, text or image — not to another linear element.
  return el.type === 'rect' || el.type === 'ellipse' || el.type === 'note' || el.type === 'text' || el.type === 'image';
}

let idSeq = 0;
/** A process-unique element id. Not cryptographic; ids only need to be unique within a board. */
export function newElementId(): string {
  idSeq += 1;
  return `el-${idSeq.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** A fresh random version nonce. */
export function newVersionNonce(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/**
 * Return a NEW element with its version bumped and a fresh nonce — call on every
 * edit so the change wins reconciliation against the pre-edit copy. Pure (returns
 * a copy; never mutates). The nonce can be injected for deterministic tests.
 */
export function bumpVersion<T extends CanvasElement>(el: T, nonce: number = newVersionNonce()): T {
  return { ...el, version: el.version + 1, versionNonce: nonce };
}

/** Axis-aligned bounds (ignoring rotation) of a single element. */
export function elementBounds(el: CanvasElement): { minX: number; minY: number; maxX: number; maxY: number } {
  return { minX: el.x, minY: el.y, maxX: el.x + el.w, maxY: el.y + el.h };
}

/** The union bounds of several elements (for a multi-selection box). Empty → a zero box. */
export function commonBounds(els: CanvasElement[]): { x: number; y: number; w: number; h: number } {
  if (els.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of els) {
    const b = elementBounds(el);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** The bounding box of a relative `points` polyline, as an absolute box offset by (x,y). */
function pointsBounds(points: number[]): { dx: number; dy: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const px = points[i];
    const py = points[i + 1];
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  if (!isFinite(minX)) return { dx: 0, dy: 0, w: 0, h: 0 };
  return { dx: minX, dy: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Normalize a linear element so its first point is `[0,0]` and `x,y,w,h` reflect
 * the polyline bounds. Endpoint edits can leave `points` with a non-zero min or a
 * stale box; this re-anchors them. Pure.
 */
export function normalizeLinear<T extends LinearElement>(el: T): T {
  const { dx, dy, w, h } = pointsBounds(el.points);
  if (dx === 0 && dy === 0) return { ...el, w, h };
  const shifted: number[] = [];
  for (let i = 0; i < el.points.length; i += 2) {
    shifted.push(el.points[i] - dx, el.points[i + 1] - dy);
  }
  return { ...el, x: el.x + dx, y: el.y + dy, w, h, points: shifted };
}

// ── Legacy {layout, drawings} ⇄ elements migration (U5, non-destructive) ────────

function baseFrom(index: number, x: number, y: number, w: number, h: number): ElementBase {
  return { id: newElementId(), x, y, w, h, angle: 0, index, version: 1, versionNonce: newVersionNonce() };
}

/** Map one legacy `Shape` to a `CanvasElement`. Linear shapes become relative-point lines. */
function elementFromShape(shape: Shape, index: number): CanvasElement {
  switch (shape.kind) {
    case 'rect': {
      const s = shape;
      return { ...baseFrom(index, s.x, s.y, s.w, s.h), type: 'rect' };
    }
    case 'text': {
      const s = shape;
      return { ...baseFrom(index, s.x, s.y, 0, 0), type: 'text', text: s.text };
    }
    case 'image': {
      const s = shape;
      return { ...baseFrom(index, s.x, s.y, s.w, s.h), type: 'image', ref: s.ref };
    }
    case 'arrow': {
      const s = shape;
      const el: CanvasElement = {
        ...baseFrom(index, s.x1, s.y1, Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1)),
        type: 'arrow',
        points: [0, 0, s.x2 - s.x1, s.y2 - s.y1],
      };
      return normalizeLinear(el as LinearElement);
    }
    case 'draw':
    default: {
      const s = shape as Extract<Shape, { kind: 'draw' }>;
      const pts = s.pts;
      const { dx, dy } = pointsBounds(pts);
      const rel: number[] = [];
      for (let i = 0; i < pts.length; i += 2) rel.push(pts[i] - dx, pts[i + 1] - dy);
      const el: CanvasElement = { ...baseFrom(index, dx, dy, 0, 0), type: 'draw', points: rel };
      return normalizeLinear(el as LinearElement);
    }
  }
}

/**
 * Build an `elements` list from the legacy `{layout, drawings}` content
 * (migrate-on-read, non-destructive — the legacy fields are left untouched).
 * Notes come from `layout` (as note elements at the default card size), shapes
 * from `drawings`. Pure.
 */
export function elementsFromLegacy(layout: CanvasLayout, drawings: Shape[]): CanvasElement[] {
  const out: CanvasElement[] = [];
  let index = 0;
  for (const shape of drawings) out.push(elementFromShape(shape, index++));
  for (const [noteId, pos] of Object.entries(layout)) {
    out.push({ ...baseFrom(index++, pos.x, pos.y, NOTE_W, NOTE_H), type: 'note', noteId });
  }
  return out;
}

/**
 * Derive the `layout` mirror (noteId → position) from an elements list, so the
 * MCP `place()` writer and any layout reader keep working while `elements` is the
 * source of truth. Only note elements contribute. Pure.
 */
export function layoutFromElements(elements: CanvasElement[]): CanvasLayout {
  const layout: CanvasLayout = {};
  for (const el of elements) {
    if (el.type === 'note' && !el.isDeleted) layout[el.noteId] = { x: el.x, y: el.y };
  }
  return layout;
}

/**
 * Merge any `layout` noteIds that are NOT yet represented as note elements into
 * the elements list (e.g. the MCP wrote `{layout}` after `elements` was last
 * saved). Existing note elements win (their position/size is authoritative).
 * Returns a new list; pure.
 */
export function mergeLayoutIntoElements(elements: CanvasElement[], layout: CanvasLayout): CanvasElement[] {
  const present = new Set<string>();
  for (const el of elements) if (el.type === 'note') present.add(el.noteId);
  const merged = elements.slice();
  let index = elements.reduce((m, e) => Math.max(m, e.index), -1) + 1;
  for (const [noteId, pos] of Object.entries(layout)) {
    if (present.has(noteId)) continue;
    merged.push({ ...baseFrom(index++, pos.x, pos.y, NOTE_W, NOTE_H), type: 'note', noteId });
  }
  return merged;
}
