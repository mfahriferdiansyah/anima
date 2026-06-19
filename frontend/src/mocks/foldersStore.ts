/**
 * Folder order (mock). Folders are just an ordered list of names; an item's
 * membership lives on the item (a note's tags[0], a canvas's folder). This
 * store exists so an empty / newly-added folder can persist even with no items,
 * and so the manage modal can reorder them. Names are lowercase keys (matching
 * note tags); the sidebar title-cases them for display.
 */
import { createStore } from './store';

const store = createStore<string[]>(['research', 'trips', 'work', 'reading', 'product']);

export const foldersStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

export function addFolder(name: string): void {
  const key = name.trim().toLowerCase();
  if (!key) return;
  store.update((prev) => (prev.includes(key) ? prev : [...prev, key]));
}

/** Move a folder one slot up (dir -1) or down (dir +1). */
export function moveFolder(name: string, dir: -1 | 1): void {
  store.update((prev) => {
    const i = prev.indexOf(name);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}
