import { useSyncExternalStore } from 'react';
import { canvasStore } from '../mocks/canvasStore';
import type { CanvasDoc } from '../mocks/canvasStore';
import { createStore } from '../mocks/store';
import { loadAppState, saveAppState } from '../web3/appState';
import { getQuiltDeps } from '../web3/session';
import { vaultData } from '../web3/vaultData';
import type { VaultIndex } from '../../../chain/core/src/index.js';

/** The list of canvas documents. (Multi-canvas persistence is plan 007 — still mocked here.) */
export function useCanvases(): CanvasDoc[] {
  return useSyncExternalStore(canvasStore.subscribe, canvasStore.getSnapshot);
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

export { createCanvas, setCanvasFolder, updateCanvas, deleteCanvas, SHARED_CANVAS_ID } from '../mocks/canvasStore';
export type { CanvasDoc } from '../mocks/canvasStore';
