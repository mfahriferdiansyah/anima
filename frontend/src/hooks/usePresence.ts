import { useSyncExternalStore } from 'react';
import { presenceStore, type PresenceState } from '../mocks/presenceStore';

/** Canvas peers, layout, the savingLayout/materialize flags, and socket health. */
export function usePresence(): PresenceState {
  return useSyncExternalStore(presenceStore.subscribe, presenceStore.getSnapshot);
}

export {
  startPresence,
  stopPresence,
  moveNote,
  moveCursor,
  setWriting,
  resetPresenceStore,
  onCanvasCollabFrame,
  emitCanvasCollab,
  presenceSelfId,
} from '../mocks/presenceStore';
export type { PresenceState, Peer, ConnectionState } from '../mocks/presenceStore';
