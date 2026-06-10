import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './app/providers.js';
import App from './App.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>,
);
