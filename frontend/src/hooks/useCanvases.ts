import { useSyncExternalStore } from 'react';
import { canvasStore } from '../mocks/canvasStore';
import type { CanvasDoc } from '../mocks/canvasStore';

/** The list of canvas documents (boards). */
export function useCanvases(): CanvasDoc[] {
  return useSyncExternalStore(canvasStore.subscribe, canvasStore.getSnapshot);
}

export { createCanvas, SHARED_CANVAS_ID } from '../mocks/canvasStore';
export type { CanvasDoc } from '../mocks/canvasStore';
