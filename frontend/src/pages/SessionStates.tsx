import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND_NAME } from '@/brand';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { InkPanel } from '@/components/InkPanel';
import { Orb } from '@/components/Orb';
import {
  closeBeforeSign,
  completeOnboarding,
  disconnect,
  pair,
  rejectPairing,
  rejectSignature,
  retryRebuild,
} from '@/hooks/useVaultSession';
import type { SessionState } from '@/hooks/useVaultSession';
import './session.css';

/** Every phase the AppGate hands over; ready and disconnected never reach here. */
export type GateSession = Exclude<SessionState, { phase: 'ready' } | { phase: 'disconnected' }>;

function shortId(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** The wordmark every gate surface carries, so the four phases read as one family. */
function GateMark() {
  return (
    <div className="gate-mark" aria-hidden="true">
      {BRAND_NAME}
      <i>✦</i>
    </div>
  );
}

/**
 * The one ceremony glyph (kit's stroke-drawn ✦, reserved for "first board open").
 * It plays only while the vault is being created — nowhere else in onboarding.
 */
function StarDraw() {
  return (
    <svg className="stardraw" viewBox="0 0 22 22" aria-hidden="true">
      <path
        pathLength={100}
        d="M11 1 L13.4 8.6 L21 11 L13.4 13.4 L11 21 L8.6 13.4 L1 11 L8.6 8.6 Z"
      />
    </svg>
  );
}

function Checking() {
  return (
    <div className="gate" role="status">
      <GateMark />
      <span className="spin" aria-hidden="true">✦</span>
      <div className="mono gate-line">checking your vault</div>
    </div>
  );
}

const ONBOARDING_STEPS = [
  { key: 'creating', label: 'Creating your vault' },
  { key: 'preparing', label: 'Preparing your companion' },
  { key: 'done', label: 'Memory ready' },
] as const;

type FirstRunSession = Extract<SessionState, { phase: 'first-run' }>;

/**
 * The first-run ceremony, full screen: name → one signature (mock wallet
 * inline) → the star-draw while the vault is created. Close (X / Escape)
 * works only before signing; once onboarding starts it cannot be interrupted.
 */
function Ceremony({ session }: { session: FirstRunSession }) {
  const navigate = useNavigate();
  const [name, setName] = useState('Nova');
  const [signing, setSigning] = useState(false);
  const inProgress = session.onboarding !== null;
  const doneIndex = ONBOARDING_STEPS.findIndex((step) => step.key === session.onboarding);
  const companion = name.trim() || 'Nova';

  const close = useCallback(() => {
    if (inProgress) return;
    closeBeforeSign();
    navigate('/');
  }, [inProgress, navigate]);

  // Escape returns to the landing, mirroring the old modal affordance.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const approve = () => {
    setSigning(false);
    completeOnboarding(name);
  };
  const reject = () => {
    setSigning(false);
    rejectSignature();
  };

  return (
    <div className="gate gate-cere">
      <GateMark />
      {inProgress ? null : (
        <button type="button" className="gate-x" aria-label="Back to landing" onClick={close}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}

      <div className="cere anim">
        {inProgress ? (
          <>
            <StarDraw />
            <div className="cere-kick mono">CREATING YOUR VAULT</div>
            <h1 className="cere-h">Waking {companion}.</h1>
            <ol className="cere-steps" aria-live="polite">
              {ONBOARDING_STEPS.map((step, index) => {
                const complete = index < doneIndex || (index === doneIndex && step.key === 'done');
                const active = index === doneIndex && !complete;
                const cls = complete ? 'cstep ok' : active ? 'cstep on' : 'cstep';
                return (
                  <li key={step.key} className={cls}>
                    <span className="ci" aria-hidden="true">{complete || active ? '✦' : '✧'}</span>
                    {step.label}
                  </li>
                );
              })}
            </ol>
          </>
        ) : signing ? (
          <>
            <div className="cere-kick mono">ONE SIGNATURE</div>
            <h1 className="cere-h">Approve in your wallet.</h1>
            <p className="cere-sub">
              This single signature creates the vault and funds {companion}. It is the only one
              onboarding asks for.
            </p>
            <InkPanel label="Wallet" tone="orange">
              <div className="inner">create vault · fund {companion} · 1 signature</div>
            </InkPanel>
            <div className="cere-wait" role="status">
              <span className="spinstar" aria-hidden="true">✦</span>
              waiting for signature…
            </div>
            <div className="wallet-actions">
              <Button variant="quiet" onClick={reject}>
                Reject
              </Button>
              <Button variant="primary" onClick={approve}>
                Approve in wallet
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="cere-kick mono">NEW VAULT</div>
            <h1 className="cere-h">
              Name your <span className="cere-hl">companion</span>.
            </h1>
            <p className="cere-sub">
              She keeps what she learns in a vault your wallet owns. One signature creates it.
            </p>
            <Field
              label="Companion name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              help="This becomes her name and the name of your vault."
              error={session.error ?? undefined}
            />
            <Button variant="primary" onClick={() => setSigning(true)}>
              Create with one signature
            </Button>
            <p className="cere-fine">Writes are silent. Forgetting needs your signature.</p>
          </>
        )}
      </div>
    </div>
  );
}

type PairingSession = Extract<SessionState, { phase: 'needs-pairing' }>;

/** Known vault, unknown device: one signature registers this device key. */
function Pairing({ session }: { session: PairingSession }) {
  const [signing, setSigning] = useState(false);

  const approve = () => {
    setSigning(false);
    pair();
  };

  const reject = () => {
    setSigning(false);
    rejectPairing();
  };

  return (
    <div className="gate">
      <GateMark />
      <div className="pair-card anim">
        <Orb size="lg" label={`${session.agent.name} is waiting`} />
        <div className="pair-title">Pair this device</div>
        <p className="pair-desc">
          {session.agent.name} already lives in vault{' '}
          <span className="mono">{shortId(session.vault.vaultId)}</span>. One signature registers
          this device so it can decrypt your memory.
        </p>
        {session.error ? <p className="pair-error">{session.error}</p> : null}
        {signing ? (
          <>
            <InkPanel label="Wallet" tone="orange">
              <div className="inner">register device key · vault {shortId(session.vault.vaultId)}</div>
            </InkPanel>
            <div className="wallet-actions">
              <Button variant="quiet" onClick={reject}>
                Reject
              </Button>
              <Button variant="primary" onClick={approve}>
                Approve in wallet
              </Button>
            </div>
          </>
        ) : (
          <Button variant="primary" onClick={() => setSigning(true)}>
            {session.error ? 'Retry' : 'Pair this device'}
          </Button>
        )}
        <button type="button" className="gate-escape" onClick={disconnect}>
          disconnect
        </button>
      </div>
    </div>
  );
}

type RebuildingSession = Extract<SessionState, { phase: 'rebuilding' }>;

/** The hero moment: decrypting quilts back into memory, ✦ by ✦. */
function Rebuilding({ session }: { session: RebuildingSession }) {
  if (session.error) {
    return (
      <div className="gate">
        <GateMark />
        <div className="failcard anim" role="alert">
          <span className="fx" aria-hidden="true">✕</span>
          <div className="ft">Rebuild interrupted</div>
          <p className="fd">{session.error}</p>
          <Button variant="primary" onClick={retryRebuild}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="gate">
      <GateMark />
      <div className="rebuild" aria-live="polite">
        <Orb size="lg" working label="Decrypting your memory" />
        <h1 className="rebuild-title">Decrypting your memory</h1>
        <div className="mono rebuild-sub">
          quilt {session.done} of {session.total}
        </div>
        <div className="rebuild-quilts" aria-hidden="true">
          {Array.from({ length: session.total }, (_, index) => (
            <span key={index} className={index < session.done ? 'q f' : 'q'}>✦</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Session-state surfaces for every non-ready phase the AppGate hands over. */
export function SessionGate({ session }: { session: GateSession }) {
  switch (session.phase) {
    case 'checking':
      return <Checking />;
    case 'first-run':
      return <Ceremony session={session} />;
    case 'needs-pairing':
      return <Pairing session={session} />;
    case 'rebuilding':
      return <Rebuilding session={session} />;
  }
}
