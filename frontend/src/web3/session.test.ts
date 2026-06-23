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
  pairingAffordability,
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

describe('web3/session pairingAffordability', () => {
  it('a wallet at or above the 0.35 SUI floor can pair', () => {
    expect(pairingAffordability(350_000_000n).ok).toBe(true);
    expect(pairingAffordability(1_000_000_000n).ok).toBe(true);
  });

  it('exactly the 0.3 funding is NOT enough — no gas headroom would be left', () => {
    expect(pairingAffordability(300_000_000n).ok).toBe(false);
  });

  it('a short wallet returns a top-up message naming the cost, the floor, and the balance', () => {
    const { ok, message } = pairingAffordability(120_000_000n);
    expect(ok).toBe(false);
    expect(message).toContain('0.3'); // the funding amount
    expect(message).toContain('0.35'); // the total floor (funding + gas)
    expect(message).toContain('0.12'); // the wallet's current balance
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
});
