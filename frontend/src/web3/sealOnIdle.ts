/**
 * Seal-on-idle controller (plan 2026-06-24 U5) — debounces the owner's durable
 * seal so a live co-edit session writes ONE sealed snapshot per quiet burst, not
 * one per keystroke (which would drain the agent key + storm the key servers).
 *
 * The owner sees EVERY peer's edits over the relay, so "no update for N seconds"
 * IS room-wide convergence — the right moment to seal. A max-flush interval bounds
 * data-loss-on-crash and tombstone growth even under continuous typing.
 *
 * Pure + injected: `readBody` reads the current flattened markdown (a pure read of
 * the Y.Text — it never mutates the doc, so the seal can't loop), `seal` performs
 * the durable write. Node-testable with fake timers. The seal is ALSO the manual
 * Save while a share is active (the caller wires the Save button to flushNow), so
 * there is never a second independent seal trigger fighting the dirty flag.
 */

export interface SealController {
  /** Call on each doc update (local or remote). Resets the idle timer; seals after quiet. */
  bump(): void;
  /** Seal immediately (the manual Save, or a share-end flush). Cancels the pending idle seal. */
  flushNow(): void;
  /** True while a seal is in flight (drives the saving/saved UI). */
  isSealing(): boolean;
  /** Stop all timers (unmount / share end). Does NOT flush — call flushNow first if needed. */
  dispose(): void;
}

export interface SealControllerOpts {
  /** Read the current body to seal (a PURE read of the Y.Text — must not mutate it). */
  readBody: () => string;
  /** Perform the durable seal of `body`. May be async; rejections are surfaced via onError. */
  seal: (body: string) => void | Promise<unknown>;
  /** Idle quiet window before sealing (ms). */
  idleMs?: number;
  /** Force a seal at least this often under continuous typing (ms); 0 disables. */
  maxIntervalMs?: number;
  /** Called when a seal rejects (e.g. out of funds) so the caller can surface it. */
  onError?: (e: unknown) => void;
  /** Called when a seal starts/ends so the caller can drive the saving state. */
  onSealingChange?: (sealing: boolean) => void;
}

export function makeSealController(opts: SealControllerOpts): SealController {
  const { readBody, seal, idleMs = 2500, maxIntervalMs = 60_000, onError, onSealingChange } = opts;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let sealing = false;
  let lastSealed: string | null = null;
  let disposed = false;

  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };
  const clearMax = () => {
    if (maxTimer) clearTimeout(maxTimer);
    maxTimer = null;
  };

  async function doSeal(): Promise<void> {
    clearIdle();
    clearMax();
    if (disposed) return;
    const body = readBody(); // PURE read — no doc mutation, so the seal cannot loop
    if (body === lastSealed) return; // nothing changed since the last seal
    sealing = true;
    onSealingChange?.(true);
    try {
      await seal(body);
      lastSealed = body;
    } catch (e) {
      onError?.(e); // e.g. out of funds — surfaced, never silently "saved"
    } finally {
      sealing = false;
      onSealingChange?.(false);
    }
  }

  return {
    bump() {
      if (disposed) return;
      clearIdle();
      idleTimer = setTimeout(() => void doSeal(), idleMs);
      // arm the max-flush once per quiet-to-busy transition
      if (maxIntervalMs > 0 && !maxTimer) {
        maxTimer = setTimeout(() => void doSeal(), maxIntervalMs);
      }
    },
    flushNow() {
      void doSeal();
    },
    isSealing: () => sealing,
    dispose() {
      disposed = true;
      clearIdle();
      clearMax();
    },
  };
}
