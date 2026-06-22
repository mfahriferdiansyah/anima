/**
 * Grouping for the document library: notes and canvases filed into folders.
 * A note's folder is its first tag; a canvas carries its folder directly. The
 * folder order comes from the folders store, with any extra folders an item
 * references (e.g. 'untitled') appended after. Empty ordered folders are kept
 * so the manage modal can show them; the sidebar drops empties itself.
 */
import type { Note } from '@/hooks/useVault';
import type { CanvasDoc } from '@/hooks/useCanvases';

export type LibKind = 'note' | 'canvas';

export interface LibItem {
  kind: LibKind;
  id: string;
  title: string;
  folder: string;
  note?: Note;
  canvas?: CanvasDoc;
}

export interface LibFolder {
  name: string;
  items: LibItem[];
}

/** New/untagged items live in a real, editable "unsorted" inbox; fold the legacy "untitled" key into it. */
function normalizeFolder(folder: string | undefined): string {
  return folder && folder !== 'untitled' ? folder : 'unsorted';
}

export function noteFolder(note: Note): string {
  return normalizeFolder(note.tags[0]);
}

export function buildLibrary(notes: Note[], canvases: CanvasDoc[], order: string[]): LibFolder[] {
  const byFolder = new Map<string, LibItem[]>();
  const ensure = (key: string) => {
    if (!byFolder.has(key)) byFolder.set(key, []);
  };
  for (const key of order) ensure(key);
  for (const canvas of canvases) {
    const cf = normalizeFolder(canvas.folder);
    ensure(cf);
    byFolder.get(cf)!.push({ kind: 'canvas', id: canvas.canvasId, title: canvas.title || 'Untitled canvas', folder: cf, canvas });
  }
  for (const note of notes) {
    const key = noteFolder(note);
    ensure(key);
    byFolder.get(key)!.push({ kind: 'note', id: note.noteId, title: note.title || 'Untitled', folder: key, note });
  }
  const extras = [...byFolder.keys()].filter((k) => !order.includes(k));
  return [...order, ...extras].map((name) => ({ name, items: byFolder.get(name) ?? [] }));
}
