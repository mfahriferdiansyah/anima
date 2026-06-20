import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

/**
 * Shared layout options (nav title/logo, links) used by both the home and
 * docs layouts. The brand mark is "Anima" in Space Grotesk with a small
 * orange star.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="anima-logo inline-flex items-center gap-1.5">
          <span className="anima-star text-base leading-none">✦</span>
          Anima
        </span>
      ),
      url: '/',
    },
  };
}
