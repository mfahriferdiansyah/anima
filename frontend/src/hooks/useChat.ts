/**
 * The real Nova chat layer (plan U6): one shared conversation for the Companion
 * page and the popup (AE3 cross-route continuity), now backed by the REAL
 * pipeline instead of the scripted mock — it ports scripts/e2e-chat.ts into the
 * browser. A send runs: instant client-side recall over the decrypted vault
 * (`vaultData.search`) → POST /chat (SSE persona stream, `[[noteId]]` citations)
 * → on done, /distill the exchange → `writeTurn` each candidate → `vaultData.upsert`
 * and surface the created note ids. The transcript itself is ephemeral; only the
 * distilled, sealed memory persists.
 *
 * KEY TECHNICAL DECISION (R14/R20): the LLM context crosses a THIRD-PARTY trust
 * boundary. Recall happens in the browser against the decrypted index and the
 * plaintext context rides the request to the backend transiently — the backend
 * stores nothing. The agent JWT (auth.ts `ensureJwt`) authorizes the call.
 *
 * The wallet/chain primitives (owner address + signPersonalMessage) can't be
 * reached from a plain module, so the React layer injects them via
 * `configureChat` (mirroring useVaultSession's `configureSession`); the `send`
 * action reads the wired deps. The pure cores — the SSE delta/event parser, the
 * `[[noteId]]` citation extractor, and the distill→write driver — take injected
 * deps and are node-testable without a DOM or a live fetch.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit';
import { newNote, writeTurn, preflight, buildGrounding, type Note } from '../../../chain/core/src/index.js';
import { createStore } from '../mocks/store';
import { vaultData } from '../web3/vaultData';
import { loadCanvases } from '../web3/canvasRegistry';
import { getQuiltDeps, sessionStore } from '../web3/session';
import { ensureJwt } from '../web3/auth';
import { getCalendarContext } from '../web3/calendar';
import { runWithReceipt, objectProvenanceUrl } from '../web3/onchainToast';

export type ChatRole = 'user' | 'agent' | 'event';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  at: string;
  streaming?: boolean;
  /** noteIds the reply cites; UI renders them as citation chips. */
  citations?: string[];
  /** Set when the reply created and sealed a note; the footer reports it. */
  createdNoteId?: string;
}

export interface ChatState {
  messages: ChatMessage[];
  thinking: boolean;
  /** Popup open-state; persists across routes (lives here, not in a page). */
  chatOpen: boolean;
  /** Set when a reply completes while the popup is closed off the Companion route. */
  pendingBadge: boolean;
  lowBalanceBanner: boolean;
}

const initialState: ChatState = {
  messages: [],
  thinking: false,
  chatOpen: false,
  pendingBadge: false,
  lowBalanceBanner: false,
};

const store = createStore<ChatState>(initialState);

/** The one shared store (Companion page + popup read the same snapshot reference). */
export const chatStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

export type ChatIntent = 'default' | 'draft' | 'status';


// ── Pure cores (node-testable, DOM-free, no fetch / no import.meta.env) ──────

/** A note candidate as the /distill endpoint returns it. */
export interface DistillCandidate {
  title: string;
  body: string;
  tags?: string[];
  links?: string[];
}

/** The minimal reader shape the SSE parser consumes (a ReadableStream reader). */
export interface SseReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
}

export interface SseResult {
  /** The full accumulated reply text. */
  text: string;
  /** True once `event: done` was seen — a complete, committable reply. */
  done: boolean;
}

/**
 * Drive the backend's SSE wire format (handler.go): a bare `data: {"delta":…}`
 * frame per content delta (default `message` event), terminated by `event: done`
 * or `event: error` with a `{"error":…}` data frame. Ported from the e2e-chat
 * reader loop. Throws on `event: error`. Two failure modes the caller must NOT
 * silently commit: a `reader.read()` REJECTION (network drop) propagates as a
 * rejection; an EOF reached BEFORE `event: done` returns `{ done: false }` so the
 * caller treats it as incomplete, not a finished reply.
 *
 * `onDelta` is called with the full accumulated text after each delta so the UI
 * can stream the reply in.
 */
