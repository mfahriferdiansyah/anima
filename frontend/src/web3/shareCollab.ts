/**
 * Owner-side anonymous-collab wiring (plan 008 AE4 / R27). The reader's EditView
 * gives GUESTS a live multiplayer editor; this is the OWNER's counterpart: while
 * an edit share is active for the open note, the owner client joins the same
 * relay room, is the allowlisted writer, and turns inbound guest edits into
 * sealed, wallet-owned snapshots (the durable artifact of an anonymous session,
 * never produced by the keyless backend).
 *
 * The persist path doubles as the apply path: an inbound guest `note-op` is
 * debounce-persisted via `persistGuestSnapshot`, which upserts the vault index,
 * which re-renders the editor with the guest's body. So we never push remote text
 * into the block editor's internal state mid-edit (a fragile live two-way sync);
 * the owner sees a guest edit once it lands as a real sealed version, attributed
 * to the guest label. The owner's own edits are broadcast to guests so the loop
 * closes, with a guard so a just-persisted guest body is not echoed back.
 *
 * Concurrency is last-write-wins per note (no CRDT, disclosed). The relay drops
 * frames and never replays, so a snapshot is the owner's observed state (KTD3).
 */
import { useEffect, useState } from 'react';
import { useShare } from '../hooks/useShare';
import { persistGuestSnapshot } from '../hooks/useVault';
import { vaultData } from './vaultData';
import { serializeMsg, parseMsg } from '../mocks/presenceStore';
import { deriveRoomId, noteOp } from './collabOps';
import { makeCollabPersister, type CollabPersister } from './collabPersist';
import type { PresenceMsg } from '../../../chain/core/src/index.js';

/** The relay URL for a share room (mirrors EditView): rooms key on an unguessable id. */
function relayUrl(room: string): string {
  const base = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080';
  const ws = base.replace(/^http/, 'ws');
  return `${ws}/presence?room=${encodeURIComponent(room)}`;
}

// ---------------------------------------------------------------------------
// Pure controller — node-testable (injected send + persister).
// ---------------------------------------------------------------------------

export interface OwnerCollab {
  /** An inbound relay frame. */
  onFrame(msg: PresenceMsg): void;
  /** The owner's note body changed locally (read from the vault index). */
  onOwnerBody(body: string): void;
  /** How many guests are currently in the room. */
  guestCount(): number;
  dispose(): void;
}

export function makeOwnerCollab(opts: {
  noteId: string;
  selfId: string;
  send: (msg: PresenceMsg) => void;
  persister: CollabPersister;
}): OwnerCollab {
  const { noteId, selfId, send, persister } = opts;
  const labels = new Map<string, string>(); // guest id -> label
  let suppress: string | null = null; // a guest body just handed to the persister; do not echo it

  return {
    onFrame(msg) {
      if (msg.t === 'hello' && msg.id !== selfId) {
        labels.set(msg.id, msg.label || 'Guest');
      } else if (msg.t === 'bye') {
        labels.delete(msg.id);
      } else if (msg.t === 'note-op' && msg.id !== selfId) {
        // a guest edit: remember it (so the persist-driven index change does not
        // bounce back out), then debounce-persist a sealed snapshot attributed to
        // the guest. The owner being present is what makes this persist (AE4).
        suppress = msg.body;
        persister.onGuestEdit(noteId, msg.body, labels.get(msg.id) ?? 'Guest');
      }
    },
    onOwnerBody(body) {
      if (body === suppress) {
        suppress = null; // this change came from a guest op we persisted; do not re-broadcast
        return;
      }
      send(noteOp(selfId, noteId, body));
    },
    guestCount: () => labels.size,
    dispose() {
      labels.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// The hook — connects the owner to the active edit-share room.
// ---------------------------------------------------------------------------

/**
 * While an `edit` share is active for `noteId`, keep the owner connected to its
 * relay room as the allowlisted writer (persisting guest edits as sealed
 * snapshots, broadcasting the owner's edits). A no-op when there is no active
 * edit share. Returns the live-guest count + connection state for a small UI hint.
 */
export function useShareCollab(noteId: string): { guestCount: number; live: boolean } {
  const { links } = useShare();
  const link = links.find((l) => l.noteId === noteId && l.access === 'edit') ?? null;
  const linkRoomId = link?.roomId ?? null;
  const linkSalt = link?.salt ?? null;
  const linkPassword = link?.password ?? null;

  const [room, setRoom] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState(0);
  const [live, setLive] = useState(false);

  // resolve the room id: a plain id for a no-password edit link, or the
  // PBKDF2(password, salt) derivation the owner can compute (it set the password).
  useEffect(() => {
    let cancelled = false;
    if (linkRoomId) {
      setRoom(linkRoomId);
    } else if (linkSalt && linkPassword) {
      void deriveRoomId(linkPassword, linkSalt).then((id) => {
        if (!cancelled) setRoom(id);
      });
    } else {
      setRoom(null);
    }
    return () => {
      cancelled = true;
    };
  }, [linkRoomId, linkSalt, linkPassword]);

  useEffect(() => {
    if (!room) {
      setLive(false);
      setGuestCount(0);
      return;
    }
    const selfId = `own-${Math.random().toString(36).slice(2, 10)}`;
    const ws = new WebSocket(relayUrl(room));
    const persister = makeCollabPersister({
      persistSnapshot: (id, body, label) => persistGuestSnapshot(id, body, label),
    });
    const collab = makeOwnerCollab({
      noteId,
      selfId,
      send: (m) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(serializeMsg(m));
      },
      persister,
    });

    let lastBody = vaultData.getSnapshot().index?.get(noteId)?.note.body ?? '';

    ws.onopen = () => {
      ws.send(serializeMsg({ t: 'hello', id: selfId, label: 'Owner', kind: 'human' }));
      persister.setWriterPresent(true); // the owner is the allowlisted writer
      setLive(true);
      collab.onOwnerBody(lastBody); // seed late guests with the current body
    };
    ws.onmessage = (e) => {
      const msg = typeof e.data === 'string' ? parseMsg(e.data) : null;
      if (!msg) return;
      collab.onFrame(msg);
      setGuestCount(collab.guestCount());
    };
    ws.onclose = () => setLive(false);

    // the owner's local edits (any change to this note's body in the index) → guests
    const unsub = vaultData.subscribe(() => {
      const b = vaultData.getSnapshot().index?.get(noteId)?.note.body ?? '';
      if (b !== lastBody) {
        lastBody = b;
        collab.onOwnerBody(b);
      }
    });

    return () => {
      unsub();
      persister.setWriterPresent(false);
      persister.dispose();
      collab.dispose();
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(serializeMsg({ t: 'bye', id: selfId }));
      } catch {
        /* closing anyway */
      }
      ws.close();
    };
  }, [room, noteId]);

  return { guestCount, live };
}
