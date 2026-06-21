/**
 * Anonymous-collab persistence controller (plan 008 U2, AE4 / KTD2 / KTD3).
 *
 * Guests edit a shared note live through the unauthenticated relay and NEVER
 * touch Seal. The durable artifact is produced ONLY by an allowlisted writer
 * (the owner client or the owner's paired agent) via the existing sealed write
 * path, so what survives stays sealed + wallet-owned, attributed to a guest
 * label. This controller is the AE4 invariant in one place:
 *
 *   a guest edit schedules a debounced sealed write ONLY while an allowlisted
 *   writer is present; when only guests are present, edits are live-only.
 *
 * It is pure-ish (the sealed write is injected as `persistSnapshot`) so it is
 * node-testable with fake timers and no chain mocks. The persist is gated at
 * SCHEDULE time and edits made while no writer is present are dropped, never
 * buffered-then-flushed: the relay drops frames and never replays, so a snapshot
 * is the writer's observed state (KTD3 honest lossiness), not a lossless capture.
 */

/** Persist one sealed snapshot of a note's body, attributed to a guest label. Injected (real impl = editedNote → writeTurn → vaultData.upsert). */
export type PersistSnapshot = (noteId: string, body: string, guestLabel: string) => void | Promise<unknown>;

export interface CollabPersister {
  /** A guest edited `noteId` to `body`. Schedules a debounced persist iff an allowlisted writer is present; otherwise live-only (dropped). */
  onGuestEdit(noteId: string, body: string, guestLabel: string): void;
  /** Mark whether an allowlisted writer (owner client / owner's agent) is actively connected. Leaving cancels any pending persist. */
  setWriterPresent(present: boolean): void;
  /** Cancel all pending persists (unmount / share end). */
  dispose(): void;
}

export interface CollabPersisterOpts {
  persistSnapshot: PersistSnapshot;
  /** Debounce window before a sealed snapshot is written (KTD3 cadence ~2-3s). */
  debounceMs?: number;
}

export function makeCollabPersister({ persistSnapshot, debounceMs = 2500 }: CollabPersisterOpts): CollabPersister {
  let writerPresent = false;
  // one pending debounce per note (latest body wins)
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function cancelAll(): void {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  }

  return {
    onGuestEdit(noteId, body, guestLabel) {
      // gate at schedule time: no writer → live-only, nothing scheduled (AE4)
      if (!writerPresent) return;
      const prev = timers.get(noteId);
      if (prev) clearTimeout(prev);
      timers.set(
        noteId,
        setTimeout(() => {
          timers.delete(noteId);
          // re-check at fire time: a writer who left during the window cancels the write
          if (!writerPresent) return;
          void persistSnapshot(noteId, body, guestLabel);
        }, debounceMs),
      );
    },
    setWriterPresent(present) {
      writerPresent = present;
      // a writer leaving must NOT leave a pending persist that would fire after they go
      if (!present) cancelAll();
    },
    dispose() {
      cancelAll();
    },
  };
}
