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
import { type AgentEvent, type AgentEventType } from '../mocks/fixture';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Suggestion {
  id: string;
  targetNoteId: string | null;
  title: string;
  summary: string;
  body: string;
}

/** A calendar-grounded preparation item in the "Nova suggests" checklist. */
export interface PrepItem {
  id: string;
  title: string;
  /** Grounding line, e.g. "Demo day · Jun 21 · 9 days out". */
  meta: string;
  /** Whether Nova can draft it for you ("Let Nova draft"). */
  draft: boolean;
}

export interface TimelineState {
  /** Newest first. */
  events: AgentEvent[];
  /** Set by the Home "Let Nova draft" quick-start; consumed on Notes mount. */
  draftRequested: boolean;
  /** The pending suggestion block Notes renders; never auto-applies. */
  suggestion: Suggestion | null;
  /** Nova's prep checklist (tickable). Empty in the live app until the /suggest
   *  flow populates it; the landing preview seeds it for the "Nova suggests" beat. */
  prep: PrepItem[];
}

// ── Store ─────────────────────────────────────────────────────────────────────

// The activity rail starts EMPTY — it fills with real accept/draft events. No
// scripted fixture history (that would present fake Nova activity as real).
const store = createStore<TimelineState>({
  events: [],
  draftRequested: false,
  suggestion: null,
  prep: [],
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
  name: string;
  context: { noteId: string; title: string; body: string; tags: string[] }[];
  canvas?: { title: string; body: string }[];
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
        name: input.name,
        context: input.context.map((n) => ({ noteId: n.noteId, title: n.title, body: n.body, tags: n.tags })),
        canvas: input.canvas ?? [],
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
 * The checklist grounding line for a suggestion: the first sentence of the body
 * (where Nova grounds the step in a date / note / balance), trimmed to one tidy
 * line. Falls back to the 80-char summary if the body has no sentence break.
 */
function suggestionMeta(s: Suggestion): string {
  const firstSentence = s.body.split(/(?<=[.!?])\s/)[0]?.trim() || s.summary;
  return firstSentence.length > 88 ? `${firstSentence.slice(0, 87).trimEnd()}…` : firstSentence;
}

/**
 * Home quick-start: set draftRequested=true synchronously (Home shows a "Nova is
 * thinking" state), then fire the /suggest call. On result, map the suggestions
 * into the "Nova suggests" prep checklist (`setPrep`) and clear draftRequested.
 */
export function requestDraft(opts: {
  name: string;
  context: { noteId: string; title: string; body: string; tags: string[] }[];
  canvas?: { title: string; body: string }[];
  calendar?: unknown[];
}): void {
  store.update((prev) => ({ ...prev, draftRequested: true }));

  void requestSuggestions({ ...opts, targetNoteId: null }).then((suggestions) => {
    // Map the live /suggest results into the prep checklist. On an empty/failed
    // /suggest, prep stays empty — the honest "no suggestions yet" rail shows.
    // NEVER fall back to a fixture: the owner could draft a fabricated suggestion
    // into a real signed note.
    const prep: PrepItem[] = suggestions.map((s) => ({
      id: s.id,
      title: s.title,
      meta: suggestionMeta(s),
      draft: true, // every suggestion is a next-step Nova can draft into a note
    }));
    store.update((prev) => ({ ...prev, draftRequested: false, prep }));
    if (prep.length > 0) {
      appendEvent('suggestion', `Nova suggested ${prep.length} next step${prep.length === 1 ? '' : 's'}`, []);
    }
  });
}

/**
 * "Let Nova draft": POST /draft for a full, structured prepared note grounded in
 * the prep item + vault + calendar (+ canvas). Returns the draft when Nova
 * prepared one, or null when there is nothing to prepare or the call fails. The
 * caller seals it through the normal note path (so the funded-write gate is
 * preserved) and never seals an empty body. Degrades silently — never throws.
 */
export async function requestPreparedDraft(input: {
  name: string;
  context: { noteId: string; title: string; body: string; tags: string[] }[];
  canvas?: { title: string; body: string }[];
  calendar?: unknown[];
}): Promise<{ title: string; body: string } | null> {
  if (!wired) return null;
  const { owner, signPersonalMessage } = wired;
  try {
    const jwt = await ensureJwt({ backendUrl: backendUrl(), address: owner, signPersonalMessage });
    const res = await fetch(`${backendUrl()}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        name: input.name,
        context: input.context.map((n) => ({ noteId: n.noteId, title: n.title, body: n.body, tags: n.tags })),
        canvas: input.canvas ?? [],
        calendar: input.calendar ?? [],
      }),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { prepared: boolean; title?: string; body?: string };
    if (!d.prepared || !d.body) return null;
    return { title: d.title || 'Prepared note', body: d.body };
  } catch {
    return null;
  }
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
 * Publish Nova's prep checklist (the "Nova suggests" design). The live /suggest
 * flow maps its results to PrepItem[] and calls this; SuggestRail then renders
 * the checklist instead of the fallback single-suggestion block.
 */
export function setPrep(items: PrepItem[]): void {
  store.update((prev) => ({ ...prev, prep: items }));
}

/**
 * Canvas hook for an agent-materialize activity beat. Real agent-on-canvas
 * activity (an external agent placing a note) is a plan-007 concern; until then
 * this is a no-op — it must NOT fabricate a "Nova added a note" event.
 */
export function scheduleAgentNote(): void {
  // intentionally empty — no fabricated activity (see plan 007)
}

export function resetAgentTimeline(): void {
  eventCounter = 0;
  store.update(() => ({ events: [], draftRequested: false, suggestion: null, prep: [] }));
}
