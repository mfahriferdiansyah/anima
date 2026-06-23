import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useSettings, refreshBalances, topUp, TOPUP_AGENT_SUI } from '@/hooks/useSettings';
import { dismissLowBalance } from '@/hooks/useChat';
import './TopUpModal.css';

/**
 * A focused top-up modal opened from the shared FundsBanner. The device agent
 * signs and pays for every seal, so it depletes and saves stop sealing. Topping
 * up sends a chosen amount of SUI from the OWNER's connected wallet to the agent
 * (one wallet approval); the agent then swaps a slice to WAL itself, no second
 * popup. The agent key is non-custodial (it lives in this browser), stated up
 * front as the trust callout so funding your OWN agent makes sense. Refreshes the
 * agent balance on open; on success the global receipt toast confirms.
 */
export function TopUpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { balances } = useSettings();
  const [topping, setTopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState(TOPUP_AGENT_SUI.toFixed(2));

  // Pull the agent's live balance + reset the amount whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setAmountStr(TOPUP_AGENT_SUI.toFixed(2));
    void refreshBalances();
  }, [open]);

  const amount = parseFloat(amountStr);
  const valid = Number.isFinite(amount) && amount > 0;

  // Keep the field locale-proof: digits + a single separator, comma normalized to a
  // dot. (A type=number input renders "0,3" in comma locales, which parseFloat then
  // reads as 0, so we drive a plain text input ourselves.)
  const onAmount = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.,]/g, '').replace(',', '.');
    const parts = cleaned.split('.');
    setAmountStr(parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned);
  };

  const doTopUp = async () => {
    if (!valid) return;
    setTopping(true);
    setError(null);
    try {
      await topUp(amount); // owner wallet popup → SUI to agent, then agent self-swaps to WAL
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
            <div className="dd2">Your agent signs and pays for every save, and it has run low.</div>
          </div>
        </div>

        <div className="topup-keys">
          <svg className="topup-keys-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <div className="topup-keys-tx">
            <b>You hold the keys</b>
            <span>This agent&apos;s key lives in this browser, on your device. Anima never holds it.</span>
          </div>
        </div>

        <div className="topup-balance">
          <span className="topup-balance-l">Agent balance</span>
          <div className="topup-balance-row">
            <span className="topup-stat">
              <b>{balances.sui.toFixed(2)}</b> SUI
            </span>
            <span className="topup-stat-sep" aria-hidden="true" />
            <span className="topup-stat">
              <b>{balances.wal.toFixed(2)}</b> WAL
            </span>
          </div>
        </div>

        <div className="topup-amt">
          <label className="topup-amt-l" htmlFor="topup-amount">
            Add from your wallet
          </label>
          <div className={valid ? 'topup-amt-field' : 'topup-amt-field invalid'}>
            <input
              id="topup-amount"
              className="topup-amt-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amountStr}
              onChange={(e) => onAmount(e.target.value)}
              disabled={topping}
            />
            <span className="topup-amt-suffix">SUI</span>
          </div>
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
          <Button variant="primary" className="topup-act" onClick={() => void doTopUp()} disabled={topping || !valid}>
            {topping ? (
              <span className="topup-loading">
                <span className="topup-spin" aria-hidden="true" /> Waiting for wallet…
              </span>
            ) : valid ? (
              `Top up ${amount.toFixed(2)} SUI`
            ) : (
              'Enter an amount'
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
