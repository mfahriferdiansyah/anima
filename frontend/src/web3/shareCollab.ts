/**
 * Owner-side note co-edit (plan 2026-06-24 U5) — the OWNER's counterpart to the
 * guest editor (reader/EditView, U4). While an `edit` share is active for the open
 * note, the owner joins the same relay room as the AUTHORITATIVE Yjs sync responder
 * and the SINGLE durable sealer.
 *
 * It speaks the same CRDT as the guest (CollabSession / y-sync, U2) — the plan-008
 * whole-body LWW `makeOwnerCollab` is replaced, since a guest now speaks Yjs and the
 * two must interoperate. The owner's Y.Text is seeded from the durable note body and
 * its updates flatten-to-markdown and seal on room-wide idle (sealOnIdle, U5),
 * cross-tab single-sealer-elected via the Web Locks lease (ownerLock, U5). The seal
 * is a PURE read of the Y.Text → the existing sealed write path, so it cannot loop.
 *
 * Custody is unchanged: only the owner's device seals; guests are live-only.
 */
import { useEffect, useRef, useState } from 'react';
import { useShare } from '../hooks/useShare';
import { persistGuestSnapshot } from '../hooks/useVault';
import { vaultData } from './vaultData';
import { serializeMsg, parseMsg } from '../mocks/presenceStore';
import { deriveRoomId, syncReq } from './collabOps';
import { CollabSession } from './collabSession';
import { bindYText, contentEditableSurface } from './collabTextBinding';
import { makeSealController } from './sealOnIdle';
import { acquireSealLease } from './ownerLock';
import { isInsufficientFunds } from './session';
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
  /** True while a durable seal is in flight (drives the saving/saved UI). */
  saving: boolean;
  /** Set when the last seal failed because the agent is out of funds (drives the funds notice + the guest signal, U11). */
  needsFunds: boolean;
}

/**
 * While an `edit` share is active for `noteId`, keep the owner connected as the
 * authoritative Yjs responder + single sealer. A no-op when there is no active
 * edit share. Optionally binds the editor's contenteditable surface to the live
 * Y.Text so the owner types into the same CRDT as the guests.
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
  const [saving, setSaving] = useState(false);
  const [needsFunds, setNeedsFunds] = useState(false);
  // A stable owner id across reconnects (no ghost owners). Derived once per mount;
  // the cross-tab single-sealer is the Web Locks lease, not this id.
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

    // Cross-tab single-sealer: exactly one owner tab seals (Web Locks; auto-released
    // on tab death). A non-leader tab observes and never seals.
    const lease = acquireSealLease(room);

    // Seal on room-wide idle: flatten the Y.Text to markdown and persist it via the
    // existing sealed write path (attributed to the live session). A PURE read — it
    // never mutates the doc, so it cannot loop.
    // Broadcast the owner's seal-state over awareness so guests render an HONEST
    // signal (saving / saved / can't-save). A guest can't fake this: it is on the
    // verified-owner's awareness entry (the owner badge is signature-gated, U9).
    const setSealState = (state: 'saving' | 'saved' | 'cant-save') => session.awareness.setLocalStateField('seal', state);

    const seal = makeSealController({
      readBody: () => yText.toString(),
      seal: async (body) => {
        if (!lease.isHeld()) return; // only the elected sealer writes
        try {
          await persistGuestSnapshot(noteId, body, 'Live edit');
          setNeedsFunds(false);
          setSealState('saved');
        } catch (e) {
          if (isInsufficientFunds(e)) {
            setNeedsFunds(true);
            setSealState('cant-save'); // the guest banner flips to "owner can't save right now"
          }
          throw e;
        }
      },
      onSealingChange: (s) => {
        setSaving(s);
        if (s) setSealState('saving');
      },
      onError: () => {
        /* surfaced via needsFunds + the seal-state awareness field */
      },
    });
    session.doc.on('update', seal.bump);

    // Refresh the relay's stored catch-up snapshot as the doc settles (debounced),
    // gated by the seal lease so exactly ONE owner tab posts — so a guest who joins
    // while the owner is offline hydrates the latest note, not a blank one.
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
      // Share end: flush any un-settled edits BEFORE tearing down, so no burst is
      // stranded between the live seal and the manual Save.
      seal.flushNow();
      if (roomStateTimer) clearTimeout(roomStateTimer);
      unbind?.();
      session.awareness.off('change', refreshGuests);
      session.doc.off('update', seal.bump);
      session.doc.off('update', postRoomStateSoon);
      seal.dispose();
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

  return { guestCount, live, saving, needsFunds };
}
