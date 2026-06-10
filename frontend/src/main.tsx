import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/theme/tokens.css';
import '@/theme/base.css';
import '@/theme/components.css';
import { BRAND_NAME } from '@/brand';
import { App } from '@/app/App';
import { failNextWrite } from '@/mocks/vaultStore';
import { failNextRebuild } from '@/mocks/sessionStore';
import { triggerLowBalance } from '@/mocks/chatStore';

document.title = BRAND_NAME;

// dev switches for the mocked build's failure-path walkthroughs
declare global {
  interface Window {
    __anima?: { failNextWrite: () => void; failNextRebuild: () => void; triggerLowBalance: () => void };
  }
}
window.__anima = { failNextWrite, failNextRebuild, triggerLowBalance };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
