/**
 * The public reader — a memory published as an article. NO wallet, NO
 * providers, NO backend: the page reads straight from a public Walrus
 * aggregator. Password shares decrypt entirely in the browser.
 */
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { marked } from 'marked';
import '../theme/tokens.css';
import { parseNote, isPasswordShare, openWithPassword, aggregatorUrl, type Note } from '@core/index.js';

type State =
  | { s: 'loading' }
  | { s: 'locked'; bytes: Uint8Array; error?: string }
  | { s: 'ready'; note: Note }
  | { s: 'error'; message: string };

function Reader() {
  const params = new URLSearchParams(location.search);
  const blobId = params.get('b');
  const [state, setState] = useState<State>({ s: 'loading' });
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!blobId) return setState({ s: 'error', message: 'missing blob id (?b=…)' });
    (async () => {
      const res = await fetch(aggregatorUrl(blobId));
      if (!res.ok) throw new Error(`this memory is no longer published (${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (isPasswordShare(bytes)) setState({ s: 'locked', bytes });
      else setState({ s: 'ready', note: parseNote(new TextDecoder().decode(bytes)) });
    })().catch((e) => setState({ s: 'error', message: e.message }));
  }, [blobId]);

  async function unlock(bytes: Uint8Array) {
    try {
      setState({ s: 'ready', note: await openWithPassword(bytes, password) });
    } catch {
      setState({ s: 'locked', bytes, error: 'wrong password' });
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-6 py-14">
      <article className="w-full max-w-2xl flex flex-col gap-6">
        <header className="flex items-center gap-2.5">
          <div className="orb" style={{ width: 20, height: 20 }} />
          <span style={{ fontWeight: 600 }}>anima</span>
          <span className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>· a shared memory</span>
        </header>

        {state.s === 'loading' && <p className="text-fg-muted">reading from Walrus…</p>}

        {state.s === 'error' && <p style={{ color: 'var(--color-danger)' }}>{state.message}</p>}

        {state.s === 'locked' && (
          <div className="card p-6 flex flex-col gap-3">
            <p style={{ fontWeight: 600 }}>This memory is password-protected</p>
            <p className="text-fg-muted" style={{ fontSize: 'var(--text-meta)' }}>
              It decrypts in your browser — the password is never sent anywhere.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && unlock(state.bytes)}
                placeholder="password"
                className="card flex-1 px-4 py-2.5 outline-none focus:border-border-strong"
                autoFocus
              />
              <button
                onClick={() => unlock(state.bytes)}
                className="px-5 rounded-[10px] font-semibold text-canvas"
                style={{ background: 'linear-gradient(90deg, var(--color-soul-violet), var(--color-soul-cyan))' }}
              >
                unlock
              </button>
            </div>
            {state.error && <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-meta)' }}>{state.error}</p>}
          </div>
        )}

        {state.s === 'ready' && (
          <>
            <h1 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              {state.note.title}
            </h1>
            <div className="flex items-center gap-3 text-fg-muted" style={{ fontSize: 'var(--text-meta)' }}>
              <span>by {state.note.author}</span>
              <span>· {new Date(state.note.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              {state.note.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
            <div
              className="article-body"
              style={{ fontSize: '1.05rem', lineHeight: 1.75 }}
              dangerouslySetInnerHTML={{ __html: marked.parse(state.note.body) as string }}
            />
            <footer className="mt-8 pt-5 text-fg-faint flex flex-col gap-1" style={{ borderTop: '1px solid var(--color-border)', fontSize: 'var(--text-meta)' }}>
              <span>
                Published from an{' '}
                <a href="/" className="hover:underline" style={{ color: 'var(--color-soul-violet)' }}>anima</a>{' '}
                memory vault — stored on Walrus, owned by its author, censorship-resistant.
              </span>
              {blobId && (
                <a className="font-mono hover:underline" href={aggregatorUrl(blobId)} target="_blank" rel="noreferrer">
                  raw blob: {blobId.slice(0, 16)}… ↗
                </a>
              )}
            </footer>
          </>
        )}
      </article>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Reader />
  </React.StrictMode>,
);
