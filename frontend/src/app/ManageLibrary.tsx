import { useEffect, useState } from 'react';
import { forgetNotes, setNoteFolder, useVault } from '@/hooks/useVault';
import {
  addFolder,
  deleteCanvas,
  moveFolder,
  setCanvasFolder,
  updateCanvas,
  useCanvases,
  useFolders,
} from '@/hooks/useCanvases';
import { confirmWithWallet } from '@/hooks/useWallet';
import { buildLibrary, type LibItem } from './library';

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Organize library: add and reorder folders, move notes/canvases between them
 * (a per-item folder picker — drag-and-drop is a later layer), edit a canvas's
 * title + description, and delete (forgetting a note is wallet-gated). Opened
 * from the gear beside the sidebar search; reuses the kit's modal chrome.
 */
export function ManageLibrary({ onClose }: { onClose: () => void }) {
  const { notes } = useVault();
  const canvases = useCanvases();
  const folders = useFolders();
  const [newName, setNewName] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const library = buildLibrary(notes, canvases, folders);
  const folderOptions = library.map((f) => f.name);

  const addNew = () => {
    addFolder(newName);
    setNewName('');
  };

  const moveItem = (item: LibItem, folder: string) => {
    if (item.kind === 'canvas') setCanvasFolder(item.id, folder);
    else setNoteFolder(item.id, folder);
  };

  const removeItem = async (item: LibItem) => {
    if (item.kind === 'canvas') {
      if (!item.canvas?.seed) deleteCanvas(item.id);
      return;
    }
    const ok = await confirmWithWallet(`Forget memory: ${item.title}`);
    if (ok) forgetNotes([item.id]);
  };

  return (
    <>
      <div className="mlib-scrim" onClick={onClose} aria-hidden="true" />
      <div className="mlib" role="dialog" aria-modal="true" aria-label="Organize library">
        <div className="mlib-h">
          <div>
            <b>Organize</b>
            <span>Add folders, move notes and canvases between them, edit a canvas.</span>
          </div>
          <button type="button" className="mlib-x" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="mlib-add">
          <input
            type="text"
            value={newName}
            placeholder="New folder name"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addNew();
            }}
          />
          <button type="button" className="pgbtn" disabled={!newName.trim()} onClick={addNew}>
            Add folder
          </button>
        </div>

        <div className="mlib-body">
          {library.map((folder, i) => {
            const inOrder = folders.includes(folder.name);
            return (
              <div key={folder.name} className="mlib-fold">
                <div className="mlib-foldh">
                  <span className="mlib-foldn">{titleCase(folder.name)}</span>
                  <span className="mlib-cnt">{folder.items.length}</span>
                  <span className="sp" />
                  <button type="button" className="mlib-arrow" disabled={!inOrder || i === 0} aria-label="Move folder up" onClick={() => moveFolder(folder.name, -1)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
                  </button>
                  <button type="button" className="mlib-arrow" disabled={!inOrder || i === folders.length - 1} aria-label="Move folder down" onClick={() => moveFolder(folder.name, 1)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                </div>

                {folder.items.length === 0 ? <div className="mlib-empty">Empty — move items here.</div> : null}

                {folder.items.map((item) => (
                  <div key={item.id} className="mlib-item">
                    <span className={item.kind === 'canvas' ? 'pgtype canvas' : 'pgtype doc'} aria-hidden="true">
                      {item.kind === 'canvas' ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" /><polyline points="14 2 14 8 20 8" /></svg>
                      )}
                    </span>

                    {item.kind === 'canvas' && item.canvas ? (
                      <div className="mlib-cv">
                        <input
                          type="text"
                          className="mlib-cv-t"
                          value={item.canvas.title}
                          placeholder="Canvas title"
                          onChange={(e) => updateCanvas(item.id, { title: e.target.value })}
                        />
                        <input
                          type="text"
                          className="mlib-cv-d"
                          value={item.canvas.desc}
                          placeholder="Description"
                          onChange={(e) => updateCanvas(item.id, { desc: e.target.value })}
                        />
                      </div>
                    ) : (
                      <span className="mlib-title">{item.title}</span>
                    )}

                    <select className="mlib-move" value={item.folder} aria-label="Move to folder" onChange={(e) => moveItem(item, e.target.value)}>
                      {folderOptions.map((f) => (
                        <option key={f} value={f}>
                          {titleCase(f)}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className="mlib-del"
                      disabled={item.kind === 'canvas' && item.canvas?.seed}
                      aria-label={item.kind === 'canvas' ? 'Delete canvas' : 'Forget note'}
                      onClick={() => removeItem(item)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
