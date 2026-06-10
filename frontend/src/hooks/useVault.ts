import { useSyncExternalStore } from 'react';
import { vaultStore, type VaultState } from '../mocks/vaultStore';
import { writeStateStore, type WriteEvent } from '../mocks/writeStateStore';

/** Notes plus the latest write state per note. */
export function useVault(): VaultState {
  return useSyncExternalStore(vaultStore.subscribe, vaultStore.getSnapshot);
}

/** The global write-event stream for the bottom-left toast stack. */
export function useWriteEvents(): WriteEvent[] {
  return useSyncExternalStore(writeStateStore.subscribe, writeStateStore.getSnapshot).events;
}

export {
  saveNote,
  retryWrite,
  failNextWrite,
  forgetNotes,
  createNote,
  recentNotes,
} from '../mocks/vaultStore';
export { dismissWriteEvent } from '../mocks/writeStateStore';
export type { VaultState, NotePatch, ScrubEvent } from '../mocks/vaultStore';
export type { WriteEvent } from '../mocks/writeStateStore';
export type { Note } from '../mocks/fixture';
