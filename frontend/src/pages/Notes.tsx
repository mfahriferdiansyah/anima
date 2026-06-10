import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { createNote, forgetNotes, useVault } from '@/hooks/useVault';
import type { Note } from '@/hooks/useVault';
import { notesMounted, useAgentTimeline } from '@/hooks/useAgentTimeline';
import { confirmWithWallet } from '@/hooks/useWallet';
import { useVaultSession } from '@/hooks/useVaultSession';
import { NoteEditor } from './NoteEditor';
import '@/theme/editor.css';

/** Folder = the note's first tag (3 fixture groups), untagged notes pool in "unsorted". */
function folderOf(note: Note): string {
  return note.tags[0] ?? 'unsorted';
}

function folderLabel(folder: string): string {
  return folder.charAt(0).toUpperCase() + folder.slice(1);
}

/** Kit .aged format: short age for the agent-edited marker. */
function shortAge(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const AGENT_RECENT_MS = 48 * 60 * 60 * 1000;

const FOLDER_PATH = (
  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
);

function Chevron() {
  return (
    <svg
      className="chev"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 1l4 4-4 4" />
    </svg>
  );
}

/** Kit note states: blue dot open, hollow untouched, teal sealed. */
function stateDotStyle(state: 'open' | 'sealed' | 'untouched') {
  if (state === 'open') return { background: 'var(--blue-600)' };
  if (state === 'sealed') return { background: 'var(--teal-500)' };
  return { background: 'transparent', boxShadow: 'inset 0 0 0 1.5px var(--gray-200)' };
}

function EditorEmpty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="notes-empty">
      <div className="empty">
        <span className="ghost" aria-hidden="true">✦</span>
        <div className="et">{title}</div>
        <div className="ed">{detail}</div>
        {action}
      </div>
    </div>
  );
}

/**
 * The Obsidian-style page (R10-R12): in-page tree on the left, the kit
 * editor frame on the right. Forget is the one wallet-gated action; the
 * tree carries note state dots, agent markers, and the suggestion pill.
 */
