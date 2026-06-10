/**
 * Framework-free store with the subscribe/getSnapshot contract that
 * React's useSyncExternalStore expects. No DOM, no React imports, so
 * every mock store stays testable from plain vitest in node.
 */
export type Listener = () => void;

export interface MockStore<T> {
  getSnapshot: () => T;
  subscribe: (listener: Listener) => () => void;
  update: (updater: (prev: T) => T) => void;
}

export function createStore<T>(initial: T): MockStore<T> {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (updater) => {
      state = updater(state);
      for (const listener of listeners) listener();
    },
  };
}
