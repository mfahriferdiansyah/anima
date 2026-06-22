import { useEffect } from 'react';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import { WriteStateCard } from '@/components/WriteStateCard';
import { dismissWriteEvent, retryWrite, useWriteEvents } from '@/hooks/useVault';
import type { WriteEvent } from '@/hooks/useVault';
import { AppRoutes } from './routes';
import './shell.css';

const VISIBLE_TOASTS = 3;
// Long enough to read the sealed-blob id and click "View provenance" before it
// auto-dismisses — even when a couple of saves land back-to-back.
const CERTIFIED_DISMISS_MS = 8000;

function WriteEventToast({ event }: { event: WriteEvent }) {
  const { id, noteId, noteTitle, state, labels } = event;
  const navigate = useNavigate();

  useEffect(() => {
    // Certified receipts auto-dismiss (kit 4s spec); in-flight states stay
    // until they resolve and failures persist until retried or replaced.
    if (state.phase !== 'certified') return;
    const timer = setTimeout(() => dismissWriteEvent(id), CERTIFIED_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [id, state.phase]);

  const retry = () => {
    dismissWriteEvent(id);
    retryWrite(noteId);
  };

  // Low-balance toast → dismiss it and take the user to Settings → Balances,
  // where the (now real) Top up button refills the agent.
  const topUp = () => {
    dismissWriteEvent(id);
    navigate('/settings');
  };

  // Non-note receipts (labels set) own their failure handling, so they offer no
  // retry/top-up affordance — those belong to the note-save lifecycle.
  return (
    <WriteStateCard
      state={state}
      noteTitle={noteTitle}
      labels={labels}
      onRetry={labels ? undefined : retry}
      onTopUp={labels ? undefined : topUp}
    />
  );
}

/** Global write-state stack, bottom-left so saves are visible from any surface (R12). */
function WriteToasts() {
  const events = useWriteEvents();
  const visible = events.slice(-VISIBLE_TOASTS);
  if (visible.length === 0) return null;
  return (
    <div id="toaststack">
      {visible.map((event) => (
        <WriteEventToast key={event.id} event={event} />
      ))}
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
      <WriteToasts />
    </BrowserRouter>
  );
}
