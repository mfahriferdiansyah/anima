import { useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { createCanvas, useCanvases, useFolders, type CanvasDoc } from '@/hooks/useCanvases';
import type { Note } from '@/hooks/useVault';
import { buildLibrary } from '@/app/library';
import { ManageLibrary } from '@/app/ManageLibrary';
import { resolveCover, parseCoverRef } from '@/web3/covers';
import { vaultData } from '@/web3/vaultData';
import { loadCanvasContent, type CanvasElement } from '../../../chain/core/src/index.js';
import './sectionhome.css';

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Resolve a canvas cover ref to a renderable URL (mirrors NoteEditor's
 * `useResolvedCover`): presets resolve synchronously to their path; `blob:`/`seal:`
 * refs async-resolve to an object URL (revoked on unmount/change). Canvas covers
 * are uploaded PUBLIC, so a `blob:` ref needs no wallet to fetch.
 */
function useResolvedCanvasCover(coverRef: string | undefined, canvasId: string): string | null {
  const preset = coverRef && parseCoverRef(coverRef).kind === 'preset' ? coverRef : null;
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (preset !== null || !coverRef) {
      setBlobUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void resolveCover(coverRef, canvasId).then((url) => {
      if (cancelled) return;
      setBlobUrl(url);
      if (url?.startsWith('blob:')) objectUrl = url;
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [coverRef, canvasId, preset]);

  return preset ?? blobUrl;
}

const INK = 'rgba(22, 24, 29, .72)';

/** Truncate a string to roughly the chars that fit `width` at `fontSize` (SVG has no ellipsis). */
function fitText(text: string, width: number, fontSize: number): string {
  const max = Math.max(1, Math.floor(width / (fontSize * 0.58)));
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

/** The effective box of an element for bounds — text/zero-size elements get a sane minimum. */
function effBox(el: CanvasElement): { minX: number; minY: number; maxX: number; maxY: number } {
  let w = el.w;
  let h = el.h;
  if (el.type === 'text') {
    w = Math.max(w, (el.text?.length ?? 4) * 7);
    h = Math.max(h, 18);
  }
  w = Math.max(w, 2);
  h = Math.max(h, 2);
  return { minX: el.x, minY: el.y, maxX: el.x + w, maxY: el.y + h };
}

/** One element drawn into the thumbnail's world-coordinate SVG. */
function ThumbElement({ el, titles }: { el: CanvasElement; titles: Map<string, string> }) {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const rot = el.angle ? `rotate(${(el.angle * 180) / Math.PI} ${cx} ${cy})` : undefined;
  const stroke = el.strokeColor ?? INK;
  const fill = el.backgroundColor && el.backgroundColor !== 'transparent' ? el.backgroundColor : 'none';
  const sw = el.strokeWidth ?? 2;
  const dash = el.strokeStyle === 'dashed' ? '8 6' : el.strokeStyle === 'dotted' ? '2 5' : undefined;

  switch (el.type) {
    case 'note': {
      const title = titles.get(el.noteId) ?? 'Note';
      return (
        <g transform={rot}>
          <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={8} fill="#fff" stroke="rgba(22,24,29,.16)" strokeWidth={1.5} />
          <text x={el.x + 11} y={el.y + 25} fontSize={15} fontFamily="'Space Grotesk', sans-serif" fontWeight={600} fill="#16181d">
            {fitText(title, el.w - 18, 15)}
          </text>
          <rect x={el.x + 11} y={el.y + 38} width={Math.max(el.w - 30, 4)} height={3.5} rx={1.75} fill="rgba(22,24,29,.10)" />
          <rect x={el.x + 11} y={el.y + 49} width={Math.max(el.w - 46, 4)} height={3.5} rx={1.75} fill="rgba(22,24,29,.10)" />
        </g>
      );
    }
    case 'rect':
      return <rect transform={rot} x={el.x} y={el.y} width={el.w} height={el.h} rx={4} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />;
    case 'ellipse':
      return <ellipse transform={rot} cx={cx} cy={cy} rx={el.w / 2} ry={el.h / 2} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />;
    case 'text':
      return (
        <text transform={rot} x={el.x} y={el.y + 14} fontSize={15} fontFamily="'Inter', sans-serif" fill={el.strokeColor ?? '#16181d'}>
          {fitText(el.text ?? '', Math.max(el.w, 160), 15)}
        </text>
      );
    case 'image':
      return <rect transform={rot} x={el.x} y={el.y} width={el.w} height={el.h} rx={6} fill="rgba(22,24,29,.06)" stroke="rgba(22,24,29,.12)" strokeWidth={1} />;
    case 'draw':
    case 'arrow':
    case 'line': {
      const pts: string[] = [];
      for (let i = 0; i < el.points.length; i += 2) pts.push(`${el.x + el.points[i]},${el.y + el.points[i + 1]}`);
      if (pts.length < 2) return null;
      return <polyline points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={dash} strokeLinecap="round" strokeLinejoin="round" />;
    }
    default:
      return null;
  }
}

/**
 * A canvas rendered as a thumbnail: its actual elements (notes, shapes, text,
 * arrows, images) scaled to fit, mirroring the board (Figma/Miro board cards).
 * Reads from the in-memory index, so it is synchronous and cheap — no per-card
 * Walrus/Seal read. An empty board falls back to a faint board surface.
 */
function CanvasThumbnail({ elements, titles }: { elements: CanvasElement[]; titles: Map<string, string> }) {
  const visible = elements.filter((el) => !el.isDeleted);
  if (visible.length === 0) return <span className="pgcv-thumb empty" aria-hidden="true" />;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of visible) {
    const b = effBox(el);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  const pad = 28;
  const w = Math.max(maxX - minX, 1) + pad * 2;
  const h = Math.max(maxY - minY, 1) + pad * 2;
  const ordered = visible.slice().sort((a, b) => a.index - b.index);

  return (
    <svg className="pgcv-thumb" viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {ordered.map((el) => (
        <ThumbElement key={el.id} el={el} titles={titles} />
      ))}
    </svg>
  );
}

/**
 * One canvas gallery card: the canvas rendered as a thumbnail (or its cover, when
 * one is set) with the title overlaid. No description and no inline delete — the
 * card is the board preview; delete lives in Organize.
 */
function CanvasCard({
  canvas,
  elements,
  titles,
  onOpen,
}: {
  canvas: CanvasDoc;
  elements: CanvasElement[];
  titles: Map<string, string>;
  onOpen: () => void;
}) {
  const cover = useResolvedCanvasCover(canvas.image, canvas.canvasId);
  const hasCoverRef = !!canvas.image;
  const hasContent = elements.some((el) => !el.isDeleted);
  // The board's OWN content is the preview. A cover only fills in while the board is
  // still empty (so the shared/seed board keeps a nice card before anything is
  // placed); once you draw on a board, its real content shows — never a full-bleed
  // cover hiding the work.
  const showCover = !hasContent && (cover || hasCoverRef);
  return (
    <button type="button" className="pglib-card canvas pgcv-card" onClick={onOpen}>
      <span className="pgcv-surface">
        {showCover ? (
          cover ? <img className="pgcv-cover" src={cover} alt="" /> : null
        ) : (
          <CanvasThumbnail elements={elements} titles={titles} />
        )}
      </span>
      <span className="pgcv-titlebar">
        <span className="pgcv-cardtitle">{canvas.title || 'Untitled canvas'}</span>
      </span>
    </button>
  );
}

/** Canvas home: the overview reached from the Canvas nav — every canvas as a board
 *  thumbnail with its title, grouped into the same folders as the sidebar. Open one
 *  to enter its board. */
export function CanvasHome() {
  const navigate = useNavigate();
  const canvases = useCanvases();
  const folderOrder = useFolders();
  const snap = useSyncExternalStore(vaultData.subscribe, vaultData.getSnapshot);
  const index = snap.index;
  const notes = snap.notes as Note[];
  const [query, setQuery] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const titles = new Map(notes.map((note) => [note.noteId, note.title || 'Untitled note']));
  const folders = buildLibrary([], canvases, folderOrder)
    .map((folder) => ({ ...folder, items: q ? folder.items.filter((it) => it.title.toLowerCase().includes(q)) : folder.items }))
    .filter((folder) => folder.items.length > 0);

  // Only the seed (shared) board exists — nothing created yet. The board itself
  // still renders below; this is the gentle nudge to make a first canvas.
  const noCreatedCanvases = canvases.every((c) => c.seed);

  const newCanvas = () => navigate(`/app/canvas/${createCanvas()}`);

  /** The element list to preview, read synchronously from the in-memory index. */
  const elementsFor = (canvasId: string): CanvasElement[] =>
    index ? loadCanvasContent(index, canvasId).elements ?? [] : [];

  return (
    <div className="pged">
      <div className="pged-top">
        <span className="pgcrumb">
          <b>Canvas</b> · {canvases.length} {canvases.length === 1 ? 'canvas' : 'canvases'}
        </span>
        <span className="sp" />
        <span className="pghome-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="text" placeholder="Search canvases" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search canvases" />
        </span>
        <button type="button" className="pgbtn" onClick={() => setManageOpen(true)}>
          Organize
        </button>
        <button type="button" className="pgbtn primary" onClick={newCanvas}>
          New canvas
        </button>
      </div>
      <div className="pged-scroll">
        <div className="pghome-scroll">
          {folders.map((folder) => (
            <div key={folder.name} className="pglib-fold">
              <div className="pglib-foldh">
                <span className="pglib-foldn">{titleCase(folder.name)}</span>
                <span className="pglib-foldc">{folder.items.length}</span>
                <span className="hr" />
              </div>
              <div className="pglib-grid">
                {folder.items.map((item) => (
                  <CanvasCard
                    key={item.id}
                    canvas={item.canvas!}
                    elements={elementsFor(item.canvas!.canvasId)}
                    titles={titles}
                    onOpen={() => navigate(`/app/canvas/${item.canvas!.canvasId}`)}
                  />
                ))}
              </div>
            </div>
          ))}
          {folders.length === 0 && q ? <div className="pghome-empty">No canvases match “{query}”.</div> : null}
          {noCreatedCanvases && !q ? (
            <div className="pghome-empty">
              No canvases yet — the shared board above holds your whole vault. Create one to lay out a focused board.
            </div>
          ) : null}
        </div>
      </div>
      <ManageLibrary open={manageOpen} onClose={() => setManageOpen(false)} />
    </div>
  );
}
