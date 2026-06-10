/**
 * The camera-legible memory-write card. One distinguishing visual property
 * per state (readable on a 1080p recording):
 *   encrypting — pulsing soul-colored left border
 *   certifying — static border + spinner + "writing to Walrus…"
 *   certified  — full-violet border + provenance link (hairline chain text)
 *   failed     — red border + RETRY BUTTON (one click re-attempts the turn write)
 */
export type WriteState = 'encrypting' | 'certifying' | 'certified' | 'failed';

export interface PendingNote {
  noteId: string;
  title: string;
  state: WriteState;
  blobObjectId?: string;
  error?: string;
}

export function NoteToast({ p, onRetry, onOpen }: { p: PendingNote; onRetry?: () => void; onOpen?: (noteId: string) => void }) {
  const border =
    p.state === 'certified'
      ? '2px solid var(--color-soul-violet)'
      : p.state === 'failed'
        ? '2px solid var(--color-danger)'
        : '2px solid transparent';
  return (
    <div
      className={`card px-3 py-2 flex items-center gap-3 ${p.state === 'encrypting' ? 'animate-pulse' : ''}`}
      style={{ borderLeft: p.state === 'encrypting' ? '2px solid var(--color-soul-cyan)' : border }}
    >
      <div className="flex-1 min-w-0">
        <button
          onClick={() => onOpen?.(p.noteId)}
          className="block truncate text-left hover:underline"
          style={{ fontWeight: 500 }}
        >
          {p.title}
        </button>
        <span className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>
          {p.state === 'encrypting' && 'encrypting…'}
          {p.state === 'certifying' && 'writing to Walrus…'}
          {p.state === 'certified' && p.blobObjectId && (
            <a
              href={`https://testnet.suivision.xyz/object/${p.blobObjectId}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:underline"
            >
              on-chain · {p.blobObjectId.slice(0, 10)}… ↗
            </a>
          )}
          {p.state === 'failed' && (p.error ?? 'write failed')}
        </span>
      </div>
      {p.state === 'certifying' && (
        <div className="size-3 rounded-full border-2 border-fg-faint border-t-transparent animate-spin" />
      )}
      {p.state === 'failed' && onRetry && (
        <button onClick={onRetry} className="card px-2 py-1 hover:border-border-strong" style={{ fontSize: 'var(--text-meta)' }}>
          retry
        </button>
      )}
    </div>
  );
}