export async function parseSseStream(
  reader: SseReader,
  onDelta: (text: string) => void,
  decode: (value: Uint8Array) => string = ((): ((v: Uint8Array) => string) => {
    const dec = new TextDecoder();
    return (v) => dec.decode(v, { stream: true });
  })(),
): Promise<SseResult> {
  let text = '';
  let buf = '';
  let ev = 'message';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) buf += decode(value);
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        ev = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        if (ev === 'done') return { text, done: true };
        if (ev === 'error') {
          let msg = 'chat stream error';
          try {
            const parsed = JSON.parse(line.slice(6)) as { error?: string };
            if (parsed.error) msg = parsed.error;
          } catch {
            /* keep the generic message */
          }
          throw new Error(msg);
        }
        try {
          text += (JSON.parse(line.slice(6)) as { delta?: string }).delta ?? '';
          onDelta(text);
        } catch {
          /* a malformed data frame is skipped, not fatal */
        }
      } else if (line === '') {
        // blank line ends an SSE record: the next record defaults to `message`.
        ev = 'message';
      }
    }
  }
  // EOF before `event: done` → incomplete, NOT a committed reply.
  return { text, done: false };
}

/** Extract `[[noteId]]` citation markers from a reply, de-duplicated, in order. */
export function extractCitations(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[\[([0-9A-Za-z]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

/** Heuristic intent from the user's message (ported from the mock's pickIntent). */
export function pickIntent(text: string): ChatIntent {
  const lower = text.toLowerCase();
  if (/(draft|write|compose)/.test(lower)) return 'draft';
  if (/(status|balance|how are|standing|update me)/.test(lower)) return 'status';
  return 'default';
}

/** Injected deps for the distill→write driver — all mockable in tests. */
export interface DistillDeps {
  /** POST /distill {transcript} → the returned candidates. */
  distill: () => Promise<DistillCandidate[]>;
  /** The live chain write deps (web3/session getQuiltDeps), or null off a vault. */
  getDeps: typeof getQuiltDeps;
  /** chain/core writeTurn (mocked in tests). */
  writeTurn: typeof writeTurn;
  /** chain/core preflight — the funding gate before a write. */
  preflight: typeof preflight;
  /** chain/core newNote factory. */
  newNote: typeof newNote;
  /** Write-through into the shared live index after a successful writeTurn. */
  upsert: (note: Note, location: { quiltPatchId: string; quiltBlobId: string; blobObjectId: string }) => void;
  /** Surface the low-balance banner (skips the write) when preflight fails. */
  onLowBalance: () => void;
  /**
   * Wrap the seal write in a provenance-receipt toast (real impl = `runWithReceipt`,
   * wired in `send`). Optional so the node tests skip the toast; when present it
   * shows ONE "N memories sealed · View provenance" receipt per quilt batch.
   */
  sealReceipt?: <T extends { blobObjectId: string }>(count: number, run: () => Promise<T>) => Promise<T>;
}

export interface DistillWriteResult {
  /** Created note ids, in order — prepended to the reply's citations. */
  createdNoteIds: string[];
}

/**
 * The distill→write driver (the e2e-chat distill leg, made pure). Distills the
 * exchange into candidates, gates the write on funding `preflight` (low balance →
 * `onLowBalance`, skip the write, no created ids), then `writeTurn`s the
 * candidates as one quilt and `upsert`s each into the live index. When the
 * distiller returns nothing (common for chit-chat, and the right outcome for a
 * draft with no real facts), it writes nothing — a note is never sealed empty.
 */
export async function runDistill(deps: DistillDeps): Promise<DistillWriteResult> {
  const chainDeps = deps.getDeps();
  if (!chainDeps) return { createdNoteIds: [] };

  const candidates = await deps.distill();
  if (candidates.length === 0) return { createdNoteIds: [] };

  // Funding gate FIRST: a low balance surfaces the banner and skips the write,
  // so we never claim a sealed note we could not afford to write.
  const pf = await deps.preflight(chainDeps.suiClient, chainDeps.agentSigner.toSuiAddress());
  if (!pf.ok) {
    deps.onLowBalance();
    return { createdNoteIds: [] };
  }

  const notes = candidates.map((c) =>
    deps.newNote({ title: c.title, body: c.body, tags: c.tags ?? [], links: c.links ?? [], author: 'anima' }),
  );
  const seal = () => deps.writeTurn(chainDeps, notes);
  const w = deps.sealReceipt ? await deps.sealReceipt(notes.length, seal) : await seal();
  const createdNoteIds: string[] = [];
  notes.forEach((n, i) => {
    const per = w.perNote[i] ?? w.perNote[0];
    deps.upsert(n, { quiltPatchId: per.quiltPatchId, quiltBlobId: w.quiltBlobId, blobObjectId: w.blobObjectId });
    createdNoteIds.push(n.noteId);
  });
  return { createdNoteIds };
}

// ── Hook-side wiring (wallet/chain primitives + live fetch; not unit-tested) ──

/** Wallet/chain primitives injected by the React layer (null until a wallet connects). */
interface WiredChat {
  owner: string;
  signPersonalMessage: (msg: Uint8Array) => Promise<{ signature: string }>;
  /** The companion/vault name for the persona block. */
  name: string;
}

let wired: WiredChat | null = null;
let messageCounter = 0;
let streamToken = 0;
let onCompanionRoute = false;

export function configureChat(deps: WiredChat): void {
  wired = deps;
}

function nextId(): string {
  messageCounter += 1;
  return `msg-${messageCounter}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function backendUrl(): string {
  return import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080';
}

/** Map the shared transcript to the LLM role shape (agent→assistant; drop events). */
function toLlmTranscript(messages: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'agent')
    .map((m) => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.text }));
}

/**
 * Send a user message through the REAL pipeline. The whole exchange runs inside a
 * try/finally so `thinking` and the reply's `streaming` flag always reset on every
 * exit (done, error, network drop) — never a hung spinner.
 */
export async function send(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || !wired) return;
  const { owner, signPersonalMessage, name } = wired;

  streamToken += 1;
  const token = streamToken;

  // 1) append the user turn + go thinking.
  store.update((prev) => ({
    ...prev,
    thinking: true,
    messages: [...prev.messages, { id: nextId(), role: 'user', text: trimmed, at: nowIso() }],
  }));

  // 2) assemble grounding over the DECRYPTED index (no network): relevance-ranked
  // notes + any canvas board the message names by title + calendar, bounded by the
  // safety ceiling. The client is the librarian; the backend owns composition.
  const index = vaultData.getSnapshot().index;
  const referenced = index
    ? loadCanvases(index)
        .filter((c) => trimmed.toLowerCase().includes(c.title.toLowerCase()))
        .map((c) => ({ id: c.canvasId, title: c.title }))
    : [];
  const grounding = index
    ? buildGrounding({ index, query: trimmed, canvases: referenced, calendar: getCalendarContext() })
    : { context: [], canvas: [], calendar: getCalendarContext(), trimmed: 0 };

  // the transcript the model sees (excludes the placeholder agent reply below).
  const transcript = toLlmTranscript(store.getSnapshot().messages);

  // 3) the streaming agent reply placeholder.
  const replyId = nextId();
  store.update((prev) => ({
    ...prev,
    messages: [...prev.messages, { id: replyId, role: 'agent', text: '', at: nowIso(), streaming: true }],
  }));

  const isCurrent = () => token === streamToken;
  const setReply = (patch: Partial<ChatMessage>) =>
    store.update((prev) => ({
      ...prev,
      messages: prev.messages.map((m) => (m.id === replyId ? { ...m, ...patch } : m)),
    }));

  try {
    const jwt = await ensureJwt({ backendUrl: backendUrl(), address: owner, signPersonalMessage });
    const res = await fetch(`${backendUrl()}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      // name: the on-chain companion name (the backend owns the persona now);
      // canvas + calendar are read-only grounding the backend composes in.
      body: JSON.stringify({ name, transcript, context: grounding.context, canvas: grounding.canvas, calendar: grounding.calendar }),
    });
    if (!res.ok || !res.body) throw new Error(`chat failed: HTTP ${res.status}`);

    const stream = await parseSseStream(res.body.getReader(), (partial) => {
      if (isCurrent()) setReply({ text: partial });
    });
    if (!isCurrent()) return;

    if (!stream.done) {
      // EOF before `event: done`: incomplete — surface an error, do NOT commit.
      setReply({ text: stream.text || 'The reply was cut off. Try again.', streaming: false });
      return;
    }

    const citations = extractCitations(stream.text);
    setReply({ streaming: false, citations });

    // 4) distill the exchange → seal → cite the new notes.
    const exchange = [...transcript, { role: 'assistant' as const, content: stream.text }];
    const { createdNoteIds } = await runDistill(
      {
        distill: async () => {
          const dres = await fetch(`${backendUrl()}/distill`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
            body: JSON.stringify({ transcript: exchange }),
          });
          if (!dres.ok) throw new Error(`distill failed: HTTP ${dres.status}`);
          const { notes } = (await dres.json()) as { notes: DistillCandidate[] };
          return notes ?? [];
        },
        getDeps: getQuiltDeps,
        writeTurn,
        preflight,
        newNote,
        upsert: (note, location) => vaultData.upsert(note, location),
        onLowBalance: triggerLowBalance,
        // Agent-sealed memories get the SAME provenance receipt a manual save does:
        // one "N memories sealed · View provenance" toast per quilt batch.
        sealReceipt: (count, run) =>
          runWithReceipt(
            {
              key: 'distill',
              title: count === 1 ? '1 new memory' : `${count} new memories`,
              labels: { pending: 'Sealing memory', success: count === 1 ? 'Memory sealed' : `${count} memories sealed` },
            },
            () => run().then((r) => ({ result: r, provenanceUrl: objectProvenanceUrl(r.blobObjectId) })),
          ),
      },
    );

    if (isCurrent() && createdNoteIds.length > 0) {
      setReply({
        citations: [...createdNoteIds, ...citations],
        createdNoteId: createdNoteIds[0],
      });
    }
  } catch {
    // network drop / non-ok / stream error: a clean error with a retry affordance,
    // never a silently committed reply or a hung spinner.
    if (isCurrent()) setReply({ text: 'Something interrupted the reply. Try sending it again.', streaming: false });
  } finally {
    if (isCurrent()) {
      store.update((prev) => ({
        ...prev,
        thinking: false,
        pendingBadge: !prev.chatOpen && !onCompanionRoute ? true : prev.pendingBadge,
      }));
    }
  }
}

