/**
 * The shared live-vault data layer (plan U2) — the spine every Tier-1 read-hook
 * selects from. It holds ONE live `VaultIndex` (published by the session rebuild,
 * U3), the per-note inline write-state map, and the append-only global write-event
 * log that drives the toast stack (App.tsx). Notes/search/backlinks are
 * reserved-filtered (`anima:*` excluded — R19) by delegating to the core
 * `VaultIndex`, which now routes `notes()`/`search()`/`backlinks()` past reserved.
 *
 * Shape mirrors the mock `createStore` pattern (getSnapshot/subscribe + reset) so
 * the hooks migrate with their signatures intact and the pure store stays
 * node-testable (DOM-free) — the thin `useVaultData` hook is the only React part.
 *
 * It is a MODULE SINGLETON, not a React provider: like the mock stores the hooks
 * import it directly, and it is simply empty (index === null) until the session
 * discovers a vault and `publish()`es the rebuilt index. The session `reset()`s
 * it on disconnect / account-switch so a stale (wrong-account) index never shows.
 */
import { useSyncExternalStore } from 'react';
import { VaultIndex, type IndexedNote, type Note, type NoteLocation } from '../../../chain/core/src/index.js';
import type { WriteState } from '../components/WriteStateCard';

/** A global write-event for the bottom-left toast stack (was mocks/writeStateStore). */
export interface WriteEvent {
  id: string;
  noteId: string;
  noteTitle: string;
  state: WriteState;
}

/** The reactive snapshot the hooks read. New object on every mutation. */
export interface VaultDataSnapshot {
  /** The live index, or null until the session publishes a rebuilt one. */
  index: VaultIndex | null;
  /** User-facing notes only (reserved `anima:*` filtered out), recency-sorted. */
  notes: Note[];
  /** Latest inline write-state per noteId (editor card display). */
  writeStates: Record<string, WriteState>;
  /** Append-only toast stack (silent writes never appear here). */
  writeEvents: WriteEvent[];
}

export interface VaultDataStore {
  getSnapshot(): VaultDataSnapshot;
  subscribe(listener: () => void): () => void;

  /** Session rebuild → publish the live index (replaces any prior). */
  publish(index: VaultIndex): void;
  /** Write-through after a successful writeTurn (note save / distill / survivor rewrite). */
  upsert(note: Note, location: NoteLocation): void;
  /** Forget write-through. */
  remove(noteId: string): void;

  /** Set the inline write-state for a note without a toast. */
  setWriteState(noteId: string, state: WriteState): void;
  /**
   * Begin a write lifecycle. Always updates `writeStates[noteId]` (so the
   * bulk-forget quiesce predicate, which watches encrypting|certifying, covers
   * even silent writes). When `silent` (e.g. the layout autosave) NO toast event
   * is pushed. Returns the event id for `updateWriteEvent`/`dismissWriteEvent`.
   */
  beginWriteEvent(input: { noteId: string; noteTitle: string; state: WriteState; silent?: boolean }): string;
  /** Advance a write lifecycle (updates the inline state + the toast if not silent). */
  updateWriteEvent(eventId: string, state: WriteState): void;
  /** Remove a toast (App.tsx). Leaves the inline write-state in place. */
  dismissWriteEvent(eventId: string): void;

  /** Reserved-filtered recall over the live index (empty until published). */
  search(query: string, topK?: number): IndexedNote[];
  /** Reserved-filtered backlinks (empty until published). */
  backlinks(noteId: string): IndexedNote[];

  /** Reset to empty (disconnect / account-switch / tests). */
  reset(): void;
}

/** Pure factory — node-testable without React. The singleton below wraps one of these. */
export function createVaultData(): VaultDataStore {
  let index: VaultIndex | null = null;
  const writeStates = new Map<string, WriteState>();
  const events: WriteEvent[] = [];
  const eventMeta = new Map<string, { noteId: string; silent: boolean }>();
  let counter = 0;
  const listeners = new Set<() => void>();

  function build(): VaultDataSnapshot {
    return {
      index,
      notes: index ? index.notes().map((e) => e.note) : [],
      writeStates: Object.fromEntries(writeStates),
      writeEvents: [...events],
    };
  }
  let snapshot = build();
  function emit(): void {
    snapshot = build();
    for (const l of listeners) l();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    publish(idx) {
      index = idx;
      emit();
    },
    upsert(note, location) {
      if (!index) index = VaultIndex.fromEntries([]);
      index.upsert(note, location);
      emit();
    },
    remove(noteId) {
      index?.remove(noteId);
      emit();
    },
    setWriteState(noteId, state) {
      writeStates.set(noteId, state);
      emit();
    },
    beginWriteEvent({ noteId, noteTitle, state, silent = false }) {
      counter += 1;
      const id = `write-${counter}`;
      eventMeta.set(id, { noteId, silent });
      writeStates.set(noteId, state);
      if (!silent) events.push({ id, noteId, noteTitle, state });
      emit();
      return id;
    },
    updateWriteEvent(eventId, state) {
      const meta = eventMeta.get(eventId);
      if (!meta) return;
      writeStates.set(meta.noteId, state);
      if (!meta.silent) {
        const i = events.findIndex((e) => e.id === eventId);
        if (i >= 0) events[i] = { ...events[i], state };
      }
      emit();
    },
    dismissWriteEvent(eventId) {
      const i = events.findIndex((e) => e.id === eventId);
      if (i >= 0) events.splice(i, 1);
      eventMeta.delete(eventId);
      emit();
    },
    search(query, topK) {
      return index ? index.search(query, topK) : [];
    },
    backlinks(noteId) {
      return index ? index.backlinks(noteId) : [];
    },
    reset() {
      index = null;
      writeStates.clear();
      events.length = 0;
      eventMeta.clear();
      counter = 0;
      emit();
    },
  };
}

/** The app-wide singleton the hooks consume (mirrors the mock store singletons). */
export const vaultData = createVaultData();

/** Test/lifecycle reset (mirrors the mocks' reset*Store()). */
export function resetVaultData(): void {
  vaultData.reset();
}

/** Reactive access to the whole layer (snapshot fields + mutations + queries). */
export function useVaultData(): VaultDataSnapshot & Pick<
  VaultDataStore,
  'publish' | 'upsert' | 'remove' | 'setWriteState' | 'beginWriteEvent' | 'updateWriteEvent' | 'dismissWriteEvent' | 'search' | 'backlinks'
> {
  const snap = useSyncExternalStore(vaultData.subscribe, vaultData.getSnapshot);
  return {
    ...snap,
    publish: vaultData.publish,
    upsert: vaultData.upsert,
    remove: vaultData.remove,
    setWriteState: vaultData.setWriteState,
    beginWriteEvent: vaultData.beginWriteEvent,
    updateWriteEvent: vaultData.updateWriteEvent,
    dismissWriteEvent: vaultData.dismissWriteEvent,
    search: vaultData.search,
    backlinks: vaultData.backlinks,
  };
}
