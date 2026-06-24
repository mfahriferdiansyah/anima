import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useBlocker } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { FundsBanner } from '@/components/FundsBanner';
import { ToastStack } from '@/components/ToastStack';
import type { ToastItem } from '@/components/ToastStack';
import { createNote, saveNote, useVault } from '@/hooks/useVault';
import type { Note } from '@/hooks/useVault';
import { clearSuggestion, useAgentTimeline } from '@/hooks/useAgentTimeline';
import { CoverPicker } from '@/components/CoverPicker';
import { ShareDialog } from './ShareDialog';
import { useShareCollab } from '../web3/shareCollab';
import { resolveCover, parseCoverRef } from '../web3/covers';

/* ---------- editor ---------- */

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/** Stable mock blob id for a note already sealed before this session (deterministic). */
function mockSealId(noteId: string): string {
  let h = 0;
  for (let i = 0; i < noteId.length; i += 1) h = (h * 31 + noteId.charCodeAt(i)) >>> 0;
  const hex = (h * 2654435761) >>> 0;
  const s = hex.toString(16).padStart(8, '0');
  return `0x${s.slice(0, 4)}…${s.slice(4, 8)}`;
}

/** Same algorithm the share flow uses, so the status-bar link matches the published slug. */
function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 32) || 'untitled'
  );
}

let toastCounter = 0;

/**
 * Resolve a note's `cover` ref to a renderable URL. Presets resolve synchronously
 * to the same path; blob/seal refs trigger an async fetch + decrypt. Cleans up
 * object URLs on unmount or when the ref changes.
 */
