/**
 * The chromeless participant/reader view (plan 008 U3, R26/AE8).
 *
 * Renders ONE shared doc with no app sidebar:
 *  - VIEW  (`?b=<blobId>` [+ `?locked=1`]) — fetch the published blob from the
 *    aggregator over plain HTTP, open a password envelope client-side if locked,
 *    then render the body THROUGH `sanitizeNoteHtml` (the XSS sink). No wallet,
 *    no Seal, no chain call.
 *  - EDIT  (`?room=<id>` OR `?salt=<salt>&edit=1`) — anonymous multiplayer over
 *    the unauthenticated relay. The editor is behind a DYNAMIC import so its code
 *    (and whatever it pulls) lands in a separate async chunk — the view read path
 *    stays `@mysten`-free (KTD6).
 *
 * BUNDLE ISOLATION: every static import in this file (and its `./EditView` is the
 * only exception, dynamic) must avoid `@mysten/*`. So we import `parseNote` from
 * `../../../chain/core/src/notes.js` (NOT the barrel), the crypto/url helpers from
 * `share-crypto.js` (NOT `share.js`), and `sanitizeNoteHtml` from `web3/collabOps`
 * (whose only chain import is `import type`). The aggregator base comes from a Vite
 * env, NOT `chain/core/config.ts` (which imports the wallet stack at module scope).
 *
 * Relative imports throughout: the `@/` alias does not resolve under vitest, and
 * `ReaderView.test.tsx` loads this module directly.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { parseNote } from '../../../chain/core/src/notes.js';
import { isPasswordShare, openWithPassword } from '../../../chain/core/src/share-crypto.js';
import { sanitizeNoteHtml } from '../web3/collabOps';
import { Frame } from './Frame';
import { CanvasReadonly } from './CanvasReadonly';
import type { CanvasSnapshot } from '../web3/canvasSnapshot';

// Mirror the testnet aggregator the app's chainConfig uses (chain/core/config.ts),
// but read it from a Vite env so the reader never imports that `@mysten`-laden module.
const AGG = import.meta.env.VITE_AGGREGATOR_URL ?? 'https://aggregator.walrus-testnet.walrus.space';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; title: string; bodyHtml: string; meta: string; cover: string | null }
  | { kind: 'canvas'; snapshot: CanvasSnapshot }
  | { kind: 'password'; bytes: Uint8Array; error: string | null; busy: boolean }
  | { kind: 'not-found' }
  | { kind: 'network-error' };

// ---------------------------------------------------------------------------
// URL parsing — `?b=` (view) and `?room=`/`?salt=&edit=1` (edit) are exclusive.
// ---------------------------------------------------------------------------

type Route =
  | { mode: 'view'; blobId: string; locked: boolean }
  | { mode: 'edit'; room: string | null; salt: string | null; editKind: 'note' | 'canvas'; opk: string | null }
  | { mode: 'fixture' }
  | { mode: 'fixture-locked' }
  | { mode: 'fixture-canvas' }
  | { mode: 'none' };

export function parseRoute(search: string, hash: string): Route {
  const q = new URLSearchParams(search);
  // `?fixture=…` renders a deterministic surface with no network, for the screenshot smoke.
  if (q.get('fixture') === 'locked' || hash === '#fixture-locked') return { mode: 'fixture-locked' };
  if (q.get('fixture') === 'canvas' || hash === '#fixture-canvas') return { mode: 'fixture-canvas' };
  if (q.get('fixture') === '1' || hash === '#fixture') return { mode: 'fixture' };

  const b = q.get('b');
  if (b) return { mode: 'view', blobId: b, locked: q.get('locked') === '1' };

  const room = q.get('room');
  const salt = q.get('salt');
  if (room || (salt && q.get('edit') === '1')) {
    // `&kind=canvas` routes to the board surface (default note); `&opk=` is the
    // owner's agent public key, the guest's trust anchor for verifying the owner.
    const editKind = q.get('kind') === 'canvas' ? 'canvas' : 'note';
    return { mode: 'edit', room, salt, editKind, opk: q.get('opk') };
  }

  return { mode: 'none' };
}

// ---------------------------------------------------------------------------
// Cover — preset-only in the reader (KTD6). The cover `src` is the ONE rendered
// field that does not pass through `sanitizeNoteHtml` (it comes from frontmatter
// straight into `<img src>`), and published blobs are untrusted — so this is an
// ALLOWLIST, not a denylist: render ONLY a static `/covers/*.svg` preset. A
// `seal:`/`blob:` ref needs a wallet/`@mysten` the reader cannot have, and any
// other value (an external URL, a `javascript:`/`data:` ref) is an exfiltration /
// tracking-pixel vector — all are silently ignored (no broken image). Inlined
// (not `covers.ts`) because that module imports the wallet stack.
// ---------------------------------------------------------------------------

export function presetCover(ref: string | undefined): string | null {
  if (!ref) return null;
  return ref.startsWith('/covers/') && ref.endsWith('.svg') ? ref : null;
}

// ---------------------------------------------------------------------------
// View read path — fetch the blob, decrypt if needed, sanitize, render.
// ---------------------------------------------------------------------------

/** A decoded note body that is a canvas snapshot (`anima:'canvas'` marker), else null. */
function canvasSnapshotOf(body: string): CanvasSnapshot | null {
  try {
    const parsed = JSON.parse(body) as { anima?: string };
    return parsed && parsed.anima === 'canvas' ? (parsed as CanvasSnapshot) : null;
  } catch {
    return null; // ordinary markdown body — not JSON
  }
}

