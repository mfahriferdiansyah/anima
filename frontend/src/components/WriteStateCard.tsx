/**
 * Write-state sequence per docs/integration.md NoteToast:
 * encrypting → certifying → certified(blobObjectId) | failed(+retry).
 * Rendered as the kit's single-line toast pill so saves read like receipts.
 */
export type WriteState =
  | { phase: 'encrypting' }
  | { phase: 'certifying' }
  | { phase: 'certified'; blobObjectId: string; provenanceUrl: string }
  | { phase: 'failed' };

export interface WriteStateCardProps {
  state: WriteState;
  noteTitle: string;
  onRetry?: () => void;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function WriteStateCard({ state, noteTitle, onRetry }: WriteStateCardProps) {
  switch (state.phase) {
    case 'encrypting':
      return (
        <div className="toast info" role="status">
          <span className="ti" aria-hidden="true"><span className="spinstar">✦</span></span>
          <span className="tt">Encrypting</span>
          <span className="td">{noteTitle}</span>
        </div>
      );
    case 'certifying':
      return (
        <div className="toast info" role="status">
          <span className="ti" aria-hidden="true"><span className="spinstar">✦</span></span>
          <span className="tt">Certifying</span>
          <span className="td">{noteTitle}</span>
        </div>
      );
    case 'certified':
      return (
        <div className="toast success" role="status">
          <span className="ti" aria-hidden="true">✦</span>
          <span className="tt">Memory sealed</span>
          <span className="td"><span className="mono">{shortId(state.blobObjectId)}</span></span>
          <a className="tact" href={state.provenanceUrl} target="_blank" rel="noreferrer">
            View provenance
          </a>
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
  }
}
