import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useSettings, refreshBalances, topUp, TOPUP_AGENT_SUI } from '@/hooks/useSettings';
import { dismissLowBalance } from '@/hooks/useChat';

/**
 * A focused top-up modal opened from the shared FundsBanner (or Settings). The
 * device agent signs and pays for every seal, so it depletes and saves stop
 * sealing. Topping up sends a fixed amount of SUI from the OWNER's connected
 * wallet to the agent (one wallet approval), and the agent then swaps a slice to
 * WAL itself — no second popup. Refreshes the agent balance on open, and on
 * success the global receipt toast confirms the transfer (so we just close).
 */
export function TopUpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { balances } = useSettings();
  const [topping, setTopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className="dh">
        <div className="dt">Top up your agent</div>
        <div className="dd2">
          Your device agent signs and pays for every save. It has run low, so new edits can&apos;t seal to your vault
          until you add funds.
        </div>
      </div>

      <div className="topup-bal">
        <span className="topup-bal-i">
          SUI <b>{balances.sui.toFixed(2)}</b>
        </span>
        <span className="topup-bal-i">
          WAL <b>{balances.wal.toFixed(2)}</b>
        </span>
      </div>

      <div className="topup-what">
        This sends <b>{TOPUP_AGENT_SUI.toFixed(2)} SUI</b> from your connected wallet to the agent (one approval). The
        agent converts a little to WAL on its own, so both the gas and storage floors clear.
      </div>

      {error ? <div className="topup-err">{error}</div> : null}

      <div className="db">
        <div className="wallet-actions">
          <Button variant="quiet" onClick={onClose} disabled={topping}>
            Close
          </Button>
          <Button variant="primary" onClick={() => void doTopUp()} disabled={topping}>
            {topping ? 'Waiting for wallet…' : `Top up ${TOPUP_AGENT_SUI.toFixed(2)} SUI`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
