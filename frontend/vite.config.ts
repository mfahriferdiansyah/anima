import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

// Frontend lives in a subdir of a single-package repo: deps resolve from the
// repo-root node_modules; @core aliases the shared chain library source.
export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../chain/core/src'),
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    fs: { allow: [resolve(__dirname, '..')] },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      // brand kit re-adds entries: alt.html (echo) + read.html (public reader)
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
