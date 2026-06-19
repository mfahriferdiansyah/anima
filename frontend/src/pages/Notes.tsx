import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { createNote, useVault } from '@/hooks/useVault';
import { notesMounted } from '@/hooks/useAgentTimeline';
import { useVaultSession } from '@/hooks/useVaultSession';
import { NoteEditor } from './NoteEditor';
import './notes.css';

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

  return <EditorEmpty title="Pick a memory" detail="Choose a note from the tree, or start a new one." />;
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
