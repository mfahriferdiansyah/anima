/**
 * Canvas presence and layout. Presence is ephemeral (custody invariant 4):
 * scripted cursors for one human peer (Mira) and the agent (Nova) loop
 * while the canvas is mounted. The layout mirrors the reserved note shape
 * from docs/integration.md section 6 ({noteId: {x, y}}), with a debounced
 * savingLayout pulse standing in for the new-version save.
 */
import { createStore } from './store';
import { mockMs } from './scenario';
import { canvasLayout } from './fixture';

export interface Peer {
  id: string;
  label: string;
  kind: 'human' | 'agent';
  x: number;
  y: number;
  isWriting: boolean;
}

export interface PresenceState {
  peers: Peer[];
  layout: Record<string, { x: number; y: number }>;
  savingLayout: boolean;
  /** Set briefly when the agent timeline adds a note; drives the materialize animation. */
  materializedNoteId: string | null;
}

function initialPeers(): Peer[] {
  return [
    { id: 'peer-mira', label: 'Mira', kind: 'human', x: 720, y: 220, isWriting: false },
    { id: 'peer-nova', label: 'Nova', kind: 'agent', x: 300, y: 420, isWriting: false },
  ];
}

const store = createStore<PresenceState>({
  peers: initialPeers(),
  layout: { ...canvasLayout },
  savingLayout: false,
  materializedNoteId: null,
});

export const presenceStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

let ticker: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveDoneTimer: ReturnType<typeof setTimeout> | null = null;
let materializeTimer: ReturnType<typeof setTimeout> | null = null;

/** Begin the scripted cursor loop (canvas mount). Idempotent. */
export function startPresence(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    tickCount += 1;
    const t = tickCount * 0.12;
    store.update((prev) => ({
      ...prev,
      peers: prev.peers.map((peer) =>
        peer.kind === 'human'
          ? {
              ...peer,
              x: 560 + 260 * Math.cos(t * 0.45),
              y: 300 + 150 * Math.sin(t * 0.6),
            }
          : {
              ...peer,
              x: 420 + 320 * Math.cos(t * 0.28 + 2.1),
              y: 340 + 180 * Math.sin(t * 0.37 + 0.6),
              isWriting: Math.sin(t * 0.2) > 0.45,
            },
      ),
    }));
  }, mockMs(120));
}

/** Stop the cursor loop (canvas unmount). */
export function stopPresence(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

/** Drag updates apply immediately; the layout save debounces 800ms then pulses savingLayout. */
export function moveNote(noteId: string, x: number, y: number): void {
  store.update((prev) => ({ ...prev, layout: { ...prev.layout, [noteId]: { x, y } } }));
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    store.update((prev) => ({ ...prev, savingLayout: true }));
    if (saveDoneTimer) clearTimeout(saveDoneTimer);
    saveDoneTimer = setTimeout(() => {
      saveDoneTimer = null;
      store.update((prev) => ({ ...prev, savingLayout: false }));
    }, mockMs(600));
  }, mockMs(800));
}

/** Place a freshly written agent note and flag it for the materialize animation. */
export function materializeNote(noteId: string, x = 660, y = 160): void {
  store.update((prev) => ({
    ...prev,
    layout: { ...prev.layout, [noteId]: { x, y } },
    materializedNoteId: noteId,
  }));
  if (materializeTimer) clearTimeout(materializeTimer);
  materializeTimer = setTimeout(() => {
    materializeTimer = null;
    store.update((prev) =>
      prev.materializedNoteId === noteId ? { ...prev, materializedNoteId: null } : prev,
    );
  }, mockMs(2400));
}

export function resetPresenceStore(): void {
  stopPresence();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (saveDoneTimer) {
    clearTimeout(saveDoneTimer);
    saveDoneTimer = null;
  }
  if (materializeTimer) {
    clearTimeout(materializeTimer);
    materializeTimer = null;
  }
  tickCount = 0;
  store.update(() => ({
    peers: initialPeers(),
    layout: { ...canvasLayout },
    savingLayout: false,
    materializedNoteId: null,
  }));
}
