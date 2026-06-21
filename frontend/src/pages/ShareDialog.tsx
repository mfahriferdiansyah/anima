import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { createShareLink, newSharePassword, setLinkAccess, setLinkPassword, unpublish, useShare } from '@/hooks/useShare';
import type { LinkAccess } from '@/hooks/useShare';
import './share.css';

/** Kit .copybtn: the ✦ bursts once on copy, then back to work. */
function CopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <button type="button" className={copied ? 'copybtn copied' : 'copybtn'} onClick={onCopy}>
      <span className="cstar" aria-hidden="true">✦</span>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function AccessIcon({ access }: { access: LinkAccess }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {access === 'edit' ? (
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </>
      ) : (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  noteId: string;
  title: string;
  /** 'note' shares a memory, 'canvas' shares a board; only the copy differs. */
  kind?: 'note' | 'canvas';
}

/**
 * Share = pick an access level (edit = multiplayer, view = read-only) from two
 * cards, then optionally protect the link with a password. One live link, no
 * separate publish flow for edit; a view link publishes a real read-only blob.
 * The link exists as soon as the dialog opens (defaults to an EDIT link: an
 * instant relay room, no chain write; switching to VIEW triggers a silent
 * agent publish). Revoking a view link deletes its wallet-owned blob.
 */
export function ShareDialog({ open, onClose, noteId, title, kind = 'note' }: ShareDialogProps) {
  const { links } = useShare();
  const noun = kind === 'canvas' ? 'canvas' : 'memory';

  const link = links.find((entry) => entry.noteId === noteId) ?? null;
  const access = link?.access ?? 'edit';
  const password = link?.password ?? null;
  const publishing = link?.publishing ?? false;
  const error = link?.error ?? null;

  const [copied, setCopied] = useState<'link' | 'password' | null>(null);
  const copyTimer = useRef<number | null>(null);

  // the link is the share itself; ensure one exists while the dialog is open
  // (defaults to edit: an instant room id, no chain write on mere open)
  useEffect(() => {
    if (open && !link) void createShareLink(noteId, 'edit', title);
  }, [open, link, noteId, title]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const close = () => {
    setCopied(null);
    onClose();
  };

  const choose = (next: LinkAccess) => {
    if (link) void setLinkAccess(noteId, next);
    else void createShareLink(noteId, next, title);
  };

  const togglePassword = () => {
    void setLinkPassword(noteId, password ? null : newSharePassword());
  };

  const revoke = () => {
    const ok = window.confirm(
      `Revoke this link? Anyone currently reading this ${noun} will lose access, and the published copy is permanently deleted.`,
    );
    if (ok) {
      void unpublish(noteId);
      close();
    }
  };

  const copyText = (key: 'link' | 'password', text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1800);
  };

  // A view link publishes a read-only snapshot of a note's body; a canvas's
  // durable snapshot is 007 territory, so canvases share as live edit links only.
  const CARDS: { value: LinkAccess; label: string; desc: string }[] = [
    { value: 'edit', label: 'Can edit', desc: `Anyone with the link joins and edits this ${noun}, live.` },
    ...(kind === 'canvas'
      ? []
      : [{ value: 'view' as LinkAccess, label: 'Can view', desc: `Anyone with the link can read this ${noun}. No changes.` }]),
  ];

  return (
    <Modal open={open} onClose={close}>
      <div className="dh">
        <div className="dt">Share this {noun}</div>
        <div className="dd2 dd2-clamp">{title}</div>
      </div>
      <div className="db sharebody">
        <div className="accesscards">
          {CARDS.map((card) => (
            <button
              key={card.value}
              type="button"
              className={access === card.value ? 'acard on' : 'acard'}
              aria-pressed={access === card.value}
              onClick={() => choose(card.value)}
            >
              <AccessIcon access={card.value} />
              <b>{card.label}</b>
              <span>{card.desc}</span>
            </button>
          ))}
        </div>

        {access === 'edit' ? (
          <div className="sharenote">
            Edits are live but not saved. The owner must be present to persist them.
          </div>
        ) : null}

        {link && publishing ? (
          <div className="sharebar sharebar-busy">
            <span className="url">Publishing this {noun}…</span>
          </div>
        ) : link && link.url ? (
          <div className="sharebar">
            <span className="url">{link.url}</span>
            <CopyButton copied={copied === 'link'} onCopy={() => copyText('link', link.url)} />
          </div>
        ) : null}

        {error ? <div className="shareerror" role="alert">{error}</div> : null}

        <div className="protect">
          <label className="protect-row">
            <span className="protect-l">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect width="18" height="11" x="3" y="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Protect with a password
            </span>
            <span className="switch">
              <input type="checkbox" checked={!!password} onChange={togglePassword} disabled={publishing} />
              <span className="track" />
            </span>
          </label>

          {password ? (
            <div className="protect-body">
              <div className="sharebar">
                <span className="url">{password}</span>
                <CopyButton copied={copied === 'password'} onCopy={() => copyText('password', password)} />
              </div>
              <div className="sharecaption">readers enter this to open the link</div>
            </div>
          ) : null}
        </div>

        <div className="wallet-actions">
          {access === 'view' && link?.blobObjectId ? (
            <Button variant="danger" onClick={revoke}>
              Revoke link
            </Button>
          ) : null}
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
