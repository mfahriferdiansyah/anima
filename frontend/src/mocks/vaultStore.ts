/**
 * Notes CRUD and the write-state sequence per docs/integration.md:
 * encrypting -> certifying -> certified(blobObjectId) | failed(+retry).
 * Saves emit events to writeStateStore for the global toast stack and
 * mirror the latest state per note for inline surfaces.
 *
 * Imports chatStore at runtime only (forget appends the transcript-scrub
 * line); the chatStore->vaultStore cycle is call-time safe ESM.
 */
import type { WriteState } from '../components/WriteStateCard';
import { createStore } from './store';
import { mockMs } from './scenario';
import { OWNER_AUTHOR, type Note } from './fixture';
import { beginWriteEvent, updateWriteEvent } from './writeStateStore';
import { appendEventMessage } from './chatStore';

export interface NotePatch {
  title?: string;
  body?: string;
  tags?: string[];
  links?: string[];
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

const store = createStore<VaultState>({ notes: [], writeStates: {} });

export const vaultStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

let failNext = false;
let blobCounter = 0;
let noteCounter = 0;
const saveTokens = new Map<string, number>();

function nowIso(): string {
  return new Date().toISOString();
}

function mockBlobObjectId(): string {
  blobCounter += 1;
  return `0x${blobCounter.toString(16).padStart(8, '0').repeat(8)}`;
}

/** Replace the whole vault (sessionStore calls this when a scenario reaches ready). */
export function loadNotes(notes: Note[]): void {
  saveTokens.clear();
  store.update(() => ({ notes, writeStates: {} }));
}

/** Insert a new untitled note, returns its id. Author defaults to the owner. */
export function createNote(author: string = OWNER_AUTHOR): string {
  noteCounter += 1;
  const noteId = `note-new-${noteCounter}`;
  const note: Note = {
    noteId,
    version: 1,
    updatedAt: nowIso(),
    author,
    tags: [],
    links: [],
    title: '',
    body: '',
  };
  store.update((prev) => ({ ...prev, notes: [note, ...prev.notes] }));
  return noteId;
}

/** Move a note into a folder (manage modal): the folder is tags[0]. */
export function setNoteFolder(noteId: string, folder: string): void {
  store.update((prev) => ({
    ...prev,
    notes: prev.notes.map((n) => (n.noteId === noteId ? { ...n, tags: [folder, ...n.tags.slice(1)] } : n)),
  }));
}

/**
 * Apply a patch (new version) and run the write-state sequence.
 * Without a noteId a fresh untitled note is created first. Returns the id.
 */
export function saveNote(noteId: string | undefined, patch: NotePatch = {}): string {
  const id = noteId ?? createNote();
  store.update((prev) => ({
    ...prev,
    notes: prev.notes.map((note) =>
      note.noteId === id ? { ...note, ...patch, version: note.version + 1, updatedAt: nowIso() } : note,
    ),
  }));
  runWriteSequence(id);
  return id;
}

/** Re-run the sequence after a failed seal. */
export function retryWrite(noteId: string): void {
  runWriteSequence(noteId);
}

function runWriteSequence(noteId: string): void {
  const note = store.getSnapshot().notes.find((entry) => entry.noteId === noteId);
  if (!note) return;
  const token = (saveTokens.get(noteId) ?? 0) + 1;
  saveTokens.set(noteId, token);
  const fresh = () => saveTokens.get(noteId) === token;
  const title = note.title || 'Untitled note';

  const eventId = beginWriteEvent(noteId, title, { phase: 'encrypting' });
  const apply = (state: WriteState) => {
    store.update((prev) => ({ ...prev, writeStates: { ...prev.writeStates, [noteId]: state } }));
    updateWriteEvent(eventId, state);
  };
  apply({ phase: 'encrypting' });

  setTimeout(() => {
    if (!fresh()) return;
    apply({ phase: 'certifying' });
    setTimeout(() => {
      if (!fresh()) return;
      if (failNext) {
        failNext = false;
        apply({ phase: 'failed' });
        return;
      }
      const blobObjectId = mockBlobObjectId();
      apply({
        phase: 'certified',
        blobObjectId,
        provenanceUrl: `https://suiscan.xyz/testnet/object/${blobObjectId}`,
      });
    }, mockMs(900));
  }, mockMs(700));
}

/** Dev switch for the failure path: the next save (or retry) ends failed. */
export function failNextWrite(): void {
  failNext = true;
}

/**
 * Forget = enumerate, remove, scrub. Returns the scrub event and appends
 * the transcript-scrub line to the shared chat store. Wallet gating
 * happens at the UI layer (walletStore.confirmWithWallet) before calling.
 */
export function forgetNotes(ids: string[]): ScrubEvent {
  const idSet = new Set(ids);
  const removed = store
    .getSnapshot()
    .notes.filter((note) => idSet.has(note.noteId))
    .map((note) => ({ noteId: note.noteId, title: note.title || 'Untitled note' }));
  store.update((prev) => {
    const writeStates = { ...prev.writeStates };
    for (const id of ids) {
      delete writeStates[id];
      saveTokens.delete(id);
    }
    return { notes: prev.notes.filter((note) => !idSet.has(note.noteId)), writeStates };
  });
  const titles = removed.map((entry) => entry.title).join(', ');
  const line =
    removed.length === 1
      ? `Forgot 1 memory: ${titles}. Transcript references were scrubbed.`
      : `Forgot ${removed.length} memories: ${titles}. Transcript references were scrubbed.`;
  if (removed.length > 0) appendEventMessage(line);
  return { removed, line };
}

/** Recents for Home: newest `updatedAt` first. Pure helper over useVault().notes. */
export function recentNotes(notes: Note[], limit = 6): Note[] {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}

export function resetVaultStore(): void {
  failNext = false;
  blobCounter = 0;
  noteCounter = 0;
  saveTokens.clear();
  store.update(() => ({ notes: [], writeStates: {} }));
}
