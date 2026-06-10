/**
 * Backend auth: wallet signs a one-time nonce (personal message) → JWT.
 * The JWT protects the OpenRouter budget; it grants nothing over the vault.
 */
import { get, set } from 'idb-keyval';

export const BACKEND_URL: string = (import.meta as any).env?.VITE_BACKEND_URL ?? 'http://localhost:8080';

interface StoredJwt {
  token: string;
  address: string;
  exp: number;
}

export async function getJwt(ns: string, address: string): Promise<string | null> {
  const stored = await get<StoredJwt>(`${ns}:jwt`);
  if (stored && stored.address === address && stored.exp * 1000 > Date.now() + 60_000) return stored.token;
  return null;
}

export async function authenticate(
  ns: string,
  address: string,
  signPersonalMessage: (msg: Uint8Array) => Promise<{ signature: string }>,
): Promise<string> {
  const cached = await getJwt(ns, address);
  if (cached) return cached;

  const nonceRes = await fetch(`${BACKEND_URL}/auth/nonce`);
  const { nonce } = await nonceRes.json();
  const { signature } = await signPersonalMessage(new TextEncoder().encode(nonce));
  const verifyRes = await fetch(`${BACKEND_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, nonce, signature }),
  });
  if (!verifyRes.ok) throw new Error(`auth failed: ${await verifyRes.text()}`);
  const { token, exp } = await verifyRes.json();
  await set(`${ns}:jwt`, { token, address, exp: exp ?? Math.floor(Date.now() / 1000) + 23 * 3600 } satisfies StoredJwt);
  return token;
}
