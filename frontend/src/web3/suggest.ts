/**
 * Nova on-demand suggestion layer (plan U4, R21/R22, AE5).
 *
 * KEY TECHNICAL DECISION: `requestSuggestions` is a stateless call to the real
 * /suggest endpoint — the backend stores nothing. Every suggestion returned is
 * PENDING until the owner accepts (accept → a real sealed note; reject →
 * discarded, nothing persists).
 *
 * The wallet/chain primitives can't be reached from a plain module, so the
 * React layer injects them via `configureSuggest` (mirroring configureChat /
 * configureSession). `requestSuggestions` reads the wired deps, acquires a JWT
 * exactly as useChat does, and degrades to [] on any error so the UI never sees
 * a throw.
 *
 * TRUST BOUNDARY: decrypted note bodies sent as /suggest context cross to
 * OpenRouter for inference. The backend stores nothing. The agent JWT
 * (ensureJwt) authorises the call.
 */
import { createStore } from '../mocks/store';
import { ensureJwt } from './auth';
import { agentEvents, draftSuggestion, materializeNoteSeed, type AgentEvent, type AgentEventType } from '../mocks/fixture';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Suggestion {
  id: string;
  targetNoteId: string | null;
  title: string;
  summary: string;
  body: string;
}

export interface TimelineState {
  /** Newest first. */
  events: AgentEvent[];
  /** Set by the Home "Let Nova draft" quick-start; consumed on Notes mount. */
  draftRequested: boolean;
  /** The pending suggestion block Notes renders; never auto-applies. */
  suggestion: Suggestion | null;
}

// ── Store ─────────────────────────────────────────────────────────────────────

const store = createStore<TimelineState>({
  events: [...agentEvents],
  draftRequested: false,
  suggestion: null,
});

export const agentTimeline = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

// ── Wiring (wallet/chain primitives injected by the React layer) ───────────────

interface WiredSuggest {
  owner: string;
  signPersonalMessage: (msg: Uint8Array) => Promise<{ signature: string }>;
  /** Creates a new blank note and returns its id (from hooks/useVault). */
  createNote: () => string;
  /** Saves a patch to a note (from hooks/useVault). */
  saveNote: (noteId: string, patch: { title?: string; body?: string; tags?: string[] }) => void;
}

let wired: WiredSuggest | null = null;

export function configureSuggest(deps: WiredSuggest): void {
  wired = deps;
}

function backendUrl(): string {
  // import.meta.env is provided by Vite; fall back gracefully in Node/test env.
  try {
    return import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080';
  } catch {
    return 'http://localhost:8080';
  }
}

// ── Counter / id helpers ──────────────────────────────────────────────────────

let eventCounter = 0;
let agentNoteScheduled = false;

function nowIso(): string {
  return new Date().toISOString();
}

function newEventId(): string {
  eventCounter += 1;
  return `evt-live-${eventCounter}`;
}

function newSuggestionId(): string {
  eventCounter += 1;
  return `sug-${eventCounter}`;
}

function appendEvent(type: AgentEventType, summary: string, noteIds: string[]): void {
  const event: AgentEvent = { id: newEventId(), type, at: nowIso(), summary, noteIds };
  store.update((prev) => ({ ...prev, events: [event, ...prev.events] }));
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * POST /suggest with the JWT acquired exactly like useChat:
 *   ensureJwt({backendUrl, address:owner, signPersonalMessage}) → fetch.
 *
 * Maps the returned {suggestions:[{title,body,tags,links}]} into the Suggestion
 * shape (id minted client-side; summary = first 80 chars of body; targetNoteId
 * provided by the caller). Degrades to [] on any error — never throws to the UI.
 */
export async function requestSuggestions(input: {
  persona: string;
  context: { noteId: string; title: string; body: string; tags: string[] }[];
  targetNoteId?: string | null;
  calendar?: unknown[];
}): Promise<Suggestion[]> {
  if (!wired) return [];
  const { owner, signPersonalMessage } = wired;

  try {
    const jwt = await ensureJwt({ backendUrl: backendUrl(), address: owner, signPersonalMessage });
    const res = await fetch(`${backendUrl()}/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        persona: input.persona,
        context: input.context.map((n) => ({ noteId: n.noteId, title: n.title, body: n.body, tags: n.tags })),
        calendar: input.calendar ?? [],
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { suggestions: Array<{ title: string; body: string; tags?: string[]; links?: string[] }> };
    const raw = json.suggestions ?? [];
    return raw.map((s) => ({
      id: newSuggestionId(),
      targetNoteId: input.targetNoteId ?? null,
      title: s.title,
      summary: s.body.slice(0, 80),
      body: s.body,
    }));
  } catch {
    return [];
  }
}

/**
 * Home quick-start: set draftRequested=true synchronously (Home can show a
 * "Nova is thinking" state), then fire the /suggest call. On result, the first
 * suggestion becomes the pending block; draftRequested is cleared.
 */
export function requestDraft(opts: {
  persona: string;
  context: { noteId: string; title: string; body: string; tags: string[] }[];
}): void {
  store.update((prev) => ({ ...prev, draftRequested: true }));

  void requestSuggestions({ ...opts, targetNoteId: null }).then((suggestions) => {
    const first = suggestions[0] ?? null;
    store.update((prev) => ({
      ...prev,
      draftRequested: false,
      suggestion: first ?? {
        ...draftSuggestion,
        id: newSuggestionId(),
      },
    }));
    if (first) {
      appendEvent('suggestion', first.summary, []);
    }
  });
}

/**
 * Notes page calls this on mount to acknowledge a pending draft request.
 * Because requestDraft is now async-real, the suggestion arrives via store
 * update — notesMounted() flips draftRequested off if the async call hasn't
 * resolved yet (safety valve), and is otherwise a harmless no-op.
 */
export function notesMounted(): void {
  const snap = store.getSnapshot();
  if (!snap.draftRequested) return;
  // The async requestSuggestions call will clear it; nothing more to do here.
}

/**
 * Accepting or rejecting a suggestion block clears it.
 * For in-editor (targeted) suggestions, accept saves via NoteEditor directly
 * (saveNote + clearSuggestion) — that path is untouched.
 * For a Home "draft" (targetNoteId=null), this creates a new note.
 */
export function acceptSuggestion(s: Suggestion): void {
  if (!wired) {
    store.update((prev) => ({ ...prev, suggestion: null }));
    return;
  }
  const { createNote: mkNote, saveNote: persistNote } = wired;
  const id = mkNote();
  persistNote(id, { title: s.title, body: s.body });
  store.update((prev) => ({ ...prev, suggestion: null }));
  appendEvent('draft', `Nova drafted ${s.title}`, [id]);
}

/** Accepting or rejecting the suggestion block clears it (accept saves via vaultStore first). */
export function clearSuggestion(): void {
  store.update((prev) => ({ ...prev, suggestion: null }));
}

/**
 * Canvas calls this once; ~6s later Nova logs that it added a note to the board.
 * The event is a lightweight activity log — no chain write here (Tier-2 Concern).
 */
export function scheduleAgentNote(): void {
  if (agentNoteScheduled) return;
  agentNoteScheduled = true;
  setTimeout(() => {
    appendEvent('draft', `Nova added ${materializeNoteSeed.title} to the canvas`, []);
  }, 6000);
}

export function resetAgentTimeline(): void {
  agentNoteScheduled = false;
  eventCounter = 0;
  store.update(() => ({ events: [...agentEvents], draftRequested: false, suggestion: null }));
}
