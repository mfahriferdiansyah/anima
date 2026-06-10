export type OrbSize = 'sm' | 'md' | 'lg';

export interface OrbProps {
  size?: OrbSize;
  /** Spinning ✦ while the companion works; breathing idle otherwise. */
  working?: boolean;
  /** Orange dot: something finished while you were elsewhere. */
  badge?: boolean;
  label?: string;
}

/** The one living element: breathing idle ✦, spinning while working, badge dot for unseen activity. */
export function Orb({ size = 'md', working = false, badge = false, label }: OrbProps) {
  const cls = ['orb', `orb-${size}`, working ? 'working' : ''].filter(Boolean).join(' ');
  const fallbackLabel = working ? 'Companion is working' : 'Companion is idle';
  return (
    <span className={cls} role="img" aria-label={label ?? fallbackLabel}>
      <span className="oglyph" aria-hidden="true">✦</span>
      {badge ? <span className="obadge" aria-hidden="true" /> : null}
    </span>
  );
}
