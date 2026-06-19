import { useSyncExternalStore } from 'react';
import { canvasStore } from '../mocks/canvasStore';
import { foldersStore } from '../mocks/foldersStore';
import type { CanvasDoc } from '../mocks/canvasStore';

/** The list of canvas documents. */
export function useCanvases(): CanvasDoc[] {
  return useSyncExternalStore(canvasStore.subscribe, canvasStore.getSnapshot);
}

/** The ordered list of folder keys. */
export function useFolders(): string[] {
  return useSyncExternalStore(foldersStore.subscribe, foldersStore.getSnapshot);
}

export { createCanvas, setCanvasFolder, updateCanvas, deleteCanvas, SHARED_CANVAS_ID } from '../mocks/canvasStore';
export { addFolder, moveFolder } from '../mocks/foldersStore';
export type { CanvasDoc } from '../mocks/canvasStore';
