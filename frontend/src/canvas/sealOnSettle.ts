/**
 * Seal-on-settle scheduler (plan 2026-06-22 U11).
 *
 * The canvas seals the whole scene to Walrus CHEAPLY: not on every change (which
 * drained the agent key), but when an edit burst SETTLES (idle for `settleMs`), on
 * LEAVE (navigate/close), and at a `safetyMs` cap during a long unbroken burst. The
 * decision logic is pure and time-injected (the caller drives `tick(now)` from a
 * timer/raf and supplies the real `save`), so "a burst → exactly one seal" is
 * node-tested rather than timing-flaky. Overlapping saves coalesce: edits arriving
 * mid-save re-arm, and the next tick after the save resolves flushes them.
 */
export interface SealScheduler {
  /** Record an edit (re-arms the settle timer; starts the safety clock if idle). */
  edit(now: number): void;
  /** True if a seal is due now (settle elapsed since the last edit, or safety cap reached). */
  due(now: number): boolean;
  /** Fire a seal if one is due and none is in flight. Returns true if it fired. */
  flushIfDue(now: number): boolean;
  /** Force an immediate seal of any unsaved edits (leave/close). Returns true if it fired. */
  flushNow(now: number): boolean;
  /** True while a save is in flight. */
  isSaving(): boolean;
  /** Timestamp of the oldest unsaved edit, or null when there is nothing to seal. */
  pendingSince(): number | null;
}

export interface SealSchedulerOpts {
  /** Idle gap after an edit burst before sealing. */
  settleMs: number;
  /** Hard cap: seal at most this long after the first unsaved edit, even mid-burst. */
  safetyMs: number;
  /** The real seal of the current scene. Coalesced: never called while a prior call is in flight. */
  save: () => Promise<unknown>;
}

export function createSealScheduler({ settleMs, safetyMs, save }: SealSchedulerOpts): SealScheduler {
  let firstUnsavedAt: number | null = null;
  let lastEditAt = 0;
  let saving = false;

  function fire(): boolean {
    if (saving || firstUnsavedAt === null) return false;
    saving = true;
    firstUnsavedAt = null; // edits during the save will re-arm this
    void Promise.resolve(save()).finally(() => {
      saving = false;
    });
    return true;
  }

  return {
    edit(now) {
      if (firstUnsavedAt === null) firstUnsavedAt = now;
      lastEditAt = now;
    },
    due(now) {
      if (firstUnsavedAt === null) return false;
      return now - lastEditAt >= settleMs || now - firstUnsavedAt >= safetyMs;
    },
    flushIfDue(now) {
      if (saving || firstUnsavedAt === null) return false;
      if (now - lastEditAt >= settleMs || now - firstUnsavedAt >= safetyMs) return fire();
      return false;
    },
    flushNow() {
      return fire();
    },
    isSaving: () => saving,
    pendingSince: () => firstUnsavedAt,
  };
}
