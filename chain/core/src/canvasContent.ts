/**
 * Per-canvas durable content: the multi-canvas data spine (plan 007 U1).
 *
 * Each canvas owns ONE reserved note (tag `anima:canvas:<id>`, body = JSON
 * `{layout, drawings}`): the same custody as every memory, and it resurrects, so
 * a board wakes with its constellation AND its drawn shapes intact.
 *
 * This lives in `chain/core` (NOT `frontend/web3`) so the MCP can import it:
 * Nova, the frontend, and external agents share one write path for `place_note`
 * (KTD3). Reserved `anima:*` notes are filtered out of recall/library by
 * `isReservedNote`, so canvas content never leaks into answers or the notes list
 * (R19).
 *
 * The legacy `shared` board reads `anima:canvas-layout` until its first write,
 * which migrates it to `anima:canvas:shared` AND deletes the old note so a later
 * `findLayoutNote` cannot resurrect stale layout (KTD4). The delete is wallet-
 * signed (the wallet owns the blob), so this module BUILDS the delete tx and the
 * caller executes it with its own wallet seam, mirroring `forgetNotes` in
 * `useVault.ts` (core builds, caller signs).
 */
import { Transaction } from '@mysten/sui/transactions';
import type { Note, IndexedNote } from './types.js';
import { newNote, editedNote } from './notes.js';
import { writeTurn, buildDeleteQuiltsTx, type QuiltDeps } from './quilts.js';
import { VaultIndex } from './vaultIndex.js';
import { LAYOUT_TAG, type CanvasLayout, findLayoutNote } from './canvas.js';
import {
  type CanvasElement,
  elementsFromLegacy,
  layoutFromElements,
  mergeLayoutIntoElements,
} from './elements.js';

/** The legacy single-board layout note (read-aliased for `shared` pre-migration). */
export const SHARED_CANVAS_ID = 'shared';

/** Reserved tag for a canvas's content note. */
export function canvasContentTag(canvasId: string): string {
  return `anima:canvas:${canvasId}`;
}

/**
 * A drawn shape, in its SERIALIZABLE form: plain JSON only (no DOM references).
 * This is the canonical `Shape` type: `pages/Canvas.tsx` imports it from here
 * (core never imports frontend types). The `image` variant carries a `ref`
 * (`blob:`/`seal:`) NOT a base64 `src`: a single pasted data URL blows the
 * one-note quilt-size bound, so image payloads upload as a separate blob (see
 * KTD2) and the shape stores only the ref.
 */
export type Shape =
  | { id: string; kind: 'draw'; pts: number[] }
  | { id: string; kind: 'rect'; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'arrow'; x1: number; y1: number; x2: number; y2: number }
  | { id: string; kind: 'text'; x: number; y: number; text: string }
  | { id: string; kind: 'image'; x: number; y: number; w: number; h: number; ref: string };

/**
 * A canvas's durable content. `elements` is the unified Excalidraw-style model and
 * the source of truth once present (plan 2026-06-22 U5); `layout` + `drawings` are
 * the legacy split kept for back-compat and migrate-on-read. When `elements` is
 * written, `layout` is re-derived as a mirror so the MCP `place()` writer and any
 * layout reader keep working; the destructive removal of layout/drawings is a
 * later, user-verified step.
 */
export interface CanvasContent {
  layout: CanvasLayout;
  drawings: Shape[];
  /** The unified element model; absent on legacy boards (migrated on read). */
  elements?: CanvasElement[];
}

/** A FRESH empty content (a new object each call, since consumers mutate it as React state). */
function emptyContent(): CanvasContent {
  return { layout: {}, drawings: [] };
}

/** The `anima:canvas:<id>` content note, if it exists yet. */
function findContentNote(index: VaultIndex, canvasId: string): IndexedNote | undefined {
  const tag = canvasContentTag(canvasId);
  return index.all().find((e) => e.note.tags.includes(tag));
}

/** Coerce a parsed body into a complete `CanvasContent` (tolerates partial bodies). */
function asContent(parsed: unknown): CanvasContent {
  const p = (parsed ?? {}) as Partial<CanvasContent>;
  return {
    layout: p.layout ?? {},
    drawings: Array.isArray(p.drawings) ? p.drawings : [],
    // Preserve undefined-vs-empty: a board saved with the element model has an
    // `elements` field (possibly []); a legacy board has none (migrated on read).
    elements: Array.isArray(p.elements) ? p.elements : undefined,
  };
}

/**
 * Read a canvas's content. Returns `{layout:{}, drawings:[]}` for a canvas with
 * no content (never throws). For `shared` pre-migration (no `anima:canvas:shared`
 * yet) it FALLS BACK to the legacy `anima:canvas-layout` note (its layout, no
 * drawings) so the live single-board layout survives until the first write.
 */
export function loadCanvasContent(index: VaultIndex, canvasId: string): CanvasContent {
  const raw = readRawContent(index, canvasId);
  // Always expose a populated `elements` list (U5). If the board already uses the
  // model, fold in any layout noteIds the MCP wrote since (so a freshly placed note
  // shows up); otherwise migrate-on-read from the legacy {layout, drawings}.
  const elements =
    raw.elements !== undefined
      ? mergeLayoutIntoElements(raw.elements, raw.layout)
      : elementsFromLegacy(raw.layout, raw.drawings);
  return { ...raw, elements };
}

