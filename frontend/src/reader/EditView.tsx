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
import { bindYText, textareaSurface } from '../web3/collabTextBinding';
import { PresenceStack, type PresenceMember } from '../components/PresenceStack';
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

export function EditView({ room, salt }: EditViewProps): ReactElement {
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

  return <Room room={phase.room} />;
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

function Room({ room }: { room: string }): ReactElement {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const idRef = useRef<{ id: string; label: string } | null>(null);
  if (!idRef.current) idRef.current = { id: freshSelfId(), label: freshSelfLabel() };
  const [members, setMembers] = useState<PresenceMember[]>([]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const { id: selfId, label } = idRef.current!;
    const ws = new WebSocket(relayUrl(room));
    const sockSend = (msg: PresenceMsg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(serializeMsg(msg));
    };
    // The session emits frames through the socket; the socket feeds inbound frames
    // back into the session. (The session is created with the socket send, so the
    // doc/awareness wiring and the relay share one path.)
    const session = new CollabSession({ send: sockSend, selfId });
    // Announce our anonymous identity over awareness; render the avatar stack from
    // the awareness states (who is in the room, MS-Docs style).
    session.awareness.setLocalStateField('user', { id: selfId, label });
    const refreshMembers = () => {
      const seen: PresenceMember[] = [];
      for (const state of session.awareness.getStates().values()) {
        const user = (state as { user?: { id?: string; label?: string } }).user;
        if (user?.id) seen.push({ id: user.id, label: user.label ?? 'Guest' });
      }
      setMembers(seen);
    };
    session.awareness.on('change', refreshMembers);
    ws.onopen = () => {
      sockSend({ t: 'hello', id: selfId, label, kind: 'human' });
      session.start(); // announce our state vector + awareness
      sockSend(syncReq(selfId)); // ask the owner / a present peer for the current doc
      refreshMembers();
    };
    ws.onmessage = (e) => {
      const msg = typeof e.data === 'string' ? parseMsg(e.data) : null;
      if (msg) session.onFrame(msg);
    };
    // Bind the Y.Text to the uncontrolled textarea — concurrent typing, caret-safe.
    const unbind = bindYText(session.doc.getText('body'), textareaSurface(ta));
    return () => {
      unbind();
      session.awareness.off('change', refreshMembers);
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(serializeMsg({ t: 'bye', id: selfId }));
      } catch {
        /* closing anyway */
      }
      session.destroy();
      ws.close();
    };
  }, [room]);

  return (
    <Frame state="edit" tag="Live edit">
      <div className="rd-editor">
        <div className="rd-editor-top">
          <div className="sharenote rd-livenote">Edits are live. Changes save while the owner is here.</div>
          <PresenceStack members={members} />
        </div>
        <textarea
          ref={taRef}
          className="rd-textarea"
          defaultValue=""
          placeholder="Start typing to collaborate…"
          aria-label="Shared note"
        />
      </div>
    </Frame>
  );
}
