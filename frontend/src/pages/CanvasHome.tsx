import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createCanvas, useCanvases, useFolders } from '@/hooks/useCanvases';
import { buildLibrary } from '@/app/library';
import { ManageLibrary } from '@/app/ManageLibrary';
import './sectionhome.css';

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const GRID_GLYPH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

/** Canvas home: the overview reached from the Canvas nav — every canvas as a
 *  card (cover or grid glyph + title + description), grouped into the same
 *  folders as the sidebar. Open one to enter its board. */
export function CanvasHome() {
  const navigate = useNavigate();
  const canvases = useCanvases();
  const folderOrder = useFolders();
  const [query, setQuery] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const folders = buildLibrary([], canvases, folderOrder)
    .map((folder) => ({ ...folder, items: q ? folder.items.filter((it) => it.title.toLowerCase().includes(q)) : folder.items }))
    .filter((folder) => folder.items.length > 0);

  const newCanvas = () => navigate(`/app/canvas/${createCanvas()}`);

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
                {folder.items.map((item) => {
                  const canvas = item.canvas!;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="pglib-card canvas"
                      onClick={() => navigate(`/app/canvas/${canvas.canvasId}`)}
                    >
                      {canvas.image ? <span className="pglib-cover"><img src={canvas.image} alt="" /></span> : null}
                      <span className="pglib-body">
                        {!canvas.image ? <span className="pglib-ic">{GRID_GLYPH}</span> : null}
                        <span className="pglib-t">{canvas.title || 'Untitled canvas'}</span>
                        <span className="pglib-x">{canvas.desc || 'A blank canvas to draw on.'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {folders.length === 0 ? <div className="pghome-empty">No canvases match “{query}”.</div> : null}
        </div>
      </div>
      <ManageLibrary open={manageOpen} onClose={() => setManageOpen(false)} />
    </div>
  );
}
