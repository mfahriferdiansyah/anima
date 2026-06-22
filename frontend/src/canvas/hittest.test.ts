import { describe, it, expect } from 'vitest';
import type { CanvasElement } from '../../../chain/core/src/elements.js';
import { hitElement, hitTopElement, marqueeSelect, fullyContained } from './hittest';

const base = { angle: 0, index: 0, version: 1, versionNonce: 1 };
function rect(id: string, x: number, y: number, w: number, h: number, angle = 0, index = 0): CanvasElement {
  return { ...base, id, type: 'rect', x, y, w, h, angle, index };
}
function ellipse(x: number, y: number, w: number, h: number): CanvasElement {
  return { ...base, id: 'e', type: 'ellipse', x, y, w, h };
}
function arrow(x: number, y: number, points: number[]): CanvasElement {
  return { ...base, id: 'a', type: 'arrow', x, y, w: 0, h: 0, points };
}

describe('hitElement', () => {
  it('hits inside a rect, misses outside', () => {
    const r = rect('r', 0, 0, 100, 50);
    expect(hitElement({ x: 50, y: 25 }, r)).toBe(true);
    expect(hitElement({ x: 200, y: 25 }, r)).toBe(false);
  });

  it('hits near an arrow stroke, misses far away', () => {
    const a = arrow(0, 0, [0, 0, 100, 0]); // horizontal segment y=0
    expect(hitElement({ x: 50, y: 3 }, a)).toBe(true); // within HIT_THRESHOLD
    expect(hitElement({ x: 50, y: 40 }, a)).toBe(false);
  });

  it('honors the ellipse equation (corner of bbox is outside)', () => {
    const e = ellipse(0, 0, 100, 100);
    expect(hitElement({ x: 50, y: 50 }, e)).toBe(true); // centre
    expect(hitElement({ x: 2, y: 2 }, e)).toBe(false); // bbox corner, outside the circle
  });

  it('is rotation-aware: a rotated rect catches a point its un-rotated box would miss', () => {
    const r = rect('r', 0, 0, 100, 20, Math.PI / 2); // 90deg about centre (50,10)
    expect(hitElement({ x: 50, y: 40 }, r)).toBe(true); // inside once rotated
    expect(hitElement({ x: 50, y: 40 }, rect('r', 0, 0, 100, 20))).toBe(false); // not when un-rotated
  });

  it('ignores tombstoned elements', () => {
    expect(hitElement({ x: 50, y: 25 }, { ...rect('r', 0, 0, 100, 50), isDeleted: true })).toBe(false);
  });
});

describe('hitTopElement', () => {
  it('returns the highest-index element under the point', () => {
    const lo = rect('lo', 0, 0, 100, 100, 0, 1);
    const hi = rect('hi', 0, 0, 100, 100, 0, 5);
    expect(hitTopElement({ x: 50, y: 50 }, [lo, hi])?.id).toBe('hi');
  });
});

describe('marqueeSelect (full containment)', () => {
  const inside = rect('in', 10, 10, 20, 20);
  const clipped = rect('clip', 90, 90, 40, 40); // sticks out of a 0..100 marquee
  const outside = rect('out', 500, 500, 10, 10);

  it('selects fully-contained elements and excludes clipped/outside ones', () => {
    const sel = marqueeSelect({ x: 0, y: 0, w: 100, h: 100 }, [inside, clipped, outside]);
    expect(sel.map((e) => e.id)).toEqual(['in']);
  });

  it('normalizes a marquee dragged up-left', () => {
    expect(fullyContained(inside, { x: 100, y: 100, w: -100, h: -100 })).toBe(false);
    const sel = marqueeSelect({ x: 100, y: 100, w: -100, h: -100 }, [inside]);
    expect(sel.map((e) => e.id)).toEqual(['in']);
  });
});
