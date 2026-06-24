/**
 * The anonymous multiplayer editor (plan 2026-06-24 U4) — loaded behind a DYNAMIC
 * import from `ReaderView` so its yjs + `@mysten` graph lands in a SEPARATE async
 * chunk, keeping the view read chunk `@mysten`- AND yjs-free (KTD6 / U2 byte-grep).
 *
 * A guest joins the relay room directly by its unguessable id:
 *  - `?room=<id>`          → join that room.
 *  - `?salt=<salt>&edit=1` → prompt for the password, derive `room-id =
 *    PBKDF2(password, salt)` (U1), and join that room. A wrong password computes
 *    a different, empty room — the relay does no token check.
 *
 * Concurrency is now a real CRDT (Yjs): the note body is a `Y.Text` bound to an
 * uncontrolled textarea (U3), so multiple guests type at once with no lost
 * keystrokes — the plan-008 whole-body LWW + soft-lock path is REPLACED. On join
 * the session broadcasts `sync-req`; the owner (or a present peer) answers with
 * the current state, so a late guest hydrates instead of starting blank. Wallet-
 * free: the guest never imports the session/agent stack.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Frame } from './Frame';
import { parseMsg, serializeMsg } from '../mocks/presenceStore';
import { deriveRoomId, syncReq } from '../web3/collabOps';
import { CollabSession } from '../web3/collabSession';
import { bindYText, contentEditableSurface } from '../web3/collabTextBinding';
import { PresenceStack, type PresenceMember } from '../components/PresenceStack';
import { guestSaveSignal, guestSaveText, type GuestSaveSignal } from '../web3/collabIdentity';
import { CanvasEditRoom } from './CanvasEditRoom';
import type { PresenceMsg } from '../../../chain/core/src/index.js';

// The relay base mirrors presenceStore.backendWsUrl (a Vite env, default localhost).
function relayUrl(room: string): string {
  const base = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080';
  const ws = base.replace(/^http/, 'ws');
  return `${ws}/presence?room=${encodeURIComponent(room)}`;
}

// A non-identifying session handle — NEVER a wallet address or a real name. Minted
// PER ROOM mount (not module-level) so two rooms in one process — and any future
// multi-room surface — don't collide on one id and drop each other as self-echoes.
function freshSelfId(): string {
  return `read-${Math.random().toString(36).slice(2, 10)}`;
}
function freshSelfLabel(): string {
  return `Guest ${Math.random().toString(36).slice(2, 6)}`;
}

type Phase =
  | { kind: 'pw' } // a salted link awaiting its password
  | { kind: 'deriving' } // computing the room id
  | { kind: 'live'; room: string }
  | { kind: 'error'; message: string };

export interface EditViewProps {
  room: string | null;
  salt: string | null;
  /** which surface the link opens: a note editor (default) or a board. */
  editKind?: 'note' | 'canvas';
  /** the owner's agent public key (hex) — the guest's trust anchor for verifying the owner. */
  opk?: string | null;
}

export function EditView({ room, salt, editKind = 'note', opk = null }: EditViewProps): ReactElement {
  const [phase, setPhase] = useState<Phase>(() =>
    room ? { kind: 'live', room } : salt ? { kind: 'pw' } : { kind: 'error', message: 'This edit link is incomplete.' },
  );

  if (phase.kind === 'error') {
    return (
      <Frame state="not-found" tag="Live edit">
        <div className="rd-center">
          <div className="rd-card">
            <h2>This edit link is incomplete</h2>
            <p>Ask the sender for a fresh link.</p>
            <a className="btn btn-primary" href="/">
              Go to Anima
            </a>
          </div>
        </div>
      </Frame>
    );
  }

  if (phase.kind === 'pw') {
    return <JoinGate onPassword={async (pw) => {
      setPhase({ kind: 'deriving' });
      try {
        const id = await deriveRoomId(pw, salt!);
        setPhase({ kind: 'live', room: id });
      } catch {
        setPhase({ kind: 'error', message: 'Could not derive the room.' });
      }
    }} />;
  }

  if (phase.kind === 'deriving') {
    return (
      <Frame state="loading" tag="Live edit">
        <div className="rd-doc rd-skeleton">
          <span />
          <span />
          <span />
          <span />
        </div>
      </Frame>
    );
  }

  // A password-derived room MUST see a verified owner before it is trusted as the
  // real room — a wrong password lands in a different empty room silently, and a
  // second guest with the same wrong password is not enough (C4). A no-password
  // `?room=` link is the unguessable room itself, so it joins directly.
  if (editKind === 'canvas') return <CanvasEditRoom room={phase.room} />;
  return <Room room={phase.room} requireOwner={room === null} opk={opk} />;
}

