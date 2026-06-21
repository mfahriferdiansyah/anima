import { useEffect, useSyncExternalStore } from 'react';
import { useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit';
import { createNote, saveNote } from './useVault';
import { sessionStore } from '../web3/session';
import {
  agentTimeline,
  configureSuggest,
  requestDraft as _requestDraft,
  notesMounted as _notesMounted,
  clearSuggestion as _clearSuggestion,
  scheduleAgentNote as _scheduleAgentNote,
  type TimelineState,
} from '../web3/suggest';
import { vaultData } from '../web3/vaultData';
import { getCalendarContext } from '../web3/calendar';

/** Real Nova suggestion activity: Home activity line, Notes suggestions, canvas materialize. */
export function useAgentTimeline(): TimelineState {
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

  return useSyncExternalStore(agentTimeline.subscribe, agentTimeline.getSnapshot);
}

/** Home quick-start: ask Nova for a draft, using live vault notes + calendar as context. */
export function requestDraft(): void {
  const session = sessionStore.getSnapshot();
  const persona = `You are ${session.phase === 'ready' ? session.agent.name : 'Nova'}, a warm, attentive companion.`;
  const notes = vaultData.getSnapshot().notes;
  const context = notes.slice(0, 8).map((n) => ({
    noteId: n.noteId,
    title: n.title,
    body: n.body,
    tags: n.tags,
  }));
  _requestDraft({ persona, context, calendar: getCalendarContext() });
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
