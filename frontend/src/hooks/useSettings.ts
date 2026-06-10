import { useSyncExternalStore } from 'react';
import { settingsStore, type SettingsState } from '../mocks/settingsStore';

/** Keys (devices + external agents) and balances for the settings page. */
export function useSettings(): SettingsState {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
}

export { revokeKey, connectExternalAgent, regenerateAgentSecret } from '../mocks/settingsStore';
export type { SettingsState } from '../mocks/settingsStore';
export type { KeyEntry } from '../mocks/fixture';
