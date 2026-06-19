import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { publish, unpublish, useShare } from '@/hooks/useShare';
import type { PublishedCopy, ShareMode } from '@/hooks/useShare';
import { useVault } from '@/hooks/useVault';
import { confirmWithWallet } from '@/hooks/useWallet';
import './share.css';

function slugOf(url: string): string {
  return url.split('/c/')[1] ?? url;
}

/** Stroke icons only: globe for public, lock for password. */
function ModeIcon({ mode }: { mode: ShareMode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {mode === 'public' ? (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </>
      ) : (
        <>
          <rect width="18" height="11" x="3" y="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </>
      )}
    </svg>
  );
}

/** Kit .copybtn: the ✦ bursts once on copy, then back to work. */
function CopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <button type="button" className={copied ? 'copybtn copied' : 'copybtn'} onClick={onCopy}>
      <span className="cstar" aria-hidden="true">✦</span>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function PublishedList({ copies, onUnpublish }: { copies: PublishedCopy[]; onUnpublish: (copy: PublishedCopy) => void }) {
  if (copies.length === 0) return null;
  return (
    <div className="pubrows">
      <div className="publabel">Published copies</div>
      {copies.map((copy) => (
        <div className="accessrow" key={copy.id}>
          <div className="pubmeta">
            <ModeIcon mode={copy.mode} />
            <div>
              <div className="al">
                <span className="mono">/c/{slugOf(copy.url)}</span>
              </div>
              <div className="as">
                {copy.mode === 'password' ? 'password link' : 'public article'} · {copy.publishedAt.slice(0, 10)}
              </div>
            </div>
          </div>
          <Button variant="quiet" size="sm" className="unpub" onClick={() => onUnpublish(copy)}>
            Unpublish
          </Button>
        </div>
      ))}
    </div>
  );
}

type Step = 'pick' | 'progress' | 'done';

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  noteId: string;
  title: string;
  /** 'note' shares a memory, 'canvas' shares a board — only the copy differs. */
  kind?: 'note' | 'canvas';
}

/**
 * Kit section 05: publish a note as a public or password copy. Mode pick →
 * ~3s mocked sealing (close disabled mid-flight) → the named link with the
 * copy burst. A password renders exactly once, here. Unpublish is the
 * destructive one, so it goes through the mock wallet.
 */
export function ShareDialog({ open, onClose, noteId, title, kind = 'note' }: ShareDialogProps) {
  const { publishedCopies } = useShare();
  const { notes } = useVault();
  const noun = kind === 'canvas' ? 'canvas' : 'memory';
  const [step, setStep] = useState<Step>('pick');
  const [mode, setMode] = useState<ShareMode>('public');
  const [result, setResult] = useState<PublishedCopy | null>(null);
  const [copied, setCopied] = useState<'url' | 'password' | null>(null);
  const copyTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const note = notes.find((entry) => entry.noteId === noteId);
  const words = note ? note.body.split(/\s+/).filter(Boolean).length : 0;

  const close = () => {
    if (step === 'progress') return; // sealing cannot be cancelled mid-flight
    setStep('pick');
    setResult(null);
    setCopied(null);
    onClose();
  };

  const start = async (next: ShareMode) => {
    setMode(next);
    setStep('progress');
    const copy = await publish(noteId, next, title);
    setResult(copy);
    setStep('done');
  };

  const copyText = (key: 'url' | 'password', text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1800);
  };

  const removeCopy = async (copy: PublishedCopy) => {
    const approved = await confirmWithWallet(`unpublish ${slugOf(copy.url)}`);
    if (approved) unpublish(copy.id);
  };

  const password = result?.password;

  return (
    <Modal open={open} onClose={close}>
      <div className="dh">
        <div className="dt">Share this {noun}</div>
        <div className="dd2">
          {title}
          {note ? (
            <>
              {' '}· {words.toLocaleString()} words · rev {note.version}
            </>
          ) : null}
        </div>
      </div>
      <div className="db">
        {step === 'pick' ? (
          <>
            <div className="sharemodes">
              <button type="button" className="sharemode" onClick={() => start('public')}>
                <ModeIcon mode="public" />
                <span className="smt">Public article</span>
                <span className="sms">Anyone with the link can read this {noun}.</span>
              </button>
              <button type="button" className="sharemode" onClick={() => start('password')}>
                <ModeIcon mode="password" />
                <span className="smt">Password link</span>
                <span className="sms">Readers unlock it with a password you hand them.</span>
              </button>
            </div>
            <PublishedList copies={publishedCopies} onUnpublish={removeCopy} />
            <div className="wallet-actions">
              <Button variant="quiet" onClick={close}>
                Cancel
              </Button>
            </div>
          </>
        ) : step === 'progress' ? (
          <div className="shareprog">
            <span className="spin" aria-hidden="true">✦</span>
            <span className="pm">sealing a {mode === 'public' ? 'public' : 'password-locked'} copy…</span>
          </div>
        ) : result ? (
          <>
            <div className="sharebar">
              <span className="url">
                <b>anima.app</b>/c/{slugOf(result.url)}
              </span>
              <CopyButton copied={copied === 'url'} onCopy={() => copyText('url', result.url)} />
            </div>
            {password ? (
              <>
                <div className="sharebar">
                  <span className="url">{password}</span>
                  <CopyButton copied={copied === 'password'} onCopy={() => copyText('password', password)} />
                </div>
                <div className="sharecaption">save it now, it is not shown again</div>
              </>
            ) : null}
            <PublishedList copies={publishedCopies} onUnpublish={removeCopy} />
            <div className="wallet-actions">
              <Button variant="primary" onClick={close}>
                Done
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
