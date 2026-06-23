import { describe, it, expect } from 'vitest';
import { disconnectedGate, type AutoConnectStatus } from './appGate';

describe('disconnectedGate', () => {
  it('holds on checking while autoConnect is still idle (refresh renders 1–2)', () => {
    // account hasn't rehydrated yet and the reconnect attempt is in flight.
    expect(disconnectedGate(false, 'idle')).toBe('checking');
  });

  it('holds on checking once the account arrives but session.phase lags (render 3)', () => {
    // The regression: autoConnect has handed us the account and settled, but
    // session.phase is one render behind at 'disconnected'. Must NOT bounce —
    // the session effect is about to advance to 'checking'.
    const settled: AutoConnectStatus[] = ['attempted', 'disabled', 'idle'];
    for (const status of settled) {
      expect(disconnectedGate(true, status)).toBe('checking');
    }
  });

  it('bounces to landing only when autoConnect has settled with no account', () => {
    // Real disconnect / brand-new browser (no lastConnectedWallet → 'attempted'
    // immediately), or autoConnect disabled with no wallet.
    expect(disconnectedGate(false, 'attempted')).toBe('landing');
    expect(disconnectedGate(false, 'disabled')).toBe('landing');
  });
});
