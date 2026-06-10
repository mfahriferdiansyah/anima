/**
 * The browser agent keypair — signs Walrus writes and self-signs Seal sessions
 * silently. Persisted in IndexedDB under a per-client namespace ('anima:' main
 * app, 'alt:' resurrection client) so the two entries behave as independent
 * clients even on one browser profile.
 *
 * Custody note (stated in the README too): the key is extractable by
 * same-origin JS; mitigations are CSP + a minimal third-party surface.
 */
import { get, set, del } from 'idb-keyval';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

export async function loadOrCreateAgentKey(ns: string): Promise<Ed25519Keypair> {
  const stored = await get<string>(`${ns}:agentKey`);
  if (stored) return Ed25519Keypair.fromSecretKey(stored);
  const kp = Ed25519Keypair.generate();
  await set(`${ns}:agentKey`, kp.getSecretKey());
  return kp;
}

export async function peekAgentKey(ns: string): Promise<Ed25519Keypair | null> {
  const stored = await get<string>(`${ns}:agentKey`);
  return stored ? Ed25519Keypair.fromSecretKey(stored) : null;
}

export async function clearAgentKey(ns: string): Promise<void> {
  await del(`${ns}:agentKey`);
}
