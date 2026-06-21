import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { createNote, useVault } from '@/hooks/useVault';
import { vaultData } from '@/web3/vaultData';
import { useFolders } from '@/hooks/useCanvases';
import { notesMounted } from '@/hooks/useAgentTimeline';
import { useVaultSession } from '@/hooks/useVaultSession';
import { buildLibrary } from '@/app/library';
import { ManageLibrary } from '@/app/ManageLibrary';
import { NoteEditor } from './NoteEditor';
import './notes.css';
import './sectionhome.css';

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function shortAge(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** First meaningful line(s) of a note, with wiki links resolved to titles. */
function excerptOf(body: string, titles: Map<string, string>): string {
  return body
    .replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => titles.get(id) ?? id)
    .split('\n')
    .map((line) => line.replace(/^[\s\->#]*(\[[ x]\]\s*)?/, '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * The notes surface (section 13). The left rail and the MEMORIES tree now
 * live in the app shell and render on every page, so this page is only the
 * editor worktop that sits inside the shell's <Outlet/>: the kit .pged frame
 * holding either the open note or a designed empty state. Forget moved to the
 * shell tree along with selection, so this page no longer hosts it.
 */
export function Notes() {
  const session = useVaultSession();
  const { noteId } = useParams();
  const navigate = useNavigate();
  const { notes } = useVault();

  // Draft handoff: a pending "Let Nova draft" request fires ~1200ms after this mount.
  useEffect(() => {
    notesMounted();
  }, []);

  if (session.phase !== 'ready') return null;
  const name = session.agent.name;
  const activeNote = noteId ? notes.find((note) => note.noteId === noteId) : undefined;

  const newNote = () => {
    navigate(`/app/notes/${createNote()}`);
  };

  if (activeNote) {
    return <NoteEditor key={activeNote.noteId} note={activeNote} agentName={name} />;
  }

  if (notes.length === 0) {
    return (
      <EditorEmpty
        title="No memories yet"
        detail={`Start a note or ask ${name} to draft one. Everything you keep is sealed to your vault.`}
        action={
          <Button variant="primary" onClick={newNote}>
            New note
          </Button>
        }
      />
    );
  }

  if (noteId) {
    return (
      <EditorEmpty
        title="This memory is gone"
        detail="It was forgotten or never existed. Pick another note from the tree."
      />
    );
  }

  return <NotesHome name={name} onNew={newNote} />;
}

/** Notes home: the overview reached from the Notes nav — every note as a card,
 *  grouped into the same folders as the sidebar. Open one to edit it. */
function NotesHome({ name, onNew }: { name: string; onNew: () => void }) {
  const navigate = useNavigate();
  const { notes } = useVault();
  const folderOrder = useFolders();
  const [query, setQuery] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const titles = new Map(notes.map((note) => [note.noteId, note.title || 'Untitled']));
  const q = query.trim();
  // Index-ranked recall (title/body/tags + recency) instead of a title-substring
  // filter; topK is uncapped to notes.length so search never hides notes.
  const hits = q ? new Set(vaultData.search(q, notes.length).map((e) => e.note.noteId)) : null;
  const folders = buildLibrary(notes, [], folderOrder)
    .map((folder) => ({ ...folder, items: hits ? folder.items.filter((it) => hits.has(it.id)) : folder.items }))
    .filter((folder) => folder.items.length > 0);

  return (
    <div className="pged">
      <div className="pged-top">
        <span className="pgcrumb">
          <b>Notes</b> · {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        </span>
        <span className="sp" />
        <span className="pghome-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="text" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes" />
        </span>
        <button type="button" className="pgbtn" onClick={() => setManageOpen(true)}>
          Organize
        </button>
        <button type="button" className="pgbtn primary" onClick={onNew}>
          New note
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
                  const note = item.note!;
                  const byAgent = note.author.startsWith('agent');
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="pglib-card"
                      onClick={() => navigate(`/app/notes/${note.noteId}`)}
                    >
                      {note.image ? <span className="pglib-cover"><img src={note.image} alt="" /></span> : null}
                      <span className="pglib-body">
                        <span className="pglib-t">{item.title}</span>
                        <span className="pglib-x">{excerptOf(note.body, titles) || 'Empty note'}</span>
                        {byAgent ? (
                          <span className="pglib-m">
                            <i>✧ {name.toLowerCase()} · {shortAge(note.updatedAt)}</i>
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {folders.length === 0 ? <div className="pghome-empty">No notes match “{query}”.</div> : null}
        </div>
      </div>
      <ManageLibrary open={manageOpen} onClose={() => setManageOpen(false)} />
    </div>
  );
}

/** The empty editor: the same .pged worktop, centered .empty block, no open note. */
function EditorEmpty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="pged">
      <div className="pged-scroll" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="empty">
          <span className="ghost" aria-hidden="true">✦</span>
          <div className="et">{title}</div>
          <div className="ed">{detail}</div>
          {action}
        </div>
      </div>
    </div>
  );
}
