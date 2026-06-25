/**
 * Owner-side note co-edit (plan 2026-06-24 U5) — the OWNER's counterpart to the
 * guest editor (reader/EditView, U4). While an `edit` share is active for the open
 * note, the owner joins the same relay room as the AUTHORITATIVE Yjs sync responder.
 *
 * It speaks the same CRDT as the guest (CollabSession / y-sync, U2). The owner's
 * Y.Text is seeded from the durable note body and bound to the in-app editor, so
 * the owner types into the same CRDT as the guests.
 *
 * Durable saves are MANUAL: writing to Walrus happens ONLY when the owner clicks
 * Save in the note editor (`NoteEditor.save` reads the live bound surface and calls
 * `saveNote`), never on a timer. What this module keeps fresh is the relay's
 * EPHEMERAL catch-up snapshot (`room-state`) — a single owner tab (Web Locks lease)
 * posts it so a guest joining while the owner is offline still hydrates the latest
 * live text. That snapshot is relay-only, never durable; Walrus stays the only
 * durable store, written solely by the manual Save.
 */
import { useEffect, useRef, useState } from 'react';
import { useShare } from '../hooks/useShare';
import { vaultData } from './vaultData';
import { serializeMsg, parseMsg } from '../mocks/presenceStore';
import { deriveRoomId, syncReq } from './collabOps';
import { CollabSession } from './collabSession';
import { bindYText, contentEditableSurface } from './collabTextBinding';
import { acquireSealLease } from './ownerLock';
import type { PresenceMsg } from '../../../chain/core/src/index.js';

/** The relay URL for a share room (mirrors EditView): rooms key on an unguessable id. */
function relayUrl(room: string): string {
  const base = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080';
  const ws = base.replace(/^http/, 'ws');
  return `${ws}/presence?room=${encodeURIComponent(room)}`;
}

export interface ShareCollabState {
  /** How many guests are currently in the room. */
  guestCount: number;
  /** True while the owner is connected to the live room. */
  live: boolean;
}

/**
 * While an `edit` share is active for `noteId`, keep the owner connected as the
 * authoritative Yjs responder. A no-op when there is no active edit share.
 * Optionally binds the editor's contenteditable surface to the live Y.Text so the
 * owner types into the same CRDT as the guests. Durable persistence is the manual
 * Save in the note editor — this hook never writes to Walrus.
 *
 * @param noteId the open note
 * @param editorRef a ref to the in-app editor's source-mode contenteditable (optional;
 *        when present the owner's typing drives the shared Y.Text directly)
 */
export function useShareCollab(noteId: string, editorRef?: React.RefObject<HTMLElement | null>): ShareCollabState {
  const { links } = useShare();
  const link = links.find((l) => l.noteId === noteId && l.access === 'edit') ?? null;
  const linkRoomId = link?.roomId ?? null;
  const linkSalt = link?.salt ?? null;
  const linkPassword = link?.password ?? null;

  const [room, setRoom] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState(0);
  const [live, setLive] = useState(false);
  // A stable owner id across reconnects (no ghost owners). Derived once per mount;
  // the single room-state poster across tabs is the Web Locks lease, not this id.
  const selfIdRef = useRef<string | null>(null);
  if (!selfIdRef.current) selfIdRef.current = `own-${Math.random().toString(36).slice(2, 10)}`;

  // Resolve the room id: a plain id for a no-password edit link, or PBKDF2(password, salt).
  useEffect(() => {
    let cancelled = false;
    if (linkRoomId) setRoom(linkRoomId);
    else if (linkSalt && linkPassword) void deriveRoomId(linkPassword, linkSalt).then((id) => !cancelled && setRoom(id));
    else setRoom(null);
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
    const selfId = selfIdRef.current!;
    const ws = new WebSocket(relayUrl(room));
    const sockSend = (msg: PresenceMsg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(serializeMsg(msg));
    };
    const session = new CollabSession({ send: sockSend, selfId });
    session.authoritative = true; // the owner answers a guest's sync-req with the current doc
    const yText = session.doc.getText('body');

    // Seed the CRDT from the durable note body (the owner brings the saved state).
    const seedNote = vaultData.getSnapshot().index?.get(noteId)?.note;
    const seedBody = seedNote?.body ?? '';
    if (seedBody) yText.insert(0, seedBody);

    // Cross-tab single poster of the relay catch-up snapshot: exactly one owner tab
    // posts room-state (Web Locks; auto-released on tab death) so two tabs don't race.
    const lease = acquireSealLease(room);

    // Refresh the relay's stored catch-up snapshot as the doc settles (debounced),
    // gated by the lease so exactly ONE owner tab posts — so a guest who joins while
    // the owner is offline hydrates the latest live text, not a blank one. This is a
    // RELAY post (ephemeral), NOT a durable write — Walrus is only the manual Save.
    let roomStateTimer: ReturnType<typeof setTimeout> | null = null;
    const postRoomStateSoon = (): void => {
      if (!lease.isHeld()) return;
      if (roomStateTimer) clearTimeout(roomStateTimer);
      roomStateTimer = setTimeout(() => {
        roomStateTimer = null;
        session.postRoomState();
      }, 1500);
    };
    session.doc.on('update', postRoomStateSoon);

    // Bind the in-app editor's contenteditable to the shared Y.Text (if provided),
    // so the owner types into the same CRDT as the guests.
    let unbind: (() => void) | null = null;
    const el = editorRef?.current;
    if (el) unbind = bindYText(yText, contentEditableSurface(el));

    const refreshGuests = () => {
      let n = 0;
      for (const client of session.awareness.getStates().keys()) if (client !== session.doc.clientID) n++;
      setGuestCount(n);
    };
    session.awareness.on('change', refreshGuests);
    session.awareness.setLocalStateField('user', { id: selfId, label: 'Owner', owner: true });
    // Share the note's title + cover ref so the guest's edit page shows the same
    // document header as the in-app editor (the cover is preset-allowlisted on the
    // reader, so a sealed/uploaded ref simply doesn't render — wallet-free safe).
    session.awareness.setLocalStateField('doc', { title: seedNote?.title ?? '', cover: seedNote?.cover ?? '' });

    ws.onopen = () => {
      sockSend({ t: 'hello', id: selfId, label: 'Owner', kind: 'human' });
      session.start();
      sockSend(syncReq(selfId));
      // Seed the relay's catch-up snapshot with the saved note immediately, so a
      // guest opening the link while we're offline hydrates it even with no edits.
      session.postRoomState();
      setLive(true);
    };
    ws.onmessage = (e) => {
      const msg = typeof e.data === 'string' ? parseMsg(e.data) : null;
      if (msg) session.onFrame(msg);
    };
    ws.onclose = () => setLive(false);

    return () => {
      if (roomStateTimer) clearTimeout(roomStateTimer);
      unbind?.();
      session.awareness.off('change', refreshGuests);
      session.doc.off('update', postRoomStateSoon);
      lease.release();
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(serializeMsg({ t: 'bye', id: selfId }));
      } catch {
        /* closing anyway */
      }
      session.destroy();
      ws.close();
    };
  }, [room, noteId, editorRef]);

  return { guestCount, live };
}
