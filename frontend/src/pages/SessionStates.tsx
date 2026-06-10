import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { InkPanel } from '@/components/InkPanel';
import { Modal } from '@/components/Modal';
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

function Checking() {
  return (
    <div className="gate" role="status">
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
 * The ceremony modal: name → one signature (mock wallet inline) → progress.
 * Close (X / Escape / outside click) only works before signing; once the
 * onboarding sub-state is non-null the ceremony cannot be interrupted.
 */
function Ceremony({ session }: { session: FirstRunSession }) {
  const navigate = useNavigate();
  const [name, setName] = useState('Nova');
  const [signing, setSigning] = useState(false);
  const inProgress = session.onboarding !== null;
  const doneIndex = ONBOARDING_STEPS.findIndex((step) => step.key === session.onboarding);

  const close = () => {
    if (inProgress) return;
    closeBeforeSign();
    navigate('/');
  };

  const approve = () => {
    setSigning(false);
    completeOnboarding(name);
  };

  const reject = () => {
    setSigning(false);
    rejectSignature();
  };

  return (
    <div className="gate">
      <Modal open onClose={close}>
        <div className="dh ceremony-head">
          <div>
            <div className="dt">Name your companion</div>
            <div className="dd2">It keeps what it learns in a vault your wallet owns.</div>
          </div>
          {inProgress ? null : (
            <button type="button" className="ceremony-x" aria-label="Close" onClick={close}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="db ceremony-body">
          {inProgress ? (
            <ol className="ceremony-steps" aria-live="polite">
              {ONBOARDING_STEPS.map((step, index) => {
                const complete = index < doneIndex || (index === doneIndex && step.key === 'done');
                const active = index === doneIndex && !complete;
                const cls = complete ? 'cstep ok' : active ? 'cstep on' : 'cstep';
                return (
                  <li key={step.key} className={cls}>
                    <span className="ci" aria-hidden="true">
                      {active ? <span className="spinstar">✦</span> : complete ? '✦' : '✧'}
                    </span>
                    {step.label}
                  </li>
                );
              })}
            </ol>
          ) : signing ? (
            <>
              <div className="ceremony-wait" role="status">
                <span className="spinstar" aria-hidden="true">✦</span>
                waiting for signature…
              </div>
              <InkPanel label="Mock wallet">
                <div className="inner">create vault · fund {name.trim() || 'Nova'} · 1 signature</div>
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
            <>
              <Field
                label="Companion name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                help="One signature creates the vault and funds your companion."
                error={session.error ?? undefined}
              />
              <Button variant="primary" onClick={() => setSigning(true)}>
                Create with one signature
              </Button>
            </>
          )}
        </div>
      </Modal>
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
            <InkPanel label="Mock wallet">
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
