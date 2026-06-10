import { useSyncExternalStore } from 'react';
import { walletStore, type WalletState } from '../mocks/walletStore';

/** The pending mock wallet prompt (destructive actions only). */
export function useWallet(): WalletState {
  return useSyncExternalStore(walletStore.subscribe, walletStore.getSnapshot);
}

export { confirmWithWallet, approveWalletPrompt, rejectWalletPrompt } from '../mocks/walletStore';
export type { WalletState, WalletPrompt } from '../mocks/walletStore';