/** The `ready` doc state from a parsed note. */
function readyDocFromNote(note: ReturnType<typeof parseNote>): Extract<ViewState, { kind: 'ready' }> {
  return {
    kind: 'ready',
    title: note.title,
    bodyHtml: sanitizeNoteHtml(note.body),
    meta: note.author ? `Shared by ${note.author}` : 'Shared note',
    cover: presetCover(note.cover),
  };
}

/** A decoded share renders as one of these two doc states. */
type ViewDoc = Extract<ViewState, { kind: 'ready' | 'canvas' }>;

/** Classify a decoded note: a canvas snapshot → canvas view, else a markdown doc. */
function viewStateFromNote(note: ReturnType<typeof parseNote>): ViewDoc {
  const snapshot = canvasSnapshotOf(note.body);
  return snapshot ? { kind: 'canvas', snapshot } : readyDocFromNote(note);
}

/** Build the view state from a plaintext serialized-note (markdown OR canvas snapshot). */
export function readyFromMarkdown(markdown: string): ViewDoc {
  return viewStateFromNote(parseNote(markdown));
}

/** Open a password envelope and classify (throws on wrong password). */
async function readyFromEnvelope(bytes: Uint8Array, password: string): Promise<ViewDoc> {
  return viewStateFromNote(await openWithPassword(bytes, password));
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function LoadingDoc(): ReactElement {
  return (
    <Frame state="loading">
      <div className="rd-doc rd-skeleton">
        <span />
        <span />
        <span />
        <span />
      </div>
    </Frame>
  );
}

function NotFound(): ReactElement {
  return (
    <Frame state="not-found">
      <div className="rd-center">
        <div className="rd-card">
          <h2>This link is no longer available</h2>
          <p>The shared note may have been revoked, or the link is incomplete.</p>
          <a className="btn btn-primary" href="/">
            Go to Anima
          </a>
        </div>
      </div>
    </Frame>
  );
}

function NetworkError({ onRetry }: { onRetry: () => void }): ReactElement {
  return (
    <Frame state="network-error">
      <div className="rd-center">
        <div className="rd-card">
          <h2>Could not load this note</h2>
          <p>The network request failed. Check your connection and try again.</p>
          <button className="btn btn-primary" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    </Frame>
  );
}

function PasswordGate({
  error,
  busy,
  onSubmit,
}: {
  error: string | null;
  busy: boolean;
  onSubmit: (pw: string) => void;
}): ReactElement {
  const [pw, setPw] = useState('');
  // wrong-password is the smoke-relevant state when an error is present.
  return (
    <Frame state={error ? 'wrong-password' : 'loading'} tag="Shared with you" bleed>
      <div className="rd-locked">
        {/* a blurred doc skeleton + frosted veil behind the modal — "there is
            content here, locked" — then the password card as a centered modal. */}
        <div className="rd-locked-bg" aria-hidden="true">
          <div className="rd-doc rd-skeleton">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="rd-locked-veil" aria-hidden="true" />
        <div className="rd-modal">
        <form
          className="rd-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw && !busy) onSubmit(pw);
          }}
        >
          <h2>This note is password-protected</h2>
          <p>Enter the password the sender shared with you to read it.</p>
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
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Opening…' : 'Open'}
            </button>
          </div>
          {error ? <div className="rd-error">{error}</div> : null}
        </form>
        </div>
      </div>
    </Frame>
  );
}

