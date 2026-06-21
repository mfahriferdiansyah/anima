import { useSyncExternalStore } from 'react';
import { createStore } from '../mocks/store';
import { loadAppState, saveAppState } from '../web3/appState';
import {
  loadCanvases,
  saveCanvases,
  newCanvasId,
  addCanvas,
  patchCanvas,
  removeCanvas,
  classifyCanvasCoverPatch,
  DEFAULT_REGISTRY,
  SHARED_CANVAS_ID,
  type CanvasDoc,
} from '../web3/canvasRegistry';
import { getQuiltDeps } from '../web3/session';
import { vaultData } from '../web3/vaultData';
import { runDestructiveTx } from './useVault';
import { uploadCover, listVaultCovers, buildDeleteQuiltsTx, type VaultIndex } from '../../../chain/core/src/index.js';

// ── Canvases (Tier-2 / plan 007 U2) ─────────────────────────────────────────
// The durable canvas registry, persisted as the `anima:canvas-registry` reserved
// note. MIRRORS the folders idiom below: an optimistic local store backs the UI
// (instant create/rename/cover/delete) and reseeds from the durable note whenever
// the session republishes the index (the rebuild). The shared/seed board always
// exists (the live constellation); real canvases append via createCanvas.
const canvasesLocal = createStore<CanvasDoc[]>(DEFAULT_REGISTRY);
let lastCanvasIndexRef: VaultIndex | null = null;

function reseedCanvases(): void {
  const idx = vaultData.getSnapshot().index;
  if (idx === lastCanvasIndexRef) return; // only the rebuild publish swaps the index ref
  lastCanvasIndexRef = idx;
  canvasesLocal.update(() => loadCanvases(idx));
}
vaultData.subscribe(reseedCanvases);
reseedCanvases(); // seed if an index is already published (hot reload / tests)

function persistCanvases(next: CanvasDoc[]): void {
  canvasesLocal.update(() => next); // optimistic — the durable write lands ~one quilt later
  const deps = getQuiltDeps();
  const idx = vaultData.getSnapshot().index;
  if (deps && idx) void saveCanvases(deps, idx, next).catch(() => {});
}

/** The list of canvas documents (the shared board plus any created canvases). */
export function useCanvases(): CanvasDoc[] {
  return useSyncExternalStore(canvasesLocal.subscribe, canvasesLocal.getSnapshot);
}

/** Create a canvas (optimistic local + durable registry write); returns its id. */
export function createCanvas(folder = 'untitled', title = 'Untitled canvas'): string {
  const canvasId = newCanvasId();
  persistCanvases(addCanvas(canvasesLocal.getSnapshot(), { canvasId, title, desc: '', folder }));
  return canvasId;
}

/**
 * Edit a canvas title / description / cover (manage modal). Cover handling mirrors
 * useVault's `saveNote`/`persist`: scalar edits (and a preset/clear cover) persist
 * immediately and optimistically; a `data:` upload is decoded + size-checked, then
 * kicked off async (fire-and-forget, returning void) — the resolved `blob:` ref is
 * persisted once the upload lands. The data URL itself is NEVER written to the
 * registry note (KTD2 size bound). Canvas covers are board chrome → uploaded PUBLIC
 * so the board renders without a connected wallet. Oversize/malformed → skipped.
 */
export function updateCanvas(
  canvasId: string,
  patch: { title?: string; desc?: string; image?: string; folder?: string },
): void {
  const current = canvasesLocal.getSnapshot().find((c) => c.canvasId === canvasId)?.image;
  const cover = classifyCanvasCoverPatch(patch.image, current);
  // Strip the raw image from the immediate patch; re-add only a ready value (preset/clear).
  const { image: _image, ...rest } = patch;
  const immediate: typeof patch = { ...rest };
  if (cover?.kind === 'value') immediate.image = cover.cover;

  // Persist the immediate part only if it carries a real change (a cover-only upload
  // with no scalar edit would otherwise bump a redundant registry version).
  if (Object.keys(immediate).length > 0) {
    persistCanvases(patchCanvas(canvasesLocal.getSnapshot(), canvasId, immediate));
  }

  // A data-URL cover: upload (public/plaintext) off the main path, then store the ref.
  if (cover?.kind === 'upload') {
    const deps = getQuiltDeps();
    if (!deps) return; // no live vault — drop the cover silently (mirrors persist())
    void (async () => {
      try {
        const { ref } = await uploadCover(deps, cover.bytes, { noteId: canvasId, public: true });
        persistCanvases(patchCanvas(canvasesLocal.getSnapshot(), canvasId, { image: ref }));
      } catch {
        // upload failed — leave the prior cover untouched (no crash, no toast)
      }
    })();
  }
}

