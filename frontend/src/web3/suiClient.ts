/**
 * The one walrus-extended SuiClient for the browser. dapp-kit's own client
 * (wired in AnimaProviders) handles wallet connect, RPC queries, and tx
 * execution; THIS singleton is what Seal/Walrus code imports directly, so the
 * `.walrus` extension stays fully typed (dapp-kit's `useSuiClient()` is typed
 * as the plain client and would need casts). Split-client decision — see
 * docs/plans/2026-06-21-004-feat-web3-foundation-plan.md (U1).
 */
import { createSuiClient } from '../../../chain/core/src/index.js';
// Vite serves the wasm asset URL via `?url`; passing it to createSuiClient is
// MANDATORY in-browser — omitting it makes the walrus SDK fail silently on the
// first encode/decode (deep inside writeTurn/readOneQuilt), not at startup.
import walrusWasmUrl from '@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url';

type SuiWalrusClient = ReturnType<typeof createSuiClient>;

let client: SuiWalrusClient | null = null;

/**
 * Memoized; created on first use so importing this module has no side effects.
 * Browser path: pass `wasmUrl`, omit `nodeFetch` (the undici connect-timeout
 * fix is Node-only; browser fetch handles timeouts).
 */
export function getSuiClient(): SuiWalrusClient {
  if (!client) client = createSuiClient({ wasmUrl: walrusWasmUrl });
  return client;
}

/** The resolved wasm asset URL — exported so unit/smoke checks can assert it is wired. */
export const WALRUS_WASM_URL = walrusWasmUrl;
