import { useState, useSyncExternalStore } from 'react';
import { chatStore, dismissLowBalance } from '@/hooks/useChat';
import { TopUpModal } from './TopUpModal';
import './FundsBanner.css';

/**
 * A shared, persistent banner shown across notes + canvas (and the chat layer)
 * whenever the agent is low on funds, so a save that won't seal is explained once
 * with a Top up action instead of failing silently per-surface. Reads the single
 * low-balance signal in the chat store; Top up opens a focused modal IN PLACE (no
 * navigation, so it never trips a surface's unsaved-changes guard).
 */
export function FundsBanner() {
  const low = useSyncExternalStore(chatStore.subscribe, () => chatStore.getSnapshot().lowBalanceBanner);
  const [topUpOpen, setTopUpOpen] = useState(false);
  return (
    <>
      {low ? (
        <div className="fundsbanner" role="status">
          <span className="fundsbanner-dot" aria-hidden="true" />
          <span className="fundsbanner-txt">
            Your agent is running low on funds — new edits won&apos;t seal to your vault until you top up.
          </span>
          <button type="button" className="fundsbanner-act" onClick={() => setTopUpOpen(true)}>
            Top up
          </button>
          <button type="button" className="fundsbanner-x" aria-label="Dismiss" onClick={() => dismissLowBalance()}>
            ✕
          </button>
        </div>
      ) : null}
      <TopUpModal open={topUpOpen} onClose={() => setTopUpOpen(false)} />
    </>
  );
}
