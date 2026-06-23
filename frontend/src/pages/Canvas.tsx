import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { createNote, runDestructiveTx, useVault } from '@/hooks/useVault';
import type { Note } from '@/hooks/useVault';
import { SHARED_CANVAS_ID, updateCanvas, useCanvases } from '@/hooks/useCanvases';
import { CoverPicker } from '@/components/CoverPicker';
import { CanvasHome } from './CanvasHome';
import { ShareDialog } from './ShareDialog';
import { moveCursor, startPresence, stopPresence, usePresence } from '@/hooks/usePresence';
import type { Peer } from '@/hooks/usePresence';
import { scheduleAgentNote } from '@/hooks/useAgentTimeline';
import { useVaultSession } from '@/hooks/useVaultSession';
import {
  loadCanvasContent,
  saveCanvasContent,
  canvasContentTag,
  type CanvasElement,
  type LinearElement,
  type ElementStyle,
  newElementId,
  newVersionNonce,
  isLinear,
  isBindable,
  normalizeLinear,
  commonBounds,
  uploadCover,
  preflight,
  NOTE_W,
  NOTE_H,
} from '../../../chain/core/src/index.js';
import { getQuiltDeps } from '@/web3/session';
import { resolveCover } from '@/web3/covers';
import { vaultData } from '@/web3/vaultData';
import { hitTopElement, marqueeSelect } from '@/canvas/hittest';
import { addElement, moveElements, deleteElements, duplicateElements, reorder } from '@/canvas/ops';
import { resizeElement, rotateElement, resizeMultiple, type ResizeHandle } from '@/canvas/transform';
import { moveEndpoint, endpointWorld, bindEndpoint, breakBinding, type BindableLinear } from '@/canvas/linear';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { FundsBanner } from '@/components/FundsBanner';
import { CanvasStylePanel } from '@/components/CanvasStylePanel';
import { triggerLowBalance, dismissLowBalance } from '@/hooks/useChat';
import './canvas.css';

const DRAG_THRESHOLD_PX = 4;
const INK = '#16181D';
const SEL = '#2F6BFF';
/** Tools that draw a new element (vs select/pan). */
const DRAW_TOOLS = new Set(['draw', 'arrow', 'shape', 'text']);

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

/** Absolute polyline points (world coords) for a linear element. */
function linearPointsAttr(el: LinearElement): string {
  let out = '';
  for (let i = 0; i < el.points.length; i += 2) out += `${el.x + el.points[i]},${el.y + el.points[i + 1]} `;
  return out.trim();
}

function makeBase(): Pick<CanvasElement, 'id' | 'angle' | 'index' | 'version' | 'versionNonce'> {
  return { id: newElementId(), angle: 0, index: 0, version: 1, versionNonce: newVersionNonce() };
}

/** Image elements with a local data: ref are NOT yet persistable (U13 uploads them). */
function elementsForSave(elements: CanvasElement[]): CanvasElement[] {
  return elements.filter((el) => !(el.type === 'image' && el.ref.startsWith('data:')));
}

/**
 * Measure a text element's rendered box so its hit area and selection box land on
 * the glyphs — a text element stored with w/h = 0 (legacy/migrated, or freshly
 * typed) is otherwise nearly unclickable. Mirrors the `.cv-text` CSS (Inter 15/1.4,
 * wrapping at 340px) via one reused offscreen node. Browser-only: returns a small
 * fallback box where there is no layout engine (jsdom/tests).
 */
let textMeasureEl: HTMLDivElement | null = null;
function measureTextSize(text: string): { w: number; h: number } {
  if (typeof document === 'undefined') return { w: 8, h: 21 };
  if (!textMeasureEl) {
    textMeasureEl = document.createElement('div');
    textMeasureEl.setAttribute('aria-hidden', 'true');
    textMeasureEl.style.cssText =
      'position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;' +
      'display:inline-block;max-width:340px;white-space:pre-wrap;word-break:break-word;' +
      "font-family:'Inter',sans-serif;font-size:15px;line-height:1.4;padding:0;margin:0;";
    document.body.appendChild(textMeasureEl);
  }
  // A trailing newline needs a width-holding char so the empty last line is counted.
  textMeasureEl.textContent = text.length ? (text.endsWith('\n') ? `${text} ` : text) : ' ';
  const w = Math.max(8, Math.ceil(textMeasureEl.offsetWidth) + 1);
  const h = Math.max(21, Math.ceil(textMeasureEl.offsetHeight));
  return { w, h };
}

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

