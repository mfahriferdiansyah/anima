/**
 * The scripted companion activity: the fixture's six events feed the Home
 * activity line; the draft-request flow (Home quick-start -> Notes mount
 * -> suggestion ~1200ms later) and the canvas materialize beat both run
 * through here so pages only read the timeline.
 */
import { createStore } from './store';
import { mockMs } from './timing';
import {
  agentEvents,
  draftSuggestion,
  materializeNoteSeed,
  type AgentEvent,
  type AgentEventType,
} from './fixture';

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

const store = createStore<TimelineState>({
  events: [...agentEvents],
  draftRequested: false,
  suggestion: null,
});

export const agentTimeline = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

let eventCounter = 0;
let timelineGeneration = 0;
let agentNoteScheduled = false;

function nowIso(): string {
  return new Date().toISOString();
}

export function appendTimelineEvent(type: AgentEventType, summary: string, noteIds: string[]): void {
  eventCounter += 1;
  const event: AgentEvent = { id: `evt-live-${eventCounter}`, type, at: nowIso(), summary, noteIds };
  store.update((prev) => ({ ...prev, events: [event, ...prev.events] }));
}

/** Home quick-start: ask Nova for a draft, delivered on the Notes page. */
export function requestDraft(): void {
  store.update((prev) => ({ ...prev, draftRequested: true }));
}

/** Notes page calls this on mount; a pending draft request fires the suggestion ~1200ms later. */
export function notesMounted(): void {
  if (!store.getSnapshot().draftRequested) return;
  store.update((prev) => ({ ...prev, draftRequested: false }));
  const gen = timelineGeneration;
  setTimeout(() => {
    if (gen !== timelineGeneration) return;
    eventCounter += 1;
    const suggestion: Suggestion = { ...draftSuggestion, id: `sug-${eventCounter}` };
    store.update((prev) => ({ ...prev, suggestion }));
    appendTimelineEvent(
      'suggestion',
      draftSuggestion.summary,
      draftSuggestion.targetNoteId ? [draftSuggestion.targetNoteId] : [],
    );
  }, mockMs(1200));
}

/** Accepting or rejecting the suggestion block clears it (accept saves via vaultStore first). */
export function clearSuggestion(): void {
  store.update((prev) => ({ ...prev, suggestion: null }));
}

/**
 * Canvas calls this once; ~6s later Nova logs that it added a note to the board.
 * Tier-1 decoupled this from the (migrating) vault/presence stores: it now only
 * appends the activity event. Wiring Nova's canvas-materialize beat to a REAL
 * sealed note + the real presence layer is Tier-2 (when this timeline migrates
 * to the live companion-activity path).
 */
export function scheduleAgentNote(): void {
  if (agentNoteScheduled) return;
  agentNoteScheduled = true;
  const gen = timelineGeneration;
  setTimeout(() => {
    if (gen !== timelineGeneration) return;
    appendTimelineEvent('draft', `Nova added ${materializeNoteSeed.title} to the canvas`, []);
  }, mockMs(6000));
}

export function resetAgentTimeline(): void {
  timelineGeneration += 1;
  agentNoteScheduled = false;
  eventCounter = 0;
  store.update(() => ({ events: [...agentEvents], draftRequested: false, suggestion: null }));
}
