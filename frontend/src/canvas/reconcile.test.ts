import { describe, it, expect } from 'vitest';
import type { CanvasElement } from '../../../chain/core/src/elements.js';
import { reconcile, reconcileElement, liveElements } from './reconcile';

function el(id: string, version: number, versionNonce: number, extra: Partial<CanvasElement> = {}): CanvasElement {
  return { id, type: 'rect', x: 0, y: 0, w: 10, h: 10, angle: 0, index: 0, version, versionNonce, ...extra } as CanvasElement;
}

describe('reconcileElement', () => {
  it('higher version wins regardless of argument order', () => {
    const a = el('x', 5, 100);
    const b = el('x', 3, 1);
    expect(reconcileElement(a, b)).toBe(a);
    expect(reconcileElement(b, a)).toBe(a);
  });

  it('on equal version the LOWER nonce wins, deterministically across peers', () => {
    const lowNonce = el('x', 4, 10);
    const highNonce = el('x', 4, 99);
    // peer A holds lowNonce, receives highNonce; peer B holds highNonce, receives lowNonce
    expect(reconcileElement(lowNonce, highNonce)).toBe(lowNonce);
    expect(reconcileElement(highNonce, lowNonce)).toBe(lowNonce);
  });
});

describe('reconcile (lists)', () => {
  it('two peers editing the same element converge to the identical winner', () => {
    const a = el('x', 4, 10, { x: 1 });
    const b = el('x', 4, 99, { x: 2 });
    const peerA = reconcile([a], [b]);
    const peerB = reconcile([b], [a]);
    expect(peerA).toEqual(peerB);
    expect(peerA[0].versionNonce).toBe(10);
  });

  it('edits to different elements both survive', () => {
    const merged = reconcile([el('x', 1, 1)], [el('y', 1, 1)]);
    expect(merged.map((e) => e.id).sort()).toEqual(['x', 'y']);
  });

  it('does not resurrect a tombstone with a higher version', () => {
    const deleted = el('x', 5, 1, { isDeleted: true });
    const staleEdit = el('x', 3, 1, { x: 99 });
    const merged = reconcile([staleEdit], [deleted]);
    expect(merged[0].isDeleted).toBe(true);
    expect(liveElements(merged)).toHaveLength(0);
  });
});
