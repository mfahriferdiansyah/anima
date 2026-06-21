/**
 * The session hook (plan U3). Reads the real six-phase `SessionState` from the
 * `web3/session` engine and wires the wallet/chain primitives the engine can't
 * reach on its own: the connected dapp-kit account, this device's agent keypair,
 * and the wallet-execute adapter. On account change it (re)configures the engine
 * and kicks off discovery; on disconnect it tears down. The engine's `generation`
 * guard makes an account switch mid-rebuild drop the stale (wrong-account) index.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useWalletExecTx } from '../web3/walletExecTx';
import { agentAddress, getOrCreateAgentKey } from '../web3/agentKey';
import { configureSession, disconnect, sessionStore, startSession } from '../web3/session';
import type { SessionState } from '../web3/session';

export function useVaultSession(): SessionState {
  const account = useCurrentAccount();
  const { execTx } = useWalletExecTx();
  const state = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot);

  // useWalletExecTx returns a fresh execTx each render; keep the latest in a ref
  // so the account-change effect can hand the engine a STABLE wrapper that always
  // calls the current one (re-running the effect every render would thrash discovery).
  const execRef = useRef(execTx);
  execRef.current = execTx;

  useEffect(() => {
    let cancelled = false;
    if (!account) {
      disconnect();
      return;
    }
    void (async () => {
      const kp = await getOrCreateAgentKey(account.address);
      if (cancelled) return;
      configureSession({
        owner: account.address,
        agentSigner: kp,
        agentAddress: agentAddress(kp),
        execTx: (tx) => execRef.current(tx),
      });
      void startSession();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- execTx is read via execRef; rerun only on account change
  }, [account?.address]);

  return state;
}

export {
  startSession,
  completeOnboarding,
  pair,
  rejectSignature,
  closeBeforeSign,
  rejectPairing,
  retryRebuild,
  renameCompanion,
  disconnect,
} from '@/web3/session';
export type { SessionState, VaultInfo, AgentInfo, OnboardingStep } from '@/web3/session';
