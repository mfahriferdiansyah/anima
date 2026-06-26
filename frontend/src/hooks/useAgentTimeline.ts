import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit';
import { createNote, saveNote } from './useVault';
import { sessionStore } from '../web3/session';
import {
  agentTimeline,
  configureSuggest,
  requestDraft as _requestDraft,
  requestPreparedDraft as _requestPreparedDraft,
  notesMounted as _notesMounted,
  clearSuggestion as _clearSuggestion,
  scheduleAgentNote as _scheduleAgentNote,
  type TimelineState,
} from '../web3/suggest';
import { vaultData } from '../web3/vaultData';
import { getCalendarContext } from '../web3/calendar';
import { buildGrounding } from '../../../chain/core/src/index.js';

/**
 * Landing-preview override (mirrors useVaultSession's PreviewSessionContext).
 * The landing's decorative previews supply a seeded timeline so the Home
 * suggestion rail reads populated; the real app has no provider and reads the
 * live store. The wiring effect below already no-ops on `!account` (the preview
 * has none), so it needs no skip-guard.
 */
export const PreviewTimelineContext = createContext<TimelineState | null>(null);

/** Real Nova suggestion activity: Home activity line, Notes suggestions, canvas materialize. */
export function useAgentTimeline(): TimelineState {
  const preview = useContext(PreviewTimelineContext);
  const account = useCurrentAccount();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  useEffect(() => {
    if (!account) return;
    configureSuggest({
      owner: account.address,
      signPersonalMessage: (msg) => signPersonalMessage({ message: msg }).then(({ signature }) => ({ signature })),
      createNote: () => createNote(),
      saveNote: (noteId, patch) => saveNote(noteId, patch),
    });
  }, [account?.address, signPersonalMessage]);

  const live = useSyncExternalStore(agentTimeline.subscribe, agentTimeline.getSnapshot);
  return preview ?? live;
}

/** Home quick-start: ask Nova for next-step suggestions, grounded in the live
 * vault + calendar (name is the on-chain companion name; the backend owns the
 * persona now). */
export function requestDraft(): void {
  const session = sessionStore.getSnapshot();
  const name = session.phase === 'ready' ? session.agent.name : 'Nova';
  const index = vaultData.getSnapshot().index;
  const g = index ? buildGrounding({ index, query: '', calendar: getCalendarContext() }) : null;
  _requestDraft({ name, context: g?.context ?? [], canvas: g?.canvas ?? [], calendar: g?.calendar ?? [] });
}

/** "Let Nova draft" on a prep item → ask /draft for a full prepared note grounded
 * in that item + vault + calendar. Returns {title, body} or null (nothing to
 * prepare / failure); the caller seals it through the normal note path. */
export async function draftPreparedNote(prepTitle: string): Promise<{ title: string; body: string } | null> {
  const session = sessionStore.getSnapshot();
  const name = session.phase === 'ready' ? session.agent.name : 'Nova';
  const index = vaultData.getSnapshot().index;
  const g = index ? buildGrounding({ index, query: prepTitle, calendar: getCalendarContext() }) : null;
  return _requestPreparedDraft({ name, context: g?.context ?? [], canvas: g?.canvas ?? [], calendar: g?.calendar ?? [] });
}

/** Notes page calls this on mount; a pending draft request is handled async in requestDraft. */
export function notesMounted(): void {
  _notesMounted();
}

/** Accepting or rejecting the suggestion block clears it (accept saves via vaultStore first). */
export function clearSuggestion(): void {
  _clearSuggestion();
}

/**
 * Canvas calls this once; ~6s later Nova logs that it added a note to the board.
 */
export function scheduleAgentNote(): void {
  _scheduleAgentNote();
}

export type { TimelineState, Suggestion } from '../web3/suggest';
export type { AgentEvent, AgentEventType } from '../mocks/fixture';