function useResolvedCover(coverRef: string | undefined, noteId: string): string | null {
  // Presets are directly-renderable paths — resolve them synchronously so they
  // never flash the loading placeholder. Only blob:/seal: refs need an async
  // aggregator fetch (+ Seal decrypt), which yields an object URL.
  const preset = coverRef && parseCoverRef(coverRef).kind === 'preset' ? coverRef : null;
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (preset !== null || !coverRef) {
      setBlobUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void resolveCover(coverRef, noteId).then((url) => {
      if (cancelled) return;
      setBlobUrl(url);
      if (url?.startsWith('blob:')) objectUrl = url;
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [coverRef, noteId, preset]);

  return preset ?? blobUrl;
}

/**
 * The kit editor frame (section 12): tab, title, typed props, and the always-on
 * editable body — a contenteditable source surface (markdown-lite) prefilled with
 * the saved note so anything kept can be freely rewritten, not just appended. It
 * carries [[ autocomplete, the selection bubble, the agent suggestion block, and
 * the status bar with save/share. The editable block is an uncontrolled ref
 * island; React never writes its children, so StrictMode double-mounts cannot
 * clobber typed text. Unsaved edits gate navigation away (useBlocker + the
 * save/discard dialog) so a save is a deliberate seal, never silent autosave.
 */
export function NoteEditor({ note, agentName }: { note: Note; agentName: string }) {
  const { notes, writeStates } = useVault();
  const { suggestion } = useAgentTimeline();

  const frameRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<HTMLDivElement>(null);
  const typeRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const [bubble, setBubble] = useState<{ centerX: number; top: number } | null>(null);
  const [pop, setPop] = useState<{ prefix: string; left: number; top: number } | null>(null);
  const [popIndex, setPopIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [coverOpen, setCoverOpen] = useState(false);
  // The note is editable the moment it opens (Notion-style, no edit toggle).
  // `dirty` = the live surface differs from the saved body; it drives the
  // Save/Saved button, the navigation guard, and the beforeunload warning.
  const [dirty, setDirty] = useState(false);

  // While an edit share is active for this note, the owner joins the live room as
  // the authoritative Yjs responder + single sealer. Passing `typeRef` binds the
  // editor's contenteditable to the shared Y.Text, so the owner types into the SAME
  // CRDT as the guests (owner edits show up live in their browser). A no-op when
  // nothing is shared.
  const { guestCount } = useShareCollab(note.noteId, typeRef);

  // Resolve note.cover (a ref: preset path, seal:, or blob:) to a renderable URL.
  // Falls back to note.image for fixture demo notes that predate the cover field.
  const resolvedCoverUrl = useResolvedCover(note.cover, note.noteId);
  const displayCover = resolvedCoverUrl ?? note.image ?? null;

  const setCover = (src: string) => {
    saveNote(note.noteId, { image: src });
    setCoverOpen(false);
  };
  const removeCover = () => {
    saveNote(note.noteId, { image: '' });
    setCoverOpen(false);
  };

  const writeState = writeStates[note.noteId];
  const certified = writeState?.phase === 'certified' ? writeState : undefined;
  const wordCount = note.body.split(/\s+/).filter(Boolean).length;
  const agentLower = agentName.toLowerCase();

  const pushInfo = (title: string, detail?: string) => {
    toastCounter += 1;
    setToasts((prev) => [...prev, { id: `note-toast-${toastCounter}`, variant: 'info', title, detail, icon: '✧' }]);
  };
  const dismissToast = (id: string) => setToasts((prev) => prev.filter((toast) => toast.id !== id));

  /* ----- prefill the editable source surface ----- */

  // Write the saved body into the uncontrolled edit island imperatively (never via
  // JSX children — the StrictMode ref-island contract). Keyed on noteId only: the
  // component is remounted per note (key={noteId} in Notes.tsx), and NOT depending
  // on note.body means a background/optimistic body change can't clobber an
  // in-progress edit. A fresh, empty note gets focus so writing starts immediately;
  // an existing note is left unfocused so a click lands the caret exactly where the
  // reader wants to edit.
  useLayoutEffect(() => {
    const el = typeRef.current;
    if (!el) return;
    el.textContent = note.body;
    if (note.body.trim().length === 0) el.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.noteId]);

  /* ----- selection bubble (200ms settle, Escape hides) ----- */

  useEffect(() => {
    let timer: number | null = null;
    const evaluate = () => {
      const sel = window.getSelection();
      const root = selRef.current;
      const frame = frameRef.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !root || !frame || !sel.anchorNode || !root.contains(sel.anchorNode)) {
        setBubble(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      setBubble({ centerX: rect.left - frameRect.left + rect.width / 2, top: rect.top - frameRect.top });
    };
    const onSelectionChange = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, 200);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBubble(null);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useLayoutEffect(() => {
    const el = bubbleRef.current;
    const frame = frameRef.current;
    if (!bubble || !el || !frame) return;
    const left = Math.max(8, Math.min(bubble.centerX - el.offsetWidth / 2, frame.clientWidth - el.offsetWidth - 8));
    el.style.left = `${left}px`;
    el.style.top = `${bubble.top - el.offsetHeight - 8}px`;
  }, [bubble]);

  const execFormat = (command: 'bold' | 'italic') => (event: ReactMouseEvent) => {
    event.preventDefault(); // keep the selection alive
    document.execCommand(command);
  };
  const formatStub = (event: ReactMouseEvent) => {
    event.preventDefault();
    pushInfo('Coming soon', 'Bold and italic work today; the rest lands later');
  };

  /* ----- [[ autocomplete in the type-block ----- */

  const detectPopup = () => {
    const sel = window.getSelection();
    const frame = frameRef.current;
    const type = typeRef.current;
    if (!sel || sel.rangeCount === 0 || !frame || !type || !sel.anchorNode || !type.contains(sel.anchorNode) || sel.anchorNode.nodeType !== Node.TEXT_NODE) {
      setPop(null);
      return;
    }
    const upto = (sel.anchorNode.textContent ?? '').slice(0, sel.anchorOffset);
    const open = upto.lastIndexOf('[[');
    if (open === -1 || upto.slice(open).includes(']]')) {
      setPop(null);
      return;
    }
    const prefix = upto.slice(open + 2);
    if (prefix.length > 40) {
      setPop(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const anchorLeft = rect.left > 0 ? rect.left - frameRect.left : 30;
    setPop({
      prefix,
      left: Math.max(8, Math.min(anchorLeft, frameRect.width - 296)),
      top: (rect.bottom > 0 ? rect.bottom : frameRect.top) - frameRect.top + 6,
    });
    setPopIndex(0);
  };

  // The edit surface fires this on every input: keep the [[ autocomplete in sync
  // and recompute dirty against the saved body (trim trailing newlines the
  // contenteditable adds so an untouched note never reads as dirty).
  const onTypeInput = () => {
    detectPopup();
    const el = typeRef.current;
    setDirty(el ? el.innerText.trimEnd() !== note.body.trimEnd() : false);
  };

  const popMatches = useMemo(() => {
    if (!pop) return [];
    const prefix = pop.prefix.toLowerCase();
    return notes
      .filter((entry) => entry.noteId !== note.noteId && (entry.title || '').toLowerCase().startsWith(prefix))
      .slice(0, 5);
  }, [pop, notes, note.noteId]);
  const popCanCreate = pop !== null && pop.prefix.trim().length > 0;
  const popTotal = popMatches.length + (popCanCreate ? 1 : 0);

  const insertLink = (title: string) => {
    const sel = window.getSelection();
    setPop(null);
    if (!sel || !sel.anchorNode || sel.anchorNode.nodeType !== Node.TEXT_NODE) return;
    const node = sel.anchorNode as Text;
    const offset = sel.anchorOffset;
    const text = node.textContent ?? '';
    const open = text.slice(0, offset).lastIndexOf('[[');
    if (open === -1) return;
    node.textContent = `${text.slice(0, open)}[[${title}]]${text.slice(offset)}`;
    const caret = open + title.length + 4;
    const range = document.createRange();
    range.setStart(node, caret);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    // an inserted link mutates the body — reflect it in the dirty flag
    const el = typeRef.current;
    setDirty(el ? el.innerText.trimEnd() !== note.body.trimEnd() : false);
  };

  const choosePopOption = (index: number) => {
    if (index < popMatches.length) {
      insertLink(popMatches[index].title || 'Untitled note');
      return;
    }
    if (!pop) return;
    const title = pop.prefix.trim();
    const created = createNote();
    saveNote(created, { title });
    insertLink(title);
  };

  const onTypeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!pop || popTotal === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPopIndex((index) => (index + 1) % popTotal);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPopIndex((index) => (index + popTotal - 1) % popTotal);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choosePopOption(popIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setPop(null);
    }
  };

  /* ----- save flow ----- */

  const saveTitle = () => {
    const value = titleRef.current?.textContent?.trim() ?? '';
    if (value !== note.title) saveNote(note.noteId, { title: value });
  };

  const save = () => {
    const title = titleRef.current?.textContent?.trim() || note.title;
    // The surface holds the full body — REPLACE it (not append). `innerText`
    // round-trips the contenteditable's line breaks; trailing blank lines the
    // browser adds are trimmed.
    const body = (typeRef.current?.innerText ?? note.body).trimEnd();
    setPop(null);
    setDirty(false);
    saveNote(note.noteId, { title, body });
  };

  /* ----- unsaved-changes guards ----- */

  // SPA navigation (switch note, nav section, back/forward): block while dirty and
  // offer Save / Discard / Keep editing. useBlocker requires the data router that
  // App now mounts via RouterProvider. The blocker fires before navigation
  // commits, while this editor (and its typeRef) is still mounted, so save() can
  // read the live buffer.
  const blocker = useBlocker(dirty);

  // Tab close / refresh / external link — the case the SPA blocker can't catch.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /* ----- agent suggestion block (never auto-applies, P5) ----- */

  const targeted = suggestion && suggestion.targetNoteId === note.noteId ? suggestion : null;
  const firstLine = note.body.split('\n')[0] ?? '';

  const acceptSuggestion = () => {
    if (!targeted) return;
    const lines = note.body.split('\n');
    saveNote(note.noteId, { body: [targeted.body, ...lines.slice(1)].join('\n') });
    clearSuggestion();
  };

  const rejectSuggestion = () => {
    setFading(true);
    window.setTimeout(() => {
      clearSuggestion();
      setFading(false);
      pushInfo('Suggestion dismissed', 'The note is unchanged');
    }, 200);
  };

  const folder = note.tags[0] ?? 'unsorted';
  const folderLabel = folder.charAt(0).toUpperCase() + folder.slice(1);

  const coverMenu = <CoverPicker onPick={setCover} />;

  return (
    <div className="pged" ref={frameRef}>
      <div className="pged-top">
        <span className="pgcrumb">
          {folderLabel} / <b>{note.title || 'Untitled note'}</b>
        </span>
        <span className="sp" />
        {guestCount > 0 ? (
          <span className="pgcv-save" role="status" aria-label={`${guestCount} editing live`}>
            {guestCount} editing live
          </span>
        ) : null}
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
      <div className="pged-scroll">
        {(note.cover || note.image) ? (
          <div className="pgbanner-wrap">
            <div className="pgbanner">
              {displayCover ? (
                <img src={displayCover} alt="" />
              ) : (
                <div className="pgbanner-loading" aria-label="Loading cover…" />
              )}
              <div className="pgbanner-acts">
                <button type="button" className="pgbn-btn" onClick={() => setCoverOpen((o) => !o)}>Change cover</button>
                <button type="button" className="pgbn-btn" onClick={removeCover}>Remove</button>
              </div>
            </div>
            {coverOpen ? coverMenu : null}
          </div>
        ) : null}
        <div className={(note.cover || note.image) ? 'pgcol haz' : 'pgcol'}>
          {!(note.cover || note.image) ? (
            <div className="pgcover-add-wrap">
              <button type="button" className="pgcover-add" onClick={() => setCoverOpen((o) => !o)}>
                <span aria-hidden="true">✦</span> Add cover
              </button>
              {coverOpen ? coverMenu : null}
            </div>
          ) : null}
          <h1
            ref={titleRef}
            className="pgtitle"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            role="textbox"
            aria-label="Note title"
            onBlur={saveTitle}
          >
            {note.title}
          </h1>
          <div className="props">
            {note.tags.length > 0 ? (
              <div className="proprow">
                <span className="pk">tags</span>
                <span className="pv">
                  {note.tags.map((tag) => (
                    <span key={tag} className="ptag">{tag}</span>
                  ))}
                </span>
              </div>
            ) : null}
            <div className="proprow">
              <span className="pk">updated</span>
              <span className="pv"><span className="mono">{note.updatedAt.slice(0, 10)}</span></span>
            </div>
            {certified || !note.noteId.startsWith('note-new-') ? (
              <div className="proprow">
                <span className="pk">sealed</span>
                <span className="pv">
                  <span className="mono">
                    <span style={{ color: 'var(--teal-500)' }} aria-hidden="true">✦</span> rev {note.version} · {certified ? shortId(certified.blobObjectId) : mockSealId(note.noteId)}
                  </span>
                </span>
              </div>
            ) : null}
          </div>
          <div ref={selRef}>
            <div
              ref={typeRef}
              className="edtype"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              role="textbox"
              aria-label="Note body"
              data-ph="Write your note… press [[ to link another"
              onInput={onTypeInput}
              onKeyDown={onTypeKeyDown}
              onBlur={() => setPop(null)}
            />
            {targeted ? (
              <div className={fading ? 'suggest fading' : 'suggest'}>
                <div className="sh">
                  <span className="ag" aria-hidden="true">✧</span> {agentLower} suggests · just now
                </div>
                <div className="sdiff">
                  <del>{firstLine}</del> <ins>{targeted.body}</ins>
                </div>
                <div className="swhy">
                  <b>Reason:</b> the current opening states the format, not the hook. This one proves the memory claim
                  before the first slide.
                </div>
                <div className="sact">
                  <Button variant="primary" size="sm" onClick={acceptSuggestion}>
                    Accept
                  </Button>
                  <Button variant="quiet" size="sm" onClick={rejectSuggestion}>
                    Reject
                  </Button>
                  <span className="scope">undo scope: this agent run</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="pgstatus">
        <span>{wordCount.toLocaleString()} words</span>
        <span aria-hidden="true">·</span>
        {writeState?.phase === 'certified' ? (
          <span>
            <span className="ok" aria-hidden="true">✦</span> sealed rev {note.version}
          </span>
        ) : writeState?.phase === 'failed' ? (
          <span style={{ color: 'var(--red-500)' }}>seal failed</span>
        ) : writeState ? (
          <span>{writeState.phase} rev {note.version}</span>
        ) : (
          <span>rev {note.version}</span>
        )}
        <span className="pgspeak" style={{ marginLeft: 'auto' }}>
          anima.app/c/{slugify(note.title || 'untitled')}
        </span>
      </div>

      {pop && popTotal > 0 ? (
        <div className="lcpop float" style={{ left: pop.left, top: pop.top }}>
          <div className="lin">
            [[{pop.prefix}
            <span className="caret" aria-hidden="true" />
          </div>
          {popMatches.map((entry, index) => (
            <div
              key={entry.noteId}
              className={index === popIndex ? 'li on' : 'li'}
              onMouseDown={(event) => {
                event.preventDefault();
                insertLink(entry.title || 'Untitled note');
              }}
            >
              <span className="ic" aria-hidden="true">✦</span>
              <span className="lt">{entry.title || 'Untitled note'}</span>
              <span className="cnt2">{entry.tags[0] ?? 'unsorted'}/</span>
            </div>
          ))}
          {popCanCreate ? (
            <div
              className={popIndex === popMatches.length ? 'li new on' : 'li new'}
              onMouseDown={(event) => {
                event.preventDefault();
                choosePopOption(popMatches.length);
              }}
            >
              <span className="ic" style={{ color: 'var(--gray-600)' }} aria-hidden="true">+</span>
              <span className="lt">Create "{pop.prefix.trim()}"</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {bubble ? (
        <div className="bubble" ref={bubbleRef} role="toolbar" aria-label="Text formatting" style={{ left: -9999, top: -9999 }}>
          <button type="button" className="bscout" onMouseDown={formatStub}>
            <span className="ag" aria-hidden="true">✧</span> {agentLower}
          </button>
          <span className="bsep" />
          <button type="button" className="bturn" onMouseDown={formatStub}>
            Text <span style={{ fontSize: 9, opacity: 0.7 }} aria-hidden="true">▾</span>
          </button>
          <span className="bsep" />
          <button type="button" aria-label="Bold" onMouseDown={execFormat('bold')}>
            <b>B</b>
          </button>
          <button type="button" className="bi2" aria-label="Italic" onMouseDown={execFormat('italic')}>
            i
          </button>
          <button type="button" className="bs2" aria-label="Strikethrough" onMouseDown={formatStub}>
            S
          </button>
          <button type="button" className="bc2" aria-label="Code" onMouseDown={formatStub}>
            {'</>'}
          </button>
          <span className="bsep" />
          <button type="button" aria-label="Link" onMouseDown={formatStub}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </button>
        </div>
      ) : null}

      <Modal open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()}>
        <div className="dh">
          <div className="dt">Save your changes?</div>
          <div className="dd2">
            This note has edits that aren&apos;t sealed yet. Save to seal them to your vault, or discard to leave the
            note as it was.
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

      <ShareDialog
        open={sharing}
        onClose={() => setSharing(false)}
        noteId={note.noteId}
        title={note.title || 'Untitled note'}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
