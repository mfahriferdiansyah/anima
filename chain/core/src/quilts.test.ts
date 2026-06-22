import { describe, expect, it, vi } from 'vitest';
import { installAggregatorReads } from './quilts.js';

/**
 * The browser read path: blob bytes must come from the aggregator (one HTTP GET),
 * NOT the SDK's direct storage-node sliver fan-out (which CORS-fails in-browser and
 * floods the network with canceled requests). These cover the two overrides without
 * needing the wasm-backed real client.
 */
describe('installAggregatorReads', () => {
  function bytesResponse(bytes: Uint8Array): Response {
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer } as unknown as Response;
  }

  it('routes readBlob to {aggregator}/v1/blobs/{blobId} and returns the bytes', async () => {
    const fetchImpl = vi.fn(async () => bytesResponse(new Uint8Array([1, 2, 3])));
    const walrus: any = { getBlob: async () => ({ asFile: () => ({ bytes: async () => new Uint8Array() }) }) };

    installAggregatorReads(walrus, 'https://agg.example', fetchImpl as unknown as typeof fetch);
    const out = await walrus.readBlob({ blobId: 'AbC-123' });

    expect(fetchImpl).toHaveBeenCalledWith('https://agg.example/v1/blobs/AbC-123');
    expect(out).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('url-encodes the blobId (base64url ids can contain / and +)', async () => {
    const fetchImpl = vi.fn(async () => bytesResponse(new Uint8Array()));
    const walrus: any = { getBlob: async () => ({ asFile: () => ({ bytes: async () => new Uint8Array() }) }) };

    installAggregatorReads(walrus, 'https://agg.example', fetchImpl as unknown as typeof fetch);
    await walrus.readBlob({ blobId: 'a/b+c=' });

    expect(fetchImpl).toHaveBeenCalledWith('https://agg.example/v1/blobs/a%2Fb%2Bc%3D');
  });

  it('throws on a non-ok aggregator response (so the retry loop can back off)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response);
    const walrus: any = { getBlob: async () => ({ asFile: () => ({ bytes: async () => new Uint8Array() }) }) };

    installAggregatorReads(walrus, 'https://agg.example', fetchImpl as unknown as typeof fetch);
    await expect(walrus.readBlob({ blobId: 'missing' })).rejects.toThrow(/aggregator read failed \(404\)/);
  });

  it('getBlob primes the full blob (forces the cached-bytes path, no lazy sliver reads)', async () => {
    const fetchImpl = vi.fn(async () => bytesResponse(new Uint8Array()));
    const primeSpy = vi.fn(async () => new Uint8Array());
    const realBlob = { asFile: () => ({ bytes: primeSpy }) };
    const origGetBlob = vi.fn(async () => realBlob);
    const walrus: any = { getBlob: origGetBlob };

    installAggregatorReads(walrus, 'https://agg.example', fetchImpl as unknown as typeof fetch);
    const blob = await walrus.getBlob({ blobId: 'q' });

    expect(origGetBlob).toHaveBeenCalledWith({ blobId: 'q' });
    expect(primeSpy).toHaveBeenCalledOnce(); // primed before returning
    expect(blob).toBe(realBlob);
  });
});
