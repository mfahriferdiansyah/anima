import { useSyncExternalStore } from 'react';
import { shareStore, type ShareState } from '../mocks/shareStore';

/** Publishing progress + the published-copies list. */
export function useShare(): ShareState {
  return useSyncExternalStore(shareStore.subscribe, shareStore.getSnapshot);
}

export { publish, unpublish } from '../mocks/shareStore';
export type { ShareState, ShareMode, PublishedCopy } from '../mocks/shareStore';
