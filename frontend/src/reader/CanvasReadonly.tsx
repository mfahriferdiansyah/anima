/**
 * Read-only CANVAS view for the chromeless reader (canvas read-only view).
 *
 * A real, pannable board (mirrors the in-app canvas: translate the world on
 * pointer-drag and wheel, no zoom), NOT a fitted static thumbnail. Shapes render
 * as SVG, note cards / text / image placeholders as HTML, all at world coords; the
 * view opens centred on the board's content. Geometry + baked note title/excerpt
 * come entirely from the snapshot JSON, so this stays `@mysten`-free: it imports
 * only the pure geometry helpers from `elements.js` (NOT the barrel) and the
 * snapshot TYPE (erased). It reuses the app's `.pgcv-note`/`.nt3`/`.nb3` (kit.css)
 * so a shared board matches the live one; vector rendering mirrors `Canvas.tsx`'s
 * `renderVector`. Images can't be resolved without the wallet → neutral placeholder.
 */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { commonBounds, isLinear, type CanvasElement } from '../../../chain/core/src/elements.js';
import type { CanvasSnapshot, CanvasSnapshotNoteInfo } from '../web3/canvasSnapshot';
import { Frame } from './Frame';

const INK = '#16181D';

/** Absolute polyline points (world coords) for a linear element. */
function absPoints(el: Extract<CanvasElement, { points: number[] }>): string {
  let out = '';
  for (let i = 0; i < el.points.length; i += 2) out += `${el.x + el.points[i]},${el.y + el.points[i + 1]} `;
  return out.trim();
}

/** Mirror of Canvas.tsx renderVector, read-only (no selection/draft). */
function renderVector(s: CanvasElement): ReactElement | null {
  const rot = s.angle ? `rotate(${(s.angle * 180) / Math.PI} ${s.x + s.w / 2} ${s.y + s.h / 2})` : undefined;
  if (isLinear(s)) {
    return (
      <polyline
        key={s.id}
        points={absPoints(s)}
        transform={rot}
        fill="none"
        stroke={s.strokeColor ?? INK}
        strokeWidth={s.strokeWidth ?? 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerEnd={s.type === 'arrow' ? 'url(#rd-arrow)' : undefined}
      />
    );
  }
  if (s.type === 'rect' || s.type === 'ellipse') {
    const stroke = s.strokeColor ?? INK;
    const fill = s.backgroundColor && s.backgroundColor !== 'transparent' ? s.backgroundColor : 'none';
    const sw = s.strokeWidth ?? 2;
    const dash = s.strokeStyle === 'dashed' ? '8 6' : s.strokeStyle === 'dotted' ? '2 5' : undefined;
    if (s.type === 'ellipse') {
      return <ellipse key={s.id} cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} transform={rot} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />;
    }
    return <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} rx="3" transform={rot} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />;
  }
  return null;
}

/** Note card / text / image placeholder at world coords. */
function renderHtml(el: CanvasElement, notes: Record<string, CanvasSnapshotNoteInfo>): ReactElement | null {
  if (el.type === 'note') {
    const info = notes[el.noteId];
    return (
      <div key={el.id} className={info?.byAgent ? 'pgcv-note byagent2' : 'pgcv-note'} style={{ left: el.x, top: el.y, pointerEvents: 'none' }}>
        <div className="nt3">{info?.title || 'Untitled note'}</div>
        <div className="nb3">{info?.excerpt || ''}</div>
      </div>
    );
  }
  if (el.type === 'text') {
    return (
      <div key={el.id} className="cv-text" style={{ left: el.x, top: el.y, color: el.strokeColor, pointerEvents: 'none' }}>
        {el.text}
      </div>
    );
  }
  if (el.type === 'image') {
    return <div key={el.id} className="rd-img-ph" style={{ left: el.x, top: el.y, width: el.w, height: el.h }} aria-label="image" />;
  }
  return null;
}

/** Centred label inside a rect/ellipse (the board's double-click label). */
function renderLabel(el: CanvasElement): ReactElement | null {
  if ((el.type !== 'rect' && el.type !== 'ellipse') || !el.label) return null;
  return (
    <div key={`lbl-${el.id}`} className="rd-label" style={{ left: el.x, top: el.y, width: el.w, height: el.h }}>
      {el.label}
    </div>
  );
}

export function CanvasReadonly({ snapshot }: { snapshot: CanvasSnapshot }): ReactElement {
  const boardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);

  const live = [...(snapshot.elements ?? [])].filter((e) => !e.isDeleted).sort((a, b) => a.index - b.index);
  const notes = snapshot.notes ?? {};

  // Open centred on the board's content (the in-app board pans from 0,0; here a
  // shared link should land on the notes, not empty space).
  useLayoutEffect(() => {
    const node = boardRef.current;
    if (!node || live.length === 0) return;
    const b = commonBounds(live);
    setPan({ x: node.clientWidth / 2 - (b.x + b.w / 2), y: node.clientHeight / 2 - (b.y + b.h / 2) });
    // center once on mount for this snapshot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  // Wheel pans the board (mirrors Canvas.tsx); non-passive so it doesn't scroll the page.
  useEffect(() => {
    const node = boardRef.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
    setPanning(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    setPan({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
  };
  const onPointerUp = (): void => {
    drag.current = null;
    setPanning(false);
  };

  if (live.length === 0) {
    return (
      <Frame state="ready" tag="Shared canvas">
        <div className="rd-canvas-empty">{snapshot.title || 'Shared canvas'} is empty.</div>
      </Frame>
    );
  }

  return (
    <Frame state="ready" tag="Shared canvas" bleed>
      <div
        className={panning ? 'rd-board panning' : 'rd-board'}
        ref={boardRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div className="rd-board-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          <svg className="rd-ink">
            <defs>
              <marker id="rd-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill={INK} />
              </marker>
            </defs>
            {live.map(renderVector)}
          </svg>
          {live.map((el) => renderHtml(el, notes))}
          {live.map((el) => renderLabel(el))}
        </div>
      </div>
    </Frame>
  );
}
