import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useSettings, refreshBalances, topUp } from '@/hooks/useSettings';
import { dismissLowBalance } from '@/hooks/useChat';

/**
 * A focused top-up modal opened from the shared FundsBanner. It funds the device
 * agent IN PLACE (no navigation), so topping up never trips a surface's unsaved
 * changes guard. On success it refreshes balances and clears the low-funds banner.
 */
export function TopUpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { balances } = useSettings();
  const [topping, setTopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doTopUp = async () => {
    setTopping(true);
    setError(null);
    try {
      await topUp();
      await refreshBalances();
      dismissLowBalance();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Top up failed — try again.');
    } finally {
      setTopping(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="dh">
        <div className="dt">Top up your agent</div>
        <div className="dd2">
          Your device agent funds the seals that write your notes and canvases to your vault. Top it up to keep saving — no
          wallet popup needed.
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
      {error ? <div className="topup-err">{error}</div> : null}
      <div className="db">
        <div className="wallet-actions">
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => void doTopUp()} disabled={topping}>
            {topping ? 'Topping up…' : 'Top up'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
