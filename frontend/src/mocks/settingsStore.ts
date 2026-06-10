/**
 * Settings page state: the key list (devices + external agents) and the
 * funding balances. Connect issues an agent secret exactly once; the store
 * never keeps it, only the secretIssued flag, so the UI cannot show it
 * again. Revoke and regenerate are destructive: the UI wallet-gates both.
 */
import { createStore } from './store';
import { settingsFixture, type KeyEntry } from './fixture';

export interface SettingsState {
  keys: KeyEntry[];
  balances: { sui: number; wal: number };
}

function initialState(): SettingsState {
  return {
    keys: [...settingsFixture.deviceKeys, ...settingsFixture.externalAgents].map((key) => ({ ...key })),
    balances: { ...settingsFixture.balances },
  };
}

const store = createStore<SettingsState>(initialState());

export const settingsStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

let keyCounter = 0;

function randomHex(length: number): string {
  let out = '';
  while (out.length < length) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

function generateSecret(): string {
  return `anima_sk_${randomHex(40)}`;
}

/** Remove a key. The UI requires a mock wallet confirm first (destructive). */
export function revokeKey(id: string): void {
  store.update((prev) => ({ ...prev, keys: prev.keys.filter((key) => key.id !== id) }));
}

/**
 * Issue a new external agent key. Returns the entry plus its secret; the
 * secret exists only in this return value, shown once by the dialog.
 */
export function connectExternalAgent(label: string): { key: KeyEntry; secret: string } {
  keyCounter += 1;
  const key: KeyEntry = {
    id: `key-agent-${keyCounter}`,
    label: label.trim() || `external agent ${keyCounter}`,
    kind: 'external',
    address: `0x${randomHex(64)}`,
    addedAt: new Date().toISOString(),
    thisDevice: false,
    secretIssued: true,
  };
  store.update((prev) => ({ ...prev, keys: [...prev.keys, key] }));
  return { key, secret: generateSecret() };
}

/**
 * Replace an issued agent secret (destructive: the old one stops working).
 * The UI requires a mock wallet confirm first. Returns the new secret,
 * again held only by the caller.
 */
export function regenerateAgentSecret(id: string): string | null {
  const key = store.getSnapshot().keys.find((entry) => entry.id === id);
  if (!key || key.kind !== 'external') return null;
  store.update((prev) => ({
    ...prev,
    keys: prev.keys.map((entry) => (entry.id === id ? { ...entry, secretIssued: true } : entry)),
  }));
  return generateSecret();
}

export function resetSettingsStore(): void {
  keyCounter = 0;
  store.update(() => initialState());
}
