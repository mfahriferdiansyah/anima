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
  // Serve the production preview on the dev origin so the backend's exact-match
  // CORS allowlist (ALLOWED_ORIGINS=http://localhost:5173) accepts it — the U2
  // smoke run must hit the real third-party surface, not fail at backend CORS.
  preview: { port: 5173 },
});
