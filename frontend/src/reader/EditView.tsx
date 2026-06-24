/**
 * The anonymous multiplayer editor (plan 008 U3, R26/R32) — loaded behind a
 * DYNAMIC import from `ReaderView` so it (and `presenceStore`'s transitive
 * `@mysten` graph) lands in a SEPARATE async chunk, keeping the view read chunk
 * `@mysten`-free (KTD6). The edit chunk MAY contain `@mysten`; only the view path
 * must not.
 *
 * A guest joins the relay room directly by its unguessable id:
 *  - `?room=<id>`         → join that room.
 *  - `?salt=<salt>&edit=1` → prompt for the password, derive `room-id =
 *    PBKDF2(password, salt)` (U1), and join that room. A wrong password computes
 *    a different, empty room — the relay does no token check.
 *
 * Concurrency is the U1 soft-lock: a `note-writing` ping claims the note; a peer
 * who does not hold the lock sees a non-editable body + a "Someone is editing"
 * banner with a take-over affordance (auto-releases ~5s after the last ping). The
 * editable text lives in REACT STATE (never innerHTML) — only the read view uses
 * `dangerouslySetInnerHTML`, and only through `sanitizeNoteHtml`. A late guest
 * with no owner present sees the live state only (the relay never replays).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Frame } from './Frame';
import { parseMsg, serializeMsg } from '../mocks/presenceStore';
import {
  deriveRoomId,
  reduceLocks,
  lockedBy,
  takeOver,
  noteOp,
  noteWriting,
  LOCK_TTL_MS,
  type LockMap,
} from '../web3/collabOps';
import type { PresenceMsg } from '../../../chain/core/src/index.js';

// The relay base mirrors presenceStore.backendWsUrl (a Vite env, default localhost).
function relayUrl(room: string): string {
  const base = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080';
  const ws = base.replace(/^http/, 'ws');
  return `${ws}/presence?room=${encodeURIComponent(room)}`;
}

// A non-identifying session handle — NEVER a wallet address or a real name.
const SELF_ID = `read-${Math.random().toString(36).slice(2, 10)}`;
const SELF_LABEL = `Guest ${Math.random().toString(36).slice(2, 6)}`;
// One shared note per live edit room (the reader edits a single doc).
const NOTE_ID = 'shared';
const WRITING_OFF_MS = 1200; // stop the "writing" ping this long after the last keystroke

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
// The live room — a textarea over the relay, with the soft-lock banner.
// ---------------------------------------------------------------------------

function Room({ room }: { room: string }): ReactElement {
  const [text, setText] = useState('');
  const [locks, setLocks] = useState<LockMap>({});
  const [, tick] = useState(0); // re-render to re-evaluate lock staleness
  const socketRef = useRef<WebSocket | null>(null);
  const writingOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connect the relay room directly by its unguessable id (no wallet, no session).
  useEffect(() => {
    const ws = new WebSocket(relayUrl(room));
    socketRef.current = ws;
    ws.onopen = () => {
      ws.send(serializeMsg({ t: 'hello', id: SELF_ID, label: SELF_LABEL, kind: 'human' }));
    };
    ws.onmessage = (e) => {
      const msg = typeof e.data === 'string' ? parseMsg(e.data) : null;
      if (!msg) return;
      // A peer's body snapshot is the document state — applied through REACT STATE
      // (never innerHTML). Ignore our own echoes.
      if (msg.t === 'note-op' && msg.id !== SELF_ID) setText(msg.body);
      if (msg.t === 'note-writing') setLocks((prev) => reduceLocks(prev, msg, Date.now()));
    };
    return () => {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(serializeMsg({ t: 'bye', id: SELF_ID }));
      } catch {
        /* closing anyway */
      }
      ws.close();
      socketRef.current = null;
    };
  }, [room]);

  // Re-evaluate the soft-lock staleness on a timer (the holder may have gone quiet).
  useEffect(() => {
    const h = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, []);

  const holder = lockedBy(locks, NOTE_ID, SELF_ID, Date.now(), LOCK_TTL_MS);
  const locked = holder !== null;

  function send(msg: PresenceMsg): void {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(serializeMsg(msg));
  }

  function onChange(next: string): void {
    setText(next);
    // claim the soft lock + broadcast the body snapshot (LWW per note)
    send(noteWriting(SELF_ID, NOTE_ID, true));
    send(noteOp(SELF_ID, NOTE_ID, next));
    if (writingOffTimer.current) clearTimeout(writingOffTimer.current);
    writingOffTimer.current = setTimeout(() => {
      send(noteWriting(SELF_ID, NOTE_ID, false));
    }, WRITING_OFF_MS);
  }

  function reclaim(): void {
    setLocks((prev) => takeOver(prev, NOTE_ID));
    send(noteWriting(SELF_ID, NOTE_ID, true)); // immediately assert our claim
  }

  return (
    <Frame state="edit" tag="Live edit">
      <div className="rd-editor">
        {locked ? (
          <div className="rd-lockbanner">
            <span>Someone is editing — wait or take over.</span>
            <button className="btn btn-sm" onClick={reclaim}>
              Take over
            </button>
          </div>
        ) : (
          <div className="rd-notsaved">
            Edits are live but not saved — the owner must be present to persist them.
          </div>
        )}
        <textarea
          className="rd-textarea"
          value={text}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
          placeholder={locked ? '' : 'Start typing to collaborate…'}
          aria-label="Shared note"
        />
      </div>
    </Frame>
  );
}
