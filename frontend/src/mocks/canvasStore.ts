/**
 * Canvas documents (mock). A canvas is an id + title + description + the folder
 * it files under — there is no per-canvas content model; the document list +
 * creation is the surface. The seed 'shared' canvas renders the note
 * constellation (today's behaviour); canvases created with createCanvas() start
 * blank (a dotted grid you draw on).
 */
import { createStore } from './store';
import { seedCanvases } from './seed';

export interface CanvasDoc {
  canvasId: string;
  title: string;
  desc: string;
  /** Folder key (matches a note tag[0] / the folders store). */
  folder: string;
  /** Optional cover (preset path or uploaded data URL), shown on the home card. */
  image?: string;
  /** The seed canvas shows the shared note constellation; others start blank. */
  seed?: boolean;
}

export const SHARED_CANVAS_ID = 'shared';

const seed: CanvasDoc[] = [
  { canvasId: SHARED_CANVAS_ID, title: 'Shared canvas', desc: 'The whole vault as one live constellation.', folder: 'research', image: '/covers/ethos-graph.svg', seed: true },
  { canvasId: 'c-lisbon', title: 'Lisbon planning canvas', desc: 'Routes, places and bookings on one board.', folder: 'trips', image: '/covers/ethos-quilt.svg' },
  { canvasId: 'c-demo', title: 'Demo day canvas', desc: 'Storyboard for the seven-minute walkthrough.', folder: 'work', image: '/covers/ethos-pulse.svg' },
];

const store = createStore<CanvasDoc[]>([...seed, ...seedCanvases]);

export const canvasStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

let canvasCounter = 0;

export function createCanvas(folder = 'untitled', title = 'Untitled canvas'): string {
  canvasCounter += 1;
  const canvasId = `canvas-new-${canvasCounter}`;
  store.update((prev) => [...prev, { canvasId, title, desc: '', folder }]);
  return canvasId;
}

/** Move a canvas into a folder (manage modal). */
export function setCanvasFolder(canvasId: string, folder: string): void {
  store.update((prev) => prev.map((c) => (c.canvasId === canvasId ? { ...c, folder } : c)));
}

/** Edit a canvas title / description / cover (manage modal). */
export function updateCanvas(canvasId: string, patch: { title?: string; desc?: string; image?: string }): void {
  store.update((prev) => prev.map((c) => (c.canvasId === canvasId ? { ...c, ...patch } : c)));
}

/** Delete a canvas (manage modal). The seed canvas is not removable. */
export function deleteCanvas(canvasId: string): void {
  store.update((prev) => prev.filter((c) => !(c.canvasId === canvasId && !c.seed)));
}
