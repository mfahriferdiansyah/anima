/**
 * Views were intentionally removed — the brand kit builds them
 * (see docs/frontend-handoff.md). The integration layer (src/lib, the use*
 * hooks, providers) is kept, compiled, and tested; the full working reference
 * UI is one command away: `git checkout reference-frontend -- frontend/src`.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './app/providers.js';
import './theme/tokens.css';

function Placeholder() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ textAlign: 'center', opacity: 0.7 }}>
        <h1 style={{ fontWeight: 650 }}>anima</h1>
        <p>frontend is being rebuilt with the brand kit — integration layer ready (docs/frontend-handoff.md)</p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <Placeholder />
    </Providers>
  </React.StrictMode>,
);