/** Append a system event line (transcript scrub, suggestions) to the shared transcript. */
export function appendEventMessage(text: string): void {
  store.update((prev) => ({
    ...prev,
    messages: [...prev.messages, { id: nextId(), role: 'event', text, at: nowIso() }],
  }));
}

export function openPopup(): void {
  store.update((prev) => ({ ...prev, chatOpen: true, pendingBadge: false }));
}

/** Home's ask-input handoff (U5): open the popup and send in one action. */
export function sendOnOpen(text: string): void {
  if (!text.trim()) return;
  openPopup();
  void send(text);
}

export function closePopup(): void {
  store.update((prev) => ({ ...prev, chatOpen: false }));
}

/** Expand hands the transcript to the Companion page: close here, the caller navigates. */
export function expandPopup(): void {
  store.update((prev) => ({ ...prev, chatOpen: false }));
}

/** The shell reports route changes; replies finishing on Companion never badge the orb. */
export function setOnCompanionRoute(value: boolean): void {
  onCompanionRoute = value;
  if (value && store.getSnapshot().pendingBadge) {
    store.update((prev) => ({ ...prev, pendingBadge: false }));
  }
}

/** Surface the low-balance banner (preflight failure on a distill write, or the dev switch). */
export function triggerLowBalance(): void {
  store.update((prev) => ({ ...prev, lowBalanceBanner: true }));
}

export function dismissLowBalance(): void {
  store.update((prev) => ({ ...prev, lowBalanceBanner: false }));
}

export function resetChatStore(): void {
  streamToken += 1;
  messageCounter = 0;
  onCompanionRoute = false;
  wired = null;
  store.update(() => initialState);
}

/**
 * The one shared conversation (Companion page + popup, AE3). Also wires the
 * wallet primitives into the chat layer (mirrors useVaultSession's configure):
 * `send` signs auth with the connected wallet and uses the on-chain companion
 * name for the persona. `signPersonalMessage` is read via a ref-free closure that
 * always calls the latest dapp-kit mutation.
 */
export function useChat(): ChatState {
  const account = useCurrentAccount();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot);
  const name = session.phase === 'ready' ? session.agent.name : 'Nova';

  useEffect(() => {
    if (!account) {
      wired = null;
      return;
    }
    configureChat({
      owner: account.address,
      name,
      signPersonalMessage: (msg) => signPersonalMessage({ message: msg }).then(({ signature }) => ({ signature })),
    });
  }, [account?.address, name, signPersonalMessage]);

  return useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot);
}
