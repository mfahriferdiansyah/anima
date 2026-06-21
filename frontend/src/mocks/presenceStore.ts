/**
 * Canvas presence + durable layout (plan U9 — R31/R32, the shared constellation).
 *
 * Presence is EPHEMERAL and plaintext-through-relay: a real `/presence`
 * WebSocket client (unauth, 4 KB frame cap, 32 peers) relays `PresenceMsg`
 * frames — cursors, writing pings, hello/bye — that this store reduces into the
 * `peers[]` list. Nothing here is persisted; the relay sees no key. The peer
 * `label` is a NON-IDENTIFYING session handle, never a wallet address or name.
 *
 * The LAYOUT is DURABLE: it lives as the reserved `anima:canvas-layout` note on
 * Walrus (`saveLayout`/`loadLayout`), last-write-wins per object, written
 * SILENTLY (no toast). Overlapping drags are coalesced into one pending write so
 * two same-version layout quilts never ship (the resurrection-determinism guard).
 *
 * Module load is side-effect-free (no WS, no env read) so the pure cores —
 * `reducePeers`, `serializeMsg`/`parseMsg`, and `createLayoutSaver` — stay
 * node-testable. The socket and the chain write only run once `startPresence`
 * is called from the mounted board.
 */
import { createStore } from './store';
import { LAYOUT_TAG, loadLayout, saveLayout, type CanvasLayout, type PresenceMsg } from '../../../chain/core/src/index.js';
import { getQuiltDeps } from '../web3/session';
import { vaultData } from '../web3/vaultData';

export interface Peer {
  id: string;
  label: string;
  kind: 'human' | 'agent';
  x: number;
  y: number;
  isWriting: boolean;
}

/** Socket health, distinct so the board can tell a normal "alone" room from a
 * lost connection or a terminal room-full lockout (the latter never reconnects). */
export type ConnectionState = 'live' | 'lost' | 'full';

export interface PresenceState {
  peers: Peer[];
  layout: Record<string, { x: number; y: number }>;
  savingLayout: boolean;
  /** Set briefly when a peer reports a freshly written note; drives the materialize animation. */
  materializedNoteId: string | null;
  /** Socket health — additive to the contract; Canvas keeps reading the four fields above. */
  connection: ConnectionState;
}

const store = createStore<PresenceState>({
  peers: [],
  layout: {},
  savingLayout: false,
  materializedNoteId: null,
  connection: 'live',
});

export const presenceStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

// ---------------------------------------------------------------------------
// Pure core 1 — presence wire (de)serialization
// ---------------------------------------------------------------------------

/** Encode a `PresenceMsg` to the relay's raw-JSON text frame (well under 4 KB). */
export function serializeMsg(msg: PresenceMsg): string {
  return JSON.stringify(msg);
}

/** Decode a received text frame; returns null for anything malformed/unknown. */
export function parseMsg(raw: string): PresenceMsg | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      if (typeof m.id === 'string' && typeof m.label === 'string' && (m.kind === 'human' || m.kind === 'agent')) {
        return { t: 'hello', id: m.id, label: m.label, kind: m.kind };
      }
      return null;
    case 'cursor':
      if (typeof m.id === 'string' && typeof m.x === 'number' && typeof m.y === 'number') {
        return { t: 'cursor', id: m.id, x: m.x, y: m.y };
      }
      return null;
    case 'writing':
      if (typeof m.id === 'string' && typeof m.on === 'boolean') {
        return { t: 'writing', id: m.id, on: m.on };
      }
      return null;
    case 'note-created':
      if (typeof m.id === 'string' && typeof m.noteId === 'string') {
        return { t: 'note-created', id: m.id, noteId: m.noteId };
      }
      return null;
    case 'bye':
      if (typeof m.id === 'string') return { t: 'bye', id: m.id };
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Pure core 2 — the peers[] reducer
// ---------------------------------------------------------------------------

/**
 * Fold a received `PresenceMsg` into the peer list. `hello` adds (or refreshes)
 * a peer, `cursor` moves it (adding a placeholder if it arrives before hello),
 * `writing` toggles its ping, `bye` drops it. `note-created` carries no peer
 * mutation here (the materialize id is handled by the receive wiring). Always
 * returns a new array (never mutates the input) for snapshot identity.
 */
export function reducePeers(peers: Peer[], msg: PresenceMsg): Peer[] {
  switch (msg.t) {
    case 'hello': {
      const rest = peers.filter((p) => p.id !== msg.id);
      const existing = peers.find((p) => p.id === msg.id);
      return [
        ...rest,
        {
          id: msg.id,
          label: msg.label,
          kind: msg.kind,
          x: existing?.x ?? 0,
          y: existing?.y ?? 0,
          isWriting: existing?.isWriting ?? false,
        },
      ];
    }
    case 'cursor': {
      const existing = peers.find((p) => p.id === msg.id);
      if (!existing) {
        // A cursor before its hello: track the position with a placeholder peer.
        return [...peers, { id: msg.id, label: '', kind: 'human', x: msg.x, y: msg.y, isWriting: false }];
      }
      return peers.map((p) => (p.id === msg.id ? { ...p, x: msg.x, y: msg.y } : p));
    }
    case 'writing':
      return peers.map((p) => (p.id === msg.id ? { ...p, isWriting: msg.on } : p));
    case 'bye':
      return peers.filter((p) => p.id !== msg.id);
    case 'note-created':
      return peers;
  }
}

