import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Static export: the search index is computed at build time and downloaded by
// the browser, not served by a live API route. `staticGET` pre-renders the
// index to a static file; the client uses the static Orama client (set in
// app/layout.tsx via RootProvider search options type: 'static').
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
