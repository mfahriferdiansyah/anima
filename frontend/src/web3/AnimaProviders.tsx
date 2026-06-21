/**
 * The web3 provider tree mounted around <App/> in main.tsx. dapp-kit only
 * needs a PLAIN client (wallet connect, RPC queries, tx execution); the
 * walrus-extended client lives in suiClient.ts as a singleton (split-client,
 * plan U1). Provider order is fixed: QueryClient ▸ SuiClient ▸ Wallet —
 * WalletProvider reads the SuiClient context internally.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuiClientProvider, WalletProvider, createNetworkConfig } from '@mysten/dapp-kit';
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import '@mysten/dapp-kit/dist/index.css';

const queryClient = new QueryClient();

const { networkConfig } = createNetworkConfig({
  testnet: { url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' },
});

export function AnimaProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <WalletProvider autoConnect>{children}</WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
