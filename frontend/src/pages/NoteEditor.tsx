import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { ToastStack } from '@/components/ToastStack';
import type { ToastItem } from '@/components/ToastStack';
import { createNote, saveNote, useVault } from '@/hooks/useVault';
import type { Note } from '@/hooks/useVault';
import { clearSuggestion, useAgentTimeline } from '@/hooks/useAgentTimeline';
import { ShareDialog } from './ShareDialog';

/* ---------- markdown-lite: fixture bodies -> kit-classed blocks ---------- */

type CalloutType = 'info' | 'tip' | 'warn' | 'danger';

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'callout'; type: CalloutType; title: string; body: string }
  | { kind: 'check'; line: number; checked: boolean; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

const CALLOUT_TYPES: Record<string, { type: CalloutType; title: string }> = {
  info: { type: 'info', title: 'Info' },
  note: { type: 'info', title: 'Note' },
  tip: { type: 'tip', title: 'Tip' },
  warning: { type: 'warn', title: 'Warning' },
  warn: { type: 'warn', title: 'Warning' },
  danger: { type: 'danger', title: 'Danger' },
};

function parseBlocks(body: string): Block[] {
  const lines = body.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const check = line.match(/^- \[( |x)\] (.*)$/);
    if (check) {
      blocks.push({ kind: 'check', line: i, checked: check[1] === 'x', text: check[2] });
      i += 1;
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quote.push(lines[i].replace(/^> ?/, ''));
        i += 1;
      }
      const typed = quote[0]?.match(/^\[!(\w+)\]\s*(.*)$/);
      const meta = typed ? (CALLOUT_TYPES[typed[1].toLowerCase()] ?? CALLOUT_TYPES.note) : CALLOUT_TYPES.note;
      const rest = typed ? [typed[2], ...quote.slice(1)] : quote;
      blocks.push({ kind: 'callout', type: meta.type, title: meta.title, body: rest.filter(Boolean).join(' ') });
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ''));
        i += 1;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ') && !/^- \[( |x)\]/.test(lines[i])) {
        items.push(lines[i].slice(2));
        i += 1;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^([->]|\d+\. )/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: 'p', text: para.join(' ') });
  }
  return blocks;
}

/* ---------- wiki links: fixture bodies link by noteId, typed links by title ---------- */

function resolveLink(notes: Note[], token: string): Note | undefined {
  const key = token.trim().toLowerCase();
  return (
    notes.find((note) => note.noteId.toLowerCase() === key) ??
    notes.find((note) => (note.title || '').toLowerCase() === key)
  );
}

function flatExcerpt(note: Note, notes: Note[]): string {
  const text = note.body
    .replace(/\[\[([^\]]+)\]\]/g, (_, token: string) => resolveLink(notes, token)?.title ?? token)
    .split('\n')
    .map((line) => line.replace(/^(- \[( |x)\] |- |> ?|\d+\. )/, ''))
    .filter(Boolean)
    .join(' ');
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

interface LinkHandlers {
  onOpen: (noteId: string) => void;
  onHoverStart: (noteId: string, el: HTMLElement) => void;
  onHoverEnd: () => void;
}

function InlineText({ text, notes, handlers }: { text: string; notes: Note[]; handlers: LinkHandlers }) {
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return (
    <>
      {parts.map((part, index) => {
        const match = part.match(/^\[\[([^\]]+)\]\]$/);
        if (!match) return <Fragment key={index}>{part}</Fragment>;
        const target = resolveLink(notes, match[1]);
        if (!target) {
          return (
            <span key={index} className="wikilink unresolved">
              {match[1]}
            </span>
          );
        }
        return (
          <span
            key={index}
            className="wikilink"
            role="link"
            tabIndex={0}
            onClick={() => handlers.onOpen(target.noteId)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handlers.onOpen(target.noteId);
            }}
            onMouseEnter={(event) => handlers.onHoverStart(target.noteId, event.currentTarget)}
            onMouseLeave={handlers.onHoverEnd}
          >
            {target.title || 'Untitled note'}
          </span>
        );
      })}
    </>
  );
}

/* ---------- callouts ---------- */

function CalloutIcon({ type }: { type: CalloutType }) {
  const paths: Record<CalloutType, ReactNode> = {
    info: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </>
    ),
    tip: (
      <>
        <path d="M15 14c.2-1 .7-1.7 1.5-2.5A7 7 0 1 0 5 9c0 1 .5 2.5 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
        <path d="M9 18h6" />
        <path d="M10 22h4" />
      </>
    ),
    warn: (
      <>
        <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </>
    ),
    danger: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6" />
        <path d="m9 9 6 6" />
      </>
    ),
  };
  return (
    <svg className="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[type]}
    </svg>
  );
}

