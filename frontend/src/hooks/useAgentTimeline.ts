import { useSyncExternalStore } from 'react';
import { agentTimeline, type TimelineState } from '../mocks/agentTimeline';

/** Scripted companion activity: Home activity line, Notes suggestions, canvas materialize. */
export function useAgentTimeline(): TimelineState {
  return useSyncExternalStore(agentTimeline.subscribe, agentTimeline.getSnapshot);
}

export {
  requestDraft,
  notesMounted,
  clearSuggestion,
  scheduleAgentNote,
} from '../mocks/agentTimeline';
export type { TimelineState, Suggestion } from '../mocks/agentTimeline';
export type { AgentEvent, AgentEventType } from '../mocks/fixture';