export function Notes() {
  const session = useVaultSession();
  const { noteId } = useParams();
  const navigate = useNavigate();
  const { notes, writeStates } = useVault();
  const { suggestion } = useAgentTimeline();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  // Draft handoff: a pending "Let Nova draft" request fires ~1200ms after this mount.
  useEffect(() => {
    notesMounted();
  }, []);

  const activeNote = noteId ? notes.find((note) => note.noteId === noteId) : undefined;

  // The open note's folder never hides its own row.
  useEffect(() => {
    if (!activeNote) return;
    const folder = folderOf(activeNote);
    setCollapsed((prev) => {
      if (!prev.has(folder)) return prev;
      const next = new Set(prev);
      next.delete(folder);
      return next;
    });
  }, [activeNote]);

  const groups = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const note of notes) {
      const folder = folderOf(note);
      const list = map.get(folder);
      if (list) list.push(note);
      else map.set(folder, [note]);
    }
    return [...map.entries()];
  }, [notes]);

  if (session.phase !== 'ready') return null;
  const name = session.agent.name;

  const toggleFolder = (folder: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectMode = () => {
    setSelecting((prev) => !prev);
    setSelected(new Set());
  };

  const newNote = () => {
    navigate(`/app/notes/${createNote()}`);
  };

  const runForget = async () => {
    const ids = [...selected];
    const count = ids.length;
    const approved = await confirmWithWallet(`forget ${count} ${count === 1 ? 'note' : 'notes'}`);
    if (!approved) return; // wallet rejected: nothing dies, the dialog stays for another try
    const remaining = notes.filter((note) => !selected.has(note.noteId));
    forgetNotes(ids);
    setConfirming(false);
    setSelecting(false);
    setSelected(new Set());
    if (noteId && ids.includes(noteId)) {
      navigate(remaining.length > 0 ? `/app/notes/${remaining[0].noteId}` : '/app/notes', { replace: true });
    }
  };

  const forgetCount = selected.size;
  const forgetVictims = notes.filter((note) => selected.has(note.noteId));

  return (
    <section className="notes">
      <div className="notes-side">
        <div className="tree-head">
          <span className="tree-label">Memories</span>
          {notes.length > 0 ? (
            <Button variant="quiet" size="sm" onClick={toggleSelectMode}>
              {selecting ? 'Done' : 'Select'}
            </Button>
          ) : null}
        </div>
        <div className="tree">
          {groups.map(([folder, items]) => {
            const open = !collapsed.has(folder);
            return (
              <Fragment key={folder}>
                <button
                  type="button"
                  className={open ? 'trow open' : 'trow'}
                  onClick={() => toggleFolder(folder)}
                  aria-expanded={open}
                >
                  <Chevron />
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                    {FOLDER_PATH}
                  </svg>
                  <span className="nt">{folderLabel(folder)}</span>
                  <span className="cnt">{items.length}</span>
                </button>
                {open
                  ? items.map((note) => {
                      const isActive = note.noteId === noteId;
                      const sealed = writeStates[note.noteId]?.phase === 'certified';
                      const agentRecent =
                        note.author.startsWith('agent') &&
                        Date.now() - new Date(note.updatedAt).getTime() < AGENT_RECENT_MS;
                      const suggested = !isActive && suggestion?.targetNoteId === note.noteId;
                      const state = isActive ? 'open' : sealed ? 'sealed' : 'untouched';
                      return (
                        <button
                          key={note.noteId}
                          type="button"
                          className={isActive && !selecting ? 'trow lvl2 active' : 'trow lvl2'}
                          onClick={() =>
                            selecting ? toggleSelected(note.noteId) : navigate(`/app/notes/${note.noteId}`)
                          }
                        >
                          {selecting ? (
                            <input type="checkbox" checked={selected.has(note.noteId)} readOnly tabIndex={-1} />
                          ) : (
                            <span className="dot" style={stateDotStyle(state)} />
                          )}
                          <span className="nt">{note.title || 'Untitled note'}</span>
                          {suggested ? (
                            <span className="spill" title={`${name} has a suggestion for this note`}>✧</span>
                          ) : isActive ? (
                            <span className="cnt" style={{ color: 'var(--blue-700)' }}>open</span>
                          ) : sealed ? (
                            <span className="cnt">✦ sealed</span>
                          ) : agentRecent ? (
                            <span className="aged">
                              <span aria-hidden="true">✧</span> {name.toLowerCase()} · {shortAge(note.updatedAt)}
                            </span>
                          ) : null}
                        </button>
                      );
                    })
                  : null}
              </Fragment>
            );
          })}
          <button type="button" className="trow tnew" onClick={newNote}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span className="nt">New note</span>
          </button>
        </div>
        {selecting ? (
          <div className="tree-foot">
            <Button variant="danger" size="sm" disabled={forgetCount === 0} onClick={() => setConfirming(true)}>
              Forget ({forgetCount})
            </Button>
          </div>
        ) : null}
      </div>

      <div className="notes-main">
        {activeNote ? (
          <NoteEditor key={activeNote.noteId} note={activeNote} agentName={name} />
        ) : notes.length === 0 ? (
          <EditorEmpty
            title="No memories yet"
            detail={`Start a note or ask ${name} to draft one. Everything you keep is sealed to your vault.`}
            action={
              <Button variant="primary" onClick={newNote}>
                New note
              </Button>
            }
          />
        ) : noteId ? (
          <EditorEmpty
            title="This memory is gone"
            detail="It was forgotten or never existed. Pick another note from the tree."
          />
        ) : (
          <EditorEmpty title="Pick a memory" detail="Choose a note from the tree, or start a new one." />
        )}
      </div>

      <Modal open={confirming} onClose={() => setConfirming(false)}>
        <div className="dh">
          <div className="dt">
            Forget {forgetCount} {forgetCount === 1 ? 'memory' : 'memories'}?
          </div>
          <div className="dd2">These memories will be destroyed. This is the one thing your wallet must sign.</div>
        </div>
        <div className="db">
          <ul className="forget-list">
            {forgetVictims.map((note) => (
              <li key={note.noteId}>{note.title || 'Untitled note'}</li>
            ))}
          </ul>
          <div className="wallet-actions">
            <Button variant="quiet" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={runForget}>
              Forget {forgetCount} {forgetCount === 1 ? 'memory' : 'memories'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
