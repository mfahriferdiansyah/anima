import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createNote, useVault } from '@/hooks/useVault';
import type { Note } from '@/hooks/useVault';
import { SHARED_CANVAS_ID, useCanvases } from '@/hooks/useCanvases';
import { moveNote, startPresence, stopPresence, usePresence } from '@/hooks/usePresence';
import type { Peer } from '@/hooks/usePresence';
import { scheduleAgentNote } from '@/hooks/useAgentTimeline';
import { useVaultSession } from '@/hooks/useVaultSession';
import './canvas.css';

const CARD_WIDTH = 190;
/** Edge endpoints aim at the card's visual middle (title + two excerpt lines). */
const CARD_CENTER_Y = 44;
const DRAG_THRESHOLD_PX = 4;
const INK = '#16181D';
const SEL = '#2F6BFF';

/** A drawn element on the board, in world coordinates (so it pans with cards). */
type Shape =
  | { id: string; kind: 'draw'; pts: number[] }
  | { id: string; kind: 'rect'; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'arrow'; x1: number; y1: number; x2: number; y2: number }
  | { id: string; kind: 'text'; x: number; y: number; text: string };

/** Kit .aged format. */
function shortAge(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Flatten the body into excerpt text: wiki links become titles, list markers drop. */
function excerptOf(note: Note, titles: Map<string, string>): string {
  return note.body
    .replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => titles.get(id) ?? id)
    .split('\n')
    .map((line) => line.replace(/^[\s\->#]*(\[[ x]\]\s*)?/, '').trim())
    .filter(Boolean)
    .join(' ');
}

function pointsAttr(pts: number[]): string {
  let out = '';
  for (let i = 0; i < pts.length; i += 2) out += `${pts[i]},${pts[i + 1]} `;
  return out.trim();
}

/** Move every coordinate of a shape by (dx, dy). */
function translateShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.kind) {
    case 'draw':
      return { ...s, pts: s.pts.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
    case 'rect':
      return { ...s, x: s.x + dx, y: s.y + dy };
    case 'arrow':
      return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    case 'text':
      return { ...s, x: s.x + dx, y: s.y + dy };
  }
}

const DRAW_TOOLS = new Set(['draw', 'arrow', 'shape', 'text']);

function ToolIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const TOOLS: Array<{ id: string; label: string; icon: ReactNode }> = [
  { id: 'select', label: 'Select', icon: <ToolIcon><path d="M5 3l14 7-6.5 1.5L9 18z" /></ToolIcon> },
  { id: 'hand', label: 'Pan', icon: <ToolIcon><path d="M18 11V6a2 2 0 0 0-4 0v5" /><path d="M14 10V4a2 2 0 0 0-4 0v6" /><path d="M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></ToolIcon> },
  { id: 'draw', label: 'Draw', icon: <ToolIcon><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></ToolIcon> },
  { id: 'arrow', label: 'Arrow', icon: <ToolIcon><line x1="5" y1="19" x2="19" y2="5" /><polyline points="9 5 19 5 19 15" /></ToolIcon> },
  { id: 'shape', label: 'Rectangle', icon: <ToolIcon><rect x="3" y="3" width="18" height="18" rx="2" /></ToolIcon> },
  { id: 'text', label: 'Text', icon: <ToolIcon><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></ToolIcon> },
];

function PeerCursor({ peer }: { peer: Peer }) {
  const style = { transform: `translate(${peer.x}px, ${peer.y}px)` };
  if (peer.kind === 'human') {
    return (
      <div className="pgcv-cursor human" style={style} aria-hidden="true">
        <svg viewBox="0 0 24 24"><path fill="#FF4D8D" d="M5 3l14 7-6.5 1.5L9 18z" /></svg>
        <span>{peer.label}</span>
      </div>
    );
  }
  return (
    <div className="pgcv-cursor agent" style={style} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="#FF5C1A" strokeWidth="2" strokeLinejoin="round">
        <path d="M12 3l1.9 5.7L19.6 10.6l-5.7 1.9L12 18.2l-1.9-5.7L4.4 10.6l5.7-1.9Z" />
      </svg>
      <span>
        ✧ {peer.label.toLowerCase()}
        {peer.isWriting ? <i> · is writing…</i> : null}
      </span>
    </div>
  );
}

interface DragState {
  noteId: string;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

/** A pan drag of the whole board (empty-canvas drag or the hand tool). */
interface PanState {
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
}

/**
 * The shared sky (spec #page-canvas): memory cards on constellation paper,
 * faint link edges, live human + agent cursors, and a working Excalidraw-style
 * toolbar — pen, arrow, rectangle and text create real elements you can select,
 * move and delete; the + adds a note card and Recall summons the agent. Card
 * layout writes go through moveNote (debounced mock save + pill pulse).
 *
 * The board is an infinite plane: the wheel/trackpad and empty-canvas drags pan
 * a translated world layer, and the dotted grid scrolls with it. Cards, edges,
 * drawings and cursors live in that layer; the avatars and toolbar stay pinned.
 * Drawings are session-local (mock) — the demo doesn't persist sketch strokes.
 */
export function Canvas() {
  const session = useVaultSession();
  const navigate = useNavigate();
  const { canvasId } = useParams();
  const canvases = useCanvases();
  // The seed board shows the shared note constellation; created boards are blank.
  const isShared = !canvasId || canvasId === SHARED_CANVAS_ID;
  const boardTitle = canvases.find((c) => c.canvasId === (canvasId ?? SHARED_CANVAS_ID))?.title ?? 'Untitled board';
  const { notes } = useVault();
  const { peers, layout, savingLayout, materializedNoteId } = usePresence();
  const dragRef = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [tool, setTool] = useState('select');

  // Infinite-canvas camera: the world layer is translated by this offset.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef<PanState | null>(null);
  const [panning, setPanning] = useState(false);

  // Drawings: committed shapes, the one being drawn, and the current selection.
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const draftRef = useRef<Shape | null>(null);
  const startRef = useRef({ x: 0, y: 0 });
  const shapeDragRef = useRef<{ id: string; startClientX: number; startClientY: number; origin: Shape } | null>(null);
  const textPendingRef = useRef<{ x: number; y: number } | null>(null);
  const idSeq = useRef(0);
  const nextId = () => `sh${++idSeq.current}`;

  // Presence + the live constellation belong to the shared board only.
  useEffect(() => {
    if (!isShared) return;
    startPresence();
    return () => stopPresence();
  }, [isShared]);

  // Each board carries its own (session-local) drawings; switching clears them.
  useEffect(() => {
    setShapes([]);
    setDraft(null);
    setSelectedId(null);
    setEditingId(null);
    draftRef.current = null;
  }, [canvasId]);

  // Wheel/trackpad pans the plane. A native non-passive listener so the
  // horizontal axis can't trigger browser back/forward overscroll.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setPan((prev) => ({ x: prev.x - event.deltaX, y: prev.y - event.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Backspace/Delete removes the selected drawing; Cmd/Ctrl+Z drops the last
  // one. Ignored while typing into the text box or any field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        setShapes((prev) => prev.filter((s) => s.id !== selectedId));
        setSelectedId(null);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setShapes((prev) => prev.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of notes) map.set(note.noteId, note.title || 'Untitled note');
    return map;
  }, [notes]);

  // Notes without a stored position (e.g. chat drafts) cascade near the top-left.
  // The plane is infinite, so authored coordinates are used as-is — the viewer
  // pans to reach cards rather than the board scaling to fit them.
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    let cascade = 0;
    for (const note of notes) {
      const stored = layout[note.noteId];
      if (stored) {
        map.set(note.noteId, stored);
      } else {
        map.set(note.noteId, { x: 60 + cascade * 32, y: 60 + cascade * 32 });
        cascade += 1;
      }
    }
    return map;
  }, [notes, layout]);

  const edges = useMemo(() => {
    const seen = new Set<string>();
    const pairs: Array<{ from: string; to: string }> = [];
    for (const note of notes) {
      for (const target of note.links) {
        if (!titles.has(target)) continue;
        const key = [note.noteId, target].sort().join('~');
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ from: note.noteId, to: target });
      }
    }
    return pairs;
  }, [notes, titles]);

  if (session.phase !== 'ready') return null;
  const name = session.agent.name;

  const newNote = () => navigate(`/app/notes/${createNote()}`);

  /** Client point -> world coordinate (undo the viewport offset and the pan). */
  const toWorld = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return { x: clientX - left - pan.x, y: clientY - top - pan.y };
  };

  const onCardPointerDown = (event: React.PointerEvent<HTMLDivElement>, noteId: string) => {
    if (DRAW_TOOLS.has(tool)) return; // a drawing tool draws over the board, not drags cards
    const origin = positions.get(noteId);
    if (!origin) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      noteId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      moved: false,
    };
  };

  const onCardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    setDraggingId(drag.noteId);
    moveNote(drag.noteId, Math.max(0, drag.originX + dx), Math.max(0, drag.originY + dy));
  };

  const onCardPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDraggingId(null);
    if (drag.moved) {
      moveNote(
        drag.noteId,
        Math.max(0, drag.originX + (event.clientX - drag.startClientX)),
        Math.max(0, drag.originY + (event.clientY - drag.startClientY)),
      );
    } else {
      navigate(`/app/notes/${drag.noteId}`);
    }
  };

  // The board pointer dispatch branches on the active tool: drawing tools create
  // an element, hand/select on empty canvas pans the plane.
  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.pgcv-note, .pgcv-tools, .pgcv-avs')) return;
    setSelectedId(null);
    const wp = toWorld(event.clientX, event.clientY);

    if (tool === 'text') {
      // Defer creation to pointer-up: mounting the textarea on pointerdown lets
      // the browser's focus-on-mousedown blur (and self-delete) it immediately.
      event.currentTarget.setPointerCapture(event.pointerId);
      textPendingRef.current = wp;
      return;
    }

    if (DRAW_TOOLS.has(tool)) {
      event.currentTarget.setPointerCapture(event.pointerId);
      startRef.current = wp;
      const draftShape: Shape =
        tool === 'draw'
          ? { id: nextId(), kind: 'draw', pts: [wp.x, wp.y] }
          : tool === 'arrow'
            ? { id: nextId(), kind: 'arrow', x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y }
            : { id: nextId(), kind: 'rect', x: wp.x, y: wp.y, w: 0, h: 0 };
      draftRef.current = draftShape;
      setDraft(draftShape);
      return;
    }

    // hand, or select on empty canvas: pan the plane
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { startClientX: event.clientX, startClientY: event.clientY, originX: pan.x, originY: pan.y };
    setPanning(true);
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = draftRef.current;
    if (d) {
      const wp = toWorld(event.clientX, event.clientY);
      let next: Shape;
      if (d.kind === 'draw') next = { ...d, pts: [...d.pts, wp.x, wp.y] };
      else if (d.kind === 'arrow') next = { ...d, x2: wp.x, y2: wp.y };
      else if (d.kind === 'rect')
        next = {
          ...d,
          x: Math.min(startRef.current.x, wp.x),
          y: Math.min(startRef.current.y, wp.y),
          w: Math.abs(wp.x - startRef.current.x),
          h: Math.abs(wp.y - startRef.current.y),
        };
      else next = d;
      draftRef.current = next;
      setDraft(next);
      return;
    }
    const p = panRef.current;
    if (!p) return;
    setPan({ x: p.originX + (event.clientX - p.startClientX), y: p.originY + (event.clientY - p.startClientY) });
  };

  const onCanvasPointerUp = () => {
    if (textPendingRef.current) {
      const { x, y } = textPendingRef.current;
      textPendingRef.current = null;
      const shape: Shape = { id: nextId(), kind: 'text', x, y, text: '' };
      setShapes((prev) => [...prev, shape]);
      setEditingId(shape.id);
      setTool('select');
      return;
    }
    const d = draftRef.current;
    if (d) {
      const keep =
        (d.kind === 'draw' && d.pts.length >= 4) ||
        (d.kind === 'rect' && d.w > 3 && d.h > 3) ||
        (d.kind === 'arrow' && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 6);
      if (keep) setShapes((prev) => [...prev, d]);
      draftRef.current = null;
      setDraft(null);
      setTool('select'); // revert to select after drawing, like Excalidraw's default
      return;
    }
    if (panRef.current) {
      panRef.current = null;
      setPanning(false);
    }
  };

  // Select + drag a drawn shape (only with the select tool active).
  const onShapePointerDown = (event: ReactPointerEvent<Element>, shape: Shape) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setSelectedId(shape.id);
    shapeDragRef.current = { id: shape.id, startClientX: event.clientX, startClientY: event.clientY, origin: shape };
  };

  const onShapePointerMove = (event: ReactPointerEvent<Element>) => {
    const sd = shapeDragRef.current;
    if (!sd) return;
    const dx = event.clientX - sd.startClientX;
    const dy = event.clientY - sd.startClientY;
    setShapes((prev) => prev.map((s) => (s.id === sd.id ? translateShape(sd.origin, dx, dy) : s)));
  };

  const onShapePointerUp = () => {
    shapeDragRef.current = null;
  };

  const commitText = (id: string, value: string) => {
    setEditingId(null);
    const text = value.trim();
    if (!text) setShapes((prev) => prev.filter((s) => s.id !== id));
    else setShapes((prev) => prev.map((s) => (s.id === id && s.kind === 'text' ? { ...s, text } : s)));
  };

  const cursor = panning
    ? 'grabbing'
    : tool === 'hand'
      ? 'grab'
      : DRAW_TOOLS.has(tool)
        ? 'crosshair'
        : 'default';

  // One shape -> its visible stroke plus (committed only) a fat invisible hit
  // band that opts into pointer events when the select tool is active.
  const renderShape = (s: Shape, isDraft: boolean) => {
    if (s.kind === 'text') return null;
    const sel = !isDraft && s.id === selectedId;
    const stroke = sel ? SEL : INK;
    const hit = !isDraft && tool === 'select';
    const hitProps = {
      style: { pointerEvents: hit ? ('stroke' as const) : ('none' as const), cursor: 'move' },
      onPointerDown: (e: ReactPointerEvent<Element>) => onShapePointerDown(e, s),
      onPointerMove: onShapePointerMove,
      onPointerUp: onShapePointerUp,
    };
    if (s.kind === 'draw') {
      const pts = pointsAttr(s.pts);
      return (
        <g key={s.id}>
          <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {!isDraft ? <polyline points={pts} fill="none" stroke="transparent" strokeWidth="14" {...hitProps} /> : null}
        </g>
      );
    }
    if (s.kind === 'rect') {
      return (
        <g key={s.id}>
          <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="3" fill="none" stroke={stroke} strokeWidth="2" />
          {!isDraft ? (
            <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="transparent" stroke="transparent" strokeWidth="14" {...{ ...hitProps, style: { pointerEvents: hit ? ('all' as const) : ('none' as const), cursor: 'move' } }} />
          ) : null}
        </g>
      );
    }
    return (
      <g key={s.id}>
        <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={stroke} strokeWidth="2" markerEnd="url(#cv-arrowhead)" />
        {!isDraft ? <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="transparent" strokeWidth="14" {...hitProps} /> : null}
      </g>
    );
  };

  const textShapes = shapes.filter((s): s is Extract<Shape, { kind: 'text' }> => s.kind === 'text');

  return (
    <div className="pged">
      <div className="pged-top">
        <span className="pgcrumb">
          <b>Canvas</b> · {boardTitle}
        </span>
        <span className="sp" />
        {savingLayout ? (
          <span className="pgcv-save">
            <span className="spin" aria-hidden="true">✦</span> saving layout…
          </span>
        ) : null}
        <button type="button" className="pgbtn">
          Share board
        </button>
      </div>
      <div
        className="pgcv"
        ref={viewportRef}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerUp}
        style={{
          backgroundPosition: `${pan.x}px ${pan.y}px`,
          touchAction: 'none',
          cursor,
        }}
      >
        <div
          className="pgcv-world"
          style={{ position: 'absolute', inset: 0, transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <svg className="pgcv-edges" style={{ overflow: 'visible' }} aria-hidden="true">
            {isShared && edges.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) return null;
              return (
                <line
                  key={`${edge.from}~${edge.to}`}
                  x1={from.x + CARD_WIDTH / 2}
                  y1={from.y + CARD_CENTER_Y}
                  x2={to.x + CARD_WIDTH / 2}
                  y2={to.y + CARD_CENTER_Y}
                  stroke="#9AA7C4"
                  strokeOpacity="0.3"
                  strokeWidth="1"
                />
              );
            })}
          </svg>

          <svg className="pgcv-ink">
            <defs>
              <marker id="cv-arrowhead" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill={INK} />
              </marker>
            </defs>
            {shapes.map((s) => renderShape(s, false))}
            {draft ? renderShape(draft, true) : null}
          </svg>

          {textShapes.map((s) =>
            editingId === s.id ? (
              <textarea
                key={s.id}
                className="cv-text editing"
                style={{ left: s.x, top: s.y }}
                defaultValue={s.text}
                autoFocus
                rows={1}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${el.scrollHeight}px`;
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={(e) => commitText(s.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') e.currentTarget.blur();
                }}
              />
            ) : (
              <div
                key={s.id}
                className={selectedId === s.id ? 'cv-text sel' : 'cv-text'}
                style={{ left: s.x, top: s.y, cursor: tool === 'select' ? 'move' : 'default' }}
                onPointerDown={(e) => onShapePointerDown(e, s)}
                onPointerMove={onShapePointerMove}
                onPointerUp={onShapePointerUp}
                onDoubleClick={() => setEditingId(s.id)}
              >
                {s.text}
              </div>
            ),
          )}

          {isShared && peers.map((peer) => (
            <PeerCursor key={peer.id} peer={peer} />
          ))}

          {isShared && notes.map((note) => {
            const pos = positions.get(note.noteId);
            if (!pos) return null;
            const byAgent = note.author.startsWith('agent');
            const classes = [
              'pgcv-note',
              byAgent ? 'byagent2' : '',
              draggingId === note.noteId ? 'drag2' : '',
              materializedNoteId === note.noteId ? 'pop2' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={note.noteId}
                className={classes}
                style={{ left: pos.x, top: pos.y }}
                role="button"
                tabIndex={0}
                aria-label={`Open ${note.title || 'Untitled note'}`}
                onPointerDown={(event) => onCardPointerDown(event, note.noteId)}
                onPointerMove={onCardPointerMove}
                onPointerUp={onCardPointerUp}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/app/notes/${note.noteId}`);
                  }
                }}
              >
                <div className="nt3">{note.title || 'Untitled note'}</div>
                <div className="nb3">{excerptOf(note, titles)}</div>
                {byAgent ? (
                  <div className="na3">
                    <i>✧ {name.toLowerCase()} · {shortAge(note.updatedAt)}</i>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {isShared ? (
          <div className="pgcv-avs" aria-label={`Mira, ${name} and you are on this board`}>
            <span className="av m">M</span>
            <span className="av n" aria-hidden="true">✧</span>
            <span className="av y">Y</span>
          </div>
        ) : null}

        <div className="pgcv-tools" aria-label="Canvas tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tool === t.id ? 'on' : undefined}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
          <span className="tsep" />
          <button type="button" aria-label="New note card" onClick={newNote}>
            <ToolIcon>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </ToolIcon>
          </button>
          {isShared ? (
            <button type="button" className="recall" onClick={() => scheduleAgentNote()}>
              <span aria-hidden="true">✧</span> Recall
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
