/**
 * The wallet→JWT auth handshake (plan U3, R9). `nonce → signPersonalMessage →
 * verify → JWT`, with the token held in memory keyed by owner address and
 * silent re-auth on a 401. The pure `runAuthHandshake` mirrors the auth steps
 * of scripts/e2e-chat.ts but takes injected deps so it is node-testable without
 * a DOM; `useAuth` is the thin dapp-kit wiring on top.
 *
 * StrictMode/concurrency guard: React Query dedupes *queries* but not the
 * *mutations* that drive signing, so a second `ensureJwt()` for the same owner
 * joins a single shared in-flight handshake rather than firing a second wallet
 * signature. The nonce is signed as a personal message over its raw bytes,
 * exactly as the backend's stateless (60s) ed25519-only verify expects.
 */
import { useSignPersonalMessage, useCurrentAccount } from '@mysten/dapp-kit';

export interface AuthDeps {
  backendUrl: string;
  address: string;
  signPersonalMessage: (msg: Uint8Array) => Promise<{ signature: string }>;
  /** Injectable for unit tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * The pure handshake: GET nonce → sign its raw bytes → POST verify → token.
 * Throws a clear, service-named error on any failed leg so the caller can
 * surface it instead of failing silently.
 */
export async function runAuthHandshake(deps: AuthDeps): Promise<string> {
  const f = deps.fetchImpl ?? fetch;

  const nonceRes = await f(`${deps.backendUrl}/auth/nonce`);
  if (!nonceRes.ok) throw new Error(`auth/nonce rejected: HTTP ${nonceRes.status}`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };

  const { signature } = await deps.signPersonalMessage(new TextEncoder().encode(nonce));

  const verifyRes = await f(`${deps.backendUrl}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: deps.address, nonce, signature }),
  });
  if (!verifyRes.ok) throw new Error(`auth/verify rejected: HTTP ${verifyRes.status}`);
  const { token } = (await verifyRes.json()) as { token: string };
  if (!token) throw new Error('auth/verify returned no token');
  return token;
}

// In-memory JWT cache + in-flight handshakes, both keyed by owner address.
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

/**
 * Returns the cached JWT for the address, or runs the handshake — sharing a
 * single in-flight promise so StrictMode double-mounts and concurrent callers
 * do NOT trigger a second signature. The in-flight entry is registered
 * synchronously (before the first await) and cleared on both success and
 * failure so a rejected handshake can be retried.
 */
export function ensureJwt(deps: AuthDeps): Promise<string> {
  const cached = cache.get(deps.address);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(deps.address);
  if (existing) return existing;

  const handshake = (async () => {
    try {
      const token = await runAuthHandshake(deps);
      cache.set(deps.address, token);
      return token;
    } finally {
      inFlight.delete(deps.address);
    }
  })();
  inFlight.set(deps.address, handshake);
  return handshake;
}

/** The cached JWT for the address, or null if none is held. */
export function getJwt(address: string): string | null {
  return cache.get(address) ?? null;
}

/** Drops the cached JWT so the next protected call (e.g. after a 401) re-auths. */
export function clearJwt(address: string): void {
  cache.delete(address);
}

/** Test-only: clears the in-memory caches (mirrors the mock stores' reset pattern). */
export function __resetAuthForTests(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * Thin dapp-kit wiring: signs with the connected wallet and ensures a JWT for
 * its address. Not unit-tested — the testable logic is in `ensureJwt`.
 */
export function useAuth() {
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const account = useCurrentAccount();
  const backendUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080';

  return {
    account,
    /** Ensures a JWT for the connected wallet; throws if no wallet is connected. */
    ensureJwt(): Promise<string> {
      if (!account) throw new Error('no wallet connected');
      return ensureJwt({
        backendUrl,
        address: account.address,
        signPersonalMessage: (msg) =>
          signPersonalMessage({ message: msg }).then(({ signature }) => ({ signature })),
      });
    },
  };
}
