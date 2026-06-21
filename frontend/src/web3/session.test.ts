/**
 * DOM-free test for the session engine's pure core (plan U3). The async
 * orchestration (real discoverVault / onboarding PTBs / rebuild) is integration-
 * only and proven by the live resurrection gate; here we pin `deriveStartPhase`
 * (the allowlist-aware phase selection) and the synchronous store guards that
 * need no wallet.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveStartPhase,
  disconnect,
  renameCompanion,
  resetSessionStore,
  sessionStore,
  type VaultInfo,
} from './session';
import { vaultData } from './vaultData';

const AGENT = '0xagent';
const vault = (agents: string[]): VaultInfo => ({ vaultId: '0xv', owner: '0xowner', name: 'Nova', agents });

beforeEach(() => {
  resetSessionStore();
  vaultData.reset();
});

describe('web3/session deriveStartPhase', () => {
  it('no vault → first-run', () => {
    expect(deriveStartPhase(null, AGENT)).toBe('first-run');
  });

  it('vault exists but this device agent is not allowlisted → needs-pairing', () => {
    expect(deriveStartPhase(vault([]), AGENT)).toBe('needs-pairing');
    expect(deriveStartPhase(vault(['0xother']), AGENT)).toBe('needs-pairing');
  });

  it('vault exists and this device agent is allowlisted → rebuild', () => {
    expect(deriveStartPhase(vault([AGENT]), AGENT)).toBe('rebuild');
    expect(deriveStartPhase(vault(['0xother', AGENT]), AGENT)).toBe('rebuild');
  });
});

describe('web3/session store guards', () => {
  it('starts disconnected', () => {
    expect(sessionStore.getSnapshot()).toEqual({ phase: 'disconnected' });
  });

  it('disconnect resets the shared vault index and goes disconnected', () => {
    // (no vault published here; the assertion is that disconnect clears the spine)
    disconnect();
    expect(sessionStore.getSnapshot()).toEqual({ phase: 'disconnected' });
    expect(vaultData.getSnapshot().index).toBeNull();
  });

  it('renameCompanion is a no-op when not in the ready phase', () => {
    renameCompanion('Echo');
    expect(sessionStore.getSnapshot()).toEqual({ phase: 'disconnected' });
  });
});