/** Resize-handle placement as a fraction of the selection bbox + its cursor. */
const HANDLE_DEFS: Array<{ id: ResizeHandle; fx: number; fy: number; cursor: string }> = [
  { id: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { id: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { id: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { id: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { id: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { id: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { id: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { id: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
];

/** Whether an element kind has user-editable endpoints/midpoints (arrows + lines). */
function isBindableLinear(el: CanvasElement): el is BindableLinear {
  return el.type === 'arrow' || el.type === 'line';
}

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

/**
 * An image element. A `data:` ref (just dropped, upload in flight) renders
 * directly; a durable `blob:`/`seal:` ref resolves to an object URL (revoked on
 * change), mirroring CanvasHome's cover resolver.
 */
function CanvasImage({ el, canvasId, selected }: { el: Extract<CanvasElement, { type: 'image' }>; canvasId: string; selected: boolean }) {
  const [url, setUrl] = useState<string | null>(el.ref.startsWith('data:') ? el.ref : null);
  useEffect(() => {
    if (el.ref.startsWith('data:')) {
      setUrl(el.ref);
      return;
    }
    let cancelled = false;
    let obj: string | null = null;
    void resolveCover(el.ref, canvasId)
      .then((u) => {
        if (cancelled) return;
        setUrl(u);
        if (u && u.startsWith('blob:')) obj = u;
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [el.ref, canvasId]);
  return (
    <img
      className={selected ? 'cv-image sel' : 'cv-image'}
      src={url ?? ''}
      alt=""
      draggable={false}
      style={{ left: el.x, top: el.y, width: el.w, height: el.h, pointerEvents: 'none' }}
    />
  );
}

interface PanState {
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
}

/** A drag of the current selection: the pre-drag snapshot + the start world point. */
interface MoveState {
  ids: string[];
  origin: CanvasElement[];
  startX: number;
  startY: number;
  moved: boolean;
  /** The element actually grabbed (for click-to-open detection on a note). */
  hitId: string;
}

/**
 * The canvas board (plan 2026-06-22): one unified Excalidraw-style element model.
 * Notes, vector shapes, text and images are all `CanvasElement`s in a single list
 * — selected, dragged and deleted the same way; a note element opens its note on
 * a plain click. The scene seals to Walrus on settle (owner-signed, no save
 * button). Live presence (human + agent cursors, the avatars row, Recall) is
 * preserved on the shared board; only the old auto-vault projection + link edges
 * were removed (every board is place-only now).
 *
 * Live element sync over the relay is NOT wired yet (U16) — this is the
 * single-user surface; presence still broadcasts cursors.
 */
export function Canvas() {
  const session = useVaultSession();
  const navigate = useNavigate();
  const { canvasId } = useParams();
  const canvases = useCanvases();
  const isShared = canvasId === SHARED_CANVAS_ID;
  const boardDoc = canvases.find((c) => c.canvasId === canvasId);
  const boardTitle = boardDoc?.title ?? 'Untitled canvas';
  const boardCover = boardDoc?.image ?? '';
  const [coverOpen, setCoverOpen] = useState(false);
  const setCover = (src: string) => {
    if (!canvasId) return;
    updateCanvas(canvasId, { image: src });
    setCoverOpen(false);
  };
  const { notes } = useVault();
  const { peers, connection } = usePresence();
  const [tool, setTool] = useState('select');

  const viewportRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLElement>(null);
  // An edited-but-not-yet-saved board title (persisted by Save, like the scene).
  const pendingTitleRef = useRef<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef<PanState | null>(null);
  const [panning, setPanning] = useState(false);
  const [sharing, setSharing] = useState(false);

  // The unified element list, the in-progress draw, the selection, and the text
  // element being edited in place.
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [draft, setDraft] = useState<CanvasElement | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Interaction refs (mutable, not render state).
  const draftRef = useRef<CanvasElement | null>(null);
  const startRef = useRef({ x: 0, y: 0 });
  const moveRef = useRef<MoveState | null>(null);
  const marqueeRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const lastSeededCanvasRef = useRef<string | null>(null);
  // A resize/rotate drag of the current selection (U7).
  const transformRef = useRef<{ kind: 'resize' | 'rotate'; handle?: ResizeHandle; startX: number; startY: number; origin: CanvasElement[]; moved: boolean } | null>(null);
  // A linear-element endpoint/midpoint drag (U8).
  const linearRef = useRef<{ id: string; which: 'start' | 'end'; origin: BindableLinear; moved: boolean } | null>(null);
  const textPendingRef = useRef<{ x: number; y: number } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const elementsRef = useRef<CanvasElement[]>([]);
  const historyRef = useRef<CanvasElement[][]>([]);

  // Seed-guard (mirrors the prior drawings guard): the seed never counts as an
  // edit, so opening a board fires zero seals. The persist effect arms only once
  // it sees the seeded array reflected in `elements`.
  const seededRef = useRef<CanvasElement[] | null>(null);
  const seedArmedRef = useRef(false);

  // Manual save (consistent with notes): `dirty` drives the Save/Saved button, the
  // navigation guard and the beforeunload warning.
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker(dirty);

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  // Presence (cursors + avatars + Recall) belongs to the shared board, once ready.
  const readyVaultId = session.phase === 'ready' ? session.vault.vaultId : null;
  useEffect(() => {
    if (!isShared || !readyVaultId || !canvasId) return;
    startPresence(readyVaultId, canvasId);
    return () => stopPresence();
  }, [isShared, readyVaultId, canvasId]);

  // Seed this board's elements from its durable content note. Disarms the seal
  // guard until the seed lands in `elements`. Re-seeds when the rebuilt index
  // publishes (hard reload straight into a board mounts before the rebuild).
  const liveIndex = vaultData.getSnapshot().index;
  useEffect(() => {
    if (!canvasId) return;
    // (Re)seed ONLY on a board switch, or while the board is still empty. `liveIndex`
    // swaps reference on a full rebuild publish (initial load, an agent write, a
    // background sync) — NOT on routine local upserts. Reseeding on every such swap
    // would clobber unsaved local placements mid-edit ("the note jumped back"). The
    // empty-board case still re-seeds so a hard reload (mount before the rebuild
    // publishes → empty seed) fills in once the rebuilt index lands. Live merge of a
    // concurrent remote edit is U16 (relay) territory, deliberately not done here.
    const canvasChanged = lastSeededCanvasRef.current !== canvasId;
    if (!canvasChanged && elementsRef.current.length > 0) return;
    lastSeededCanvasRef.current = canvasId;
    const content = liveIndex ? loadCanvasContent(liveIndex, canvasId) : { elements: [] as CanvasElement[] };
    // Measure each text element up front so its hit box + selection box match the
    // glyphs (migrated/legacy text carries w/h = 0). Done BEFORE seededRef is set so
    // the SAME array seeds both the ref and state — the dirty guard is reference
    // equality, so opening a board must not look like an edit.
    const seeded = (content.elements ?? []).map((el) => (el.type === 'text' ? { ...el, ...measureTextSize(el.text) } : el));
    seededRef.current = seeded;
    seedArmedRef.current = false;
    historyRef.current = [];
    setElements(seeded);
    setDraft(null);
    setSelectedIds([]);
    setEditingId(null);
    setMarquee(null);
    setDirty(false);
    pendingTitleRef.current = null;
    draftRef.current = null;
    moveRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId, liveIndex]);

  // Warn on tab close while there are unsaved edits (mirrors the note editor).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Mark the board dirty on a real edit (post-arm). The seed itself arms but never
  // dirties, so opening a board never shows unsaved changes.
  useEffect(() => {
    if (!canvasId) return;
    if (elements === seededRef.current) {
      seedArmedRef.current = true;
      return;
    }
    if (!seedArmedRef.current) return;
    setDirty(true);
  }, [elements, canvasId]);

  // Proactively surface the low-funds banner: check the agent's balance in the
  // background on board open, so the warning shows without waiting for a Save click.
  useEffect(() => {
    if (session.phase !== 'ready') return;
    let cancelled = false;
    void (async () => {
      const deps = getQuiltDeps();
      if (!deps) return;
      try {
        const pf = await preflight(deps.suiClient, deps.agentSigner.toSuiAddress());
        if (cancelled) return;
        if (!pf.ok) triggerLowBalance();
        else dismissLowBalance();
      } catch {
        /* RPC blip — leave the banner as-is */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canvasId, session.phase]);

  // Wheel/trackpad pans the plane (native non-passive so the horizontal axis
  // can't trigger browser back/forward overscroll).
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

  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of notes) map.set(note.noteId, note.title || 'Untitled note');
    return map;
  }, [notes]);
  const notesById = useMemo(() => new Map(notes.map((n) => [n.noteId, n])), [notes]);

  /** Push the current elements onto the undo stack (call before a mutating op). */
  const pushHistory = () => {
    historyRef.current.push(elementsRef.current);
    if (historyRef.current.length > 50) historyRef.current.shift();
  };

  // Keyboard: delete / undo / duplicate / nudge / z-order. Ignored while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      const meta = event.metaKey || event.ctrlKey;
      const sel = selectedIds;
      if ((event.key === 'Delete' || event.key === 'Backspace') && sel.length) {
        event.preventDefault();
        pushHistory();
        setElements((prev) => deleteElements(prev, sel));
        setSelectedIds([]);
      } else if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        const prev = historyRef.current.pop();
        if (prev) {
          setElements(prev);
          setSelectedIds([]);
        }
      } else if (meta && event.key.toLowerCase() === 'd' && sel.length) {
        event.preventDefault();
        pushHistory();
        const { elements: next, newIds } = duplicateElements(elementsRef.current, sel);
        setElements(next);
        setSelectedIds(newIds);
      } else if (sel.length && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        const step = event.shiftKey ? 5 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        setElements((prev) => moveElements(prev, sel, dx, dy));
      } else if (meta && event.key === ']' && sel.length) {
        event.preventDefault();
        pushHistory();
        setElements((prev) => reorder(prev, sel, event.shiftKey ? 'front' : 'forward'));
      } else if (meta && event.key === '[' && sel.length) {
        event.preventDefault();
        pushHistory();
        setElements((prev) => reorder(prev, sel, event.shiftKey ? 'back' : 'backward'));
      } else if (event.key === 'Enter' && sel.length === 1) {
        // Enter edits a single selected text or shape in place (the focused-editor
        // guard above means this never fires while already typing).
        const el = elementsRef.current.find((e) => e.id === sel[0]);
        if (el && (el.type === 'text' || el.type === 'rect' || el.type === 'ellipse')) {
          event.preventDefault();
          setEditingId(el.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds]);

  if (session.phase !== 'ready') return null;
  if (!canvasId) return <CanvasHome />;
  const name = session.agent.name;
  const selectedSet = new Set(selectedIds);

  /** Client point -> world coordinate (undo the viewport offset and the pan). */
  const toWorld = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0) - pan.x, y: clientY - (rect?.top ?? 0) - pan.y };
  };

  /** Place a note element at a world point (drag-from-sidebar / +note). */
  const placeNoteElement = (noteId: string, wx: number, wy: number) => {
    pushHistory();
    const el: CanvasElement = { ...makeBase(), type: 'note', noteId, x: wx - NOTE_W / 2, y: wy - NOTE_H / 2, w: NOTE_W, h: NOTE_H };
    setElements((prev) => addElement(prev, el));
    setSelectedIds([el.id]);
  };

  const newNoteAndPlace = () => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const wx = (rect ? rect.width / 2 : 320) - pan.x;
    const wy = (rect ? rect.height / 2 : 220) - pan.y;
    placeNoteElement(createNote(), wx, wy);
  };

  // Manual seal of the scene to Walrus (owner-signed), mirroring the note Save.
  const save = () => {
    // Optimistic: flip the button to Saved at once and validate in the background;
    // only re-dirty if the seal actually fails (so the button never blocks).
    setDirty(false);
    void (async () => {
      const deps = getQuiltDeps();
      const index = vaultData.getSnapshot().index;
      if (!deps || !index) return;
      // Fast funding check: surface the banner and skip a doomed seal rather than
      // attempting a write that will fail. Re-dirty so a retry after top-up re-seals.
      try {
        const pf = await preflight(deps.suiClient, deps.agentSigner.toSuiAddress());
        if (!pf.ok) {
          setDirty(true);
          triggerLowBalance();
          return;
        }
        dismissLowBalance();
      } catch {
        /* RPC blip — fall through and let the write surface the real outcome */
      }
      // Persist a pending title edit (registry) as part of the manual save.
      if (pendingTitleRef.current && pendingTitleRef.current !== boardTitle) {
        updateCanvas(canvasId, { title: pendingTitleRef.current });
        pendingTitleRef.current = null;
      }
      // Silent write-event so the bulk-forget quiesce awaits an in-flight canvas
      // seal, the same as note/layout saves.
      const eventId = vaultData.beginWriteEvent({ noteId: canvasContentTag(canvasId), noteTitle: 'Canvas', state: { phase: 'certifying' }, silent: true });
      try {
        const res = await saveCanvasContent(deps, index, canvasId, { elements: elementsForSave(elementsRef.current) });
        vaultData.updateWriteEvent(eventId, { phase: 'certified', blobObjectId: '', provenanceUrl: '' });
        if (res.migrationTx) void runDestructiveTx(res.migrationTx).catch(() => {});
        dismissLowBalance();
      } catch {
        vaultData.updateWriteEvent(eventId, { phase: 'failed' });
        setDirty(true);
        triggerLowBalance();
      }
    })();
  };

  // Resize/rotate a selection (U7). The viewport captures the pointer so the
  // subsequent move/up route through the board handlers (which read transformRef).
  const onHandleDown = (event: ReactPointerEvent<HTMLDivElement>, kind: 'resize' | 'rotate', handle?: ResizeHandle) => {
    event.stopPropagation();
    const wp = toWorld(event.clientX, event.clientY);
    viewportRef.current?.setPointerCapture(event.pointerId);
    transformRef.current = { kind, handle, startX: wp.x, startY: wp.y, origin: elementsRef.current.filter((e) => selectedSet.has(e.id)), moved: false };
  };

  // Drag an arrow/line endpoint (U8); binds to a bindable element under the tip.
  const onEndpointDown = (event: ReactPointerEvent<HTMLDivElement>, el: BindableLinear, which: 'start' | 'end') => {
    event.stopPropagation();
    viewportRef.current?.setPointerCapture(event.pointerId);
    linearRef.current = { id: el.id, which, origin: el, moved: false };
  };

  // ── Board pointer dispatch (the viewport captures everything; rendered
  // elements are pointer-events:none, so hit-testing is done in world space). ──
  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.pgcv-tools, .pgcv-avs, .cv-stylepanel')) return;
    const wp = toWorld(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'text') {
      textPendingRef.current = wp;
      return;
    }
    if (DRAW_TOOLS.has(tool)) {
      startRef.current = wp;
      const b = makeBase();
      const d: CanvasElement =
        tool === 'draw'
          ? { ...b, type: 'draw', x: wp.x, y: wp.y, w: 0, h: 0, points: [0, 0] }
          : tool === 'arrow'
            ? { ...b, type: 'arrow', x: wp.x, y: wp.y, w: 0, h: 0, points: [0, 0, 0, 0] }
            : { ...b, type: 'rect', x: wp.x, y: wp.y, w: 0, h: 0 };
      draftRef.current = d;
      setDraft(d);
      return;
    }
    if (tool === 'hand') {
      panRef.current = { startClientX: event.clientX, startClientY: event.clientY, originX: pan.x, originY: pan.y };
      setPanning(true);
      return;
    }
    // select tool: hit-test the top element; else marquee.
    const hit = hitTopElement(wp, elements);
    if (hit) {
      const ids = selectedSet.has(hit.id)
        ? selectedIds
        : event.shiftKey
          ? [...selectedIds, hit.id]
          : [hit.id];
      setSelectedIds(ids);
      pushHistory();
      moveRef.current = { ids, origin: elementsRef.current, startX: wp.x, startY: wp.y, moved: false, hitId: hit.id };
    } else {
      if (!event.shiftKey) setSelectedIds([]);
      marqueeRef.current = { x: wp.x, y: wp.y };
      marqueeRectRef.current = { x: wp.x, y: wp.y, w: 0, h: 0 };
      setMarquee({ x: wp.x, y: wp.y, w: 0, h: 0 });
    }
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isShared) {
      const wp = toWorld(event.clientX, event.clientY);
      moveCursor(wp.x, wp.y);
    }
    const tr = transformRef.current;
    if (tr) {
      if (!tr.moved) {
        tr.moved = true;
        pushHistory();
      }
      const wp = toWorld(event.clientX, event.clientY);
      const dx = wp.x - tr.startX;
      const dy = wp.y - tr.startY;
      if (tr.kind === 'rotate') {
        const el = tr.origin[0];
        if (el) {
          const cx = el.x + el.w / 2;
          const cy = el.y + el.h / 2;
          const angle = Math.atan2(wp.y - cy, wp.x - cx) + Math.PI / 2;
          const rotated = rotateElement(el, angle, event.shiftKey);
          setElements((prev) => prev.map((e) => (e.id === rotated.id ? rotated : e)));
        }
      } else if (tr.handle) {
        const next = tr.origin.length === 1
          ? [resizeElement(tr.origin[0], tr.handle, dx, dy, event.shiftKey)]
          : resizeMultiple(tr.origin, tr.handle, dx, dy, event.shiftKey);
        const byId = new Map(next.map((e) => [e.id, e]));
        setElements((prev) => prev.map((e) => byId.get(e.id) ?? e));
      }
      return;
    }
    const ln = linearRef.current;
    if (ln) {
      if (!ln.moved) {
        ln.moved = true;
        pushHistory();
      }
      const wp = toWorld(event.clientX, event.clientY);
      const target = hitTopElement(wp, elementsRef.current.filter((e) => e.id !== ln.id && isBindable(e)));
      let moved = moveEndpoint(ln.origin, ln.which, wp);
      moved = target ? bindEndpoint(moved, ln.which, target) : breakBinding(moved, ln.which);
      setElements((prev) => prev.map((e) => (e.id === moved.id ? moved : e)));
      return;
    }
    const d = draftRef.current;
    if (d) {
      const wp = toWorld(event.clientX, event.clientY);
      let next: CanvasElement;
      if (d.type === 'draw') next = { ...d, points: [...d.points, wp.x - d.x, wp.y - d.y] };
      else if (d.type === 'arrow') next = { ...d, points: [0, 0, wp.x - d.x, wp.y - d.y] };
      else
        next = {
          ...d,
          x: Math.min(startRef.current.x, wp.x),
          y: Math.min(startRef.current.y, wp.y),
          w: Math.abs(wp.x - startRef.current.x),
          h: Math.abs(wp.y - startRef.current.y),
        };
      draftRef.current = next;
      setDraft(next);
      return;
    }
    const mv = moveRef.current;
    if (mv) {
      const dx = toWorld(event.clientX, event.clientY).x - mv.startX;
      const dy = toWorld(event.clientX, event.clientY).y - mv.startY;
      if (!mv.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      mv.moved = true;
      setElements(moveElements(mv.origin, mv.ids, dx, dy));
      return;
    }
    const mq = marqueeRef.current;
    if (mq) {
      const wp = toWorld(event.clientX, event.clientY);
      const rect = { x: mq.x, y: mq.y, w: wp.x - mq.x, h: wp.y - mq.y };
      marqueeRectRef.current = rect;
      setMarquee(rect);
      return;
    }
    const p = panRef.current;
    if (p) setPan({ x: p.originX + (event.clientX - p.startClientX), y: p.originY + (event.clientY - p.startClientY) });
  };

  const onCanvasPointerUp = () => {
    if (transformRef.current) {
      transformRef.current = null;
      return;
    }
    if (linearRef.current) {
      linearRef.current = null;
      return;
    }
    if (textPendingRef.current) {
      const { x, y } = textPendingRef.current;
      textPendingRef.current = null;
      pushHistory();
      const el: CanvasElement = { ...makeBase(), type: 'text', x, y, w: 0, h: 0, text: '' };
      setElements((prev) => addElement(prev, el));
      setEditingId(el.id);
      setTool('select');
      return;
    }
    const d = draftRef.current;
    if (d) {
      draftRef.current = null;
      setDraft(null);
      const keep =
        (d.type === 'draw' && d.points.length >= 4) ||
        (d.type === 'rect' && d.w > 3 && d.h > 3) ||
        (d.type === 'arrow' && Math.hypot(d.points[2] - d.points[0], d.points[3] - d.points[1]) > 6);
      if (keep) {
        pushHistory();
        const committed = isLinear(d) ? normalizeLinear(d as LinearElement) : d;
        setElements((prev) => addElement(prev, committed));
      }
      setTool('select');
      return;
    }
    const mv = moveRef.current;
    if (mv) {
      moveRef.current = null;
      if (!mv.moved) {
        // a plain click (no drag): a note opens; anything else just stays selected.
        const hit = elementsRef.current.find((e) => e.id === mv.hitId);
        if (hit && hit.type === 'note') navigate(`/app/notes/${hit.noteId}`);
        else historyRef.current.pop(); // no move happened → discard the pushed snapshot
      }
      return;
    }
    if (marqueeRef.current) {
      const rect = marqueeRectRef.current;
      marqueeRef.current = null;
      marqueeRectRef.current = null;
      setMarquee(null);
      if (rect) setSelectedIds(marqueeSelect(rect, elements).map((e) => e.id));
      return;
    }
    if (panRef.current) {
      panRef.current = null;
      setPanning(false);
    }
  };

  const onCanvasDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const wp = toWorld(event.clientX, event.clientY);
    const hit = hitTopElement(wp, elements);
    if (hit && (hit.type === 'text' || hit.type === 'rect' || hit.type === 'ellipse')) setEditingId(hit.id);
  };

  // Commit an in-place edit. A text element re-measures to fit (so its box + hit
  // area track the glyphs); emptying a standalone text removes it. A shape's label
  // is just a field — emptying it clears the label but keeps the shape.
  const commitEdit = (id: string, value: string) => {
    setEditingId(null);
    const el = elementsRef.current.find((e) => e.id === id);
    if (!el) return;
    const text = value.trim();
    if (el.type === 'text') {
      pushHistory();
      if (!text) {
        setElements((prev) => prev.filter((s) => s.id !== id));
        setSelectedIds((prev) => prev.filter((s) => s !== id));
        return;
      }
      const size = measureTextSize(text);
      setElements((prev) => prev.map((s) => (s.id === id && s.type === 'text' ? { ...s, text, ...size } : s)));
      return;
    }
    if (el.type === 'rect' || el.type === 'ellipse') {
      if ((el.label ?? '') === text) return; // no change → no history entry
      pushHistory();
      setElements((prev) =>
        prev.map((s) => (s.id === id && (s.type === 'rect' || s.type === 'ellipse') ? { ...s, label: text || undefined } : s)),
      );
    }
  };

  // Drag a note from the sidebar onto the board.
  const onBoardDragOver = (event: React.DragEvent) => {
    if (event.dataTransfer.types.includes('text/noteid')) event.preventDefault();
  };
  const onBoardDrop = (event: React.DragEvent) => {
    const noteId = event.dataTransfer.getData('text/noteid');
    if (!noteId) return;
    event.preventDefault();
    const wp = toWorld(event.clientX, event.clientY);
    placeNoteElement(noteId, wp.x, wp.y);
  };

  // Add an image: lands as a local element (data: ref); U13 uploads it to a blob.
  const onAddImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const probe = new Image();
      probe.onload = () => {
        const w = 220;
        const h = probe.naturalWidth ? Math.round(w * (probe.naturalHeight / probe.naturalWidth)) : 150;
        const rect = viewportRef.current?.getBoundingClientRect();
        const x = (rect ? rect.width / 2 : 320) - pan.x - w / 2;
        const y = (rect ? rect.height / 2 : 220) - pan.y - h / 2;
        pushHistory();
        const el: CanvasElement = { ...makeBase(), type: 'image', x, y, w, h, ref: src };
        const elId = el.id;
        setElements((prev) => addElement(prev, el));
        setSelectedIds([el.id]);
        setTool('select');
        // Upload the bytes to a durable (sealed) blob and swap the data: ref for the
        // returned ref, so the image persists in the sealed scene (U13). On failure
        // the local data: image stays visible but won't persist.
        void (async () => {
          const deps = getQuiltDeps();
          if (!deps) return;
          try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const { ref } = await uploadCover(deps, bytes, { noteId: canvasId, public: false });
            setElements((prev) => prev.map((e) => (e.id === elId && e.type === 'image' ? { ...e, ref } : e)));
          } catch {
            /* keep the local image; it just won't persist */
          }
        })();
      };
      probe.src = src;
    };
    reader.readAsDataURL(file);
  };

  const cursor = panning ? 'grabbing' : tool === 'hand' ? 'grab' : DRAW_TOOLS.has(tool) ? 'crosshair' : 'default';

  // Split the model into the two render layers, each in z-order.
  const ordered = [...elements].sort((a, b) => a.index - b.index);
  const vectorEls = ordered.filter((e) => e.type === 'rect' || e.type === 'ellipse' || e.type === 'arrow' || e.type === 'line' || e.type === 'draw');
  const htmlEls = ordered.filter((e) => e.type === 'note' || e.type === 'text' || e.type === 'image');
  const selectedEls = ordered.filter((e) => selectedSet.has(e.id));
  const selBox = selectedEls.length > 0 ? commonBounds(selectedEls) : null;
  const singleLinear = selectedEls.length === 1 && isBindableLinear(selectedEls[0]) ? selectedEls[0] : null;
  // Resize/rotate handles only when the selection has a sizeable element. A
  // text-only selection is content-sized (the box ignores w/h), so handles would
  // drift off the glyphs — text gets just the selection outline, move and edit.
  const showTransform = selBox !== null && selectedEls.some((e) => e.type !== 'text');
  // The single styleable element (rect/ellipse/text) the style panel edits. Gated to
  // one selection so the panel shows that element's exact values (no mixed-value blanks).
  const styleTarget =
    selectedEls.length === 1 && (selectedEls[0].type === 'rect' || selectedEls[0].type === 'ellipse' || selectedEls[0].type === 'text')
      ? selectedEls[0]
      : null;

  const renderVector = (s: CanvasElement, isDraft: boolean) => {
    const rot = s.angle ? `rotate(${(s.angle * 180) / Math.PI} ${s.x + s.w / 2} ${s.y + s.h / 2})` : undefined;
    if (s.type === 'draw' || s.type === 'arrow' || s.type === 'line') {
      const sel = !isDraft && selectedSet.has(s.id);
      const pts = linearPointsAttr(s as LinearElement);
      return (
        <polyline
          key={s.id}
          points={pts}
          transform={rot}
          fill="none"
          stroke={sel ? SEL : INK}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          markerEnd={s.type === 'arrow' ? 'url(#cv-arrowhead)' : undefined}
        />
      );
    }
    // rect / ellipse honour the element's style (defaults: ink stroke, no fill, 2px
    // solid). Selection is shown by the separate dashed outline, NOT by recolouring,
    // so a styled shape keeps its colour while selected. A draft renders plain.
    const stroke = isDraft ? INK : s.strokeColor ?? INK;
    const fill = !isDraft && s.backgroundColor && s.backgroundColor !== 'transparent' ? s.backgroundColor : 'none';
    const sw = isDraft ? 2 : s.strokeWidth ?? 2;
    const dash = !isDraft && s.strokeStyle === 'dashed' ? '8 6' : !isDraft && s.strokeStyle === 'dotted' ? '2 5' : undefined;
    if (s.type === 'ellipse') {
      return <ellipse key={s.id} cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} transform={rot} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />;
    }
    return <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} rx="3" transform={rot} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />;
  };

  return (
    <div className="pged">
      <div className="pged-top">
        <span className="pgcrumb pgcrumb-canvas">
          <span className="pgcrumb-pre">Canvas /</span>
          <b
            ref={titleRef}
            className="pgcrumb-title"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            role="textbox"
            aria-label="Canvas title"
            title="Rename this board"
            onBlur={(event) => {
              const value = event.currentTarget.textContent?.trim() ?? '';
              if (!value) {
                event.currentTarget.textContent = boardTitle; // restore if emptied
                return;
              }
              if (value !== boardTitle) {
                // Mark dirty + stage the title; persisted on Save (manual, like the scene).
                pendingTitleRef.current = value;
                setDirty(true);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                event.currentTarget.textContent = boardTitle;
                event.currentTarget.blur();
              }
            }}
          >
            {boardTitle}
          </b>
          <button
            type="button"
            className="pgcrumb-edit"
            aria-label="Rename board"
            title="Rename this board"
            onClick={() => {
              const el = titleRef.current;
              if (!el) return;
              el.focus();
              const range = document.createRange();
              range.selectNodeContents(el);
              range.collapse(false);
              const selr = window.getSelection();
              selr?.removeAllRanges();
              selr?.addRange(range);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        </span>
        <span className="sp" />
        {isShared && connection !== 'live' ? (
          <span
            role="status"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '9.5px',
              fontWeight: 700,
              color: connection === 'full' ? '#B4231F' : 'rgba(22,24,29,.55)',
            }}
          >
            {connection === 'full' ? 'This board is full — try again later.' : 'Connection lost — presence is offline.'}
          </span>
        ) : null}
        <span className="pgcv-cover-wrap">
          <button type="button" className="pgbtn" onClick={() => setCoverOpen((o) => !o)}>
            {boardCover ? 'Change cover' : 'Add cover'}
          </button>
          {coverOpen ? <CoverPicker onPick={setCover} /> : null}
        </span>
        <button type="button" className="pgbtn" onClick={() => setSharing(true)}>
          Share
        </button>
        {dirty ? (
          <button type="button" className="pgbtn primary" onClick={save}>
            Save
          </button>
        ) : (
          <button type="button" className="pgbtn" disabled aria-label="All changes saved">
            Saved
          </button>
        )}
      </div>
      <FundsBanner />
      <ShareDialog open={sharing} onClose={() => setSharing(false)} noteId={canvasId} title={boardTitle} kind="canvas" />
      <div
        className="pgcv"
        ref={viewportRef}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerUp}
        onDoubleClick={onCanvasDoubleClick}
        onDragOver={onBoardDragOver}
        onDrop={onBoardDrop}
        style={{ backgroundPosition: `${pan.x}px ${pan.y}px`, touchAction: 'none', cursor }}
      >
        <div className="pgcv-world" style={{ position: 'absolute', inset: 0, transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          {/* Vector layer (z-order within the layer). Pointer-events off: the
              viewport hit-tests in world space. */}
          <svg className="pgcv-ink" style={{ pointerEvents: 'none' }}>
            <defs>
              <marker id="cv-arrowhead" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill={INK} />
              </marker>
            </defs>
            {vectorEls.map((s) => renderVector(s, false))}
            {draft ? renderVector(draft, true) : null}
            {/* selection outlines */}
            {ordered
              .filter((e) => selectedSet.has(e.id))
              .map((e) => (
                <rect
                  key={`sel-${e.id}`}
                  x={e.x - 4}
                  y={e.y - 4}
                  width={e.w + 8}
                  height={e.h + 8}
                  transform={e.angle ? `rotate(${(e.angle * 180) / Math.PI} ${e.x + e.w / 2} ${e.y + e.h / 2})` : undefined}
                  fill="none"
                  stroke={SEL}
                  strokeWidth="1"
                  strokeDasharray="4 3"
                />
              ))}
            {marquee ? (
              <rect
                x={Math.min(marquee.x, marquee.x + marquee.w)}
                y={Math.min(marquee.y, marquee.y + marquee.h)}
                width={Math.abs(marquee.w)}
                height={Math.abs(marquee.h)}
                fill="rgba(47,107,255,.07)"
                stroke={SEL}
                strokeWidth="1"
              />
            ) : null}
          </svg>

          {/* HTML layer (notes / text / images), z-order within the layer. */}
          {htmlEls.map((el) => {
            if (el.type === 'note') {
              const note = notesById.get(el.noteId);
              const byAgent = note?.author.startsWith('agent');
              return (
                <div
                  key={el.id}
                  className={['pgcv-note', byAgent ? 'byagent2' : '', selectedSet.has(el.id) ? 'sel' : ''].filter(Boolean).join(' ')}
                  style={{ left: el.x, top: el.y, pointerEvents: 'none' }}
                >
                  <div className="nt3">{note?.title || 'Untitled note'}</div>
                  <div className="nb3">{note ? excerptOf(note, titles) : ''}</div>
                  {byAgent ? (
                    <div className="na3">
                      <i>✧ {name.toLowerCase()} · {note ? shortAge(note.updatedAt) : ''}</i>
                    </div>
                  ) : null}
                </div>
              );
            }
            if (el.type === 'image') {
              return <CanvasImage key={el.id} el={el} canvasId={canvasId} selected={selectedSet.has(el.id)} />;
            }
            // text
            if (editingId === el.id) {
              return (
                <textarea
                  key={el.id}
                  className="cv-text editing"
                  style={{ left: el.x, top: el.y }}
                  defaultValue={el.text}
                  autoFocus
                  rows={1}
                  onInput={(e) => {
                    const t = e.currentTarget;
                    t.style.height = 'auto';
                    t.style.height = `${t.scrollHeight}px`;
                  }}
                  onFocus={(e) => {
                    const len = e.currentTarget.value.length;
                    e.currentTarget.setSelectionRange(len, len);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => commitEdit(el.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') e.currentTarget.blur();
                  }}
                />
              );
            }
            return (
              <div key={el.id} className={selectedSet.has(el.id) ? 'cv-text sel' : 'cv-text'} style={{ left: el.x, top: el.y, pointerEvents: 'none' }}>
                {el.text}
              </div>
            );
          })}

          {/* Shape labels: centred text inside a rect/ellipse (double-click to edit).
              The static label is click-through so the shape under it stays selectable;
              the editor is a flex-centred contentEditable that follows the shape box. */}
          {vectorEls.map((s) => {
            if (s.type !== 'rect' && s.type !== 'ellipse') return null;
            const editing = editingId === s.id;
            const label = s.label ?? '';
            if (!editing && !label) return null;
            const box = { left: s.x, top: s.y, width: s.w, height: s.h };
            if (editing) {
              return (
                <div
                  key={`lbl-${s.id}`}
                  className="cv-label editing"
                  style={box}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  role="textbox"
                  aria-label="Shape label"
                  ref={(node) => {
                    if (node && document.activeElement !== node) {
                      node.focus();
                      const r = document.createRange();
                      r.selectNodeContents(node);
                      r.collapse(false);
                      const selr = window.getSelection();
                      selr?.removeAllRanges();
                      selr?.addRange(r);
                    }
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => commitEdit(s.id, e.currentTarget.innerText)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                >
                  {label}
                </div>
              );
            }
            return (
              <div key={`lbl-${s.id}`} className="cv-label" style={{ ...box, pointerEvents: 'none' }}>
                {label}
              </div>
            );
          })}

          {/* Selection transform handles (U7) / linear endpoint handles (U8). */}
          {singleLinear ? (
            (['start', 'end'] as const).map((which) => {
              const p = endpointWorld(singleLinear, which);
              return (
                <div
                  key={`ep-${which}`}
                  className="pgcv-handle round"
                  style={{ left: p.x - 5, top: p.y - 5, cursor: 'crosshair' }}
                  onPointerDown={(e) => onEndpointDown(e, singleLinear, which)}
                />
              );
            })
          ) : showTransform && !draft && editingId === null ? (
            <>
              {HANDLE_DEFS.map((h) => (
                <div
                  key={h.id}
                  className="pgcv-handle"
                  style={{ left: selBox.x + h.fx * selBox.w - 4, top: selBox.y + h.fy * selBox.h - 4, cursor: h.cursor }}
                  onPointerDown={(e) => onHandleDown(e, 'resize', h.id)}
                />
              ))}
              <div className="pgcv-rotate" style={{ left: selBox.x + selBox.w / 2 - 6, top: selBox.y - 26, cursor: 'grab' }} onPointerDown={(e) => onHandleDown(e, 'rotate')} />
            </>
          ) : null}

          {isShared && peers.map((peer) => <PeerCursor key={peer.id} peer={peer} />)}
        </div>

        {/* Per-selection style controls (screen-fixed; outside the panned world). */}
        {styleTarget && !draft && editingId === null ? (
          <CanvasStylePanel
            el={styleTarget}
            onPatch={(patch) => {
              pushHistory();
              setElements((prev) => prev.map((e) => (e.id === styleTarget.id ? { ...e, ...patch } : e)));
            }}
          />
        ) : null}

        {elements.length === 0 && !draft ? (
          <div className="pgcv-emptyboard" aria-hidden="true">
            <span className="pgcv-emptyboard-t">A blank canvas</span>
            <span className="pgcv-emptyboard-x">Drag a note here, draw, or add a note card.</span>
          </div>
        ) : null}

        {isShared ? (
          <div className="pgcv-avs" aria-label={`Mira, ${name} and you are on this canvas`}>
            <span className="av m">M</span>
            <span className="av n" aria-hidden="true">✧</span>
            <span className="av y">Y</span>
          </div>
        ) : null}

        <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={onAddImage} />
        <div className="pgcv-tools" aria-label="Canvas tools">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className={tool === t.id ? 'on' : undefined} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
              {t.icon}
            </button>
          ))}
          <button type="button" aria-label="Add image" onClick={() => imageInputRef.current?.click()}>
            <ToolIcon>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </ToolIcon>
          </button>
          <span className="tsep" />
          <button type="button" aria-label="Add note card" onClick={newNoteAndPlace}>
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

      <Modal open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()}>
        <div className="dh">
          <div className="dt">Save your changes?</div>
          <div className="dd2">
            This board has edits that aren&apos;t sealed yet. Save to seal them to your vault, or discard to leave it as it was.
          </div>
        </div>
        <div className="db">
          <div className="wallet-actions">
            <Button variant="quiet" onClick={() => blocker.reset?.()}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              Discard
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                save();
                blocker.proceed?.();
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
