import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/theme/kit.css';
import { BRAND_NAME } from '@/brand';
import { App } from '@/app/App';
import { AnimaProviders } from '@/web3/AnimaProviders';
// imported after App so the responsive layer wins over shell/page CSS
import '@/theme/responsive.css';
import { failNextWrite } from '@/mocks/vaultStore';
import { failNextRebuild } from '@/mocks/sessionStore';
import { triggerLowBalance } from '@/mocks/chatStore';

document.title = BRAND_NAME;

// dev switches for the mocked build's failure-path walkthroughs
declare global {
  interface Window {
    __anima?: {
      failNextWrite: () => void;
      failNextRebuild: () => void;
      triggerLowBalance: () => void;
      /** Dev/smoke-only (U2): the browser smoke probe. Excluded from production builds. */
      runSmoke?: (opts: { agentSecret: string; ownerAddress: string }) => Promise<unknown>;
    };
  }
}
window.__anima = { failNextWrite, failNextRebuild, triggerLowBalance };

// U2 smoke harness — mode-gated. In a production build MODE==='production', so
// this whole block is dead code and browserSmoke (+ the wasm singleton + the
// runtime key path) never enter the prod bundle. To run the live gate:
//   `vite build --mode smoke && vite preview`, then in the browser console:
//   await window.__anima.runSmoke({ agentSecret: 'suiprivkey1…', ownerAddress: '0x41af…' })
if (import.meta.env.DEV || import.meta.env.MODE === 'smoke') {
  void import('@/web3/browserSmoke').then(({ runBrowserSmoke }) => {
    window.__anima!.runSmoke = (opts) =>
      runBrowserSmoke({
        backendUrl: import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080',
        ...opts,
      }).then((result) => {
        console.table(result.steps);
        console.log(result.ok ? '✅ smoke passed' : `❌ smoke failed at: ${result.failedService}`);
        return result;
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnimaProviders>
      <App />
    </AnimaProviders>
  </StrictMode>,
);