function Callout({ type, title, body, notes, handlers }: { type: CalloutType; title: string; body: string; notes: Note[]; handlers: LinkHandlers }) {
  const [folded, setFolded] = useState(false);
  return (
    <div className={`callout c-${type}${folded ? ' folded' : ''}`}>
      <div
        className="ch"
        role="button"
        tabIndex={0}
        aria-expanded={!folded}
        onClick={() => setFolded((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setFolded((prev) => !prev);
          }
        }}
      >
        <CalloutIcon type={type} />
        {title}
        <svg className="car" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 3l4 4 4-4" />
        </svg>
      </div>
      <div className="cbody">
        <InlineText text={body} notes={notes} handlers={handlers} />
      </div>
    </div>
  );
}

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
 * The kit editor frame (section 12): tab, title, typed props, the rendered
 * body, the contenteditable type-block with [[ autocomplete, the selection
 * bubble, the agent suggestion block, and the status bar with save/share.
 * The editable block is an uncontrolled ref island; React never writes
 * its children, so StrictMode double-mounts cannot clobber typed text.
 */
export function NoteEditor({ note, agentName }: { note: Note; agentName: string }) {
  const navigate = useNavigate();
  const { notes, writeStates } = useVault();
  const { suggestion } = useAgentTimeline();

  const frameRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<HTMLDivElement>(null);
  const typeRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);

  const [hover, setHover] = useState<{ noteId: string; left: number; top: number } | null>(null);
  const [bubble, setBubble] = useState<{ centerX: number; top: number } | null>(null);
  const [pop, setPop] = useState<{ prefix: string; left: number; top: number } | null>(null);
  const [popIndex, setPopIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const blocks = useMemo(() => parseBlocks(note.body), [note.body]);
  const writeState = writeStates[note.noteId];
  const certified = writeState?.phase === 'certified' ? writeState : undefined;
  const wordCount = note.body.split(/\s+/).filter(Boolean).length;
  const agentLower = agentName.toLowerCase();

  const pushInfo = (title: string, detail?: string) => {
    toastCounter += 1;
    setToasts((prev) => [...prev, { id: `note-toast-${toastCounter}`, variant: 'info', title, detail, icon: '✧' }]);
  };
  const dismissToast = (id: string) => setToasts((prev) => prev.filter((toast) => toast.id !== id));

  /* ----- wiki link hover preview (350ms hold) ----- */

  const hoverStart = (noteId: string, el: HTMLElement) => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      const frame = frameRef.current;
      if (!frame) return;
      const rect = el.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      setHover({
        noteId,
        left: Math.max(8, Math.min(rect.left - frameRect.left, frameRect.width - 296)),
        top: rect.bottom - frameRect.top + 8,
      });
    }, 350);
  };
  const hoverEnd = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHover(null);
  };
  useEffect(
    () => () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  const handlers: LinkHandlers = {
    onOpen: (id) => navigate(`/app/notes/${id}`),
    onHoverStart: hoverStart,
    onHoverEnd: hoverEnd,
  };
  const hoverNote = hover ? notes.find((entry) => entry.noteId === hover.noteId) : undefined;

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

  const toggleCheck = (line: number) => {
    const lines = note.body.split('\n');
    lines[line] = lines[line].startsWith('- [x]')
      ? lines[line].replace('- [x]', '- [ ]')
      : lines[line].replace('- [ ]', '- [x]');
    saveNote(note.noteId, { body: lines.join('\n') });
  };

  const saveTitle = () => {
    const value = titleRef.current?.textContent?.trim() ?? '';
    if (value !== note.title) saveNote(note.noteId, { title: value });
  };

  const save = () => {
    const title = titleRef.current?.textContent?.trim() || note.title;
    const typed = typeRef.current?.innerText.trim() ?? '';
    const body = typed ? (note.body ? `${note.body}\n\n${typed}` : typed) : note.body;
    if (typeRef.current) typeRef.current.textContent = '';
    setPop(null);
    saveNote(note.noteId, { title, body });
  };

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

  return (
    <div className="pged" ref={frameRef}>
      <div className="pged-top">
        <span className="pgcrumb">
          {folderLabel} / <b>{note.title || 'Untitled note'}</b>
        </span>
        <span className="sp" />
        <button type="button" className="pgbtn" onClick={() => setSharing(true)}>
          Share
        </button>
        <button type="button" className="pgbtn primary" onClick={save}>
          Save
        </button>
      </div>
      <div className="pged-scroll">
        <div className="pgcol">
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
            <div className="edcontent">
              {blocks.map((block, index) => {
              switch (block.kind) {
                case 'p':
                  return (
                    <p key={index}>
                      <InlineText text={block.text} notes={notes} handlers={handlers} />
                    </p>
                  );
                case 'callout':
                  return <Callout key={index} type={block.type} title={block.title} body={block.body} notes={notes} handlers={handlers} />;
                case 'check': {
                  const id = `check-${note.noteId}-${block.line}`;
                  return (
                    <div key={index} className="edcheck">
                      <input type="checkbox" id={id} checked={block.checked} onChange={() => toggleCheck(block.line)} />
                      <label htmlFor={id}>
                        <InlineText text={block.text} notes={notes} handlers={handlers} />
                      </label>
                    </div>
                  );
                }
                case 'ul':
                  return (
                    <ul key={index}>
                      {block.items.map((item, itemIndex) => (
                        <li key={itemIndex}>
                          <InlineText text={item} notes={notes} handlers={handlers} />
                        </li>
                      ))}
                    </ul>
                  );
                case 'ol':
                  return (
                    <ol key={index}>
                      {block.items.map((item, itemIndex) => (
                        <li key={itemIndex}>
                          <InlineText text={item} notes={notes} handlers={handlers} />
                        </li>
                      ))}
                    </ol>
                  );
              }
            })}
          </div>
          <div
            ref={typeRef}
            className="edtype"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            role="textbox"
            aria-label="Write in the note"
            data-ph="Write, press [[ to link a note…"
            onInput={detectPopup}
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

      {hover && hoverNote ? (
        <div className="hovercard float show" style={{ left: hover.left, top: hover.top }}>
          <div className="ht">{hoverNote.title || 'Untitled note'}</div>
          <div className="hm">
            {(hoverNote.tags[0] ?? 'unsorted')}/ · ✦ rev {hoverNote.version} · {hoverNote.links.length} links
          </div>
          <div className="hb">{flatExcerpt(hoverNote, notes)}</div>
        </div>
      ) : null}

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