// ---------------------------------------------------------------------------
// Pure core 3 — the overlap-coalescing layout saver
// ---------------------------------------------------------------------------

/** The injected async write (real impl = `saveLayout(...)`). */
export type SaveFn = (layout: CanvasLayout) => Promise<unknown>;

export interface LayoutSaver {
  /** Request a save of `layout`. Fires immediately if idle, else coalesces into
   *  one pending write keyed to the LATEST snapshot. */
  requestSave(layout: CanvasLayout): void;
  /** True while a write is in flight (drives the `savingLayout` pulse). */
  isSaving(): boolean;
}

/**
 * Coalesce overlapping saves so two same-version layout quilts never ship.
 * `saveLayout` reads the index version synchronously but upserts only after the
 * ~10s write, so two overlapping saves would both read version V and both emit
 * V+1. This controller serializes them: while one write is in flight, further
 * requests collapse into ONE pending write (the latest layout), fired only when
 * the current write resolves — so the version increments monotonically and
 * exactly one quilt exists per logical change.
 *
 * `onSavingChange` pulses the `savingLayout` UI flag true→false around the
 * (possibly chained) write sequence. Debounce lives OUTSIDE this controller —
 * it decides WHEN to call `requestSave`; this decides whether the call fires or
 * coalesces. Pure (no timers, injected `save`) so it is node-testable.
 */
export function createLayoutSaver(save: SaveFn, onSavingChange?: (saving: boolean) => void): LayoutSaver {
  let inFlight = false;
  let pending: CanvasLayout | null = null;

  function fire(layout: CanvasLayout): void {
    if (!inFlight) onSavingChange?.(true); // pulse on the idle→saving edge only
    inFlight = true;
    void save(layout).finally(() => {
      if (pending !== null) {
        const next = pending;
        pending = null;
        fire(next); // chain the coalesced write (savingLayout stays true)
      } else {
        inFlight = false;
        onSavingChange?.(false);
      }
    });
  }

  return {
    requestSave(layout) {
      if (inFlight) {
        pending = layout; // collapse to the latest snapshot
      } else {
        fire(layout);
      }
    },
    isSaving: () => inFlight,
  };
}

// ---------------------------------------------------------------------------
// Live wiring — the WebSocket client + the real layout save (integration path)
// ---------------------------------------------------------------------------

const SELF_ID = `web-${Math.random().toString(36).slice(2, 10)}`;
/** A non-identifying session handle — NEVER a wallet address or real name. */
const SELF_LABEL = `Guest ${Math.random().toString(36).slice(2, 6)}`;
const CURSOR_THROTTLE_MS = 50; // a send-rate cap (frames are ~40 bytes, far under 4 KB)
const SAVE_DEBOUNCE_MS = 800;

let socket: WebSocket | null = null;
/** Set by stopPresence so the onclose handler reads a normal unmount, not a drop. */
let intentionalClose = false;
let cursorThrottle: ReturnType<typeof setTimeout> | null = null;
let saveDebounce: ReturnType<typeof setTimeout> | null = null;
let layoutSaver: LayoutSaver | null = null;
let materializeTimer: ReturnType<typeof setTimeout> | null = null;

function backendWsUrl(vaultId: string): string {
  const base = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080';
  const ws = base.replace(/^http/, 'ws');
  return `${ws}/presence?vault=${encodeURIComponent(vaultId)}`;
}

function send(msg: PresenceMsg): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(serializeMsg(msg));
}

/** Apply a received frame to the store (peers + materialize). */
function onFrame(msg: PresenceMsg): void {
  if (msg.t === 'note-created') {
    store.update((prev) => ({
      ...prev,
      peers: reducePeers(prev.peers, msg),
      materializedNoteId: msg.noteId,
    }));
    if (materializeTimer) clearTimeout(materializeTimer);
    materializeTimer = setTimeout(() => {
      materializeTimer = null;
      store.update((prev) =>
        prev.materializedNoteId === msg.noteId ? { ...prev, materializedNoteId: null } : prev,
      );
    }, 2400);
    return;
  }
  store.update((prev) => ({ ...prev, peers: reducePeers(prev.peers, msg) }));
}

/**
 * Begin presence for the shared board (canvas mount). Idempotent. Seeds the
 * layout from the durable reserved note, then connects the relay and announces
 * via `hello`. `vaultId` defaults to the ready vault's id (`getQuiltDeps()`); a
 * no-op if no vault is ready.
 */
