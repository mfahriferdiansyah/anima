/** U5 scaffold — U9 wires cold-start discovery, pairing, rebuild spinner, and chat. */
import { ConnectButton } from '@mysten/dapp-kit';

export function AltApp() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 p-6" style={{ ['--color-soul-violet' as any]: '#f59e0b', ['--color-soul-cyan' as any]: '#ef4444' }}>
      <div className="orb" style={{ width: 56, height: 56 }} />
      <h1 style={{ fontSize: '1.6rem', fontWeight: 650 }}>echo</h1>
      <p className="text-fg-muted max-w-sm text-center">
        A different body. If your soul is out there, connecting your wallet will bring it back.
      </p>
      <ConnectButton />
      <p className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>resurrection flow lands in U9</p>
    </div>
  );
}
