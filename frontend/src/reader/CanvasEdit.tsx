/**
 * Wallet-free editable board for the chromeless reader (plan 2026-06-24 U8) — the
 * guest's canvas co-edit surface. Extends `CanvasReadonly`'s renderer with an
 * INTERACTION layer (select / move / draw / rect / ellipse / text / arrow / delete)
 * built from the pure canvas cores (`canvas/*.ts` — already `@mysten`-free), plus a
 * toolbar. It deliberately does NOT import the in-app `Canvas.tsx`, which drags the
 * wallet/agent-key/session stack into the guest bundle (C6 / AE9). The collab
 * session + el-op sync is grafted on in U13.
 *
 * Scope (v1): the essential editing a guest needs — selection, drag-move, freehand
 * draw, shape/arrow/text placement, and delete. Excalidraw-parity transforms
 * (8-handle resize, rotation, arrow-endpoint editing) reuse the same pure cores but
 * are a larger surface verified live (U12); they are intentionally not in this cut.
 */
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  commonBounds,
  isLinear,
  newElementId,
  newVersionNonce,
  bumpVersion,
  type CanvasElement,
} from '../../../chain/core/src/elements.js';
import { addElement, moveElements, deleteElements } from '../canvas/ops';
import { hitTopElement } from '../canvas/hittest';
import { Frame } from './Frame';
import './canvas-edit.css';

const INK = '#16181D';
type Tool = 'select' | 'hand' | 'draw' | 'arrow' | 'rect' | 'ellipse' | 'text';
interface Pt {
  x: number;
  y: number;
}

