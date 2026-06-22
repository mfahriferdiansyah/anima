import { describe, it, expect, vi } from 'vitest';
import { createSealScheduler } from './sealOnSettle';

describe('createSealScheduler', () => {
  it('a burst of edits seals exactly once after it settles (AE5)', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const s = createSealScheduler({ settleMs: 1000, safetyMs: 5000, save });
    s.edit(0);
    s.edit(100);
    s.edit(200);
    expect(s.flushIfDue(300)).toBe(false); // still within the settle window of the last edit
    expect(save).not.toHaveBeenCalled();
    expect(s.flushIfDue(1200)).toBe(true); // 1200 - 200 >= 1000 → settled
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.flushIfDue(3000)).toBe(false); // nothing left to seal
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there were no edits', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const s = createSealScheduler({ settleMs: 1000, safetyMs: 5000, save });
    expect(s.flushIfDue(99999)).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('leave forces an immediate seal of unsaved edits', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const s = createSealScheduler({ settleMs: 1000, safetyMs: 5000, save });
    s.edit(0);
    expect(s.flushNow(10)).toBe(true); // does not wait for settle
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.flushNow(20)).toBe(false); // nothing pending
  });

  it('the safety cap seals during a long unbroken burst', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const s = createSealScheduler({ settleMs: 1000, safetyMs: 3000, save });
    for (let t = 0; t <= 2500; t += 500) {
      s.edit(t);
      expect(s.flushIfDue(t)).toBe(false); // settle never elapses; safety not yet reached
    }
    s.edit(3000);
    expect(s.flushIfDue(3000)).toBe(true); // 3000 - firstUnsaved(0) >= 3000
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('coalesces: no double-fire while saving; edits during the save re-arm', async () => {
    let resolveSave: () => void = () => {};
    const save = vi.fn().mockImplementation(() => new Promise<void>((r) => { resolveSave = r; }));
    const s = createSealScheduler({ settleMs: 1000, safetyMs: 5000, save });
    s.edit(0);
    expect(s.flushIfDue(1000)).toBe(true); // fires, now in flight
    expect(s.isSaving()).toBe(true);
    s.edit(1100); // an edit arrives mid-save
    expect(s.flushIfDue(2200)).toBe(false); // does not fire a second concurrent save
    expect(save).toHaveBeenCalledTimes(1);
    resolveSave();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.isSaving()).toBe(false);
    expect(s.flushIfDue(3000)).toBe(true); // the mid-save edit re-armed → next tick seals it
    expect(save).toHaveBeenCalledTimes(2);
  });
});