/** Move a canvas into a folder (manage modal). */
export function setCanvasFolder(canvasId: string, folder: string): void {
  updateCanvas(canvasId, { folder });
}

/**
 * Delete a canvas (manage modal). Removes the registry entry — the meaningful
 * delete; the shared/seed board is not removable. The per-canvas content note is
 * left as an orphaned reserved blob (reserved, filtered, harmless), and the
 * placed-note blobs stay in the library. The canvas's cover blob is cleaned up
 * best-effort through the same wallet seam as forget (`runDestructiveTx`): it
 * never forces a wallet popup and never blocks the delete — an orphaned plaintext
 * cover blob is harmless, so any failure (unwired seam, enumeration error) is
 * swallowed.
 */
export function deleteCanvas(canvasId: string): void {
  persistCanvases(removeCanvas(canvasesLocal.getSnapshot(), canvasId));
  const deps = getQuiltDeps();
  if (!deps) return;
  void (async () => {
    try {
      const coverBlobIds = await listVaultCovers(deps, [canvasId]);
      if (coverBlobIds.length === 0) return;
      const tx = await buildDeleteQuiltsTx(deps, coverBlobIds);
      await runDestructiveTx(tx);
    } catch {
      // best-effort — an orphaned plaintext cover blob is harmless
    }
  })();
}

/** Test-only reset of the local canvas store. */
export function resetCanvasesForTest(): void {
  lastCanvasIndexRef = null;
  canvasesLocal.update(() => DEFAULT_REGISTRY);
}

/** Test-only read of the local canvas store (the hook wraps this via useSyncExternalStore). */
export function getCanvasesForTest(): CanvasDoc[] {
  return canvasesLocal.getSnapshot();
}

// ── Folders (Tier-2 U1) ────────────────────────────────────────────────────
// Durable order + empty folders, persisted as the `anima:folders` reserved note.
// The list IS the ordering: `buildLibrary` seeds folders from it (so an empty
// folder still shows) and appends any item-folders as extras; a note's membership
// stays its tags[0]. An optimistic local store backs the UI (instant reorder/add)
// and reseeds from the durable note whenever the session republishes the index
// (the rebuild). Single caller, so it lives here rather than a standalone module.
const DEFAULT_FOLDERS = ['research', 'trips', 'work', 'reading', 'product'];
const foldersLocal = createStore<string[]>(DEFAULT_FOLDERS);
let lastIndexRef: VaultIndex | null = null;

function reseedFolders(): void {
  const idx = vaultData.getSnapshot().index;
  if (idx === lastIndexRef) return; // only the rebuild publish swaps the index ref
  lastIndexRef = idx;
  foldersLocal.update(() => loadAppState(idx, 'folders', DEFAULT_FOLDERS));
}
vaultData.subscribe(reseedFolders);
reseedFolders(); // seed if an index is already published (hot reload / tests)

function persistFolders(next: string[]): void {
  foldersLocal.update(() => next); // optimistic — the durable write lands ~one quilt later
  const deps = getQuiltDeps();
  const idx = vaultData.getSnapshot().index;
  if (deps && idx) void saveAppState(deps, idx, 'folders', next).catch(() => {});
}

/** The ordered list of folder keys (includes empty folders). */
export function useFolders(): string[] {
  return useSyncExternalStore(foldersLocal.subscribe, foldersLocal.getSnapshot);
}

/** Add an empty folder (lowercase key, deduped; reserved `anima:` prefixes rejected). */
export function addFolder(name: string): void {
  const key = name.trim().toLowerCase();
  if (!key || key.startsWith('anima:')) return;
  const cur = foldersLocal.getSnapshot();
  if (cur.includes(key)) return;
  persistFolders([...cur, key]);
}

/** Move a folder one slot up (dir -1) or down (dir +1). */
export function moveFolder(name: string, dir: -1 | 1): void {
  const cur = foldersLocal.getSnapshot();
  const i = cur.indexOf(name);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= cur.length) return;
  const next = [...cur];
  [next[i], next[j]] = [next[j], next[i]];
  persistFolders(next);
}

/** Remove a folder from the order (member notes keep their tag; intended for empty folders). */
export function deleteFolder(name: string): void {
  const cur = foldersLocal.getSnapshot();
  if (!cur.includes(name)) return;
  persistFolders(cur.filter((f) => f !== name));
}

/** Test-only reset of the local folder store. */
export function resetFoldersForTest(): void {
  lastIndexRef = null;
  foldersLocal.update(() => DEFAULT_FOLDERS);
}

/** Test-only read of the local folder store (the hook wraps this via useSyncExternalStore). */
export function getFoldersForTest(): string[] {
  return foldersLocal.getSnapshot();
}

export { SHARED_CANVAS_ID };
export type { CanvasDoc };
