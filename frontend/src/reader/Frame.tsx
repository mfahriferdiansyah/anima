/**
 * The reader's chrome (plan 008 U3 follow-up, redesigned): NO sidebar. A shared
 * doc reads as a clean centered document, with two light brand ties that move:
 *  - a thin animated sheen + a quiet brand wordmark across the very top, and
 *  - a floating, breathing brand orb (bottom-right) that links back to Anima —
 *    the app's own signature element (the companion FAB).
 * Purely presentational and `@mysten`-free, so BOTH the view path (`ReaderView`)
 * and the dynamically-loaded edit chunk (`EditView`) import it statically without
 * breaking bundle isolation (KTD6).
 */
import type { ReactNode, ReactElement } from 'react';

/** A reader state label mirrored onto `[data-reader-state]` for the browser smoke. */
export type ReaderStateAttr =
  | 'loading'
  | 'ready'
  | 'wrong-password'
  | 'not-found'
  | 'network-error'
  | 'edit';

export function Frame({
  state,
  tag = 'Shared with you',
  bleed = false,
  headerExtra,
  children,
}: {
  state: ReaderStateAttr;
  /** Quiet context label at the top-right (e.g. "Shared with you", "Live edit"). */
  tag?: string;
  /** Full-bleed content (no centered padding) — for the pannable board surface. */
  bleed?: boolean;
  /** Optional content in the header, to the LEFT of the tag (e.g. the live avatar stack). */
  headerExtra?: ReactNode;
  children: ReactNode;
}): ReactElement {
  // `data-reader-state` lets a screenshot agent / the jsdom smoke read a verdict.
  return (
    <div className="rd-shell" data-reader-state={state}>
      <div className="rd-sheen" aria-hidden="true" />
      <header className="rd-top">
        <a className="rd-top-brand" href="/" aria-label="Anima home">
          anima<i aria-hidden="true">✦</i>
        </a>
        <span className="rd-top-right">
          {headerExtra}
          <span className="rd-top-tag">{tag}</span>
        </span>
      </header>
      <main className={bleed ? 'rd-main rd-main-bleed' : 'rd-main'}>{children}</main>
      <a className="rd-orb" href="/" aria-label="Open Anima" title="Open Anima">
        <span className="rd-orb-star" aria-hidden="true">✦</span>
      </a>
    </div>
  );
}
