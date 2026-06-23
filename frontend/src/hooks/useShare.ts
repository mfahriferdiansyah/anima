import type { ShareState } from '../web3/share';
import { useShareState } from '../web3/share';

/** Publishing progress + the live share links (real layer, replaces the mock). */
export function useShare(): ShareState {
  return useShareState();
}

export {
  createShareLink,
  setLinkAccess,
  setLinkPassword,
  generateView,
  removeStaleCopy,
  dismissFunds,
  unpublish,
  newSharePassword,
} from '../web3/share';
export type { ShareState, ShareLink, LinkAccess } from '../web3/share';