export function startPresence(vaultId?: string): void {
  if (socket) return;
  const deps = getQuiltDeps();
  const id = vaultId ?? deps?.vaultId;
  if (!id) return;

  // Seed positions from the durable layout note (resurrects the constellation).
  const index = vaultData.getSnapshot().index;
  const seeded: CanvasLayout = index ? loadLayout(index) : {};
  store.update((prev) => ({ ...prev, layout: { ...seeded }, connection: 'live', peers: [] }));

  intentionalClose = false;
  const ws = new WebSocket(backendWsUrl(id));
  socket = ws;

  ws.onopen = () => {
    send({ t: 'hello', id: SELF_ID, label: SELF_LABEL, kind: 'human' });
  };
  ws.onmessage = (event) => {
    const msg = typeof event.data === 'string' ? parseMsg(event.data) : null;
    if (msg) onFrame(msg);
  };
  ws.onclose = (event) => {
    if (socket !== ws) return; // a superseded socket
    socket = null;
    if (intentionalClose) return; // normal unmount via stopPresence
    // 1008 = StatusPolicyViolation (room full) — terminal, no reconnect.
    const connection: ConnectionState = event.code === 1008 ? 'full' : 'lost';
    store.update((prev) => ({ ...prev, peers: [], connection }));
  };
  ws.onerror = () => {
    // Surfacing happens on the following close; nothing to do here.
  };
}

/** Stop presence (canvas unmount). A normal, intentional close — not a drop. */
export function stopPresence(): void {
  intentionalClose = true;
  if (cursorThrottle) {
    clearTimeout(cursorThrottle);
    cursorThrottle = null;
  }
  if (socket) {
    if (socket.readyState === WebSocket.OPEN) send({ t: 'bye', id: SELF_ID });
    socket.close();
    socket = null;
  }
}

/** Broadcast the local cursor (throttled under the relay's send-rate budget). */
export function moveCursor(x: number, y: number): void {
  if (cursorThrottle) return;
  send({ t: 'cursor', id: SELF_ID, x, y });
  cursorThrottle = setTimeout(() => {
    cursorThrottle = null;
  }, CURSOR_THROTTLE_MS);
}

/** Broadcast that the local user started/stopped writing a note. */
export function setWriting(on: boolean): void {
  send({ t: 'writing', id: SELF_ID, on });
}

function ensureLayoutSaver(): LayoutSaver {
  if (!layoutSaver) {
    layoutSaver = createLayoutSaver(
      async (layout) => {
        const deps = getQuiltDeps();
        const index = vaultData.getSnapshot().index;
        if (!deps || !index) return;
        // SILENT write through U2's write-event path: it emits NO toast (silent),
        // but still REGISTERS in vaultData.writeStates so the bulk-forget quiesce
        // (U7) — which awaits any in-flight {encrypting,certifying} write before a
        // vault wipe — covers the layout autosave too. The key is the reserved
        // layout tag, so it never collides with a real note or shows in notes().
        const eventId = vaultData.beginWriteEvent({
          noteId: LAYOUT_TAG,
          noteTitle: 'Canvas layout',
          state: { phase: 'certifying' },
          silent: true,
        });
        try {
          await saveLayout(deps, index, layout); // reserved note, last-write-wins
          vaultData.updateWriteEvent(eventId, { phase: 'certified', blobObjectId: '', provenanceUrl: '' });
        } catch (e) {
          vaultData.updateWriteEvent(eventId, { phase: 'failed' });
          throw e; // keep the coalescing .finally chain advancing
        }
      },
      (saving) => store.update((prev) => ({ ...prev, savingLayout: saving })),
    );
  }
  return layoutSaver;
}

/**
 * A note moved on the board: apply the position optimistically, then debounce
 * the durable save. The save is overlap-coalesced (one quilt per logical change)
 * and silent (no toast).
 */
export function moveNote(noteId: string, x: number, y: number): void {
  store.update((prev) => ({ ...prev, layout: { ...prev.layout, [noteId]: { x, y } } }));
  if (saveDebounce) clearTimeout(saveDebounce);
  saveDebounce = setTimeout(() => {
    saveDebounce = null;
    ensureLayoutSaver().requestSave({ ...store.getSnapshot().layout });
  }, SAVE_DEBOUNCE_MS);
}

export function resetPresenceStore(): void {
  stopPresence();
  if (saveDebounce) {
    clearTimeout(saveDebounce);
    saveDebounce = null;
  }
  if (materializeTimer) {
    clearTimeout(materializeTimer);
    materializeTimer = null;
  }
  layoutSaver = null;
  intentionalClose = false;
  store.update(() => ({
    peers: [],
    layout: {},
    savingLayout: false,
    materializedNoteId: null,
    connection: 'live',
  }));
}