/** The stored content as written (no element migration); `elements` may be undefined. */
function readRawContent(index: VaultIndex, canvasId: string): CanvasContent {
  const entry = findContentNote(index, canvasId);
  if (entry) {
    try {
      return asContent(JSON.parse(entry.note.body));
    } catch {
      return emptyContent();
    }
  }
  // legacy shared-board read-alias (pre-migration): {layout}, no drawings
  if (canvasId === SHARED_CANVAS_ID) {
    const legacy = findLayoutNote(index);
    if (legacy) {
      try {
        return { layout: JSON.parse(legacy.note.body), drawings: [] };
      } catch {
        return emptyContent();
      }
    }
  }
  return emptyContent();
}

/**
 * Persist a PARTIAL update to a canvas's content note: read-modify-write so a
 * drawings-only save never clobbers a concurrent layout change (KTD2). Three
 * writers share this note (MCP `place()`, the layout saver, the drawings saver),
 * so we read the current content, merge ONLY the provided field(s), then write
 * (mint v1 via `newNote`, or `editedNote`-bump). Mirrors `saveLayout`'s
 * `writeTurn` + `index.upsert` shape.
 *
 * On the FIRST `saveCanvasContent('shared', ...)` we also MIGRATE: the read base
 * is the legacy `anima:canvas-layout` content (via `loadCanvasContent`, which
 * read-aliases it), and we build a delete tx for the old note + drop it from the
 * live index so `findLayoutNote` can't resurrect stale layout. The delete is
 * wallet-signed, so we return `migrationTx` for the caller to execute: the
 * on-chain delete is REQUIRED, not best-effort (an un-deleted legacy blob would
 * re-index on resurrection and return stale layout again).
 */
export async function saveCanvasContent(
  deps: QuiltDeps,
  index: VaultIndex,
  canvasId: string,
  partial: Partial<CanvasContent>,
  author = 'anima',
): Promise<{ note: Note; migrationTx?: Transaction; blobObjectId: string }> {
  const existing = findContentNote(index, canvasId);

  // read base: the RAW stored content (no element migration), so `base.elements`
  // reflects what is actually persisted — undefined for a legacy/new board, which
  // keeps it legacy until an explicit elements save. For `shared` pre-migration
  // this still read-aliases the legacy layout (handled in readRawContent), so a
  // drawings-only first shared write keeps the live layout instead of dropping it.
  const base = readRawContent(index, canvasId);

  // merge ONLY the provided fields over the base
  const merged: CanvasContent = {
    layout: partial.layout ?? base.layout,
    drawings: partial.drawings ?? base.drawings,
  };
  if (partial.elements !== undefined) {
    // Frontend full-scene save: `elements` is the source of truth. Re-derive the
    // `layout` mirror so MCP place() / layout readers still see note positions.
    // Legacy `drawings` are left untouched (non-destructive; ignored on read).
    merged.elements = partial.elements;
    merged.layout = layoutFromElements(partial.elements);
  } else if (base.elements !== undefined) {
    // A layout-only / drawings-only write (MCP place(), the legacy layout saver) on
    // a board that already uses the model: fold any new layout noteIds into the
    // element list so a placed note renders as a note element on the next read.
    merged.elements = mergeLayoutIntoElements(base.elements, merged.layout);
  }

  const body = JSON.stringify(merged);
  const note = existing
    ? editedNote(existing.note, { body }, author)
    : newNote({ title: `Canvas ${canvasId}`, body, author, tags: [canvasContentTag(canvasId)] });

  const result = await writeTurn(deps, [note]);
  index.upsert(note, {
    quiltPatchId: result.perNote[0].quiltPatchId,
    quiltBlobId: result.quiltBlobId,
    blobObjectId: result.blobObjectId,
  });

  // shared-board migration: whenever a legacy `anima:canvas-layout` note still
  // exists (not just the first write), so it self-heals across BOTH writers. If
  // an external agent (MCP) creates `anima:canvas:shared` first, the agent key
  // cannot sign the wallet-owned delete and drops the tx; the owner's frontend
  // then still gets a migrationTx on its next shared write (the `!existing` gate
  // would have skipped it, orphaning the legacy blob). Drop it from the live
  // index now (so an in-session findLayoutNote is empty) and hand the caller a
  // delete tx; once the legacy is gone, later writes find nothing to migrate.
  let migrationTx: Transaction | undefined;
  if (canvasId === SHARED_CANVAS_ID) {
    const legacy = findLayoutNote(index);
    if (legacy && legacy.note.tags.includes(LAYOUT_TAG)) {
      index.remove(legacy.note.noteId);
      migrationTx = await buildDeleteQuiltsTx(deps, [legacy.location.blobObjectId]);
    }
  }

  return { note, migrationTx, blobObjectId: result.blobObjectId };
}
