/**
 * Tab-scoped cache of the decrypted vault index, so a page refresh restores the
 * workspace INSTANTLY instead of re-fetching + re-decrypting every quilt from
 * Walrus + Seal again (which is slow, and slower still when the testnet key
 * servers are flaky).
 *
 * CUSTODY: the cache lives in sessionStorage (per-tab, cleared when the tab
 * closes) and is cleared on disconnect, so no decrypted note ever lands on disk.
 * This adds no new exposure beyond what already exists: the agent decrypt key is
 * already device-local, so anything that can read this cache could decrypt the
 * vault directly. The durable, sealed copy on Walrus remains the source of truth;
 * this is only a same-tab speed cache. The session re-validates it in the
 * background (pulling only NEW quilts) on every load.
 */
import { VaultIndex } from '../../../chain/core/src/index.js';
import { vaultData } from './vaultData';

const PREFIX = 'anima:idx:';
const key = (vaultId: string): string => `${PREFIX}${vaultId}`;

/** The vault whose index changes should be auto-cached (set on ready, cleared on disconnect). */
let activeVaultId: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Serialize + store the index for `vaultId`. Best-effort (quota/availability may fail). */
export function saveIndexCache(vaultId: string, index: VaultIndex): void {
  try {
    sessionStorage.setItem(key(vaultId), index.serialize());
  } catch {
    // sessionStorage unavailable or over quota — refresh just falls back to a rebuild
  }
}

/** Load + deserialize the cached index for `vaultId`, or null if absent/unreadable. */
export function loadIndexCache(vaultId: string): VaultIndex | null {
  try {
    const raw = sessionStorage.getItem(key(vaultId));
    return raw ? VaultIndex.load(raw) : null;
  } catch {
    return null;
  }
}

/** Drop every cached index (disconnect / account switch) so a stale account never shows. */
export function clearIndexCache(): void {
  activeVaultId = null;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

/** Begin auto-caching the live index for `vaultId` (called when the vault is ready). */
export function enableIndexCache(vaultId: string): void {
  activeVaultId = vaultId;
}

// Auto-persist the live index (debounced) whenever vaultData changes, so the
// cache always reflects the user's latest writes without per-write plumbing.
vaultData.subscribe(() => {
  if (!activeVaultId) return;
  const index = vaultData.getSnapshot().index;
  if (!index) return;
  if (saveTimer) clearTimeout(saveTimer);
  const vaultId = activeVaultId;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveIndexCache(vaultId, index);
  }, 600);
});
