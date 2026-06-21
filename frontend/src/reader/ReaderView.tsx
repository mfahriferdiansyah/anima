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

// Mirror the testnet aggregator the app's chainConfig uses (chain/core/config.ts),
// but read it from a Vite env so the reader never imports that `@mysten`-laden module.
const AGG = import.meta.env.VITE_AGGREGATOR_URL ?? 'https://aggregator.walrus-testnet.walrus.space';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; title: string; bodyHtml: string; meta: string; cover: string | null }
  | { kind: 'password'; bytes: Uint8Array; error: string | null; busy: boolean }
  | { kind: 'not-found' }
  | { kind: 'network-error' };

/** A reader state label mirrored onto `[data-reader-state]` for the browser smoke. */
type ReaderStateAttr = 'loading' | 'ready' | 'wrong-password' | 'not-found' | 'network-error' | 'edit';

// ---------------------------------------------------------------------------
// URL parsing — `?b=` (view) and `?room=`/`?salt=&edit=1` (edit) are exclusive.
// ---------------------------------------------------------------------------

type Route =
  | { mode: 'view'; blobId: string; locked: boolean }
  | { mode: 'edit'; room: string | null; salt: string | null }
  | { mode: 'fixture' }
  | { mode: 'none' };

export function parseRoute(search: string, hash: string): Route {
  const q = new URLSearchParams(search);
  if (q.get('fixture') === '1' || hash === '#fixture') return { mode: 'fixture' };

  const b = q.get('b');
  if (b) return { mode: 'view', blobId: b, locked: q.get('locked') === '1' };

  const room = q.get('room');
  const salt = q.get('salt');
  if (room || (salt && q.get('edit') === '1')) return { mode: 'edit', room, salt };

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

/** Build a `ready` state from a plaintext serialized-note markdown blob. */
export function readyFromMarkdown(markdown: string): Extract<ViewState, { kind: 'ready' }> {
  const note = parseNote(markdown);
  return {
    kind: 'ready',
    title: note.title,
    bodyHtml: sanitizeNoteHtml(note.body),
    meta: note.author ? `Shared by ${note.author}` : 'Shared note',
    cover: presetCover(note.cover),
  };
}

/** Open a password envelope and build a `ready` state (throws on wrong password). */
async function readyFromEnvelope(bytes: Uint8Array, password: string): Promise<Extract<ViewState, { kind: 'ready' }>> {
  const note = await openWithPassword(bytes, password);
  return {
    kind: 'ready',
    title: note.title,
    bodyHtml: sanitizeNoteHtml(note.body),
    meta: note.author ? `Shared by ${note.author}` : 'Shared note',
    cover: presetCover(note.cover),
  };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function Shell({ state, children }: { state: ReaderStateAttr; children: ReactElement }): ReactElement {
  // `data-reader-state` lets a screenshot agent read a pass/fail verdict from the DOM.
  return (
    <div className="rd-shell" data-reader-state={state}>
      {children}
    </div>
  );
}

function LoadingDoc(): ReactElement {
  return (
    <Shell state="loading">
      <div className="rd-doc rd-skeleton">
        <span />
        <span />
        <span />
        <span />
      </div>
    </Shell>
  );
}

function NotFound(): ReactElement {
  return (
    <Shell state="not-found">
      <div className="rd-center">
        <div className="rd-card">
          <h2>This link is no longer available</h2>
          <p>The shared note may have been revoked, or the link is incomplete.</p>
          <a className="rd-link" href="/">
            Go to Anima
          </a>
        </div>
      </div>
    </Shell>
  );
}

function NetworkError({ onRetry }: { onRetry: () => void }): ReactElement {
  return (
    <Shell state="network-error">
      <div className="rd-center">
        <div className="rd-card">
          <h2>Could not load this note</h2>
          <p>The network request failed. Check your connection and try again.</p>
          <button className="rd-btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    </Shell>
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
    <Shell state={error ? 'wrong-password' : 'loading'}>
      <div className="rd-center">
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
            <button className="rd-btn" type="submit" disabled={!pw || busy}>
              {busy ? 'Opening…' : 'Open'}
            </button>
          </div>
          {error ? <div className="rd-error">{error}</div> : null}
        </form>
      </div>
    </Shell>
  );
}

function ReadyDoc({ title, bodyHtml, meta, cover }: Extract<ViewState, { kind: 'ready' }>): ReactElement {
  return (
    <Shell state="ready">
      <article className="rd-doc">
        <div className="rd-brand">Anima · shared</div>
        {cover ? <img className="rd-cover" src={cover} alt="" /> : null}
        <h1 className="rd-title">{title}</h1>
        <div className="rd-meta">{meta}</div>
        {/* THE XSS SINK — bodyHtml is always sanitizeNoteHtml() output. */}
        <div className="rd-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      </article>
    </Shell>
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

function EditReader({ room, salt }: { room: string | null; salt: string | null }): ReactElement {
  const [El, setEl] = useState<null | ((p: { room: string | null; salt: string | null }) => ReactElement)>(null);
  useEffect(() => {
    let on = true;
    void import('./EditView').then((m) => {
      if (on) setEl(() => m.EditView);
    });
    return () => {
      on = false;
    };
  }, []);
  if (!El) return <LoadingDoc />;
  return <El room={room} salt={salt} />;
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
  return <ReadyDoc {...readyFromMarkdown(FIXTURE_NOTE)} />;
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
    case 'view':
      return <ViewReader blobId={route.blobId} locked={route.locked} />;
    case 'edit':
      return <EditReader room={route.room} salt={route.salt} />;
    case 'none':
      return <NotFound />;
  }
}
