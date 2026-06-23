/**
 * AppGate's pure decision core (node-tested, no React/dapp-kit — mirrors the
 * shape of session's `deriveStartPhase`).
 *
 * The /app gate redirects to the landing when the wallet is gone, but on a hard
 * refresh dapp-kit reconnects the wallet ASYNCHRONOUSLY, so a null account is
 * not yet a real disconnect:
 *  - renders 1–2: `account` is null while `autoConnect` is still `'idle'`;
 *  - render 3: autoConnect hands us the account, but `session.phase` still reads
 *    `'disconnected'` for one more render — the phase only advances inside
 *    `useVaultSession`'s effect, which runs a commit later.
 * Both are the spin-up window, not a disconnect. Bouncing then would replace the
 * current URL (`/app/notes/…` → `/`) and strand the user on the landing even
 * though autoConnect silently reconnected them. So within the `'disconnected'`
 * phase we hold on the checking surface whenever an account already exists OR
 * autoConnect has not settled; only a settled autoConnect (`'attempted'` /
 * `'disabled'`) with no account is a true disconnect → landing.
 */

/** dapp-kit's `useAutoConnectWallet` lifecycle. */
export type AutoConnectStatus = 'disabled' | 'idle' | 'attempted';

/**
 * Within the `'disconnected'` phase, decide whether this is the async-reconnect
 * spin-up window (`'checking'` — hold the route) or a real disconnect
 * (`'landing'` — bounce).
 */
export function disconnectedGate(
  hasAccount: boolean,
  autoConnect: AutoConnectStatus,
): 'checking' | 'landing' {
  if (hasAccount || autoConnect === 'idle') return 'checking';
  return 'landing';
}
