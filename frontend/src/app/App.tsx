import { useEffect } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { WriteStateCard } from '@/components/WriteStateCard';
import { dismissWriteEvent, retryWrite, useWriteEvents } from '@/hooks/useVault';
import type { WriteEvent } from '@/hooks/useVault';
import { AppRoutes } from './routes';
import { MockedBadge } from './MockedBadge';
import './shell.css';

const VISIBLE_TOASTS = 3;
const CERTIFIED_DISMISS_MS = 4000;

function WriteEventToast({ event }: { event: WriteEvent }) {
  const { id, noteId, noteTitle, state } = event;

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

  return <WriteStateCard state={state} noteTitle={noteTitle} onRetry={retry} />;
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

/** The mock badge belongs to the workspace, not the public landing. */
function GatedMockedBadge() {
  const { pathname } = useLocation();
  return pathname.startsWith('/app') ? <MockedBadge /> : null;
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
      <WriteToasts />
      <GatedMockedBadge />
    </BrowserRouter>
  );
}
