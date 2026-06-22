import { describe, it, expect } from 'vitest';
import type { CanvasElement } from '../../../chain/core/src/elements.js';
import {
  resizeBox,
  resizeElement,
  rotateElement,
  translateElement,
  applyBox,
  resizeMultiple,
} from './transform';

function rect(x: number, y: number, w: number, h: number): CanvasElement {
  return { id: 'r', type: 'rect', x, y, w, h, angle: 0, index: 0, version: 1, versionNonce: 1 };
}
function arrow(x: number, y: number, points: number[], w: number, h: number): CanvasElement {
  return { id: 'a', type: 'arrow', x, y, w, h, angle: 0, index: 0, version: 1, versionNonce: 1, points };
}

describe('resizeBox', () => {
  it('se handle grows width and height, top-left anchored', () => {
    expect(resizeBox({ x: 10, y: 10, w: 100, h: 50 }, 'se', 20, 10)).toEqual({ x: 10, y: 10, w: 120, h: 60 });
  });

  it('nw handle moves the origin and shrinks the box, bottom-right anchored', () => {
    expect(resizeBox({ x: 10, y: 10, w: 100, h: 50 }, 'nw', 20, 10)).toEqual({ x: 30, y: 20, w: 80, h: 40 });
  });

  it('e handle changes width only', () => {
    expect(resizeBox({ x: 0, y: 0, w: 100, h: 50 }, 'e', 25, 999)).toEqual({ x: 0, y: 0, w: 125, h: 50 });
  });

  it('n handle changes height and y only', () => {
    expect(resizeBox({ x: 0, y: 0, w: 100, h: 50 }, 'n', 999, 10)).toEqual({ x: 0, y: 10, w: 100, h: 40 });
  });

  it('locks aspect ratio on a corner, anchored at the opposite corner', () => {
    // square 100x100 at origin, drag se corner +50 in x → uniform 1.5x → 150x150
    const out = resizeBox({ x: 0, y: 0, w: 100, h: 100 }, 'se', 50, 0, true);
    expect(out.w / out.h).toBeCloseTo(1, 6);
    expect(out).toEqual({ x: 0, y: 0, w: 150, h: 150 });
  });

  it('aspect-locked nw drag keeps the bottom-right corner fixed', () => {
    const out = resizeBox({ x: 0, y: 0, w: 100, h: 100 }, 'nw', -50, 0, true);
    // bottom-right (100,100) stays put; box grows to 150
    expect(out.w).toBeCloseTo(150, 6);
    expect(out.x + out.w).toBeCloseTo(100, 6);
    expect(out.y + out.h).toBeCloseTo(100, 6);
  });

  it('clamps to a minimum size without crossing the anchored edge', () => {
    const out = resizeBox({ x: 0, y: 0, w: 100, h: 50 }, 'w', 999, 0);
    expect(out.w).toBe(1);
    expect(out.x).toBe(99); // right edge (100) stays anchored
  });
});

describe('rotateElement', () => {
  it('snaps to the nearest 15 degrees when asked', () => {
    const out = rotateElement(rect(0, 0, 10, 10), (17 * Math.PI) / 180, true);
    expect(out.angle).toBeCloseTo((15 * Math.PI) / 180, 6);
  });

  it('normalizes negative angles into [0, 2π)', () => {
    const out = rotateElement(rect(0, 0, 10, 10), -Math.PI / 2);
    expect(out.angle).toBeCloseTo((3 * Math.PI) / 2, 6);
  });
});

describe('translateElement', () => {
  it('moves x and y by the delta', () => {
    const out = translateElement(rect(5, 5, 10, 10), 3, -2);
    expect({ x: out.x, y: out.y }).toEqual({ x: 8, y: 3 });
  });
});

describe('applyBox on a linear element', () => {
  it('scales relative points with the box', () => {
    // horizontal arrow length 100 → resize box to width 200 doubles the x of points
    const a = arrow(0, 0, [0, 0, 100, 0], 100, 0);
    const out = applyBox(a, { x: 0, y: 0, w: 200, h: 0 }) as Extract<CanvasElement, { type: 'arrow' }>;
    expect(out.points).toEqual([0, 0, 200, 0]);
    expect(out.w).toBe(200);
  });
});

describe('resizeElement', () => {
  it('resizes a rect by dragging its se handle', () => {
    const out = resizeElement(rect(0, 0, 100, 50), 'se', 10, 5);
    expect({ x: out.x, y: out.y, w: out.w, h: out.h }).toEqual({ x: 0, y: 0, w: 110, h: 55 });
  });
});

describe('resizeMultiple', () => {
  it('scales a group about its common bounds, keeping relative positions', () => {
    const a = rect(0, 0, 50, 50);
    const b = rect(50, 50, 50, 50); // group bounds 0,0 → 100x100
    const [na, nb] = resizeMultiple([a, b], 'se', 100, 100) as Array<Extract<CanvasElement, { type: 'rect' }>>;
    // group doubled → each element doubles in size and its offset doubles
    expect({ x: na.x, y: na.y, w: na.w, h: na.h }).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect({ x: nb.x, y: nb.y, w: nb.w, h: nb.h }).toEqual({ x: 100, y: 100, w: 100, h: 100 });
  });
});
