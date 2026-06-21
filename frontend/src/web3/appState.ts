/**
 * Generic durable app-state (Tier-2 U1) — a named reserved note `anima:<key>`
 * whose body is a JSON value. The same pattern `canvas.ts` uses for the layout
 * note (`anima:canvas-layout`), generalized so folders (U1), the canvas registry
 * (plan 007), and any future client-owned-but-durable state ride the existing
 * agent-signed write path and resurrect from Walrus — no contract change.
 *
 * Reserved notes are filtered out of recall/library by `isReservedNote`, so this
 * state never leaks into Nova's answers or the notes list (R19).
 *
 * Pure over its `index`/`deps` params (no singleton import) so it stays
 * node-testable; the only I/O seam is `writeTurn`.
 */
import {
  newNote,
  editedNote,
  writeTurn,
  VaultIndex,
  type QuiltDeps,
  type Note,
  type IndexedNote,
} from '../../../chain/core/src/index.js';

/** The reserved tag for a named app-state note. */
export function appStateTag(key: string): string {
  return `anima:${key}`;
}

function findAppStateNote(index: VaultIndex, key: string): IndexedNote | undefined {
  const tag = appStateTag(key);
  return index.all().find((e) => e.note.tags.includes(tag));
}

/**
 * Read the JSON body of the `anima:<key>` reserved note, or `fallback` when the
 * note is absent (fresh vault), the index is null (pre-rebuild), or the body is
 * unparseable. Pure — safe to call on every render.
 */
export function loadAppState<T>(index: VaultIndex | null, key: string, fallback: T): T {
  if (!index) return fallback;
  const entry = findAppStateNote(index, key);
  if (!entry) return fallback;
  try {
    return JSON.parse(entry.note.body) as T;
  } catch {
    return fallback;
  }
}

/**
 * Persist `value` as the `anima:<key>` reserved note — one silent quilt write
 * (mints v1, or bumps the version of the existing note) — and upsert the live
 * index in place so a same-session read sees it. Durability is the Walrus write;
 * the index upsert is in-memory consistency. Mirrors `saveLayout`.
 */
export async function saveAppState<T>(
  deps: QuiltDeps,
  index: VaultIndex,
  key: string,
  value: T,
): Promise<Note> {
  const existing = findAppStateNote(index, key);
  const body = JSON.stringify(value);
  const note = existing
    ? editedNote(existing.note, { body }, 'anima')
    : newNote({ title: `app:${key}`, body, author: 'anima', tags: [appStateTag(key)] });
  const result = await writeTurn(deps, [note]);
  index.upsert(note, {
    quiltPatchId: result.perNote[0].quiltPatchId,
    quiltBlobId: result.quiltBlobId,
    blobObjectId: result.blobObjectId,
  });
  return note;
}
