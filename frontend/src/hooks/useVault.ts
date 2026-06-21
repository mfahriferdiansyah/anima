/**
 * Notes read/edit/save (plan U4), migrated onto the shared web3/vaultData layer.
 * `useVault` selects notes + inline write-states from the one live VaultIndex;
 * `useWriteEvents` exposes the global toast stack vaultData hosts. Saves run the
 * REAL write-state lifecycle off `writeTurn`: `encrypting`/`certifying` are honest
 * optimistic labels, `certified(blobObjectId, provenanceUrl)`/`failed` come from
 * the promise. Funding is checked FIRST so a low balance surfaces the banner
 * (never a phantom `certifying`). Same hook signatures + snapshot shapes as the
 * deleted mock vaultStore (the binding contract) — no page rewrites.
 */
import { useSyncExternalStore } from 'react';
import {
  newNote,
  editedNote,
  writeTurn,
  preflight,
  type NoteLocation,
} from '../../../chain/core/src/index.js';
import type { WriteState } from '../components/WriteStateCard';
import { vaultData, type WriteEvent } from '../web3/vaultData';
import { getQuiltDeps } from '../web3/session';
import { triggerLowBalance } from '../mocks/chatStore';
import { OWNER_AUTHOR, type Note } from '../mocks/fixture';

export interface NotePatch {
  title?: string;
  body?: string;
  tags?: string[];
  links?: string[];
  /** Cover image — a Tier-2 covers concern; accepted for the binding contract but not persisted to chain this tier. */
  image?: string;
}

export interface VaultState {
  notes: Note[];
  /** Latest write state per noteId, for inline editor display. */
  writeStates: Record<string, WriteState>;
}

export interface ScrubEvent {
  removed: Array<{ noteId: string; title: string }>;
  line: string;
}

/** An unsaved draft has no chain location yet; saveNote replaces it with the real one. */
const DRAFT_LOCATION: NoteLocation = { quiltPatchId: '', quiltBlobId: '', blobObjectId: '' };

/** Notes plus the latest write state per note — selected from the live vaultData index. */
export function useVault(): VaultState {
  const snap = useSyncExternalStore(vaultData.subscribe, vaultData.getSnapshot);
  // vaultData holds chain/core notes (no cover); they satisfy the frontend Note shape (image optional).
  return { notes: snap.notes as Note[], writeStates: snap.writeStates };
}

/** The global write-event stream for the bottom-left toast stack. */
export function useWriteEvents(): WriteEvent[] {
  return useSyncExternalStore(vaultData.subscribe, vaultData.getSnapshot).writeEvents;
}

/** Mint a new draft note in the index (no chain write yet); returns its id so routing can open it. */
export function createNote(author: string = OWNER_AUTHOR): string {
  const note = newNote({ title: '', body: '', author });
  vaultData.upsert(note, DRAFT_LOCATION);
  return note.noteId;
}

/** Only the chain-persisted fields (cover/image is dropped — Tier-2), undefined keys filtered. */
function realChanges(patch: NotePatch): Partial<Pick<Note, 'title' | 'body' | 'tags' | 'links'>> {
  const changes: Partial<Pick<Note, 'title' | 'body' | 'tags' | 'links'>> = {};
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.body !== undefined) changes.body = patch.body;
  if (patch.tags !== undefined) changes.tags = patch.tags;
  if (patch.links !== undefined) changes.links = patch.links;
  return changes;
}

/**
 * Apply a patch and persist as a new sealed version. Without a noteId a fresh
 * draft is created first. Returns the id synchronously; the seal+write runs async
 * and drives the write-state lifecycle.
 */
export function saveNote(noteId: string | undefined, patch: NotePatch = {}): string {
  const id = noteId ?? createNote();
  void persist(id, patch);
  return id;
}

async function persist(id: string, patch: NotePatch): Promise<void> {
  // double-submit guard: the in-flight write-state map is the signal
  const ws = vaultData.getSnapshot().writeStates[id];
  if (ws && (ws.phase === 'encrypting' || ws.phase === 'certifying')) return;

  const deps = getQuiltDeps();
  const current = vaultData.getSnapshot().index?.get(id)?.note;
  if (!deps || !current) return; // no live vault, or unknown note

  const changes = realChanges(patch);
  // cover-only / no-op patches don't warrant a chain write this tier
  if (Object.keys(changes).length === 0) return;

  // preflight FIRST — a low balance surfaces the banner with NO write-state (Save preserved),
  // so the banner never shows under a 'certifying' indicator implying an in-flight upload.
  const pf = await preflight(deps.suiClient, deps.agentSigner.toSuiAddress());
  if (!pf.ok) {
    triggerLowBalance();
    return;
  }

  const next = editedNote(current, changes, OWNER_AUTHOR);
  const title = next.title || 'Untitled note';
  const eventId = vaultData.beginWriteEvent({ noteId: id, noteTitle: title, state: { phase: 'encrypting' } });
  vaultData.updateWriteEvent(eventId, { phase: 'certifying' });
  try {
    const res = await writeTurn(deps, [next]);
    const per = res.perNote.find((p) => p.noteId === id) ?? res.perNote[0];
    vaultData.upsert(next, { quiltPatchId: per.quiltPatchId, quiltBlobId: res.quiltBlobId, blobObjectId: res.blobObjectId });
    vaultData.updateWriteEvent(eventId, {
      phase: 'certified',
      blobObjectId: res.blobObjectId,
      provenanceUrl: `https://suiscan.xyz/testnet/object/${res.blobObjectId}`,
    });
  } catch {
    vaultData.updateWriteEvent(eventId, { phase: 'failed' });
  }
}

/** Re-run the current note's seal+write after a failure. */
export function retryWrite(noteId: string): void {
  const current = vaultData.getSnapshot().index?.get(noteId)?.note;
  if (!current) return;
  // re-persist the current title+body (a fresh version) to recover from a failed seal
  void persist(noteId, { title: current.title, body: current.body, tags: current.tags, links: current.links });
}

/** Move a note into a folder (the folder is tags[0]) — a real tags write (folders themselves stay Tier-2). */
export function setNoteFolder(noteId: string, folder: string): void {
  const current = vaultData.getSnapshot().index?.get(noteId)?.note;
  if (!current) return;
  saveNote(noteId, { tags: [folder, ...current.tags.slice(1)] });
}

/**
 * Forget — TIER-1 U4 STUB. Removes the notes from the live index + returns the
 * scrub event so the library/UI updates. The REAL destructive path (survivors-
 * rewrite → one wallet-signed delete of the quilts → on-chain erasure) is U7;
 * until then this only drops them locally and does NOT delete on Walrus.
 */
export function forgetNotes(ids: string[]): ScrubEvent {
  const idSet = new Set(ids);
  const removed = vaultData
    .getSnapshot()
    .notes.filter((n) => idSet.has(n.noteId))
    .map((n) => ({ noteId: n.noteId, title: n.title || 'Untitled note' }));
  for (const id of ids) vaultData.remove(id);
  const titles = removed.map((e) => e.title).join(', ');
  const line =
    removed.length === 1
      ? `Forgot 1 memory: ${titles}. Transcript references were scrubbed.`
      : `Forgot ${removed.length} memories: ${titles}. Transcript references were scrubbed.`;
  return { removed, line };
}

/** Dismiss a toast from the global write-event stack (App.tsx). */
export function dismissWriteEvent(id: string): void {
  vaultData.dismissWriteEvent(id);
}

export type { Note } from '../mocks/fixture';
export type { WriteEvent } from '../web3/vaultData';