function ReadyDoc({ title, bodyHtml, meta, cover }: Extract<ViewState, { kind: 'ready' }>): ReactElement {
  return (
    <Frame state="ready">
      <article className="rd-doc">
        {cover ? <img className="rd-cover" src={cover} alt="" /> : null}
        <h1 className="rd-title">{title}</h1>
        <div className="rd-meta">{meta}</div>
        {/* THE XSS SINK — bodyHtml is always sanitizeNoteHtml() output. */}
        <div className="rd-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      </article>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// The view-path container (fetch + state machine). No edit code is imported here.
// ---------------------------------------------------------------------------

function ViewReader({ blobId, locked }: { blobId: string; locked: boolean }): ReactElement {
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0); // retry trigger
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      let res: Response;
      try {
        res = await fetch(`${AGG}/v1/blobs/${encodeURIComponent(blobId)}`);
      } catch {
        if (!cancelled) setState({ kind: 'network-error' });
        return;
      }
      if (cancelled) return;
      if (res.status === 404) {
        setState({ kind: 'not-found' });
        return;
      }
      if (!res.ok) {
        setState({ kind: 'network-error' });
        return;
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await res.arrayBuffer());
      } catch {
        if (!cancelled) setState({ kind: 'network-error' });
        return;
      }
      if (cancelled) return;
      // A locked link or an envelope payload → gate on a password before any render.
      if (locked || isPasswordShare(bytes)) {
        setState({ kind: 'password', bytes, error: null, busy: false });
        return;
      }
      try {
        setState(readyFromMarkdown(new TextDecoder().decode(bytes)));
      } catch {
        setState({ kind: 'not-found' }); // unparseable payload — treat as a dead link
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blobId, locked, attempt]);

  if (state.kind === 'loading') return <LoadingDoc />;
  if (state.kind === 'not-found') return <NotFound />;
  if (state.kind === 'network-error') return <NetworkError onRetry={() => setAttempt((n) => n + 1)} />;
  if (state.kind === 'canvas') return <CanvasReadonly snapshot={state.snapshot} />;
  if (state.kind === 'ready') return <ReadyDoc {...state} />;

  // password gate
  return (
    <PasswordGate
      error={state.error}
      busy={state.busy}
      onSubmit={async (pw) => {
        setState({ ...state, busy: true, error: null });
        try {
          const ready = await readyFromEnvelope(state.bytes, pw);
          if (mounted.current) setState(ready);
        } catch {
          // wrong password reveals NOTHING — stay on the gate with an inline error.
          if (mounted.current) {
            setState({ ...state, busy: false, error: 'That password did not open this note. Try again.' });
          }
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// The edit-path container — loads the multiplayer editor behind a dynamic import
// so its code (and any transitive `@mysten`) is a SEPARATE async chunk (KTD6).
// ---------------------------------------------------------------------------

interface EditReaderProps {
  room: string | null;
  salt: string | null;
  editKind: 'note' | 'canvas';
  opk: string | null;
}

function EditReader({ room, salt, editKind, opk }: EditReaderProps): ReactElement {
  const [El, setEl] = useState<null | ((p: EditReaderProps) => ReactElement)>(null);
  useEffect(() => {
    let on = true;
    void import('./EditView').then((m) => {
      if (on) setEl(() => m.EditView as (p: EditReaderProps) => ReactElement);
    });
    return () => {
      on = false;
    };
  }, []);
  if (!El) return <LoadingDoc />;
  return <El room={room} salt={salt} editKind={editKind} opk={opk} />;
}

// ---------------------------------------------------------------------------
// Fixture — a no-network sample doc through the REAL sanitize+render path, for the
// browser smoke (so a screenshot agent reads `[data-reader-state=ready]`). It also
// proves the XSS sink: the sample body carries a hostile fragment that must vanish.
// ---------------------------------------------------------------------------

const FIXTURE_NOTE = [
  '---',
  'noteId: fixture-1',
  'version: 1',
  'updatedAt: 2026-06-21T00:00:00.000Z',
  'author: owner',
  'tags: []',
  'links: []',
  'cover: /covers/ethos-orbit.svg',
  '---',
  '# Notes on a shared canvas',
  '',
  'This is a **chromeless** shared note rendered through the real sanitize path.',
  '',
  'A hostile fragment that must not survive: <script>alert(1)</script> and an',
  '<img src=x onerror="alert(2)"> tag.',
  '',
  '- a list item',
  '- [a safe link](https://example.com)',
  '',
].join('\n');

function FixtureDoc(): ReactElement {
  // Render synchronously, no fetch — the smoke screenshot must be deterministic.
  const s = readyFromMarkdown(FIXTURE_NOTE);
  return s.kind === 'canvas' ? <CanvasReadonly snapshot={s.snapshot} /> : <ReadyDoc {...s} />;
}

function FixtureLocked(): ReactElement {
  // The password gate with no fetched envelope — for the screenshot smoke.
  return <PasswordGate error={null} busy={false} onSubmit={() => {}} />;
}

/** A hardcoded board snapshot to render the read-only canvas with no wallet/network. */
const FIXTURE_CANVAS: CanvasSnapshot = {
  v: 1,
  anima: 'canvas',
  title: 'Wedding planning',
  elements: [
    { id: 'r1', type: 'rect', x: 80, y: 80, w: 560, h: 260, angle: 0, index: 0, version: 1, versionNonce: 1, strokeColor: '#2F6BFF', strokeStyle: 'dashed', label: 'This week' },
    { id: 'n1', type: 'note', noteId: 'a', x: 120, y: 140, w: 190, h: 88, angle: 0, index: 1, version: 1, versionNonce: 2 },
    { id: 'n2', type: 'note', noteId: 'b', x: 400, y: 210, w: 190, h: 88, angle: 0, index: 2, version: 1, versionNonce: 3 },
    { id: 'a1', type: 'arrow', x: 310, y: 184, w: 90, h: 70, angle: 0, index: 3, version: 1, versionNonce: 4, points: [0, 0, 90, 70] },
    { id: 't1', type: 'text', x: 120, y: 380, w: 260, h: 24, angle: 0, index: 4, version: 1, versionNonce: 5, text: 'Call Maya about the vows' },
    { id: 'e1', type: 'ellipse', x: 470, y: 360, w: 150, h: 90, angle: 0, index: 5, version: 1, versionNonce: 6, strokeColor: '#FF5C1A' },
  ],
  notes: {
    a: { title: 'Check in with Maya', excerpt: 'Reach out to your sister Maya today to talk about the wedding.', byAgent: false },
    b: { title: 'Sister wedding', excerpt: 'Venue booked. Catering pending. Send the playlist over the weekend.', byAgent: true },
  },
};

function FixtureCanvas(): ReactElement {
  return <CanvasReadonly snapshot={FIXTURE_CANVAS} />;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function ReaderView(): ReactElement {
  const loc = typeof window !== 'undefined' ? window.location : { search: '', hash: '' };
  const route = parseRoute(loc.search, loc.hash);

  switch (route.mode) {
    case 'fixture':
      return <FixtureDoc />;
    case 'fixture-locked':
      return <FixtureLocked />;
    case 'fixture-canvas':
      return <FixtureCanvas />;
    case 'view':
      return <ViewReader blobId={route.blobId} locked={route.locked} />;
    case 'edit':
      return <EditReader room={route.room} salt={route.salt} editKind={route.editKind} opk={route.opk} />;
    case 'none':
      return <NotFound />;
  }
}
