/**
 * DOM-free tests for the frontend covers resolve layer.
 * URL.createObjectURL is unavailable in node — the bytesToObjectUrl test is
 * guarded; the core preset passthrough + dataUrlToBytes are fully testable.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./session', () => ({ getQuiltDeps: vi.fn() }));
vi.mock('../../../chain/core/src/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../chain/core/src/index.js')>()),
  readCoverBytes: vi.fn(),
}));

import { getQuiltDeps } from './session';
import { readCoverBytes } from '../../../chain/core/src/index.js';
import { dataUrlToBytes, resolveCover, COVER_MAX_BYTES } from './covers';

describe('COVER_MAX_BYTES', () => {
  it('is 2 MB', () => {
    expect(COVER_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe('dataUrlToBytes', () => {
  it('decodes a data URL to bytes', () => {
    // 'ABC' base64-encoded: QUJD
    const dataUrl = 'data:image/png;base64,QUJD';
    const bytes = dataUrlToBytes(dataUrl);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes[0]).toBe(65); // 'A'
    expect(bytes[1]).toBe(66); // 'B'
    expect(bytes[2]).toBe(67); // 'C'
  });

  it('throws on a non-data URL', () => {
    expect(() => dataUrlToBytes('/covers/ethos-orbit.svg')).toThrow('not a valid data URL');
  });
});

describe('resolveCover', () => {
  it('returns null for undefined ref', async () => {
    expect(await resolveCover(undefined, 'note-1')).toBeNull();
  });

  it('returns null for empty string ref', async () => {
    expect(await resolveCover('', 'note-1')).toBeNull();
  });

  it('returns preset paths as-is (no fetch)', async () => {
    const result = await resolveCover('/covers/ethos-orbit.svg', 'note-1');
    expect(result).toBe('/covers/ethos-orbit.svg');
    expect(vi.mocked(readCoverBytes)).not.toHaveBeenCalled();
  });

  it('returns null for a seal: ref when no deps are available', async () => {
    vi.mocked(getQuiltDeps).mockReturnValue(null);
    const result = await resolveCover('seal:abc123', 'note-1');
    expect(result).toBeNull();
    expect(vi.mocked(readCoverBytes)).not.toHaveBeenCalled();
  });

  it('fetches + wraps bytes for a seal: ref when deps are available', async () => {
    const fakeDeps = { suiClient: {}, seal: {} } as any;
    vi.mocked(getQuiltDeps).mockReturnValue(fakeDeps);
    const fakeBytes = new Uint8Array([1, 2, 3]);
    vi.mocked(readCoverBytes).mockResolvedValue(fakeBytes);

    // URL.createObjectURL may not exist in node; guard the assertion
    const hasObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
    if (!hasObjectUrl) {
      // can't test the object URL half — at least assert readCoverBytes is called
      try { await resolveCover('seal:abc123', 'note-1'); } catch { /* createObjectURL absent */ }
      expect(vi.mocked(readCoverBytes)).toHaveBeenCalledWith(fakeDeps, 'seal:abc123', 'note-1');
    } else {
      const result = await resolveCover('seal:abc123', 'note-1');
      expect(vi.mocked(readCoverBytes)).toHaveBeenCalledWith(fakeDeps, 'seal:abc123', 'note-1');
      expect(result).toMatch(/^blob:/);
    }
  });
});
