import type { ReactNode } from 'react';

/** Semantic meaning lives in the glyph color ONLY; the pill itself is always ink. */
export type GlyphColor = 'teal' | 'orange' | 'blue' | 'pink' | 'red';

const glyphColorVar: Record<GlyphColor, string> = {
  teal: 'var(--teal-500)',
  orange: 'var(--orange-500)',
  blue: 'var(--blue-300)',
  pink: 'var(--pink-500)',
  red: 'var(--red-500)',
};

export interface PillProps {
  /** Kit glyph character: ✦ brand/verified, ✧ agent, ✕ error. */
  glyph?: string;
  glyphColor?: GlyphColor;
  children: ReactNode;
}

export function Pill({ glyph, glyphColor, children }: PillProps) {
  return (
    <span className="pill pill-ink">
      {glyph ? (
        <span aria-hidden="true" style={glyphColor ? { color: glyphColorVar[glyphColor] } : undefined}>
          {glyph}
        </span>
      ) : null}
      {children}
    </span>
  );
}
