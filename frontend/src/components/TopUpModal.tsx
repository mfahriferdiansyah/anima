import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useSettings, refreshBalances, topUp, TOPUP_AGENT_SUI } from '@/hooks/useSettings';
import { dismissLowBalance } from '@/hooks/useChat';
import './TopUpModal.css';

const Arrow = () => (
  <svg className="topup-flow-arrow" viewBox="0 0 24 12" aria-hidden="true">
    <path d="M1 6h20m0 0-5-4m5 4-5 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * A focused top-up modal opened from the shared FundsBanner. The device agent
 * signs and pays for every seal, so it depletes and saves stop sealing. Topping
 * up sends a fixed amount of SUI from the OWNER's connected wallet to the agent
 * (one wallet approval); the agent then swaps a slice to WAL itself, no second
 * popup. Refreshes the agent balance on open; on success the global receipt toast
 * confirms the transfer (so we just close). Styled to the kit (Space Grotesk
 * title, mono numerics, orange agent accent) with staggered entrance motion and a
 * responsive layout.
 */
export function TopUpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { balances } = useSettings();
  const [topping, setTopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = TOPUP_AGENT_SUI.toFixed(2);

  // Pull the agent's live balance whenever the modal opens, so it never shows a
  // stale 0.00 (the settings store only refreshes on demand).
  useEffect(() => {
    if (!open) return;
    setError(null);
    void refreshBalances();
  }, [open]);

  const doTopUp = async () => {
    setTopping(true);
    setError(null);
    try {
      await topUp(); // owner wallet popup → SUI to agent, then agent self-swaps to WAL
      await refreshBalances();
      dismissLowBalance();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Top up failed. Check your wallet has SUI and try again.');
    } finally {
      setTopping(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="topup">
        <div className="topup-head">
          <span className="topup-orb" aria-hidden="true">✦</span>
          <div className="topup-head-tx">
            <div className="dt">Top up your agent</div>
            <div className="dd2">
              Your device agent signs and pays for every save. It has run low, so new edits can&apos;t seal to your vault
              until you add funds.
            </div>
          </div>
        </div>

        <div className="topup-wallet">
          <div className="topup-wallet-h">Agent balance</div>
          <div className="topup-bals">
            <div className="topup-bal2">
              <span className="topup-bal2-k">SUI</span>
              <span className="topup-bal2-v">{balances.sui.toFixed(2)}</span>
            </div>
            <div className="topup-bal2">
              <span className="topup-bal2-k">WAL</span>
              <span className="topup-bal2-v">{balances.wal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="topup-flow">
          <span className="topup-flow-node">Your wallet</span>
          <Arrow />
          <span className="topup-flow-amt">+{amount} SUI</span>
          <Arrow />
          <span className="topup-flow-node accent">
            <i aria-hidden="true">✦</i> Agent
          </span>
        </div>

        <div className="topup-note">
          One wallet approval. The agent converts a little to WAL on its own, so both the gas and storage floors clear.
        </div>

        {error ? (
          <div className="topup-err" role="alert">
            {error}
          </div>
        ) : null}

        <div className="topup-actions">
          <Button variant="quiet" className="topup-act" onClick={onClose} disabled={topping}>
            Close
          </Button>
          <Button variant="primary" className="topup-act" onClick={() => void doTopUp()} disabled={topping}>
            {topping ? (
              <span className="topup-loading">
                <span className="topup-spin" aria-hidden="true" /> Waiting for wallet…
              </span>
            ) : (
              `Top up ${amount} SUI`
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
