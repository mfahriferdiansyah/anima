import { useSyncExternalStore } from 'react';
import { presenceStore, type PresenceState } from '../mocks/presenceStore';

/** Canvas peers, layout, and the savingLayout/materialize flags. */
export function usePresence(): PresenceState {
  return useSyncExternalStore(presenceStore.subscribe, presenceStore.getSnapshot);
}

export { startPresence, stopPresence, moveNote } from '../mocks/presenceStore';
export type { PresenceState, Peer } from '../mocks/presenceStore';
