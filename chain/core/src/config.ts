/**
 * Client factories. Browser and Node share this module; the undici
 * connect-timeout fix applies only where undici exists (Node).
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { walrus } from '@mysten/walrus';
import type { ChainConfig } from './types.js';
import generated from './generated/chain.json' with { type: 'json' };

export const chainConfig = generated as ChainConfig;

export type SuiWalrusClient = ReturnType<typeof createSuiClient>;

export function createSuiClient(opts?: { wasmUrl?: string; nodeFetch?: typeof globalThis.fetch }) {
  return new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(chainConfig.network),
    network: chainConfig.network,
  }).$extend(
    walrus({
      ...(opts?.wasmUrl ? { wasmUrl: opts.wasmUrl } : {}),
      uploadRelay: {
        host: chainConfig.uploadRelay,
        sendTip: { max: 1_000 },
      },
      storageNodeClientOptions: {
        timeout: 60_000,
        ...(opts?.nodeFetch ? { fetch: opts.nodeFetch } : {}),
      },
    }),
  );
}

/** Node-only helper: undici agent with a 60s connect timeout (slow storage nodes trip Node's 10s default). */
export async function nodeFetchWithLongConnect(): Promise<typeof globalThis.fetch> {
  const { Agent, fetch: undiciFetch } = await import('undici');
  const dispatcher = new Agent({ connectTimeout: 60_000 });
  return ((url: any, init: any) => undiciFetch(url, { ...init, dispatcher })) as unknown as typeof globalThis.fetch;
}
