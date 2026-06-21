/**
 * AE4 invariant test (plan 008 U2): anonymous-collab persistence is gated on an
 * allowlisted writer being present. Guest-only edits stay live-only (no sealed
 * snapshot); only while a writer is connected does a guest edit schedule a
 * debounced persist, attributed to the guest label. The controller is pure (the
 * sealed-write is injected as `persistSnapshot`), so this needs no chain mocks,
 * only fake timers for the debounce.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeCollabPersister } from './collabPersist';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('makeCollabPersister AE4 writer-present gating', () => {
  it('guest-only edits never persist (no allowlisted writer present)', () => {
    const persistSnapshot = vi.fn();
    const c = makeCollabPersister({ persistSnapshot, debounceMs: 2000 });

    // a guest edits, but no writer is present → live-only, nothing scheduled
    c.onGuestEdit('n-1', 'guest typed this', 'guest@anon');
    c.onGuestEdit('n-1', 'guest typed more', 'guest@anon');
    vi.advanceTimersByTime(10_000);

    expect(persistSnapshot).not.toHaveBeenCalled();
    c.dispose();
  });

  it('an allowlisted writer present → a guest edit debounce-persists once, attributed to the guest', () => {
    const persistSnapshot = vi.fn();
    const c = makeCollabPersister({ persistSnapshot, debounceMs: 2000 });

    c.setWriterPresent(true);
    c.onGuestEdit('n-1', 'first', 'guest@anon');
    c.onGuestEdit('n-1', 'latest body', 'guest@anon'); // resets the debounce
    expect(persistSnapshot).not.toHaveBeenCalled(); // still inside the debounce window

    vi.advanceTimersByTime(2000);
    expect(persistSnapshot).toHaveBeenCalledTimes(1);
    expect(persistSnapshot).toHaveBeenCalledWith('n-1', 'latest body', 'guest@anon');
    c.dispose();
  });

  it('does NOT buffer-then-flush: edits made while no writer was present are not replayed when one joins', () => {
    const persistSnapshot = vi.fn();
    const c = makeCollabPersister({ persistSnapshot, debounceMs: 2000 });

    // guest edits with no writer must be dropped, not buffered
    c.onGuestEdit('n-1', 'while-alone', 'guest@anon');
    vi.advanceTimersByTime(2000);

    // a writer joins, but there is no NEW edit → nothing persists
    c.setWriterPresent(true);
    vi.advanceTimersByTime(10_000);
    expect(persistSnapshot).not.toHaveBeenCalled();
    c.dispose();
  });

  it('a writer leaving cancels a pending persist', () => {
    const persistSnapshot = vi.fn();
    const c = makeCollabPersister({ persistSnapshot, debounceMs: 2000 });

    c.setWriterPresent(true);
    c.onGuestEdit('n-1', 'body', 'guest@anon');
    c.setWriterPresent(false); // writer leaves before the debounce fires
    vi.advanceTimersByTime(10_000);

    expect(persistSnapshot).not.toHaveBeenCalled();
    c.dispose();
  });

  it('persists per note independently (latest body per noteId)', () => {
    const persistSnapshot = vi.fn();
    const c = makeCollabPersister({ persistSnapshot, debounceMs: 2000 });

    c.setWriterPresent(true);
    c.onGuestEdit('n-1', 'a1', 'g1');
    c.onGuestEdit('n-2', 'b1', 'g2');
    vi.advanceTimersByTime(2000);

    expect(persistSnapshot).toHaveBeenCalledTimes(2);
    expect(persistSnapshot).toHaveBeenCalledWith('n-1', 'a1', 'g1');
    expect(persistSnapshot).toHaveBeenCalledWith('n-2', 'b1', 'g2');
    c.dispose();
  });

  it('dispose() cancels any pending persist', () => {
    const persistSnapshot = vi.fn();
    const c = makeCollabPersister({ persistSnapshot, debounceMs: 2000 });

    c.setWriterPresent(true);
    c.onGuestEdit('n-1', 'body', 'guest@anon');
    c.dispose();
    vi.advanceTimersByTime(10_000);

    expect(persistSnapshot).not.toHaveBeenCalled();
  });
});
