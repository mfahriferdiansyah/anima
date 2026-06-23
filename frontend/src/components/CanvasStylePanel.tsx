import type { CanvasElement, ElementStyle } from '../../../chain/core/src/index.js';

// Fixed swatch rows (no full colour picker — Excalidraw-minimal). Stroke = ink, red,
// blue, green, amber, violet; fill = no-fill plus light tints of the same hues.
const STROKES = ['#16181D', '#E03131', '#1971C2', '#2F9E44', '#F08C00', '#9C36B5'];
const FILLS = ['transparent', '#FFC9C9', '#A5D8FF', '#B2F2BB', '#FFEC99', '#EEBEFE'];
const WIDTHS: Array<{ v: 1 | 2 | 4; label: string; bar: number }> = [
  { v: 1, label: 'Thin', bar: 1.5 },
  { v: 2, label: 'Bold', bar: 3 },
  { v: 4, label: 'Extra bold', bar: 5 },
];
const STYLES: Array<{ v: 'solid' | 'dashed' | 'dotted'; label: string; dash: string }> = [
  { v: 'solid', label: 'Solid', dash: '' },
  { v: 'dashed', label: 'Dashed', dash: '5 4' },
  { v: 'dotted', label: 'Dotted', dash: '1.5 4' },
];

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Per-selection style controls for a single shape or text element. A shape (rect /
 * ellipse) gets stroke colour, fill, border width and border style; a text element
 * gets just its colour. Each click applies live to the selected element via
 * `onPatch` (the board owns the undo push + state write). Stops its own pointer
 * events so clicking a control never deselects the element underneath.
 */
export function CanvasStylePanel({ el, onPatch }: { el: CanvasElement; onPatch: (patch: ElementStyle) => void }) {
  const isShape = el.type === 'rect' || el.type === 'ellipse';
  const stroke = el.strokeColor ?? '#16181D';
  const fill = el.backgroundColor ?? 'transparent';
  const width = el.strokeWidth ?? 2;
  const style = el.strokeStyle ?? 'solid';
  return (
    <div className="cv-stylepanel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="cv-sp-row">
        <span className="cv-sp-lbl">{isShape ? 'Stroke' : 'Color'}</span>
        <div className="cv-sp-swatches">
          {STROKES.map((c) => (
            <button
              key={c}
              type="button"
              className={eq(stroke, c) ? 'cv-sw on' : 'cv-sw'}
              style={{ background: c }}
              aria-label={`Stroke ${c}`}
              onClick={() => onPatch({ strokeColor: c })}
            />
          ))}
        </div>
      </div>
      {isShape ? (
        <>
          <div className="cv-sp-row">
            <span className="cv-sp-lbl">Fill</span>
            <div className="cv-sp-swatches">
              {FILLS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={['cv-sw', c === 'transparent' ? 'none' : '', eq(fill, c) ? 'on' : ''].filter(Boolean).join(' ')}
                  style={c === 'transparent' ? undefined : { background: c }}
                  aria-label={c === 'transparent' ? 'No fill' : `Fill ${c}`}
                  onClick={() => onPatch({ backgroundColor: c })}
                />
              ))}
            </div>
          </div>
          <div className="cv-sp-row">
            <span className="cv-sp-lbl">Border</span>
            <div className="cv-sp-segs">
              {WIDTHS.map((w) => (
                <button key={w.v} type="button" className={width === w.v ? 'cv-seg on' : 'cv-seg'} aria-label={w.label} title={w.label} onClick={() => onPatch({ strokeWidth: w.v })}>
                  <svg viewBox="0 0 24 12" width="22" height="12" aria-hidden="true">
                    <line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth={w.bar} strokeLinecap="round" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
          <div className="cv-sp-row">
            <span className="cv-sp-lbl">Style</span>
            <div className="cv-sp-segs">
              {STYLES.map((s) => (
                <button key={s.v} type="button" className={style === s.v ? 'cv-seg on' : 'cv-seg'} aria-label={s.label} title={s.label} onClick={() => onPatch({ strokeStyle: s.v })}>
                  <svg viewBox="0 0 24 12" width="22" height="12" aria-hidden="true">
                    <line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={s.dash || undefined} />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
