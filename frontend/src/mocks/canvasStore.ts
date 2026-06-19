/**
 * Canvas documents (mock). A board is just an id + title — there is no
 * per-canvas content model; the document list + creation is the surface.
 * The seed 'shared' board renders the note constellation (today's behaviour);
 * boards created with createCanvas() start blank (a dotted grid you draw on).
 */
import { createStore } from './store';

export interface CanvasDoc {
  canvasId: string;
  title: string;
  /** The seed board shows the shared note constellation; others start blank. */
  seed?: boolean;
}

export const SHARED_CANVAS_ID = 'shared';

const store = createStore<CanvasDoc[]>([{ canvasId: SHARED_CANVAS_ID, title: 'Shared board', seed: true }]);

export const canvasStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

let canvasCounter = 0;

export function createCanvas(title = 'Untitled board'): string {
  canvasCounter += 1;
  const canvasId = `canvas-new-${canvasCounter}`;
  store.update((prev) => [...prev, { canvasId, title }]);
  return canvasId;
}
