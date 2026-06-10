import { useSyncExternalStore } from 'react';
import { chatStore, type ChatState } from '../mocks/chatStore';

/** The one shared conversation (Companion page + popup, AE3). */
export function useChat(): ChatState {
  return useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot);
}

export {
  send,
  sendOnOpen,
  openPopup,
  closePopup,
  expandPopup,
  setOnCompanionRoute,
  triggerLowBalance,
  dismissLowBalance,
} from '../mocks/chatStore';
export type { ChatState, ChatMessage, ChatRole } from '../mocks/chatStore';
