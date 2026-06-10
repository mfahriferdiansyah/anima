import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { InkPanel } from '@/components/InkPanel';
import { Modal } from '@/components/Modal';
import { Pill } from '@/components/Pill';
import { ToastStack } from '@/components/ToastStack';
import type { ToastItem } from '@/components/ToastStack';
import type { ToastVariant } from '@/components/Toast';
import { dismissLowBalance } from '@/hooks/useChat';
import {
  connectExternalAgent,
  regenerateAgentSecret,
  revokeKey,
  useSettings,
} from '@/hooks/useSettings';
import type { KeyEntry } from '@/hooks/useSettings';
import { useVault } from '@/hooks/useVault';
import { renameCompanion, useVaultSession } from '@/hooks/useVaultSession';
import { confirmWithWallet } from '@/hooks/useWallet';
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
          <rect width="20" height="14" x="2" y="3" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
        </>
      ) : (
        <>
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path d="M15 13v2" />
          <path d="M9 13v2" />
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
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(issuedKey ? 'issued' : 'generate');
    setAgentName('');
    setSecret('');
    setCopied(null);
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

  const generate = () => {
    const issued = connectExternalAgent(agentName);
    onIssued(issued.key);
    setSecret(issued.secret);
    setStep('secret');
  };

  const regenerate = async () => {
    if (!issuedKey) return;
    const approved = await confirmWithWallet('regenerate agent key');
    if (!approved) return;
    const next = regenerateAgentSecret(issuedKey.id);
    if (!next) return;
    setSecret(next);
    setCopied(null);
    setStep('secret');
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
            <div className="wallet-actions">
              <Button variant="quiet" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={generate}>
                Generate key
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
                <div className="as">secret already issued, regenerate to replace it</div>
              </div>
            </div>
            <div className="wallet-actions">
              <Button variant="quiet" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="danger" onClick={regenerate}>
                Regenerate
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
    <div className="accessrow">
      <div className="keymeta">
        <KeyIcon kind={entry.kind} />
        <div>
          <div className="al">
            {entry.label}
            {entry.thisDevice ? (
              <Pill glyph="✦" glyphColor="blue">
                this device
              </Pill>
            ) : null}
          </div>
          <div className="as">
            <span className="mono" title={entry.address}>
              {shortAddress(entry.address)}
            </span>
            {' '}· added {entry.addedAt.slice(0, 10)}
          </div>
        </div>
      </div>
      {entry.thisDevice ? (
        <span title="you cannot revoke the key you are using">
          <Button variant="quiet" size="sm" className="unpub" disabled>
            Revoke
          </Button>
        </span>
      ) : (
        <Button variant="quiet" size="sm" className="unpub" onClick={() => onRevoke(entry)}>
          Revoke
        </Button>
      )}
    </div>
  );
}

/**
 * Standing state (R15/R16): identity, keys, balances, export, danger zone.
 * The wallet appears for destructive actions only: revoke, regenerate,
 * forget everything. Renaming the companion is routine, so it never signs.
 */
export function Settings() {
  const session = useVaultSession();
  const settings = useSettings();
  const { notes } = useVault();
  const ready = session.phase === 'ready' ? session : null;

  const [name, setName] = useState(ready?.vault.name ?? '');
  const [connectOpen, setConnectOpen] = useState(false);
  const [issuedKeyId, setIssuedKeyId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastCounter = useRef(0);

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
    const approved = await confirmWithWallet(`revoke ${entry.label}`);
    if (!approved) return;
    revokeKey(entry.id);
    pushToast('success', 'Key revoked', entry.label);
  };

  const topUp = () => {
    dismissLowBalance();
    pushToast('success', 'Top up requested');
  };

  const exportVault = () => {
    const payload = {
      vaultId: ready.vault.vaultId,
      owner: ready.vault.owner,
      companion: ready.agent.name,
      exportedAt: new Date().toISOString(),
      notes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'anima-vault-export.json';
    anchor.click();
    URL.revokeObjectURL(url);
    pushToast('success', 'Vault exported', 'anima-vault-export.json');
  };

  const forgetEverything = async () => {
    const approved = await confirmWithWallet('forget the entire vault');
    if (!approved) return;
    pushToast('info', 'Not in the demo', 'forgetting everything is disabled in the mocked build');
  };

  const issuedKey = settings.keys.find((entry) => entry.id === issuedKeyId) ?? null;
  const walLow = settings.balances.wal < WAL_LOW_THRESHOLD;

  return (
    <section className="settings">
      <h1 className="page-title">Settings</h1>

      <div className="subhead">Companion identity</div>
      <div className="identityrow">
        <Field
          label="Companion name"
          help="renaming is routine, no signature needed"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button variant="primary" size="sm" onClick={saveName} disabled={!name.trim()}>
          Save
        </Button>
      </div>

      <div className="subhead">Agents and devices</div>
      <div className="keylist">
        {settings.keys.map((entry) => (
          <KeyRow key={entry.id} entry={entry} onRevoke={revoke} />
        ))}
      </div>
      <div className="connectrow">
        <Button onClick={() => setConnectOpen(true)}>Connect external agent</Button>
      </div>

      <div className="subhead">Balances</div>
      <div className="setrow">
        <span className="sl">SUI · pays for transactions</span>
        <span className="mono balval">{settings.balances.sui.toFixed(2)} SUI</span>
      </div>
      <div className="setrow">
        <span className="sl">
          WAL · pays for storage
          {walLow ? (
            <span className="ballow">
              <span className="balglyph" aria-hidden="true">✧</span>
              running low
            </span>
          ) : null}
        </span>
        <span className="balside">
          <span className="mono balval">{settings.balances.wal.toFixed(2)} WAL</span>
          {walLow ? (
            <Button variant="primary" size="sm" onClick={topUp}>
              Top up
            </Button>
          ) : null}
        </span>
      </div>

      <div className="subhead">Export</div>
      <div className="setrow">
        <span className="sl">
          Every note as plain JSON, decrypted in this browser
          <span className="setsub">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'} · leaving the app never means leaving your data
          </span>
        </span>
        <Button size="sm" onClick={exportVault}>
          Export vault
        </Button>
      </div>

      <div className="subhead">Danger zone</div>
      <div className="dangercard">
        <div>
          <div className="al">Forget everything</div>
          <div className="as">Erases every memory in the vault, for a signature. Disabled in the mocked build.</div>
        </div>
        <Button variant="quiet" size="sm" className="unpub" onClick={forgetEverything}>
          Forget everything
        </Button>
      </div>

      <ConnectAgentDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        vaultId={ready.vault.vaultId}
        issuedKey={issuedKey}
        onIssued={(key) => setIssuedKeyId(key.id)}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </section>
  );
}