// ---------------------------------------------------------------------------
// Password gate for a salted edit link — wrong password lands in an empty room
// (it does not error). Distinct copy from the view-decrypt-fail gate.
// ---------------------------------------------------------------------------

function JoinGate({ onPassword }: { onPassword: (pw: string) => void }): ReactElement {
  const [pw, setPw] = useState('');
  // Neutral on first paint (no attempt yet) — mirrors the view gate's `loading`
  // label; a wrong password lands in a different empty room (it does not error).
  return (
    <Frame state="loading" tag="Live edit">
      <div className="rd-center">
        <form
          className="rd-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw) onPassword(pw);
          }}
        >
          <h2>Join this shared edit</h2>
          <p>Enter the password the sender shared to join the live room.</p>
          <div className="rd-field">
            <input
              className="rd-input"
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Password"
              aria-label="Password"
            />
            <button className="btn btn-primary" type="submit" disabled={!pw}>
              Join
            </button>
          </div>
        </form>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// The live room — a Yjs-bound textarea over the relay (concurrent typing).
// ---------------------------------------------------------------------------

/** How long a password room waits to see a confirming peer before flagging it as a likely-wrong-password phantom room. */
const JOIN_WINDOW_MS = 8000;

type JoinState = 'joining' | 'live' | 'unverified' | 'lost' | 'full';

