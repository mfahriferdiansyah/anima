/**
 * Frontend resolve layer for note covers. Converts refs (preset paths, blob/seal
 * Walrus references) into renderable URLs. Preset paths are returned as-is;
 * blob/seal refs are fetched + decrypted and turned into object URLs.
 */
import { parseCoverRef, readCoverBytes } from '../../../chain/core/src/index.js';
import { getQuiltDeps } from './session';

/** Re-exported so the editor can synchronously classify a ref (preset vs blob/seal). */
export { parseCoverRef };

/** Maximum allowed cover upload size (2 MB). Enforced client-side before upload. */
export const COVER_MAX_BYTES = 2 * 1024 * 1024;

/** Convert a data URL (from FileReader / canvas) to raw bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('dataUrlToBytes: not a valid data URL');
  const b64 = dataUrl.slice(comma + 1);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Wrap raw image bytes in a browser object URL (caller must revoke when done). */
export function bytesToObjectUrl(bytes: Uint8Array, mime = 'image/png'): string {
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
}

/**
 * Resolve a cover ref to a renderable URL:
 * - undefined / empty → null
 * - preset path → returned as-is (directly usable as <img src>)
 * - seal:/blob: ref → fetched + decrypted → object URL (caller owns revoke)
 */
export async function resolveCover(ref: string | undefined, noteId: string): Promise<string | null> {
  if (!ref) return null;
  const parsed = parseCoverRef(ref);
  if (parsed.kind === 'preset') return ref;

  const deps = getQuiltDeps();
  if (!deps) return null;

  const bytes = await readCoverBytes(deps, ref, noteId);
  return bytesToObjectUrl(bytes);
}
