/**
 * "echo" — the resurrection client (U9 wires the full flow). Deliberately a
 * different body: different name, different accent. Same soul: it reads the
 * same vault, with its own agent key under the 'alt:' namespace.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './app/providers.js';
import { AltApp } from './alt-client/AltApp.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <AltApp />
    </Providers>
  </React.StrictMode>,
);
