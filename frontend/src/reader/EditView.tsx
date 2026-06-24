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
import { presetCover } from './ReaderView';
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
  /** the note header, baked into the link so the document chrome shows immediately. */
  title?: string | null;
  cover?: string | null;
  updated?: string | null;
  rev?: string | null;
  sealed?: string | null;
}

export function EditView({
  room,
  salt,
  editKind = 'note',
  opk = null,
  title = null,
  cover = null,
  updated = null,
  rev = null,
  sealed = null,
}: EditViewProps): ReactElement {
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

  if (editKind === 'canvas') return <CanvasEditRoom room={phase.room} />;
  return (
    <Room
      room={phase.room}
      opk={opk}
      meta={{ title, cover, updated, rev, sealed }}
    />
  );
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
// The live room — a Yjs-bound contenteditable over the relay (concurrent typing).
// Editing is NEVER blocked on owner presence: a guest can always type; the durable
// save just happens while the owner is present (an honest, non-blocking notice).
// ---------------------------------------------------------------------------

type Conn = 'connecting' | 'live' | 'lost' | 'full';

interface DocMeta {
  title: string;
  cover: string | null;
  updated: string;
  rev: string;
  sealed: string;
}

function Room({
  room,
  meta,
}: {
  room: string;
  opk: string | null;
  meta: { title: string | null; cover: string | null; updated: string | null; rev: string | null; sealed: string | null };
}): ReactElement {
  // The body is the SAME contenteditable `.edtype` the in-app NoteEditor uses, and
  // the same title + props (updated / sealed) + divider chrome, so a shared edit
  // looks EXACTLY like the real editor.
  const taRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<{ id: string; label: string } | null>(null);
  if (!idRef.current) idRef.current = { id: freshSelfId(), label: freshSelfLabel() };
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [saveSignal, setSaveSignal] = useState<GuestSaveSignal>('not-started');
  const [conn, setConn] = useState<Conn>('connecting');
  // The document header shows IMMEDIATELY from the link; a live owner can refine it
  // via awareness, but it never waits for the owner.
  const [docMeta, setDocMeta] = useState<DocMeta>(() => ({
    title: meta.title ?? '',
    cover: presetCover(meta.cover ?? undefined),
    updated: meta.updated ?? '',
    rev: meta.rev ?? '',
    sealed: meta.sealed ?? '',
  }));

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

    let ownerEverPresent = false;
    const refresh = () => {
      const seen: PresenceMember[] = [];
      const states: { user?: { owner?: boolean }; seal?: string }[] = [];
      for (const [, state] of session.awareness.getStates()) {
        const s = state as {
          user?: { id?: string; label?: string; owner?: boolean };
          seal?: string;
          doc?: { title?: string; cover?: string };
        };
        if (s.user?.id) seen.push({ id: s.user.id, label: s.user.label ?? 'Guest', isOwner: s.user.owner });
        if (s.user?.owner) {
          ownerEverPresent = true;
          // a live owner can refine the header (e.g. a title typed after sharing)
          if (s.doc) setDocMeta((m) => ({ ...m, title: s.doc!.title ?? m.title, cover: presetCover(s.doc!.cover) ?? m.cover }));
        }
        states.push(s);
      }
      setMembers(seen);
      setSaveSignal(guestSaveSignal(states, ownerEverPresent));
    };
    session.awareness.on('change', refresh);

    ws.onopen = () => {
      setConn('live');
      sockSend({ t: 'hello', id: selfId, label, kind: 'human' });
      session.start();
      sockSend(syncReq(selfId));
      refresh();
    };
    ws.onmessage = (e) => {
      const msg = typeof e.data === 'string' ? parseMsg(e.data) : null;
      if (msg) session.onFrame(msg);
    };
    ws.onclose = (e) => {
      // 1008 = room full (terminal); any other mid-session close = a drop. The bye
      // we send on intentional unmount also lands here, harmlessly post-teardown.
      setConn(e?.code === 1008 ? 'full' : 'lost');
    };

    const unbind = bindYText(session.doc.getText('body'), contentEditableSurface(ta));
    return () => {
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
  }, [room]);

  // A full room is the one terminal state (no point editing into a void); a drop is
  // recoverable so the editor stays usable, just flagged.
  if (conn === 'full') {
    return (
      <Frame state="not-found" tag="LIVE EDIT">
        <div className="rd-center">
          <div className="rd-card">
            <h2>This room is full</h2>
            <p>Too many people are editing right now. Try again in a little while.</p>
          </div>
        </div>
      </Frame>
    );
  }

  // The honest, NON-BLOCKING status — a running-text banner. Editing is always on.
  const statusText =
    conn === 'lost'
      ? 'Connection lost — reconnect to keep editing.'
      : conn === 'connecting'
        ? 'Connecting to the shared edit…'
        : guestSaveText(saveSignal);

  return (
    <Frame state="edit" tag="LIVE EDIT" headerExtra={<PresenceStack members={members} />}>
      {/* a running-text status banner (marquee) — informational, never blocks editing */}
      <div className={saveSignal === 'owner-cant-save' ? 'rd-marquee rd-marquee-warn' : 'rd-marquee'} role="status">
        <div className="rd-marquee-track">
          <span>{statusText}</span>
          <span aria-hidden="true">{statusText}</span>
        </div>
      </div>
      {/* the EXACT in-app editor surface: the cover banner + a centered .pgcol column
          with the title and the .edtype contentEditable (kit.css), bound to the
          shared Y.Text (U3). The cover is preset-allowlisted; a sealed cover the
          wallet-free reader can't resolve simply doesn't render. */}
      <div className="pged-scroll">
        {docMeta.cover ? (
          <div className="pgbanner-wrap">
            <div className="pgbanner">
              <img src={docMeta.cover} alt="" />
            </div>
          </div>
        ) : null}
        <div className={docMeta.cover ? 'pgcol haz' : 'pgcol'}>
          <h1 className="pgtitle">{docMeta.title || 'Untitled'}</h1>
          {/* the same props block + bottom divider as the in-app editor */}
          {docMeta.updated || docMeta.sealed ? (
            <div className="props">
              {docMeta.updated ? (
                <div className="proprow">
                  <span className="pk">updated</span>
                  <span className="pv">
                    <span className="mono">{docMeta.updated}</span>
                  </span>
                </div>
              ) : null}
              {docMeta.sealed || docMeta.rev ? (
                <div className="proprow">
                  <span className="pk">sealed</span>
                  <span className="pv">
                    <span className="mono">
                      <span style={{ color: 'var(--teal-500)' }} aria-hidden="true">✦</span>
                      {docMeta.rev ? ` rev ${docMeta.rev}` : ''}
                      {docMeta.sealed ? ` · ${docMeta.sealed}` : ''}
                    </span>
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
          <div
            ref={taRef}
            className="edtype edcontent"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            role="textbox"
            aria-label="Shared note"
            data-ph="Write your note…"
          />
        </div>
      </div>
    </Frame>
  );
}
