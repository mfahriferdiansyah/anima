/**
 * Write-state sequence per docs/integration.md NoteToast:
 * encrypting → certifying → certified(blobObjectId) | failed(+retry).
 * Rendered as the kit's single-line toast pill so saves read like receipts.
 */
export type WriteState =
  | { phase: 'encrypting' }
  | { phase: 'certifying' }
  | { phase: 'certified'; blobObjectId: string; provenanceUrl: string }
  | { phase: 'failed' }
  // A non-note on-chain tx that COMMITTED but FAILED (Move abort): an honest ✕
  // receipt that still links the failed tx's provenance, instead of a green
  // success. Distinct from `failed` (note-save Seal failure) so it carries a url.
  | { phase: 'tx-failed'; provenanceUrl: string }
  // The funding preflight blocked the write: the agent is out of gas (SUI) and/or
  // storage (WAL). Distinct from `failed` so the toast can say what's wrong and
  // offer a top-up instead of a generic retry.
  | { phase: 'low-balance'; needsSui: boolean; needsWal: boolean };

/**
 * Copy overrides for a NON-note on-chain receipt (publish, agent register, forget,
 * …). Note saves pass none and keep the default "Encrypting/Certifying/Memory
 * sealed" copy. A failure that never reaches the chain (declined popup, network)
 * still surfaces through the op's own error path — the receipt is dropped — so
 * `fail` only labels the COMMITTED-but-failed case, where the receipt stays as an
 * honest ✕ with its "View provenance" link.
 */
export interface OnchainLabels {
  /** Replaces "Certifying" while the tx is in flight (e.g. "Publishing"). */
  pending: string;
  /** Replaces "Memory sealed" on success (e.g. "Link published"). */
  success: string;
  /** Replaces "Transaction failed" on a committed-but-failed tx (e.g. "Pairing failed"). */
  fail?: string;
}

export interface WriteStateCardProps {
  state: WriteState;
  noteTitle: string;
  /** Copy overrides for a non-note receipt; omitted → the note-save defaults. */
  labels?: OnchainLabels;
  onRetry?: () => void;
  onTopUp?: () => void;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function WriteStateCard({ state, noteTitle, labels, onRetry, onTopUp }: WriteStateCardProps) {
  switch (state.phase) {
    case 'encrypting':
      return (
        <div className="toast info loading" role="status">
          <span className="ti" aria-hidden="true"><span className="spinstar">✦</span></span>
          <span className="tt">{labels?.pending ?? 'Encrypting'}</span>
          <span className="td">{noteTitle}</span>
        </div>
      );
    case 'certifying':
      return (
        <div className="toast info loading" role="status">
          <span className="ti" aria-hidden="true"><span className="spinstar">✦</span></span>
          <span className="tt">{labels?.pending ?? 'Certifying'}</span>
          <span className="td">{noteTitle}</span>
        </div>
      );
    case 'certified':
      return (
        <div className="toast success" role="status">
          <span className="ti" aria-hidden="true">✦</span>
          <span className="tt">{labels?.success ?? 'Memory sealed'}</span>
          <span className="td">
            {state.blobObjectId ? <span className="mono">{shortId(state.blobObjectId)}</span> : noteTitle}
          </span>
          {state.provenanceUrl ? (
            <a className="tact" href={state.provenanceUrl} target="_blank" rel="noreferrer">
              View provenance
            </a>
          ) : null}
        </div>
      );
    case 'failed':
      return (
        <div className="toast error" role="status">
          <span className="ti" aria-hidden="true">✕</span>
          <span className="tt">Seal failed</span>
          <span className="td">{noteTitle} is safe locally</span>
          {onRetry ? (
            <button className="tact" type="button" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      );
    case 'tx-failed':
      return (
        <div className="toast error" role="status">
          <span className="ti" aria-hidden="true">✕</span>
          <span className="tt">{labels?.fail ?? 'Transaction failed'}</span>
          <span className="td">{noteTitle}</span>
          {state.provenanceUrl ? (
            <a className="tact" href={state.provenanceUrl} target="_blank" rel="noreferrer">
              View provenance
            </a>
          ) : null}
        </div>
      );
    case 'low-balance': {
      const needs = [state.needsSui && 'gas', state.needsWal && 'storage'].filter(Boolean).join(' + ');
      return (
        <div className="toast warn" role="status">
          <span className="ti" aria-hidden="true">✦</span>
          <span className="tt">Not saved — agent needs {needs}</span>
          <span className="td">{noteTitle} is safe locally; top up to seal it</span>
          {onTopUp ? (
            <button className="tact" type="button" onClick={onTopUp}>
              Top up
            </button>
          ) : null}
        </div>
      );
    }
  }
}
