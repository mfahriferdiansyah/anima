import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createCanvas, deleteCanvas, useCanvases, useFolders, type CanvasDoc } from '@/hooks/useCanvases';
import { buildLibrary } from '@/app/library';
import { ManageLibrary } from '@/app/ManageLibrary';
import { resolveCover, parseCoverRef } from '@/web3/covers';
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

const GRID_GLYPH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

/**
 * One canvas gallery card. Lives as its own component so the cover-resolve hook
 * runs once per canvas (rules of hooks — it cannot be called inside the grid map).
 * The cover slot is held while a `blob:` cover resolves (the `.pglib-cover` gray
 * background is the loading state); the grid glyph shows only when there is no
 * cover ref at all, so a resolving cover never flashes the glyph.
 */
function CanvasCard({
  canvas,
  confirming,
  onOpen,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  canvas: CanvasDoc;
  confirming: boolean;
  onOpen: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const cover = useResolvedCanvasCover(canvas.image, canvas.canvasId);
  const hasCoverRef = !!canvas.image;
  return (
    <div className="pglib-cardwrap">
      <button type="button" className="pglib-card canvas" onClick={onOpen}>
        {hasCoverRef ? (
          <span className="pglib-cover">{cover ? <img src={cover} alt="" /> : null}</span>
        ) : null}
        <span className="pglib-body">
          {!hasCoverRef ? <span className="pglib-ic">{GRID_GLYPH}</span> : null}
          <span className="pglib-t">{canvas.title || 'Untitled canvas'}</span>
          <span className="pglib-x">{canvas.desc || 'A blank canvas to draw on.'}</span>
        </span>
      </button>
      {!canvas.seed ? (
        <button
          type="button"
          className="pglib-carddel"
          aria-label={`Delete ${canvas.title || 'canvas'}`}
          onClick={onAskDelete}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      ) : null}
      {confirming ? (
        <div className="pglib-cardconfirm" role="dialog" aria-label="Confirm delete canvas">
          <span className="pglib-cardconfirm-t">Delete this board?</span>
          <span className="pglib-cardconfirm-x">This removes the board — your notes stay in your vault.</span>
          <div className="pglib-cardconfirm-row">
            <button type="button" className="pgbtn" onClick={onCancelDelete}>Cancel</button>
            <button type="button" className="pgbtn danger" onClick={onConfirmDelete}>Delete board</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Canvas home: the overview reached from the Canvas nav — every canvas as a
 *  card (cover or grid glyph + title + description), grouped into the same
 *  folders as the sidebar. Open one to enter its board. */
export function CanvasHome() {
  const navigate = useNavigate();
  const canvases = useCanvases();
  const folderOrder = useFolders();
  const [query, setQuery] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  // The canvas id awaiting delete confirmation (the seed board is never deletable).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const folders = buildLibrary([], canvases, folderOrder)
    .map((folder) => ({ ...folder, items: q ? folder.items.filter((it) => it.title.toLowerCase().includes(q)) : folder.items }))
    .filter((folder) => folder.items.length > 0);

  // Only the seed (shared) board exists — nothing created yet. The board itself
  // still renders below; this is the gentle nudge to make a first canvas.
  const noCreatedCanvases = canvases.every((c) => c.seed);

  const newCanvas = () => navigate(`/app/canvas/${createCanvas()}`);

  const removeCanvas = (canvasId: string) => {
    deleteCanvas(canvasId);
    setConfirmDelete(null);
  };

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
                    confirming={confirmDelete === item.canvas!.canvasId}
                    onOpen={() => navigate(`/app/canvas/${item.canvas!.canvasId}`)}
                    onAskDelete={() => setConfirmDelete(item.canvas!.canvasId)}
                    onCancelDelete={() => setConfirmDelete(null)}
                    onConfirmDelete={() => removeCanvas(item.canvas!.canvasId)}
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
