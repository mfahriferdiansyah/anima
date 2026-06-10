/**
 * One shared conversation for the Companion page and the popup (AE3:
 * cross-route continuity is a behavioral requirement). Streaming mimics
 * the SSE delta accumulation so the integrator swap stays internal.
 * Ephemeral by design: nothing persists, a reload clears the transcript.
 */
import { createStore } from './store';
import { mockMs } from './scenario';
import { AGENT_AUTHOR, chatScripts, type ChatIntent } from './fixture';
import { createNote, saveNote } from './vaultStore';
import { appendTimelineEvent } from './agentTimeline';

export type ChatRole = 'user' | 'agent' | 'event';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  at: string;
  streaming?: boolean;
  /** noteIds the reply cites; UI renders them as citation chips. */
  citations?: string[];
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

export const chatStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

let messageCounter = 0;
let streamToken = 0;
let chatGeneration = 0;
let onCompanionRoute = false;
let lowBalanceScheduled = false;

function nextId(): string {
  messageCounter += 1;
  return `msg-${messageCounter}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function pickIntent(text: string): ChatIntent {
  const lower = text.toLowerCase();
  if (/(draft|write|compose)/.test(lower)) return 'draft';
  if (/(status|balance|how are|standing|update me)/.test(lower)) return 'status';
  return 'default';
}

/** Send a user message; the scripted reply streams in word chunks. */
export function send(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  streamToken += 1;
  const token = streamToken;
  store.update((prev) => ({
    ...prev,
    thinking: true,
    messages: [...prev.messages, { id: nextId(), role: 'user', text: trimmed, at: nowIso() }],
  }));
  const intent = pickIntent(trimmed);
  setTimeout(() => {
    if (token !== streamToken) return;
    const script = chatScripts[intent];
    let citations = [...script.citations];
    if (intent === 'draft' && script.note) {
      const draftId = createNote(AGENT_AUTHOR);
      saveNote(draftId, { ...script.note });
      citations = [draftId, ...citations];
      appendTimelineEvent('draft', `Nova drafted ${script.note.title}`, [draftId]);
    }
    const replyId = nextId();
    store.update((prev) => ({
      ...prev,
      messages: [
        ...prev.messages,
        { id: replyId, role: 'agent', text: '', at: nowIso(), streaming: true, citations },
      ],
    }));
    const words = script.text.split(' ');
    let index = 0;
    const interval = setInterval(() => {
      if (token !== streamToken) {
        clearInterval(interval);
        return;
      }
      index += 1;
      const partial = words.slice(0, index).join(' ');
      const done = index >= words.length;
      store.update((prev) => ({
        ...prev,
        thinking: done ? false : prev.thinking,
        pendingBadge: done && !prev.chatOpen && !onCompanionRoute ? true : prev.pendingBadge,
        messages: prev.messages.map((message) =>
          message.id === replyId ? { ...message, text: partial, streaming: !done } : message,
        ),
      }));
      if (done) clearInterval(interval);
    }, mockMs(40));
  }, mockMs(550));
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

/** Scripted once per ready session: the low-balance banner fires after ~2 minutes. */
export function scheduleLowBalanceBanner(): void {
  if (lowBalanceScheduled) return;
  lowBalanceScheduled = true;
  const gen = chatGeneration;
  setTimeout(() => {
    if (gen !== chatGeneration) return;
    store.update((prev) => ({ ...prev, lowBalanceBanner: true }));
  }, mockMs(120000));
}

/** Dev switch: fire the low-balance banner now. */
export function triggerLowBalance(): void {
  store.update((prev) => ({ ...prev, lowBalanceBanner: true }));
}

export function dismissLowBalance(): void {
  store.update((prev) => ({ ...prev, lowBalanceBanner: false }));
}

export function resetChatStore(): void {
  chatGeneration += 1;
  streamToken += 1;
  messageCounter = 0;
  onCompanionRoute = false;
  lowBalanceScheduled = false;
  store.update(() => initialState);
}
