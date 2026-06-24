// @vitest-environment jsdom
/**
 * Chromeless reader tests (plan 008 U3, R26/AE8). Runs under jsdom (DOMPurify +
 * React render need a DOM). The aggregator `fetch` is mocked — no real network.
 *
 * Asserts the VIEW path only (the EDIT path is behind a dynamic import that pulls
 * `presenceStore`'s `@mysten` graph; the view chunk's isolation is verified by the
 * build-time chunk grep, not here). Covers: a plaintext view renders a chromeless
 * sanitized doc; a password view prompts then gates (wrong password reveals
 * nothing); a malicious body is sanitized; not-found / network-error render; a
 * view link shows no edit controls.
 *
 * Relative imports throughout (the `@/` alias does not resolve under vitest).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReaderView, parseRoute, presetCover, readyFromMarkdown } from './ReaderView';
import { sealWithPassword } from '../../../chain/core/src/share-crypto.js';
import { newNote, serializeNote } from '../../../chain/core/src/notes.js';

// React 18 act() flag.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(<ReaderView />);
  });
}

function unmount(): void {
  act(() => root.unmount());
  container.remove();
}

/** Drive the location the reader reads at render time. */
function setUrl(search: string, hash = ''): void {
  // jsdom forbids assigning location.search directly; replace the whole URL.
  window.history.replaceState({}, '', `/read.html${search}${hash}`);
}

/** A fetch mock returning the given bytes (or a status). */
function mockFetch(impl: () => Promise<Response> | Response): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}

const readerState = () => container.querySelector('[data-reader-state]')?.getAttribute('data-reader-state');
const flush = () => act(async () => { await Promise.resolve(); });

/** Set a React-controlled input's value the way React's onChange expects (the
 *  native value setter, then an input event) so the component state updates. */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Poll (inside act) until `[data-reader-state]` reaches `want` — for the async
 *  password decrypt (real PBKDF2 takes more than one microtask to settle). */
