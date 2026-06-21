/**
 * Chromeless reader entry (plan 008 U3) — a SEPARATE Vite bundle from the app.
 *
 * It mounts only `ReaderView` (no `AnimaProviders`, no app shell, no sidebar) so
 * the VIEW read path's static import graph stays free of `@mysten/*` (KTD6). The
 * edit-multiplayer view is loaded behind a dynamic import inside `ReaderView`, so
 * whatever it drags in lands in a separate async chunk, never the read chunk.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReaderView } from './ReaderView';
import './reader.css';

createRoot(document.getElementById('reader-root')!).render(
  <StrictMode>
    <ReaderView />
  </StrictMode>,
);
