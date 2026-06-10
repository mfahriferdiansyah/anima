/**
 * The mock wallet. Destructive actions only (forget, revoke, unpublish,
 * regenerate): confirmWithWallet(action) resolves once the UI approves or
 * rejects the pending prompt via the mock wallet dialog. Routine writes
 * never come through here, that asymmetry is the pitch.
 */
import { createStore } from './store';

export interface WalletPrompt {
  id: number;
  action: string;
}

export interface WalletState {
  pending: WalletPrompt | null;
}

const store = createStore<WalletState>({ pending: null });

export const walletStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

let promptCounter = 0;
let resolver: ((approved: boolean) => void) | null = null;

/** Ask the wallet to sign a destructive action. Resolves true on approve, false on reject. */
export function confirmWithWallet(action: string): Promise<boolean> {
  if (resolver) resolver(false); // a newer prompt supersedes an unanswered one
  promptCounter += 1;
  store.update(() => ({ pending: { id: promptCounter, action } }));
  return new Promise((resolve) => {
    resolver = resolve;
  });
}

export function approveWalletPrompt(): void {
  settle(true);
}

export function rejectWalletPrompt(): void {
  settle(false);
}

function settle(approved: boolean): void {
  const resolve = resolver;
  resolver = null;
  store.update(() => ({ pending: null }));
  if (resolve) resolve(approved);
}

export function resetWalletStore(): void {
  if (resolver) resolver(false);
  resolver = null;
  store.update(() => ({ pending: null }));
}