async function waitForState(want: string, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (readerState() === want) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

beforeEach(() => {
  setUrl('');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── pure helpers ────────────────────────────────────────────────────────────

describe('parseRoute', () => {
  it('?b= → a view route; ?b=&locked=1 → locked', () => {
    expect(parseRoute('?b=BLOB', '')).toEqual({ mode: 'view', blobId: 'BLOB', locked: false });
    expect(parseRoute('?b=BLOB&locked=1', '')).toEqual({ mode: 'view', blobId: 'BLOB', locked: true });
  });
  it('?room= and ?salt=&edit=1 → edit (default note kind, no opk); they exclude ?b=', () => {
    expect(parseRoute('?room=R', '')).toEqual({ mode: 'edit', room: 'R', salt: null, editKind: 'note', opk: null });
    expect(parseRoute('?salt=S&edit=1', '')).toEqual({ mode: 'edit', room: null, salt: 'S', editKind: 'note', opk: null });
  });
  it('?kind=canvas routes the edit link to the board; ?opk carries the owner trust anchor', () => {
    expect(parseRoute('?room=R&kind=canvas', '')).toEqual({ mode: 'edit', room: 'R', salt: null, editKind: 'canvas', opk: null });
    expect(parseRoute('?room=R&opk=deadbeef', '')).toEqual({ mode: 'edit', room: 'R', salt: null, editKind: 'note', opk: 'deadbeef' });
    expect(parseRoute('?salt=S&edit=1&kind=canvas&opk=0102', '')).toEqual({ mode: 'edit', room: null, salt: 'S', editKind: 'canvas', opk: '0102' });
  });
  it('?fixture=1 or #fixture → the no-network fixture', () => {
    expect(parseRoute('?fixture=1', '')).toEqual({ mode: 'fixture' });
    expect(parseRoute('', '#fixture')).toEqual({ mode: 'fixture' });
  });
  it('empty → none', () => {
    expect(parseRoute('', '')).toEqual({ mode: 'none' });
  });
});

describe('presetCover (reader = preset-only, ALLOWLIST)', () => {
  it('keeps a preset path, drops seal:/blob: refs (silently, no broken image)', () => {
    expect(presetCover('/covers/ethos-orbit.svg')).toBe('/covers/ethos-orbit.svg');
    expect(presetCover('seal:abc')).toBeNull();
    expect(presetCover('blob:xyz')).toBeNull();
    expect(presetCover(undefined)).toBeNull();
  });

  it('drops an arbitrary external URL and a javascript: ref (exfiltration / pixel vectors)', () => {
    // the cover src bypasses sanitizeNoteHtml, so anything but a static preset is refused
    expect(presetCover('https://attacker.example/pixel.svg')).toBeNull();
    expect(presetCover('//attacker.example/x.svg')).toBeNull();
    expect(presetCover('javascript:alert(1)')).toBeNull();
    expect(presetCover('/covers/../../etc/passwd')).toBeNull(); // not a .svg
    expect(presetCover('/coversX/evil.svg')).toBeNull(); // not the /covers/ prefix
  });
});

describe('readyFromMarkdown sanitizes (XSS sink)', () => {
  it('a hostile body has its script/onerror stripped', () => {
    const note = newNote({ title: 'X', body: '<script>steal()</script><img src=x onerror="alert(1)">', author: 'owner' });
    const ready = readyFromMarkdown(serializeNote(note));
    if (ready.kind !== 'ready') throw new Error('expected a markdown doc');
    expect(ready.bodyHtml.toLowerCase()).not.toContain('<script');
    expect(ready.bodyHtml.toLowerCase()).not.toContain('onerror');
    expect(ready.bodyHtml).not.toContain('steal()');
  });
});

// ── render: view path ─────────────────────────────────────────────────────────

describe('VIEW — plaintext (AE8): a chromeless sanitized doc', () => {
  it('renders the title + sanitized body, no sidebar, no edit controls', async () => {
    const note = newNote({ title: 'Kyoto trip', body: 'Autumn in **Kyoto**.', author: 'owner' });
    mockFetch(() => new Response(serializeNote(note), { status: 200 }));
    setUrl('?b=BLOB1');
    mount();
    await flush();

    expect(readerState()).toBe('ready');
    expect(container.querySelector('.rd-title')?.textContent).toBe('Kyoto trip');
    expect(container.querySelector('.rd-body')?.innerHTML).toContain('<strong>Kyoto</strong>');
    // chromeless: no app sidebar, no textarea (no edit controls on a view link)
    expect(container.querySelector('.sidebar')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    unmount();
  });

  it('a malicious published body is sanitized — no script element is rendered', async () => {
    const note = newNote({
      title: 'Evil',
      body: 'hi <script>fetch("/steal?"+localStorage.agentKey)</script><img src=x onerror="alert(2)">',
      author: 'attacker',
    });
    mockFetch(() => new Response(serializeNote(note), { status: 200 }));
    setUrl('?b=EVIL');
    mount();
    await flush();

    expect(readerState()).toBe('ready');
    const html = container.querySelector('.rd-body')!.innerHTML.toLowerCase();
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(container.querySelector('script')).toBeNull();
    unmount();
  });
});

describe('VIEW — password gate (AE8)', () => {
  it('prompts for a password, and a WRONG one reveals nothing (no crash)', async () => {
    const note = newNote({ title: 'Secret', body: 'classified', author: 'owner' });
    const sealed = await sealWithPassword(note, 'correct-horse');
    const sealedText = new TextDecoder().decode(sealed);
    mockFetch(() => new Response(sealedText, { status: 200 }));
    setUrl('?b=LOCKED&locked=1');
    mount();
    await flush();

    // gate is shown, content is NOT in the DOM yet
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(container.querySelector('.rd-body')).toBeNull();
    expect(container.textContent).not.toContain('classified');

    // submit a WRONG password
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;
    typeInto(input, 'wrong');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await waitForState('wrong-password');

    // still gated, an inline error, never the plaintext
    expect(readerState()).toBe('wrong-password');
    expect(container.querySelector('.rd-error')?.textContent).toMatch(/did not open/i);
    expect(container.textContent).not.toContain('classified');
    expect(container.querySelector('.rd-body')).toBeNull();
    unmount();
  });

  it('the CORRECT password decrypts and renders the doc', async () => {
    const note = newNote({ title: 'Secret', body: 'the **answer**', author: 'owner' });
    const sealed = await sealWithPassword(note, 'pw123');
    const sealedText = new TextDecoder().decode(sealed);
    mockFetch(() => new Response(sealedText, { status: 200 }));
    setUrl('?b=LOCKED&locked=1');
    mount();
    await flush();

    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;
    typeInto(input, 'pw123');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await waitForState('ready');

    expect(readerState()).toBe('ready');
    expect(container.querySelector('.rd-title')?.textContent).toBe('Secret');
    expect(container.querySelector('.rd-body')?.innerHTML).toContain('<strong>answer</strong>');
    unmount();
  });
});

describe('VIEW — error states render cleanly (no login prompt)', () => {
  it('a 404 → not-found with a link home, no login prompt', async () => {
    mockFetch(() => new Response('', { status: 404 }));
    setUrl('?b=GONE');
    mount();
    await flush();
    expect(readerState()).toBe('not-found');
    expect(container.querySelector('a[href="/"]')).not.toBeNull();
    expect(container.textContent?.toLowerCase()).not.toContain('sign in');
    expect(container.textContent?.toLowerCase()).not.toContain('connect wallet');
    unmount();
  });

  it('a network failure → network-error with a retry', async () => {
    mockFetch(() => Promise.reject(new Error('offline')));
    setUrl('?b=BLOB');
    mount();
    await flush();
    expect(readerState()).toBe('network-error');
    expect(container.textContent?.toLowerCase()).toContain('retry');
    unmount();
  });
});

describe('fixture — no-network sample doc through the real sanitize+render path', () => {
  it('renders ready with the sanitized fixture (the browser-smoke hook)', () => {
    setUrl('?fixture=1');
    mount();
    expect(readerState()).toBe('ready');
    expect(container.querySelector('.rd-title')?.textContent).toBe('Notes on a shared canvas');
    // the hostile fragment in the fixture body is gone
    expect(container.querySelector('.rd-body')!.innerHTML.toLowerCase()).not.toContain('<script');
    expect(container.querySelector('script')).toBeNull();
    unmount();
  });
});

describe('no params → not-found (never a login wall)', () => {
  it('renders not-found for a bare /read.html', () => {
    setUrl('');
    mount();
    expect(readerState()).toBe('not-found');
    unmount();
  });
});
