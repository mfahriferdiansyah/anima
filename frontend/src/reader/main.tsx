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
// The app's design system (tokens, .btn, .field, typography). Pure CSS, so the
// reader inherits the real Anima look without importing any `@mysten`/wallet JS
// (KTD6 is about the JS graph, not styles). reader.css layers the reader frame on
// top, so it must load AFTER the kit.
import '../theme/kit.css';
import './reader.css';

createRoot(document.getElementById('reader-root')!).render(
  <StrictMode>
    <ReaderView />
  </StrictMode>,
);
