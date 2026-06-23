/**
 * Build a read-only CANVAS SNAPSHOT for sharing (canvas read-only view).
 *
 * A board references private notes by id only, and its images need the wallet to
 * resolve — neither is reachable from the wallet-free reader. So at publish time
 * (here, with vault access) we DENORMALIZE: bake each note element's title +
 * excerpt + author flag, and carry the element geometry. The snapshot is carried
 * as a NOTE body (marker `anima:'canvas'`) so it rides the existing publish +
 * crypto + reader-decode path unchanged; only the Walrus `app` attribute differs
 * (`kind:'canvas'`). The reader renders it read-only from this JSON alone.
 *
 * This module is PUBLISH-side (frontend, wallet present), so importing the
 * `@mysten`-laden `canvasContent` is fine. The reader must NOT import it — it only
 * imports the `CanvasSnapshot` TYPE (erased) and does its own marker check.
 */
import { newNote } from '../../../chain/core/src/notes.js';
import { loadCanvasContent } from '../../../chain/core/src/canvasContent.js';
import type { CanvasElement } from '../../../chain/core/src/elements.js';
import type { Note } from '../../../chain/core/src/types.js';
import { vaultData } from './vaultData';

/** Baked, render-ready info for one note element (the reader cannot read the vault). */
export interface CanvasSnapshotNoteInfo {
  title: string;
  excerpt: string;
  byAgent: boolean;
}

/** The published canvas snapshot (carried as a note body; `anima:'canvas'` marks it). */
export interface CanvasSnapshot {
  v: 1;
  anima: 'canvas';
  title: string;
  elements: CanvasElement[];
  notes: Record<string, CanvasSnapshotNoteInfo>;
}

/**
 * Flatten a note body into excerpt text. Kept byte-identical to `Canvas.tsx`'s
 * `excerptOf` so a shared board reads exactly like the live one (wiki links →
 * titles, list/heading markers dropped).
 */
function excerptOf(body: string, titles: Map<string, string>): string {
  return body
    .replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => titles.get(id) ?? id)
    .split('\n')
    .map((line) => line.replace(/^[\s\->#]*(\[[ x]\]\s*)?/, '').trim())
    .filter(Boolean)
    .join(' ');
}

/** Build the snapshot for a board from the live vault (null when no vault yet). */
export function buildCanvasSnapshot(canvasId: string, title: string): CanvasSnapshot | null {
  const snap = vaultData.getSnapshot();
  if (!snap.index) return null;
  const content = loadCanvasContent(snap.index, canvasId);
  const titles = new Map(snap.notes.map((n) => [n.noteId, n.title]));
  const notesById = new Map(snap.notes.map((n) => [n.noteId, n]));

  // Carry every live element; drop a tombstone, and strip a heavy inline `data:`
  // image ref (the reader shows a neutral placeholder for images either way).
  const elements: CanvasElement[] = (content.elements ?? [])
    .filter((el) => !el.isDeleted)
    .map((el) => (el.type === 'image' && el.ref.startsWith('data:') ? { ...el, ref: '' } : el));

  const notes: Record<string, CanvasSnapshotNoteInfo> = {};
  for (const el of elements) {
    if (el.type !== 'note') continue;
    const note = notesById.get(el.noteId);
    notes[el.noteId] = {
      title: note?.title || 'Untitled note',
      excerpt: note ? excerptOf(note.body, titles) : '',
      byAgent: note?.author.startsWith('agent') ?? false,
    };
  }
  return { v: 1, anima: 'canvas', title, elements, notes };
}

/** Wrap the snapshot as a synthetic Note (body = snapshot JSON) for `publishNote`. */
export function buildCanvasSnapshotNote(canvasId: string, title: string): Note | null {
  const snapshot = buildCanvasSnapshot(canvasId, title);
  if (!snapshot) return null;
  return newNote({
    noteId: canvasId,
    title: title || 'Shared canvas',
    body: JSON.stringify(snapshot),
    author: 'owner',
    tags: ['anima:canvas-snapshot'],
  });
}
