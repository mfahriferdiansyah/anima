/**
 * R14 — export the vault as a zip of plain markdown files.
 * File over app: the whole brain leaves as human-readable .md.
 */
import { zipSync, strToU8 } from 'fflate';
import type { IndexedNote } from './types.js';
import { serializeNote } from './notes.js';

export function exportVaultZip(entries: IndexedNote[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const { note } of entries) {
    const safeTitle = note.title.replace(/[^a-zA-Z0-9-_ ]/g, '').slice(0, 40).trim() || 'untitled';
    files[`${safeTitle}-${note.noteId.slice(-6)}.md`] = strToU8(serializeNote(note));
  }
  return zipSync(files, { level: 6 });
}
