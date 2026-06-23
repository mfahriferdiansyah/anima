import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { createShareLink, dismissFunds, generateView, newSharePassword, removeStaleCopy, setLinkAccess, setLinkPassword, unpublish, useShare } from '@/hooks/useShare';
import type { LinkAccess } from '@/hooks/useShare';
import { TopUpModal } from '@/components/TopUpModal';
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
  // Read-only VIEW is the default for both notes and canvases (a canvas publishes a
  // read-only board snapshot; live edit is secondary).
  const defaultAccess: LinkAccess = 'view';

  const link = links.find((entry) => entry.noteId === noteId) ?? null;
  const access = link?.access ?? defaultAccess;
  const password = link?.password ?? null;
  const phase = link?.phase; // 'publishing' (new copy, no wallet) | 'cleaning' (delete old, wallet)
  const busy = phase !== undefined;
  const staleBlob = link?.staleBlob ?? null;
  const needsFunds = link?.needsFunds ?? false;
  // A re-publish replaces an existing copy → step 2 (wallet delete) will run.
  const replacing = phase === 'cleaning' || (phase === 'publishing' && !!link?.blobObjectId) || !!staleBlob;
  const error = link?.error ?? null;

  const [topUpOpen, setTopUpOpen] = useState(false);

  const [copied, setCopied] = useState<'link' | 'password' | null>(null);
  const copyTimer = useRef<number | null>(null);

  // the link is the share itself; ensure one exists while the dialog is open
  // (a view link is local until Generate — no chain write on mere open)
  useEffect(() => {
    if (open && !link) void createShareLink(noteId, defaultAccess, kind, title);
  }, [open, link, noteId, title, kind, defaultAccess]);

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
    else void createShareLink(noteId, next, kind, title);
  };

  const togglePassword = () => {
    void setLinkPassword(noteId, password ? null : newSharePassword());
  };

  const copyText = (key: 'link' | 'password', text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1800);
  };

  // View first (the default); a view link publishes a read-only snapshot (a note's
  // body, or a board's elements). Edit is the secondary live-collab option.
  const CARDS: { value: LinkAccess; label: string; desc: string }[] = [
    { value: 'view', label: 'Can view', desc: `Anyone with the link can read this ${noun}. No changes.` },
    { value: 'edit', label: 'Can edit', desc: `Anyone with the link joins and edits this ${noun}, live.` },
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

        {/* The published link, once it exists (the new copy is live as soon as
            step 1 finishes, so it shows during the step-2 cleanup too). Hidden
            while publishing the first copy and while revoking it away. */}
        {link && link.url && phase !== 'publishing' && phase !== 'revoking' ? (
          <div className="sharebar">
            <span className="url">{link.url}</span>
            <CopyButton copied={copied === 'link'} onCopy={() => copyText('link', link.url)} />
          </div>
        ) : null}

        {/* Step progression: a re-publish is two on-chain ops, a revoke is one;
            narrate them so the wallet approval is expected, not a surprise. */}
        {busy ? (
          <ol className="shareprog" aria-live="polite">
            {phase === 'revoking' ? (
              <li className="on">
                <span className="shareprog-i" aria-hidden="true" />
                <span className="shareprog-t">
                  Removing the published copy
                  <i>frees its storage, a small deposit comes back to you</i>
                </span>
              </li>
            ) : (
              <>
                <li className={phase === 'publishing' ? 'on' : 'done'}>
                  <span className="shareprog-i" aria-hidden="true" />
                  <span className="shareprog-t">Publishing the new copy</span>
                </li>
                {replacing ? (
                  <li className={phase === 'cleaning' ? 'on' : ''}>
                    <span className="shareprog-i" aria-hidden="true" />
                    <span className="shareprog-t">
                      Removing the old copy
                      <i>frees its storage, a small deposit comes back to you</i>
                    </span>
                  </li>
                ) : null}
              </>
            )}
          </ol>
        ) : null}

        {/* Out of funds: a graceful Top up, not a raw chain error. */}
        {!busy && needsFunds ? (
          <div className="sharefunds" role="alert">
            <span className="sharefunds-dot" aria-hidden="true" />
            <p>Your agent doesn&apos;t have enough funds to publish this {noun}.</p>
            <button type="button" className="sharefunds-act" onClick={() => setTopUpOpen(true)}>
              Top up
            </button>
          </div>
        ) : null}

        {/* A skipped/rejected cleanup: the old copy is still readable. */}
        {!busy && staleBlob ? (
          <div className="sharewarn" role="alert">
            <p>The previous copy is still published — anyone with the earlier link can still open it.</p>
            <button type="button" className="btn btn-sm" onClick={() => void removeStaleCopy(noteId)}>
              Remove old copy
            </button>
          </div>
        ) : null}

        {/* Generate affordance (a view link is published only on demand). */}
        {!busy && !staleBlob && !needsFunds && (!link || !link.url) && access === 'view' ? (
          <div className="sharebar sharebar-generate">
            <span className="url">{password ? 'Publish a password-locked copy to share' : 'Publish a read-only copy to share'}</span>
            <button type="button" className="copybtn" onClick={() => void generateView(noteId)}>
              <span className="cstar" aria-hidden="true">✦</span>
              Generate link
            </button>
          </div>
        ) : null}

        {error && !needsFunds ? <div className="shareerror" role="alert">{error}</div> : null}

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
              <input type="checkbox" checked={!!password} onChange={togglePassword} disabled={busy} />
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
            <Button variant="danger" disabled={busy} onClick={() => void unpublish(noteId)}>
              Revoke link
            </Button>
          ) : null}
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </div>
      </div>
      {/* Top up in place (no navigation). On close, clear the funds notice so the
          Generate affordance returns for a retry. */}
      <TopUpModal
        open={topUpOpen}
        onClose={() => {
          setTopUpOpen(false);
          dismissFunds(noteId);
        }}
      />
    </Modal>
  );
}
