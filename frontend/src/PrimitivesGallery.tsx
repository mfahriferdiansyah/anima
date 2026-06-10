import { useState } from 'react';
import { BRAND_NAME } from '@/brand';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { InkPanel } from '@/components/InkPanel';
import { Modal } from '@/components/Modal';
import { Orb } from '@/components/Orb';
import { Pill } from '@/components/Pill';
import { Switch } from '@/components/Switch';
import { Toast } from '@/components/Toast';
import { ToastStack } from '@/components/ToastStack';
import type { ToastItem } from '@/components/ToastStack';
import { WriteStateCard } from '@/components/WriteStateCard';
import './PrimitivesGallery.css';

/** TEMPORARY page: every primitive in every state, for screenshot review against the kit. U3 replaces it with the router App. */
export function PrimitivesGallery() {
  const [boardName, setBoardName] = useState('trip-notes');
  const [email, setEmail] = useState('');
  const [linkView, setLinkView] = useState(true);
  const [agentsJoin, setAgentsJoin] = useState(true);
  const [watermark, setWatermark] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [failedRetried, setFailedRetried] = useState(false);

  const dismissToast = (id: string) => setToasts((current) => current.filter((t) => t.id !== id));
  const pushToast = (item: Omit<ToastItem, 'id'>) =>
    setToasts((current) => [...current, { ...item, id: `${Date.now()}-${Math.random()}` }]);

  return (
    <main className="gallery">
      <section className="comp">
        <div className="wrap">
          <span className="num"><b>U1</b>{BRAND_NAME} primitives</span>
          <h2 className="kt">Every primitive, every state</h2>
          <p className="kd">
            Temporary review page for the U1 foundation. Each block below is the React wrapper over
            the kit classes; compare against anima-components.html side by side.
          </p>
        </div>
      </section>

      <section className="comp band">
        <div className="wrap">
          <span className="num"><b>01</b>Buttons</span>
          <div className="stage" style={{ marginTop: 24 }}>
            <div className="row">
              <Button variant="primary">Save board</Button>
              <Button variant="accent">Share <span aria-hidden="true">✦</span></Button>
              <Button variant="ink">Publish</Button>
              <Button>Duplicate</Button>
              <Button variant="quiet">Cancel</Button>
              <Button variant="danger">Delete board</Button>
              <Button variant="primary" disabled>Saving…</Button>
            </div>
            <div className="subhead">Sizes</div>
            <div className="row">
              <Button variant="primary" size="sm">Small</Button>
              <Button variant="primary">Default</Button>
              <Button variant="primary" size="lg">Large</Button>
            </div>
          </div>
        </div>
      </section>

      <section className="comp">
        <div className="wrap">
          <span className="num"><b>02</b>Forms</span>
          <div className="stage" style={{ marginTop: 24 }}>
            <div className="row" style={{ alignItems: 'flex-start', gap: 28 }}>
              <div style={{ minWidth: 280 }}>
                <Field
                  label="Board name"
                  mono
                  value={boardName}
                  spellCheck={false}
                  onChange={(e) => setBoardName(e.target.value)}
                  help="Becomes your link: anima.app/c/trip-notes"
                />
                <div style={{ marginTop: 12 }}>
                  <Field
                    label="Invite by email"
                    placeholder="teammate@studio.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div style={{ marginTop: 12 }}>
                  <Field
                    label="Board name"
                    mono
                    value="trip notes!!"
                    readOnly
                    error="Lowercase letters, numbers, and dashes only."
                  />
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 280 }}>
                <div className="subhead" style={{ marginTop: 0 }}>Toggles · settings rows</div>
                <Switch row label="Anyone with the link can view" checked={linkView} onChange={setLinkView} />
                <Switch row label="Agents can join this board" checked={agentsJoin} onChange={setAgentsJoin} />
                <Switch row label="Watermark on exports" checked={watermark} onChange={setWatermark} />
                <div className="subhead">Inline switch</div>
                <Switch label="Compact density" checked={watermark} onChange={setWatermark} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="comp band">
        <div className="wrap">
          <span className="num"><b>03</b>Pills</span>
          <div className="stage" style={{ marginTop: 24 }}>
            <div className="row">
              <Pill glyph="✦" glyphColor="teal">verified on Walrus</Pill>
              <Pill glyph="✧" glyphColor="orange">scout · agent</Pill>
              <Pill glyph="✦" glyphColor="blue">syncing</Pill>
              <Pill glyph="✦" glyphColor="pink">kadzu editing</Pill>
              <Pill glyph="✕" glyphColor="red">seal failed</Pill>
              <Pill>rev 34</Pill>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <span className="tagpill">growth surface</span>
              <span className="count-pill">3 people · 2 agents</span>
            </div>
          </div>
        </div>
      </section>

      <section className="comp">
        <div className="wrap">
          <span className="num"><b>04</b>Toasts</span>
          <div className="stage" style={{ marginTop: 24 }}>
            <div className="row" style={{ marginBottom: 22 }}>
              <Button
                variant="primary"
                size="sm"
                onClick={() => pushToast({ variant: 'success', title: 'Board saved', detail: 'rev 35 · sealed' })}
              >
                Success toast
              </Button>
              <Button
                size="sm"
                onClick={() => pushToast({ variant: 'info', title: 'Syncing', detail: '3 notes queued' })}
              >
                Info toast
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() =>
                  pushToast({
                    variant: 'error',
                    title: 'Connection lost',
                    detail: 'saved locally, retrying',
                    action: { label: 'Retry now', onClick: () => setToasts([]) },
                  })
                }
              >
                Error toast
              </Button>
            </div>
            <div className="row" style={{ alignItems: 'stretch' }}>
              <Toast variant="success" title="Board saved" detail="rev 35 · sealed" />
              <Toast
                variant="error"
                title="Connection lost"
                detail="saved locally, retrying"
                action={{ label: 'Retry now', onClick: () => undefined }}
              />
              <Toast variant="info" title="Syncing" detail="3 notes queued" />
            </div>
          </div>
        </div>
      </section>

      <section className="comp band">
        <div className="wrap">
          <span className="num"><b>05</b>Write states</span>
          <div className="stage" style={{ marginTop: 24 }}>
            <div className="row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <WriteStateCard state={{ phase: 'encrypting' }} noteTitle="sparkle-saturation" />
              <WriteStateCard state={{ phase: 'certifying' }} noteTitle="sparkle-saturation" />
              <WriteStateCard
                state={{
                  phase: 'certified',
                  blobObjectId: '0x7fA3c41b09e2d8f6a5c91C',
                  provenanceUrl: 'https://suiscan.xyz/testnet/object/0x7fA3',
                }}
                noteTitle="sparkle-saturation"
              />
              {failedRetried ? (
                <WriteStateCard
                  state={{
                    phase: 'certified',
                    blobObjectId: '0x9bD201aa4f7e3c885B10',
                    provenanceUrl: 'https://suiscan.xyz/testnet/object/0x9bD2',
                  }}
                  noteTitle="cursor-gap"
                />
              ) : (
                <WriteStateCard
                  state={{ phase: 'failed' }}
                  noteTitle="cursor-gap"
                  onRetry={() => setFailedRetried(true)}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="comp">
        <div className="wrap">
          <span className="num"><b>06</b>Modal</span>
          <div className="stage" style={{ marginTop: 24 }}>
            <div className="row">
              <Button variant="primary" onClick={() => setModalOpen(true)}>Open modal</Button>
            </div>
          </div>
        </div>
      </section>

      <section className="comp band">
        <div className="wrap">
          <span className="num"><b>07</b>Ink panel</span>
          <div className="stage" style={{ marginTop: 24 }}>
            <InkPanel label="Custody receipt">
              <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                <span className="lead">Wallet-owned.</span> Every memory blob lives in your wallet,
                sealed before it leaves the browser. The <span className="glyph">✦</span> fires only
                when something real happens.
              </p>
              <div className="inner" style={{ marginTop: 12 }}>blob 0x7fA3…e91C · rev 35 · sealed</div>
            </InkPanel>
          </div>
        </div>
      </section>

      <section className="comp">
        <div className="wrap">
          <span className="num"><b>08</b>Orb · the living element</span>
          <div className="stage" style={{ marginTop: 24 }}>
            <div className="subhead" style={{ marginTop: 0 }}>Sizes · idle breathing</div>
            <div className="row" style={{ gap: 28 }}>
              <Orb size="sm" />
              <Orb size="md" />
              <Orb size="lg" />
            </div>
            <div className="subhead">States</div>
            <div className="row" style={{ gap: 28 }}>
              <Orb size="md" working label="Companion is working" />
              <Orb size="md" badge label="Companion finished something" />
              <Orb size="md" working badge />
            </div>
            <div className="subhead">Spinner</div>
            <div className="row">
              <span className="spin" aria-label="Loading">✦</span>
            </div>
          </div>
        </div>
      </section>

      <footer className="gallery-footer">
        <div className="wrap">
          <p style={{ fontSize: 13, color: 'var(--gray-600)' }}>
            {BRAND_NAME} · U1 primitives review page · replaced by the app shell in U3
          </p>
        </div>
      </footer>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <div className="dh">
          <div className="dt">Publish this note</div>
          <div className="dd2">Anyone with the link can read it. Unpublish any time from settings.</div>
        </div>
        <div className="db">
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="quiet" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setModalOpen(false)}>Publish</Button>
          </div>
        </div>
      </Modal>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
