/**
 * Freeze the current demo vault into a landing-owned snapshot.
 *
 * The landing's live previews must keep their exact look even when the app seed
 * (src/mocks/fixture, src/mocks/seed) changes or is removed for the backend. So
 * we snapshot makeVault() once into src/pages/landingSeed.ts, and the landing
 * imports that frozen copy instead of the live seed.
 *
 * Run from anima/frontend:  npx tsx scripts/gen-landing-seed.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeVault } from '../src/mocks/fixture';

const notes = makeVault();
const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '../src/pages/landingSeed.ts');

const header = `// AUTO-GENERATED — do not edit by hand. Regenerate with:
//   npx tsx scripts/gen-landing-seed.ts
// A frozen snapshot of the demo vault, owned by the landing so its live previews
// keep their exact look even when the app seed (mocks/fixture, mocks/seed)
// changes or moves to the backend. The landing imports this, never makeVault().
import type { Note } from '@/mocks/fixture';

export const LANDING_NOTES: Note[] = `;

writeFileSync(outPath, `${header}${JSON.stringify(notes, null, 2)};\n`);
console.log(`wrote ${outPath} — ${notes.length} notes`);