function Room({ room, requireOwner }: { room: string; requireOwner: boolean; opk: string | null }): ReactElement {
  // `opk` (owner trust anchor) is consumed by the owner-signature gate in U5/U11;
  // the U10 gate here confirms the real room by a present peer before going live.
  // The body is the SAME contenteditable `.edtype` the in-app NoteEditor uses, so a
  // shared edit looks exactly like the real editor — not a generic textarea.
  const taRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<{ id: string; label: string } | null>(null);
  if (!idRef.current) idRef.current = { id: freshSelfId(), label: freshSelfLabel() };
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [saveSignal, setSaveSignal] = useState<GuestSaveSignal>('not-started');
  // The interactive-readiness of the editor:
  //  - 'joining'  : password room, waiting to confirm we reached the real room.
  //  - 'live'     : interactive (a no-password room is live immediately; a password
  //                 room becomes live once a peer/owner is confirmed present).
  //  - 'unverified': password room, no peer confirmed within the window — likely a
  //                  wrong password (a phantom empty room). NOT interactive.
  //  - 'lost'/'full': the socket dropped / the room is at capacity. NOT interactive.
  const [join, setJoin] = useState<JoinState>(requireOwner ? 'joining' : 'live');

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const { id: selfId, label } = idRef.current!;
    const ws = new WebSocket(relayUrl(room));
    const sockSend = (msg: PresenceMsg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(serializeMsg(msg));
    };
    const session = new CollabSession({ send: sockSend, selfId });
    session.awareness.setLocalStateField('user', { id: selfId, label });

    // Confirm we reached the REAL room: a password room must see at least one OTHER
    // peer (ideally the owner) before it is interactive — a wrong password lands in
    // a different, empty room where typing would be silently lost. Two guests with
    // the same wrong password would both see only each other; we still treat seeing
    // a peer as "joined" but keep the honest "saves while the owner's here" signal,
    // and gate on a verified owner once one is present.
    let confirmTimer: ReturnType<typeof setTimeout> | null = null;
    let ownerEverPresent = false;
    const refresh = () => {
      const seen: PresenceMember[] = [];
      let otherPeer = false;
      const states: { user?: { owner?: boolean }; seal?: string }[] = [];
      for (const [client, state] of session.awareness.getStates()) {
        const s = state as { user?: { id?: string; label?: string; owner?: boolean }; seal?: string };
        if (s.user?.id) seen.push({ id: s.user.id, label: s.user.label ?? 'Guest', isOwner: s.user.owner });
        if (s.user?.owner) ownerEverPresent = true;
        if (client !== session.doc.clientID) otherPeer = true;
        states.push(s);
      }
      setMembers(seen);
      setSaveSignal(guestSaveSignal(states, ownerEverPresent));
      if (requireOwner && otherPeer) setJoin('live'); // a peer confirms the room is real
    };
    session.awareness.on('change', refresh);

    ws.onopen = () => {
      sockSend({ t: 'hello', id: selfId, label, kind: 'human' });
      session.start();
      sockSend(syncReq(selfId));
      refresh();
      if (requireOwner) {
        // No confirming peer within the window → likely a wrong password.
        confirmTimer = setTimeout(() => setJoin((j) => (j === 'joining' ? 'unverified' : j)), JOIN_WINDOW_MS);
      }
    };
    ws.onmessage = (e) => {
      const msg = typeof e.data === 'string' ? parseMsg(e.data) : null;
      if (msg) session.onFrame(msg);
    };
    ws.onclose = (e) => {
      // 1008 = room full (terminal); anything else mid-session = a drop. The bye
      // we send on intentional unmount also lands here; React has already torn the
      // textarea down by then, so the state set is harmless.
      setJoin(e?.code === 1008 ? 'full' : 'lost');
    };

    const unbind = bindYText(session.doc.getText('body'), contentEditableSurface(ta));
    return () => {
      if (confirmTimer) clearTimeout(confirmTimer);
      unbind();
      session.awareness.off('change', refresh);
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(serializeMsg({ t: 'bye', id: selfId }));
      } catch {
        /* closing anyway */
      }
      session.destroy();
      ws.close();
    };
  }, [room, requireOwner]);

  // Terminal states render an honest surface, not a live-looking dead editor.
  if (join === 'full') {
    return (
      <Frame state="not-found" tag="Live edit">
        <div className="rd-center">
          <div className="rd-card">
            <h2>This room is full</h2>
            <p>Too many people are editing right now. Try again in a little while.</p>
          </div>
        </div>
      </Frame>
    );
  }
  if (join === 'unverified') {
    return (
      <Frame state="wrong-password" tag="Live edit">
        <div className="rd-center">
          <div className="rd-card">
            <h2>Couldn’t join this edit</h2>
            <p>No one else is in this room. Check the password with the person who shared it.</p>
          </div>
        </div>
      </Frame>
    );
  }

  const interactive = join === 'live';
  return (
    <Frame state="edit" tag="Live edit">
      {/* the live status + avatar stack, on a quiet bar above the document */}
      <div className="rd-livebar">
        <div className={saveSignal === 'owner-cant-save' ? 'sharenote rd-livenote rd-cantsave' : 'sharenote rd-livenote'}>
          {join === 'lost'
            ? 'Connection lost — reconnect to keep editing.'
            : join === 'joining'
              ? 'Joining the shared edit…'
              : guestSaveText(saveSignal)}
        </div>
        <PresenceStack members={members} />
      </div>
      {/* the body is the EXACT in-app editor surface: a centered .pgcol column with
          the .edtype contentEditable (kit.css), bound to the shared Y.Text (U3). */}
      <div className="pged-scroll">
        <div className="pgcol">
          <div
            ref={taRef}
            className="edtype"
            contentEditable={interactive}
            suppressContentEditableWarning
            spellCheck={false}
            role="textbox"
            aria-label="Shared note"
            data-ph={interactive ? 'Write your note…' : ''}
          />
        </div>
      </div>
    </Frame>
  );
}
