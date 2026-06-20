import { useSyncExternalStore } from 'react';
import { shareStore, type ShareState } from '../mocks/shareStore';

/** Publishing progress + the published-copies list. */
export function useShare(): ShareState {
  return useSyncExternalStore(shareStore.subscribe, shareStore.getSnapshot);
}

export { createShareLink, setLinkAccess, setLinkPassword, newSharePassword } from '../mocks/shareStore';
export type { ShareState, ShareLink, LinkAccess } from '../mocks/shareStore';
