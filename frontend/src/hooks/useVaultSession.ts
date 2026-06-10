import { useSyncExternalStore } from 'react';
import { sessionStore, type SessionState } from '../mocks/sessionStore';

/** The six-phase session machine; the App phase gate consumes this everywhere. */
export function useVaultSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot);
}

export {
  startSession,
  completeOnboarding,
  rejectSignature,
  closeBeforeSign,
  pair,
  rejectPairing,
  retryRebuild,
  failNextRebuild,
  disconnect,
} from '../mocks/sessionStore';
export type { SessionState, VaultInfo, AgentInfo, OnboardingStep } from '../mocks/sessionStore';
