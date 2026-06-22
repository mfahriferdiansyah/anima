import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { InkPanel } from '@/components/InkPanel';
import { Modal } from '@/components/Modal';
import { ToastStack } from '@/components/ToastStack';
import type { ToastItem } from '@/components/ToastStack';
import type { ToastVariant } from '@/components/Toast';
import { dismissLowBalance } from '@/hooks/useChat';
import {
  configureSettingsExec,
  connectExternalAgent,
  refreshBalances,
  refreshMilestones,
  revokeKey,
  topUp as topUpAgent,
  useSettings,
} from '@/hooks/useSettings';
import type { MilestoneKey } from '@/web3/milestones';
import type { KeyEntry } from '@/hooks/useSettings';
import { configureForgetExec, forgetEverything, useVault } from '@/hooks/useVault';
import { renameCompanion, useVaultSession } from '@/hooks/useVaultSession';
import { useWalletExecTx } from '@/web3/walletExecTx';
import { vaultData } from '@/web3/vaultData';
import { exportVaultZip } from '../../../chain/core/src/index.js';
import { useCalendar, connectCalendar, disconnectCalendar } from '@/web3/calendar';
import './settings.css';

const WAL_LOW_THRESHOLD = 1;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Stroke icons only: a monitor for device keys, a bot for external agents. */
function KeyIcon({ kind }: { kind: KeyEntry['kind'] }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'device' ? (
        <>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </>
      ) : (
        <>
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
          <line x1="8" y1="16" x2="8" y2="16" />
          <line x1="16" y1="16" x2="16" y2="16" />
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

type ConnectStep = 'generate' | 'secret' | 'issued';

interface ConnectAgentDialogProps {
  open: boolean;
  onClose: () => void;
  vaultId: string;
  /** The key this dialog issued earlier in the session, if it still exists. */
  issuedKey: KeyEntry | null;
  onIssued: (key: KeyEntry) => void;
}

/**
 * Connect an external agent: generate a key, show its secret exactly once
 * (the store never keeps it), then only offer a wallet-gated regenerate on
 * reopen. The env block is what an MCP config pastes verbatim.
 */
function ConnectAgentDialog({ open, onClose, vaultId, issuedKey, onIssued }: ConnectAgentDialogProps) {
  const [step, setStep] = useState<ConnectStep>('generate');
  const [agentName, setAgentName] = useState('');
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState<'secret' | 'env' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(issuedKey ? 'issued' : 'generate');
    setAgentName('');
    setSecret('');
    setCopied(null);
    setError(null);
    // the issued-or-generate fork is decided at open time only, so the
    // effect deliberately keys on `open` alone
  }, [open]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const copyText = (key: 'secret' | 'env', text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1800);
  };

  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const issued = await connectExternalAgent(agentName);
      onIssued(issued.key);
      setSecret(issued.secret);
      setStep('secret');
    } catch {
      // a declined wallet signature (or a failed register) leaves nothing
      // authorized — re-arm the generate step with an inline reason.
      setError('Signature was declined or the request failed. Nothing was authorized; try again when ready.');
    } finally {
      setBusy(false);
    }
  };

  const envBlock = `ANIMA_VAULT_ID=${vaultId}\nANIMA_AGENT_KEY=${secret}`;

  return (
    <Modal open={open} onClose={onClose}>
      <div className="dh">
        <div className="dt">Connect an external agent</div>
        <div className="dd2">A key of its own lets an agent read and write this vault.</div>
      </div>
      <div className="db">
        {step === 'generate' ? (
          <>
            <Field
              label="Agent name"
              help="optional, names the key in the list"
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              placeholder="external agent"
            />
            {error ? <div className="pgst-help" role="alert">{error}</div> : null}
            <div className="wallet-actions">
              <Button variant="quiet" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={generate} disabled={busy}>
                {busy ? 'Generating…' : 'Generate key'}
              </Button>
            </div>
          </>
        ) : step === 'secret' ? (
          <>
            <InkPanel label="Agent secret">
              <div className="secretrow">
                <span className="inner secretval">{secret}</span>
                <CopyButton copied={copied === 'secret'} onCopy={() => copyText('secret', secret)} />
              </div>
              <div className="secretcaption">shown once, store it now</div>
              <b className="lbl envlbl">MCP environment</b>
              <div className="secretrow">
                <pre className="inner envval">{envBlock}</pre>
                <CopyButton copied={copied === 'env'} onCopy={() => copyText('env', envBlock)} />
              </div>
            </InkPanel>
            <div className="wallet-actions">
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="issuednote">
              <KeyIcon kind="external" />
              <div>
                <div className="al">{issuedKey?.label}</div>
                <div className="as">secret already issued; revoke this key and connect a new agent to replace it</div>
              </div>
            </div>
            <div className="wallet-actions">
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** One key in the agents-and-devices list; this device cannot revoke itself. */
function KeyRow({ entry, onRevoke }: { entry: KeyEntry; onRevoke: (entry: KeyEntry) => void }) {
  return (
    <div className="pgst-key">
      <KeyIcon kind={entry.kind} />
      <div className="kb">
        <div className="kn">
          {entry.label}
          {entry.thisDevice ? (
            <span className="kthis">
              <i>✦</i>this device
            </span>
          ) : null}
        </div>
        <div className="km" title={entry.address}>
          {shortAddress(entry.address)}
          {entry.addedAt ? ` · added ${entry.addedAt.slice(0, 10)}` : ''}
        </div>
      </div>
      {entry.thisDevice ? (
        <button type="button" className="krev" disabled title="you cannot revoke the key you are using">
          Revoke
        </button>
      ) : (
        <button type="button" className="krev" onClick={() => onRevoke(entry)}>
          Revoke
        </button>
      )}
    </div>
  );
}

/**
 * Standing state (R15/R16): identity, keys, balances, export, danger zone.
 * The wallet appears for destructive actions only: revoke, regenerate,
 * forget everything. Renaming the companion is routine, so it never signs.
 */
/** The glyph for a milestone row (accent-colored when achieved). */
function milestoneIcon(key: MilestoneKey, achieved: boolean): ReactNode {
  if (key === 'seal') return <span className={achieved ? 'mg ok' : 'mg'}>✦</span>;
  if (key === 'paired') return <span className={achieved ? 'mg ag' : 'mg'}>✧</span>;
  if (key === 'public')
    return (
      <span className="mg">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      </span>
    );
  return (
    <span className="mg">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
    </span>
  );
}

function CalendarSection() {
  const calendar = useCalendar();
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await connectCalendar();
    } finally {
      setConnecting(false);
    }
  };

  const statusLabel = (() => {
    if (calendar.status === 'connected') return 'Connected — read-only access to your primary calendar';
    if (calendar.status === 'error') return 'Token expired — reconnect to restore calendar context';
    if (calendar.status === 'unconfigured') return 'Not configured — set VITE_GOOGLE_CLIENT_ID to enable';
    return 'Not connected';
  })();

  return (
    <>
      <div className="pgh-label">GOOGLE CALENDAR</div>
      <div className="pgst-row">
        <span className="pgst-k">
          Google Calendar (read-only)
          <br />
          <span className="pgst-help">{statusLabel}</span>
        </span>
        {calendar.status === 'connected' ? (
          <button type="button" className="pgbtn" onClick={() => disconnectCalendar()}>
            Disconnect
          </button>
        ) : calendar.status === 'unconfigured' ? null : (
          <button
            type="button"
            className="pgbtn primary"
            onClick={() => void handleConnect()}
            disabled={connecting}
          >
            {connecting ? 'Connecting…' : calendar.status === 'error' ? 'Reconnect' : 'Connect'}
          </button>
        )}
      </div>
    </>
  );
}

export function Settings() {
  const session = useVaultSession();
  const settings = useSettings();
  const { notes } = useVault();
  const { execTx } = useWalletExecTx();
  const ready = session.phase === 'ready' ? session : null;

  const [name, setName] = useState(ready?.vault.name ?? '');
  const [connectOpen, setConnectOpen] = useState(false);
  const [issuedKeyId, setIssuedKeyId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastCounter = useRef(0);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [topping, setTopping] = useState(false);

  // useWalletExecTx returns a fresh execTx each render; keep the latest in a ref
  // so the settings layer always calls the current one (mirrors useVaultSession).
  const execRef = useRef(execTx);
  execRef.current = execTx;

  // Wire the wallet-exec adapter into the settings + forget layers and pull live
  // balances once a vault is ready (preflight on the device agent address). The
  // forget wiring is set-only (NOT nulled on cleanup): ManageLibrary mounts the
  // same adapter app-wide via AppShell, so nulling here would clobber it. The
  // settings exec keeps its null-on-cleanup — that asymmetry is intentional.
  useEffect(() => {
    configureSettingsExec((tx) => execRef.current(tx));
    configureForgetExec((tx) => execRef.current(tx));
    if (ready) {
      void refreshBalances();
      void refreshMilestones();
    }
    return () => configureSettingsExec(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- execTx read via execRef; refetch only when ready flips
  }, [ready?.vault.vaultId]);

  const pushToast = (variant: ToastVariant, title: string, detail?: ReactNode) => {
    toastCounter.current += 1;
    setToasts((prev) => [...prev, { id: `settings-toast-${toastCounter.current}`, variant, title, detail }]);
  };
  const dismissToast = (id: string) => setToasts((prev) => prev.filter((toast) => toast.id !== id));

  if (!ready) return null;

  const saveName = () => {
    renameCompanion(name);
    pushToast('success', 'Companion renamed');
  };

  const revoke = async (entry: KeyEntry) => {
    try {
      await revokeKey(entry.id);
      pushToast('success', 'Key revoked', entry.label);
    } catch {
      pushToast('error', 'Revoke failed', entry.label);
    }
  };

  const topUp = async () => {
    setTopping(true);
    pushToast('info', 'Topping up the agent', 'approve the transfer in your wallet');
    try {
      await topUpAgent();
      dismissLowBalance();
      pushToast('success', 'Agent topped up', 'you can save again');
    } catch (e) {
      pushToast('error', 'Top up failed', e instanceof Error ? e.message : 'try again');
    } finally {
      setTopping(false);
    }
  };

  const exportVault = () => {
    const entries = vaultData.getSnapshot().index?.all() ?? [];
    const zip = exportVaultZip(entries);
    const blob = new Blob([zip as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'anima-vault-export.zip';
    anchor.click();
    URL.revokeObjectURL(url);
    pushToast('success', 'Vault exported', 'anima-vault-export.zip');
  };

  // Wipe the whole vault: an explicit confirm precedes the one wallet signature.
  // Quiesce + enumerate + delete run inside the hook; the Vault object survives
  // (re-onboardable), so this clears every memory but never tears down.
  const runWipe = async () => {
    setConfirmWipe(false);
    setWiping(true);
    try {
      await forgetEverything();
      pushToast('success', 'Vault wiped', 'every memory was erased; the vault stays yours to re-fill');
    } catch {
      pushToast('error', 'Wipe cancelled', 'the signature was declined or failed; nothing was erased');
    } finally {
      setWiping(false);
    }
  };

  const issuedKey = settings.keys.find((entry) => entry.id === issuedKeyId) ?? null;
  const walLow = settings.balances.wal < WAL_LOW_THRESHOLD;

  return (
    <div className="pged">
      <div className="pged-scroll">
        <div className="pgstcol">
      <h2 className="pgst-title">Settings</h2>

      <div className="pgh-label">COMPANION IDENTITY</div>
      <div className="pgst-row">
        <div className="pgst-id">
          <label htmlFor="pgstname">Companion name</label>
          <input
            type="text"
            id="pgstname"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <span className="pgst-help">renaming is routine, no signature needed</span>
        </div>
        <button type="button" className="pgbtn primary" onClick={saveName} disabled={!name.trim()}>
          Save
        </button>
      </div>

      <div className="pgh-label">AGENTS AND DEVICES</div>
      <div className="pgst-keys">
        {settings.keys.map((entry) => (
          <KeyRow key={entry.id} entry={entry} onRevoke={revoke} />
        ))}
      </div>
      <button type="button" className="pgbtn pgst-connect" onClick={() => setConnectOpen(true)}>
        Connect external agent
      </button>

      <CalendarSection />

      <div className="pgh-label">BALANCES</div>
      <div className="pgst-row">
        <span className="pgst-k">SUI · pays for transactions</span>
        <span className="pgst-v">{settings.balances.sui.toFixed(2)} SUI</span>
      </div>
      <div className="pgst-row">
        <span className="pgst-k">
          WAL · pays for storage
          {walLow ? <i className="low">✧ running low</i> : null}
        </span>
        <span className="pgst-v">{settings.balances.wal.toFixed(2)} WAL</span>
        {walLow ? (
          <button type="button" className="pgbtn primary" onClick={() => void topUp()} disabled={topping}>
            {topping ? 'Topping up…' : 'Top up'}
          </button>
        ) : null}
      </div>

      <div className="pgh-label">MILESTONES</div>
      <div className="pgst-miles">
        {settings.milestones.map((m) => (
          <div key={m.key} className={m.achieved ? 'mrow' : 'mrow dim'}>
            {milestoneIcon(m.key, m.achieved)}
            {m.label}
            <span className="md">{m.date}</span>
          </div>
        ))}
      </div>

      <div className="pgh-label">EXPORT</div>
      <div className="pgst-row">
        <span className="pgst-k">
          Every note as a folder of markdown, decrypted in this browser
          <br />
          <span className="pgst-help">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'} · leaving the app never means leaving your data
          </span>
        </span>
        <button type="button" className="pgbtn" onClick={exportVault}>
          Export vault
        </button>
      </div>

      <div className="pgh-label">DANGER ZONE</div>
      <div className="pgst-danger">
        <div>
          <b>Forget everything</b>
          <span className="pgst-help">
            {wiping
              ? 'Vault wipe in progress — finishing any open write, then erasing every quilt.'
              : 'Erases every memory in the vault, for one signature. The vault itself stays yours.'}
          </span>
        </div>
        <button type="button" className="pgbtn danger" disabled={wiping} onClick={() => setConfirmWipe(true)}>
          {wiping ? 'Wiping…' : 'Forget everything'}
        </button>
      </div>
        </div>
      </div>

      <ConnectAgentDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        vaultId={ready.vault.vaultId}
        issuedKey={issuedKey}
        onIssued={(key) => setIssuedKeyId(key.id)}
      />
      <Modal open={confirmWipe} onClose={() => setConfirmWipe(false)}>
        <div className="dh">
          <div className="dt">Forget everything?</div>
          <div className="dd2">
            This erases every memory in {ready.vault.name || 'this vault'} — {notes.length}{' '}
            {notes.length === 1 ? 'note' : 'notes'} — in one signed transaction. It cannot be undone.
            The vault stays yours to fill again.
          </div>
        </div>
        <div className="db">
          <div className="wallet-actions">
            <Button variant="quiet" onClick={() => setConfirmWipe(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void runWipe()}>
              Forget everything
            </Button>
          </div>
        </div>
      </Modal>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
