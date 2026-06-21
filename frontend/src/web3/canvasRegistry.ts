/**
 * Durable canvas registry (plan 007 U2) — the wallet-owned list of canvas
 * documents, persisted as the `anima:canvas-registry` reserved note. Mirrors
 * `web3/appState.ts`: the registry IS just an app-state value (a `CanvasDoc[]`),
 * so loadCanvases/saveCanvases delegate to loadAppState/saveAppState rather than
 * hand-rolling a second reserved-note writer. It resurrects from Walrus for free
 * and never leaks into recall/library/search (R19).
 *
 * A canvas's CONTENT (placed-note layout + drawings) lives in a separate
 * per-canvas note via chain/core `canvasContent.ts` (U1); this module owns only
 * the registry metadata. The `image?` field is the cover ref (preset path now;
 * uploaded blob ref in U4). The list-transform helpers are pure so the registry
 * test can assert the right list DOM-free.
 */
import { loadAppState, saveAppState } from './appState';
import { dataUrlToBytes, COVER_MAX_BYTES } from './covers';
import { ulid, type QuiltDeps, type VaultIndex } from '../../../chain/core/src/index.js';

/** The legacy single-board id; always present in the registry (the live constellation). */
export const SHARED_CANVAS_ID = 'shared';

/** The registry app-state key → the `anima:canvas-registry` reserved note. */
const REGISTRY_KEY = 'canvas-registry';

/**
 * A canvas document: id + title + description + filing folder, plus an optional
 * cover (`image`) and the `seed` flag for the always-present shared board. Same
 * shape the mock `CanvasDoc` carried (the binding contract) — pages read `image`.
 */
export interface CanvasDoc {
  canvasId: string;
  title: string;
  desc: string;
  /** Folder key (matches a note tag[0] / the folders store). */
  folder: string;
  /** Optional cover (preset path or uploaded blob/seal ref), shown on the home card. */
  image?: string;
  /** The seed (shared) canvas shows the live note constellation and is not removable. */
  seed?: boolean;
}

/**
 * The fresh-vault fallback: the shared board ALWAYS exists (it is the live
 * constellation; real canvases are appended via createCanvas). No demo fixtures —
 * with real persistence a canvas exists only if it was created.
 */
export const DEFAULT_REGISTRY: CanvasDoc[] = [
  {
    canvasId: SHARED_CANVAS_ID,
    title: 'Shared canvas',
    desc: 'The whole vault as one live constellation.',
    folder: 'research',
    image: '/covers/ethos-graph.svg',
    seed: true,
  },
];

/** Read the canvas list from the registry note, or the fallback for a fresh vault. */
export function loadCanvases(index: VaultIndex | null): CanvasDoc[] {
  return loadAppState(index, REGISTRY_KEY, DEFAULT_REGISTRY);
}

/** Persist the canvas list as the `anima:canvas-registry` reserved note. */
export function saveCanvases(deps: QuiltDeps, index: VaultIndex, list: CanvasDoc[]): Promise<unknown> {
  return saveAppState(deps, index, REGISTRY_KEY, list);
}

/** Mint a canvas id (chain/core ulid — collision-safe across reloads, unlike a session counter). */
export function newCanvasId(): string {
  return `c-${ulid()}`;
}

// ── pure list transforms (the hook mutators apply these, then persist) ────────

/** Append a new canvas document. */
export function addCanvas(list: CanvasDoc[], doc: CanvasDoc): CanvasDoc[] {
  return [...list, doc];
}

/** Patch a canvas's editable fields by id (no-op if absent). */
export function patchCanvas(
  list: CanvasDoc[],
  canvasId: string,
  patch: Partial<Pick<CanvasDoc, 'title' | 'desc' | 'image' | 'folder'>>,
): CanvasDoc[] {
  return list.map((c) => (c.canvasId === canvasId ? { ...c, ...patch } : c));
}

/** Remove a canvas by id. The seed (shared) board is NOT removable. */
export function removeCanvas(list: CanvasDoc[], canvasId: string): CanvasDoc[] {
  return list.filter((c) => !(c.canvasId === canvasId && !c.seed));
}

/**
 * Classify a canvas-cover patch (mirrors useVault's `classifyCoverPatch`): a
 * preset/path/clear stores the value directly; a `data:` URL is decoded +
 * size-checked for an async upload. `current` is the canvas's existing cover ref
 * — an unchanged value is a no-op (no redundant write, no re-upload). Returns:
 * - `null`        → no cover intent / unchanged / oversize / malformed (skip)
 * - `{value}`     → store this ref directly (preset path or '' clear)
 * - `{bytes}`     → upload these bytes, then store the returned `blob:` ref
 * Canvas covers are board chrome → uploaded PUBLIC (plaintext) so the board can
 * render them without a connected wallet.
 */
export function classifyCanvasCoverPatch(
  image: string | undefined,
  current: string | undefined,
): { kind: 'value'; cover: string } | { kind: 'upload'; bytes: Uint8Array } | null {
  if (image === undefined || image === current) return null; // no intent / unchanged
  if (!image.startsWith('data:')) return { kind: 'value', cover: image };
  // data URL — decode and size-check before any async work
  let bytes: Uint8Array;
  try {
    bytes = dataUrlToBytes(image);
  } catch {
    return null; // malformed data URL — treat as no cover intent
  }
  if (bytes.byteLength > COVER_MAX_BYTES) return null; // oversize — skip silently
  return { kind: 'upload', bytes };
}
