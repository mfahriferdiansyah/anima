/**
 * Canvas layout + incremental sync — the multiplayer-canvas data spine.
 *
 * Layout is DURABLE and lives as a reserved note (tag `anima:canvas-layout`,
 * body = JSON {noteId: {x, y}}) — same custody as every memory, and it
 * resurrects: echo wakes with the constellation intact.
 *
 * Presence (cursors, pings) is EPHEMERAL and never touches the chain — see
 * the backend WS relay. This module only handles durable state + freshness.
 */
import type { Note, IndexedNote } from './types.js';
import { newNote, editedNote } from './notes.js';
import { writeTurn, listVaultQuilts, readAll, type QuiltDeps } from './quilts.js';
import { VaultIndex } from './vaultIndex.js';

export const LAYOUT_TAG = 'anima:canvas-layout';
export type CanvasLayout = Record<string, { x: number; y: number }>;

export function findLayoutNote(index: VaultIndex): IndexedNote | undefined {
  return index.all().find((e) => e.note.tags.includes(LAYOUT_TAG));
}

export function loadLayout(index: VaultIndex): CanvasLayout {
  const entry = findLayoutNote(index);
  if (!entry) return {};
  try {
    return JSON.parse(entry.note.body);
  } catch {
    return {};
  }
}

/** Persist the layout as a new version of the reserved note (one quilt write). */
export async function saveLayout(
  deps: QuiltDeps,
  index: VaultIndex,
  layout: CanvasLayout,
  author = 'anima',
): Promise<Note> {
  const existing = findLayoutNote(index);
  const body = JSON.stringify(layout);
  const note = existing
    ? editedNote(existing.note, { body }, author)
    : newNote({ title: 'Canvas layout', body, author, tags: [LAYOUT_TAG] });
  const result = await writeTurn(deps, [note]);
  index.upsert(note, {
    quiltPatchId: result.perNote[0].quiltPatchId,
    quiltBlobId: result.quiltBlobId,
    blobObjectId: result.blobObjectId,
  });
  return note;
}

/**
 * Incremental freshness: read ONLY quilts the index hasn't seen (cheap poll /
 * WS-ping handler). Returns the newly indexed notes (for "materialize" UX).
 */
export async function syncNewQuilts(
  deps: QuiltDeps,
  index: VaultIndex,
): Promise<IndexedNote[]> {
  const known = new Set(index.all().map((e) => e.location.blobObjectId));
  const quilts = await listVaultQuilts(deps);
  const fresh = quilts.filter((id) => !known.has(id));
  if (fresh.length === 0) return [];
  const entries = await readAll(deps, fresh);
  const added: IndexedNote[] = [];
  for (const e of entries) {
    const before = index.get(e.note.noteId)?.note.version ?? 0;
    index.upsert(e.note, e.location);
    if ((index.get(e.note.noteId)?.note.version ?? 0) > before || before === 0) added.push(e);
  }
  return added;
}

/** Presence wire format (relayed by the backend hub; never persisted). */
export type PresenceMsg =
  | { t: 'hello'; id: string; label: string; kind: 'human' | 'agent' }
  | { t: 'cursor'; id: string; x: number; y: number }
  | { t: 'writing'; id: string; on: boolean }
  | { t: 'note-created'; id: string; noteId: string }
  | { t: 'bye'; id: string };
