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
import type { CanvasElement } from './elements.js';
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

/**
 * Presence wire format (relayed by the backend hub; never persisted).
 *
 * The first five frames are the always-on canvas presence (cursors, pings). The
 * legacy three (`note-op`/`note-writing`/`canvas-op`) are the plan-008 LWW content
 * ops; `note-op`/`note-writing`/soft-lock are SUPERSEDED by the CRDT path below
 * but kept on the wire for back-compat decoding.
 *
 * The plan-2026-06-24 collaborative-share frames carry the real-time editing model:
 *  - `sync-req`  — "I just joined this room, please send me the current state."
 *  - `y-sync`    — a Yjs sync/awareness binary frame for NOTE co-editing (the CRDT).
 *                  `b` is base64 (the relay protocol is JSON text; Yjs is binary).
 *  - `el-op`     — one full `CanvasElement` for BOARD co-editing; applied through
 *                  the version+nonce reconcile core. `el` is sanitized before it
 *                  touches the DOM (see `web3/collabOps` `sanitizeElement`).
 *  - `el-chunk`  — a chunk of a large board resync snapshot (`gen`-tagged so two
 *                  snapshot generations never interleave; `seq`/`total` order them).
 *  - `el-need`   — a selective re-request for missing chunk seqs of one `gen`.
 *
 * All of these flow only while a share is active and are relayed opaquely; the
 * relay holds nothing. Binary payloads ride as base64 inside the JSON frame.
 */
export type PresenceMsg =
  | { t: 'hello'; id: string; label: string; kind: 'human' | 'agent' }
  | { t: 'cursor'; id: string; x: number; y: number }
  | { t: 'writing'; id: string; on: boolean }
  | { t: 'note-created'; id: string; noteId: string }
  | { t: 'bye'; id: string }
  | { t: 'note-op'; id: string; noteId: string; body: string }
  | { t: 'note-writing'; id: string; noteId: string; on: boolean }
  | { t: 'canvas-op'; id: string; canvasId: string; layout: CanvasLayout }
  | { t: 'sync-req'; id: string }
  | { t: 'y-sync'; id: string; b: string }
  | { t: 'el-op'; id: string; canvasId: string; el: CanvasElement }
  | { t: 'el-chunk'; id: string; canvasId: string; gen: string; seq: number; total: number; b: string }
  | { t: 'el-need'; id: string; canvasId: string; gen: string; seqs: number[] };
