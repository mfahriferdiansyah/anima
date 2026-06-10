/**
 * Global write-state events, consumed by the bottom-left toast stack so
 * saves are visible from any surface. vaultStore emits and advances the
 * events; the UI only renders and dismisses them.
 */
import type { WriteState } from '../components/WriteStateCard';
import { createStore } from './store';

export interface WriteEvent {
  id: string;
  noteId: string;
  noteTitle: string;
  state: WriteState;
}

interface WriteEventsState {
  events: WriteEvent[];
}

const store = createStore<WriteEventsState>({ events: [] });

export const writeStateStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

let counter = 0;

export function beginWriteEvent(noteId: string, noteTitle: string, state: WriteState): string {
  counter += 1;
  const id = `write-${counter}`;
  store.update((prev) => ({ events: [...prev.events, { id, noteId, noteTitle, state }] }));
  return id;
}

export function updateWriteEvent(id: string, state: WriteState): void {
  store.update((prev) => ({
    events: prev.events.map((event) => (event.id === id ? { ...event, state } : event)),
  }));
}

export function dismissWriteEvent(id: string): void {
  store.update((prev) => ({ events: prev.events.filter((event) => event.id !== id) }));
}

export function resetWriteStateStore(): void {
  counter = 0;
  store.update(() => ({ events: [] }));
}
