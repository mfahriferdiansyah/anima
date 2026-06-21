import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { configureForgetExec, forgetNotes, setNoteFolder, useVault } from '@/hooks/useVault';
import { useWalletExecTx } from '@/web3/walletExecTx';
import {
  addFolder,
  deleteCanvas,
  deleteFolder,
  moveFolder,
  setCanvasFolder,
  updateCanvas,
  useCanvases,
  useFolders,
} from '@/hooks/useCanvases';
import { buildLibrary, type LibItem } from './library';

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Organize library: add and reorder folders, move notes/canvases between them
 * (a per-item folder picker — drag-and-drop is a later layer), edit a canvas's
 * title + description, and delete. Renders through the shared <Modal>, so its
 * chrome, spacing and close behaviour match every other dialog.
 */
export function ManageLibrary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notes } = useVault();
  const canvases = useCanvases();
  const folders = useFolders();
  const [newName, setNewName] = useState('');
  // ids whose forget is awaiting the wallet signature — the row's delete is
  // disabled while in flight (the delete is non-idempotent: one popup per click).
  const [forgetting, setForgetting] = useState<Set<string>>(new Set());
  const { execTx } = useWalletExecTx();

  // useWalletExecTx returns a fresh execTx each render; keep the latest in a ref
  // and register a stable wrapper. Set-only (no cleanup): this modal is mounted
  // app-wide via AppShell, so nulling on unmount would clobber a live sibling.
  const execRef = useRef(execTx);
  execRef.current = execTx;
  useEffect(() => {
    configureForgetExec((tx) => execRef.current(tx));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- execTx read via execRef; register once
  }, []);

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

  // Forget rewrites survivors then deletes the quilt(s) under one wallet
  // signature; disable the row while it's in flight, and on a declined/failed
  // signature re-enable it (the note stays — a failed delete is retryable).
  const removeItem = async (item: LibItem) => {
    if (item.kind === 'canvas') {
      if (!item.canvas?.seed) deleteCanvas(item.id);
      return;
    }
    if (forgetting.has(item.id)) return;
    setForgetting((prev) => new Set(prev).add(item.id));
    try {
      await forgetNotes([item.id]);
    } catch {
      // declined/failed signature — the note stays in the index, retryable
    } finally {
      setForgetting((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="wide">
      <div className="dh">
        <div className="dt">Organize</div>
        <div className="dd2">Add folders, move notes and canvases between them, edit a canvas.</div>
      </div>
      <div className="db">
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
          <button type="button" className="pgbtn primary" disabled={!newName.trim()} onClick={addNew}>
            Add folder
          </button>
        </div>

        <div className="mlib-body db-scroll">
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
                  {inOrder && folder.items.length === 0 ? (
                    <button type="button" className="mlib-arrow" aria-label="Remove empty folder" onClick={() => deleteFolder(folder.name)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                    </button>
                  ) : null}
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
                      disabled={(item.kind === 'canvas' && item.canvas?.seed) || forgetting.has(item.id)}
                      aria-label={item.kind === 'canvas' ? 'Delete canvas' : 'Forget note'}
                      onClick={() => void removeItem(item)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="wallet-actions">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
