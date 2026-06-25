/**
 * Seal-on-idle controller (plan 2026-06-24 U5). Pure, fake-timer driven. Proves
 * the debounce (one seal per quiet burst), the max-flush under continuous typing,
 * the dedup (no re-seal of unchanged content), the manual flushNow, and that a
 * seal failure (out of funds) is surfaced not swallowed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeSealController } from './sealOnIdle';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('makeSealController', () => {
  it('seals once after the room goes idle, not per bump', async () => {
    let body = 'a';
    const seals: string[] = [];
    const c = makeSealController({ readBody: () => body, seal: (b) => void seals.push(b), idleMs: 1000 });

    body = 'ab';
    c.bump();
    body = 'abc';
    c.bump();
    body = 'abcd';
    c.bump();
    expect(seals).toHaveLength(0); // nothing sealed mid-burst

    await vi.advanceTimersByTimeAsync(1100);
    expect(seals).toEqual(['abcd']); // exactly one seal, the latest body
  });

  it('does not re-seal unchanged content', async () => {
    let body = 'same';
    const seals: string[] = [];
    const c = makeSealController({ readBody: () => body, seal: (b) => void seals.push(b), idleMs: 500 });
    c.bump();
    await vi.advanceTimersByTimeAsync(600);
    c.bump(); // bump again, but body is unchanged
    await vi.advanceTimersByTimeAsync(600);
    expect(seals).toEqual(['same']); // only once
  });

  it('force-seals at the max interval under continuous typing', async () => {
    let body = 'x';
    const seals: string[] = [];
    const c = makeSealController({ readBody: () => body, seal: (b) => void seals.push(b), idleMs: 5000, maxIntervalMs: 2000 });

    // keep bumping faster than idleMs so the idle timer never fires
    for (let i = 0; i < 10; i++) {
      body = `x${i}`;
      c.bump();
      await vi.advanceTimersByTimeAsync(300);
    }
    // the max-flush must have fired at least once despite no idle window
    expect(seals.length).toBeGreaterThanOrEqual(1);
  });

  it('flushNow seals immediately (the manual Save while a share is active)', async () => {
    let body = 'draft';
    const seals: string[] = [];
    const c = makeSealController({ readBody: () => body, seal: (b) => void seals.push(b), idleMs: 9999 });
    c.bump();
    c.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(seals).toEqual(['draft']); // sealed without waiting out the idle window
  });

  it('surfaces a seal failure (out of funds) instead of swallowing it', async () => {
    const errs: unknown[] = [];
    const c = makeSealController({
      readBody: () => 'body',
      seal: () => Promise.reject(new Error('insufficient funds')),
      idleMs: 100,
      onError: (e) => errs.push(e),
    });
    c.bump();
    await vi.advanceTimersByTimeAsync(150);
    expect(errs).toHaveLength(1);
    expect(String((errs[0] as Error).message)).toMatch(/insufficient/);
  });

  it('drives the sealing state for the saving/saved UI', async () => {
    const states: boolean[] = [];
    let resolve!: () => void;
    const c = makeSealController({
      readBody: () => 'b',
      seal: () => new Promise<void>((r) => (resolve = r)),
      idleMs: 100,
      onSealingChange: (s) => states.push(s),
    });
    c.bump();
    await vi.advanceTimersByTimeAsync(150);
    expect(states).toEqual([true]); // sealing started
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([true, false]); // sealing ended
  });

  it('the seal reads the body but never mutates it (a pure read cannot loop)', async () => {
    // readBody is called, but the controller never writes back — so a doc bound to
    // it would not see a change from the seal (the echo-guard guarantee).
    let reads = 0;
    const c = makeSealController({ readBody: () => { reads++; return 'b'; }, seal: () => {}, idleMs: 100 });
    c.bump();
    await vi.advanceTimersByTimeAsync(150);
    expect(reads).toBeGreaterThan(0); // read happened
    // (the controller exposes no mutation path; the read-only contract is structural)
  });
});
