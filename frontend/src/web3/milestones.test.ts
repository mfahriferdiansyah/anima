/**
 * DOM-free test for milestone derivation (Tier-2 U3). Covers the PURE
 * `deriveMilestones` — the achieved-state contract (R29: derived, never
 * hardcoded) and the UTC-stable date formatting. The impure gathering
 * (vaultData/session/listPublished/localStorage) is integration-deferred.
 */
import { describe, it, expect } from 'vitest';
import { deriveMilestones, shortDate, type Milestone, type MilestoneSignals } from './milestones';

const base: MilestoneSignals = { noteCount: 0, firstNoteAt: null, agentCount: 1, hasPublished: false, resurrected: false };
const byKey = (ms: Milestone[], k: Milestone['key']) => ms.find((m) => m.key === k)!;

describe('deriveMilestones', () => {
  it('is all-unachieved for a fresh vault (device key only, no notes)', () => {
    const ms = deriveMilestones(base);
    expect(ms.map((m) => m.achieved)).toEqual([false, false, false, false]);
    expect(byKey(ms, 'seal').date).toBe('not yet');
  });

  it('marks first seal once a note exists, dated from the earliest note', () => {
    const ms = deriveMilestones({ ...base, noteCount: 3, firstNoteAt: '2026-06-02T10:00:00.000Z' });
    expect(byKey(ms, 'seal').achieved).toBe(true);
    expect(byKey(ms, 'seal').date).toBe('Jun 2');
  });

  it('marks paired only when agents exceed the single device key', () => {
    expect(byKey(deriveMilestones({ ...base, agentCount: 1 }), 'paired').achieved).toBe(false);
    expect(byKey(deriveMilestones({ ...base, agentCount: 2 }), 'paired').achieved).toBe(true);
  });

  it('marks first public note when something is published', () => {
    expect(byKey(deriveMilestones({ ...base, hasPublished: true }), 'public').achieved).toBe(true);
  });

  it('marks resurrected from the device-origin flag', () => {
    expect(byKey(deriveMilestones({ ...base, resurrected: true }), 'resurrected').achieved).toBe(true);
  });

  it('always returns the four milestones in a stable order', () => {
    expect(deriveMilestones(base).map((m) => m.key)).toEqual(['seal', 'paired', 'public', 'resurrected']);
  });
});

describe('shortDate', () => {
  it('formats a UTC ISO date as Mon D (timezone-stable)', () => {
    expect(shortDate('2026-06-08T00:00:00.000Z')).toBe('Jun 8');
    expect(shortDate('2026-01-15T23:59:00.000Z')).toBe('Jan 15');
  });

  it('returns empty for null or unparseable input', () => {
    expect(shortDate(null)).toBe('');
    expect(shortDate('not-a-date')).toBe('');
  });
});
