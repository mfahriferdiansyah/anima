/**
 * Cross-tab single-sealer election (plan 2026-06-24 U5) via the Web Locks API.
 *
 * The owner's seal identity is derived from the agent key, so it is IDENTICAL
 * across the owner's own tabs — "lowest id" can't break a two-tab tie. The Web
 * Locks API gives a real exclusive lock that the browser AUTO-RELEASES the instant
 * the holding tab dies / crashes / is force-killed, so a frozen leader can't strand
 * the lease: a waiting tab is promoted immediately, no heartbeat needed.
 *
 * Exactly one tab holds the lock and is the sealer; the others wait. When the API
 * is unavailable (an old browser, or a non-browser env), the lock is granted
 * IMMEDIATELY with a flag so the caller can keep the manual Save reachable as a
 * degraded fallback rather than silently leaving the owner un-persisted.
 */

export interface SealLease {
  /** True once this tab holds the exclusive seal lock (is the active sealer). */
  isHeld(): boolean;
  /** True when the Web Locks API was unavailable and the lock was granted optimistically. */
  isFallback(): boolean;
  /** Release the lock (the tab unmounts / the share ends). */
  release(): void;
}

type LockManager = {
  request: (name: string, options: { mode?: string; signal?: AbortSignal }, cb: () => Promise<void>) => Promise<void>;
};

function lockManager(): LockManager | null {
  const nav = (globalThis as { navigator?: { locks?: unknown } }).navigator;
  const locks = nav?.locks as LockManager | undefined;
  return locks && typeof locks.request === 'function' ? locks : null;
}

/**
 * Acquire the exclusive seal lock for a room. Returns a lease immediately; the
 * lease becomes held once the lock is granted (synchronously in the fallback path,
 * or asynchronously when a current holder releases). `onAcquired` fires when this
 * tab becomes the sealer.
 */
export function acquireSealLease(roomId: string, onAcquired?: () => void): SealLease {
  const lockName = `anima-seal:${roomId}`;
  let held = false;
  let released = false;
  const controller = new AbortController();
  const locks = lockManager();

  if (!locks) {
    // No Web Locks API — grant optimistically so the owner is never blocked, and
    // flag it so the caller keeps the manual Save fallback reachable.
    held = true;
    onAcquired?.();
    return {
      isHeld: () => held && !released,
      isFallback: () => true,
      release: () => {
        released = true;
        held = false;
      },
    };
  }

  // Hold the lock for the lifetime of the returned promise; we resolve it on release.
  let releaseHeld: (() => void) | null = null;
  void locks
    .request(lockName, { mode: 'exclusive', signal: controller.signal }, () => {
      held = true;
      onAcquired?.();
      return new Promise<void>((resolve) => {
        releaseHeld = resolve;
      });
    })
    .catch(() => {
      // an aborted request (we released before acquiring) — not an error
    });

  return {
    isHeld: () => held && !released,
    isFallback: () => false,
    release: () => {
      released = true;
      held = false;
      if (releaseHeld) releaseHeld();
      else controller.abort(); // never acquired — cancel the pending request
    },
  };
}
