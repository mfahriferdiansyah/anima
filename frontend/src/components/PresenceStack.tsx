/**
 * The MS-Docs-style avatar stack (plan 2026-06-24 U9) — who is in the room, as
 * overlapping colored circles with a 2-char glyph. Shared by the in-app board and
 * the reader edit surfaces. Owner is rendered distinctly (first, ringed). Past a
 * visible cap the overflow collapses to a "+N" chip so the stack stays legible at
 * the 32-peer room cap. Colors come from the fixed kit palette (no invented tints).
 */
import type { ReactElement } from 'react';
import { identityFor } from '../web3/collabIdentity';
import './presence-stack.css';

export interface PresenceMember {
  id: string;
  /** Display label (e.g. "Owner" or "Guest A3"). Always visible on hover/title. */
  label: string;
  /** Verified owner — rendered distinctly (a guest claiming "Owner" without a valid signature is NOT verified). */
  isOwner?: boolean;
}

const VISIBLE_CAP = 5;

export function PresenceStack({ members }: { members: PresenceMember[] }): ReactElement | null {
  if (members.length === 0) return null;
  // Owner first, then the rest in a stable order.
  const ordered = [...members].sort((a, b) => Number(b.isOwner ?? false) - Number(a.isOwner ?? false));
  const visible = ordered.slice(0, VISIBLE_CAP);
  const overflow = ordered.length - visible.length;

  return (
    <div className="pstack" aria-label={`${members.length} in this room`}>
      {visible.map((m) => {
        const { color, glyph } = identityFor(m.id);
        return (
          <span
            key={m.id}
            className={m.isOwner ? 'pstack-dot pstack-owner' : 'pstack-dot'}
            style={{ background: color }}
            title={m.label}
            aria-label={m.label}
          >
            {glyph}
          </span>
        );
      })}
      {overflow > 0 ? (
        <span className="pstack-dot pstack-more" title={`${overflow} more`} aria-label={`${overflow} more`}>
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
