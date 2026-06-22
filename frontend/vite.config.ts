import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      // Two entries: the app shell + the chromeless reader. `read.html` is a
      // separate input so its VIEW read chunk has its own static graph, which
      // (by construction) excludes `@mysten/*` — the multiplayer editor is behind a
      // dynamic import so the wallet stack it pulls lands in a separate async chunk.
      // The filename must stay `read.html`: share links resolve to `/read.html`
      // (see chain/core/src/share-crypto.ts and web3/share.ts).
      input: {
        main: path.resolve(__dirname, 'index.html'),
        reader: path.resolve(__dirname, 'read.html'),
      },
    },
  },
  // Serve the production preview on the dev origin so the backend's exact-match
  // CORS allowlist (ALLOWED_ORIGINS=http://localhost:5173) accepts it — the U2
  // smoke run must hit the real third-party surface, not fail at backend CORS.
  preview: { port: 5173 },
});