/** The same icon wrapper the in-app Canvas toolbar uses. */
function ToolIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Tool set + icons mirrored from the in-app Canvas (pages/Canvas.tsx TOOLS). */
const TOOLS: Array<{ id: Tool; label: string; icon: ReactNode }> = [
  { id: 'select', label: 'Select', icon: <ToolIcon><path d="M5 3l14 7-6.5 1.5L9 18z" /></ToolIcon> },
  { id: 'hand', label: 'Pan', icon: <ToolIcon><path d="M18 11V6a2 2 0 0 0-4 0v5" /><path d="M14 10V4a2 2 0 0 0-4 0v6" /><path d="M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></ToolIcon> },
  { id: 'draw', label: 'Draw', icon: <ToolIcon><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></ToolIcon> },
  { id: 'arrow', label: 'Arrow', icon: <ToolIcon><line x1="5" y1="19" x2="19" y2="5" /><polyline points="9 5 19 5 19 15" /></ToolIcon> },
  { id: 'rect', label: 'Rectangle', icon: <ToolIcon><rect x="3" y="3" width="18" height="18" rx="2" /></ToolIcon> },
  { id: 'ellipse', label: 'Ellipse', icon: <ToolIcon><ellipse cx="12" cy="12" rx="9" ry="9" /></ToolIcon> },
  { id: 'text', label: 'Text', icon: <ToolIcon><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></ToolIcon> },
];

function makeBase(): Pick<CanvasElement, 'id' | 'angle' | 'index' | 'version' | 'versionNonce'> {
  return { id: newElementId(), angle: 0, index: 0, version: 1, versionNonce: newVersionNonce() };
}

function absPoints(el: Extract<CanvasElement, { points: number[] }>): string {
  let out = '';
  for (let i = 0; i < el.points.length; i += 2) out += `${el.x + el.points[i]},${el.y + el.points[i + 1]} `;
  return out.trim();
}

/** Vector render (mirrors CanvasReadonly), with a selection outline. */
function renderVector(s: CanvasElement, selected: boolean): ReactElement | null {
  const rot = s.angle ? `rotate(${(s.angle * 180) / Math.PI} ${s.x + s.w / 2} ${s.y + s.h / 2})` : undefined;
  const sel = selected ? { stroke: 'var(--blue-600)', strokeWidth: (s.strokeWidth ?? 2) + 2, opacity: 0.5 } : null;
  if (isLinear(s)) {
    return (
      <g key={s.id}>
        {sel ? <polyline points={absPoints(s)} fill="none" {...sel} /> : null}
        <polyline
          points={absPoints(s)}
          transform={rot}
          fill="none"
          stroke={s.strokeColor ?? INK}
          strokeWidth={s.strokeWidth ?? 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          markerEnd={s.type === 'arrow' ? 'url(#ce-arrow)' : undefined}
        />
      </g>
    );
  }
  if (s.type === 'rect' || s.type === 'ellipse') {
    const stroke = s.strokeColor ?? INK;
    const fill = s.backgroundColor && s.backgroundColor !== 'transparent' ? s.backgroundColor : 'none';
    const sw = s.strokeWidth ?? 2;
    const outline = selected ? <rect x={s.x - 4} y={s.y - 4} width={s.w + 8} height={s.h + 8} fill="none" stroke="var(--blue-600)" strokeWidth={1} strokeDasharray="4 3" /> : null;
    if (s.type === 'ellipse') {
      return (
        <g key={s.id}>
          {outline}
          <ellipse cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} transform={rot} fill={fill} stroke={stroke} strokeWidth={sw} />
        </g>
      );
    }
    return (
      <g key={s.id}>
        {outline}
        <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="3" transform={rot} fill={fill} stroke={stroke} strokeWidth={sw} />
      </g>
    );
  }
  return null;
}

export interface CanvasEditProps {
  /** The current element list (controlled). The owner of this state (a standalone
   *  wrapper, or the collab room in U13) applies inbound edits to it. */
  elements: CanvasElement[];
  /** Apply a local element-list change (a functional updater, like setState). */
  onElementsChange: (next: CanvasElement[] | ((prev: CanvasElement[]) => CanvasElement[])) => void;
  /** Called when one element is created/edited/deleted locally (U13 broadcasts it). */
  onLocalEdit?: (el: CanvasElement) => void;
}

export function CanvasEdit({ elements, onElementsChange: setElements, onLocalEdit }: CanvasEditProps): ReactElement {
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const boardRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<{ id: string } | null>(null);
  const moveRef = useRef<{ id: string; sx: number; sy: number } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  // Mirror the controlled elements so a pointerup within one synchronous batch can
  // read the just-seeded element (the prop only refreshes on the next render).
  const elementsRef = useRef<CanvasElement[]>(elements);
  elementsRef.current = elements;
  // Apply a change to BOTH the controlled state and the synchronous ref, so a
  // pointer sequence (down→move→up) within one React batch sees its own edits
  // before the prop refreshes on the next render.
  const apply = (fn: (prev: CanvasElement[]) => CanvasElement[]): void => {
    elementsRef.current = fn(elementsRef.current);
    setElements(elementsRef.current);
  };

  // Center on content once (a hydrated board lands on its notes, not empty space).
  useEffect(() => {
    const node = boardRef.current;
    const live = elements.filter((e) => !e.isDeleted);
    if (!node || live.length === 0) return;
    const b = commonBounds(live);
    setPan({ x: node.clientWidth / 2 - (b.x + b.w / 2), y: node.clientHeight / 2 - (b.y + b.h / 2) });
    // center once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toWorld = (e: ReactPointerEvent): Pt => {
    const r = boardRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - pan.x, y: e.clientY - r.top - pan.y };
  };

  const emit = (el: CanvasElement): void => onLocalEdit?.(el);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const wp = toWorld(e);
    const live = elements.filter((el) => !el.isDeleted);

    if (tool === 'hand') {
      // the pan tool always pans, regardless of what's under the pointer
      panRef.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
      return;
    }

    if (tool === 'select') {
      const hit = hitTopElement(wp, live);
      setSelectedId(hit?.id ?? null);
      if (hit) moveRef.current = { id: hit.id, sx: wp.x, sy: wp.y };
      else panRef.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
      return;
    }

    // a placement tool seeds a new element at the pointer
    const base = makeBase();
    let el: CanvasElement;
    if (tool === 'draw') el = { ...base, type: 'draw', x: wp.x, y: wp.y, w: 0, h: 0, points: [0, 0] };
    else if (tool === 'arrow') el = { ...base, type: 'arrow', x: wp.x, y: wp.y, w: 0, h: 0, points: [0, 0, 0, 0] };
    else if (tool === 'ellipse') el = { ...base, type: 'ellipse', x: wp.x, y: wp.y, w: 0, h: 0 };
    else if (tool === 'text') el = { ...base, type: 'text', x: wp.x, y: wp.y, w: 120, h: 24, text: 'Text' };
    else el = { ...base, type: 'rect', x: wp.x, y: wp.y, w: 0, h: 0 };
    apply((prev) => addElement(prev, el));
    setSelectedId(el.id);
    if (tool === 'text') {
      emit(el);
      setTool('select');
    } else {
      drawRef.current = { id: el.id };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const wp = toWorld(e);
    if (panRef.current) {
      const p = panRef.current;
      setPan({ x: p.ox + (e.clientX - p.sx), y: p.oy + (e.clientY - p.sy) });
      return;
    }
    if (moveRef.current) {
      const m = moveRef.current;
      const dx = wp.x - m.sx;
      const dy = wp.y - m.sy;
      if (dx || dy) {
        apply((prev) => moveElements(prev, [m.id], dx, dy));
        moveRef.current = { ...m, sx: wp.x, sy: wp.y };
      }
      return;
    }
    const d = drawRef.current;
    if (!d) return;
    apply((prev) =>
      prev.map((el) => {
        if (el.id !== d.id) return el;
        if (el.type === 'draw' || el.type === 'arrow') {
          const pts = el.type === 'arrow' ? [0, 0, wp.x - el.x, wp.y - el.y] : [...el.points, wp.x - el.x, wp.y - el.y];
          return { ...el, points: pts, w: Math.abs(wp.x - el.x), h: Math.abs(wp.y - el.y) };
        }
        return { ...el, w: Math.max(1, wp.x - el.x), h: Math.max(1, wp.y - el.y) };
      }),
    );
  };

  const onPointerUp = (): void => {
    if (drawRef.current) {
      const id = drawRef.current.id;
      const el = elementsRef.current.find((e) => e.id === id);
      if (el) emit(bumpVersion(el));
      drawRef.current = null;
      setTool('select');
    }
    if (moveRef.current) {
      const el = elementsRef.current.find((e) => e.id === moveRef.current!.id);
      if (el) emit(bumpVersion(el));
      moveRef.current = null;
    }
    panRef.current = null;
  };

  const remove = (): void => {
    if (!selectedId) return;
    const el = elementsRef.current.find((e) => e.id === selectedId);
    apply((prev) => deleteElements(prev, [selectedId]));
    if (el) emit({ ...el, isDeleted: true, version: el.version + 1, versionNonce: newVersionNonce() });
    setSelectedId(null);
  };

  const live = elements.filter((e) => !e.isDeleted).sort((a, b) => a.index - b.index);

  return (
    <Frame state="edit" tag="Live board" bleed>
      <div
        ref={boardRef}
        className="ce-board"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        data-tool={tool}
      >
        <div className="ce-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          <svg className="ce-ink">
            <defs>
              <marker id="ce-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill={INK} />
              </marker>
            </defs>
            {live.map((s) => renderVector(s, s.id === selectedId))}
          </svg>
          {live
            .filter((el) => el.type === 'text')
            .map((el) => (
              <div key={el.id} className="cv-text" style={{ left: el.x, top: el.y, color: (el as { strokeColor?: string }).strokeColor }}>
                {(el as { text: string }).text}
              </div>
            ))}
        </div>
      </div>
      {/* the SAME icon toolbar as the in-app Canvas (.pgcv-tools from kit.css) */}
      <div className="pgcv-tools" aria-label="Board tools">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={tool === t.id ? 'on' : undefined} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
            {t.icon}
          </button>
        ))}
        <span className="tsep" />
        <button type="button" aria-label="Delete selection" disabled={!selectedId} onClick={remove}>
          <ToolIcon>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </ToolIcon>
        </button>
      </div>
    </Frame>
  );
}
