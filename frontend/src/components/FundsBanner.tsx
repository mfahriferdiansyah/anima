import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { chatStore, dismissLowBalance } from '@/hooks/useChat';
import './FundsBanner.css';

/**
 * A shared, persistent banner shown across notes + canvas (and the chat layer)
 * whenever the agent is low on funds, so a save that won't seal is explained once
 * with a Top up action instead of failing silently per-surface. Reads the single
 * low-balance signal in the chat store; renders nothing when funds are fine.
 */
export function FundsBanner() {
  const low = useSyncExternalStore(chatStore.subscribe, () => chatStore.getSnapshot().lowBalanceBanner);
  const navigate = useNavigate();
  if (!low) return null;
  return (
    <div className="fundsbanner" role="status">
      <span className="fundsbanner-dot" aria-hidden="true" />
      <span className="fundsbanner-txt">
        Your agent is running low on funds — new edits won&apos;t seal to your vault until you top up.
      </span>
      <button type="button" className="fundsbanner-act" onClick={() => navigate('/settings')}>
        Top up
      </button>
      <button type="button" className="fundsbanner-x" aria-label="Dismiss" onClick={() => dismissLowBalance()}>
        ✕
      </button>
    </div>
  );
}
