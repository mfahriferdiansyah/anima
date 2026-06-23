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
 * (one wallet approval); the agent then converts a slice to WAL itself, no second
 * popup. On success the form is REPLACED by a confirmation view (animated check +
 * the refreshed balance + a single Done button) — it never auto-closes, so the
 * outcome is unmistakable. The agent key is non-custodial (it lives in this
 * browser), stated plainly so funding your OWN agent makes sense.
 */
export function TopUpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { balances } = useSettings();
  const [view, setView] = useState<'form' | 'success'>('form');
  const [topping, setTopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState(TOPUP_AGENT_SUI.toFixed(2));

  // Reset to the form when the modal closes (so a reopen never flashes a stale
  // success), and pull the agent's live balance + default amount when it opens.
  useEffect(() => {
    if (!open) {
      setView('form');
      return;
    }
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
      await topUp(amount); // owner wallet popup → SUI to agent, then agent self-converts to WAL
      await refreshBalances(); // so the success panel reads the new figures
      dismissLowBalance();
      setView('success'); // confirm in place — do NOT auto-close
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Top up failed. Check your wallet has SUI and try again.');
    } finally {
      setTopping(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="topup">
        {view === 'success' ? (
          <div className="topup-done" role="status" aria-live="polite">
            <span className="topup-done-mark" aria-hidden="true">
              <svg className="topup-done-tick-svg" viewBox="0 0 24 24">
                <path className="topup-done-tick" d="M5 12.5l4.5 4.5L19 7" pathLength={100} />
              </svg>
            </span>
            <div className="dt topup-done-title">Your agent is funded.</div>
            <div className="topup-done-bal">
              <div className="pgst-row">
                <span className="pgst-k">SUI · pays for transactions</span>
                <span className="pgst-v">{balances.sui.toFixed(2)} SUI</span>
              </div>
              <div className="pgst-row">
                <span className="pgst-k">WAL · pays for storage</span>
                <span className="pgst-v">{balances.wal.toFixed(2)} WAL</span>
              </div>
            </div>
            <div className="topup-done-actions">
              <Button variant="primary" className="topup-act" onClick={onClose} autoFocus>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="topup-head">
              <span className="topup-orb" aria-hidden="true">✦</span>
              <div className="topup-head-tx">
                <div className="dt">Top up your agent</div>
                <div className="dd2">Your agent signs and pays for every save, and it has run low.</div>
              </div>
            </div>

            <div className="topup-balance">
              <span className="topup-balance-l">Agent balance</span>
              <span className="topup-balance-v">
                <b>{balances.sui.toFixed(2)}</b> SUI
                <i className="topup-balance-dot" aria-hidden="true">·</i>
                <b>{balances.wal.toFixed(2)}</b> WAL
              </span>
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
              <p className="topup-convert">
                <svg className="topup-convert-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <path d="M7 10h12l-3-3M17 14H5l3 3" />
                </svg>
                The agent keeps some as SUI to pay fees and converts a little to WAL for storage. One wallet approval.
              </p>
            </div>

            <div className="topup-keys">
              <svg className="topup-keys-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              <span>This agent stays on your device, so only you can use it. Anima never touches your funds.</span>
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
          </>
        )}
      </div>
    </Modal>
  );
}
