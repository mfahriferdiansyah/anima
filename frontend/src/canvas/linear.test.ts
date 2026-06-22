import { describe, it, expect } from 'vitest';
import type { CanvasElement } from '../../../chain/core/src/elements.js';
import {
  endpointWorld,
  moveEndpoint,
  insertMidpoint,
  deletePoint,
  normalizeFixedPoint,
  denormalizeFixedPoint,
  bindEndpoint,
  breakBinding,
  updateBoundEndpoints,
  dropBindingsTo,
  type BindableLinear,
} from './linear';

const base = { angle: 0, index: 0, version: 1, versionNonce: 1 };
function arrow(x: number, y: number, points: number[]): BindableLinear {
  return { ...base, id: 'a', type: 'arrow', x, y, w: 0, h: 0, points };
}
function rect(id: string, x: number, y: number, w: number, h: number): CanvasElement {
  return { ...base, id, type: 'rect', x, y, w, h };
}

describe('endpoint editing', () => {
  it('moving the end tip lengthens the arrow rather than translating it', () => {
    // start at world (10,10), end at world (110,10) → length 100
    const a = arrow(10, 10, [0, 0, 100, 0]);
    const out = moveEndpoint(a, 'end', { x: 210, y: 10 }); // end now at world 210
    expect(endpointWorld(out, 'start')).toEqual({ x: 10, y: 10 }); // start unchanged
    expect(endpointWorld(out, 'end')).toEqual({ x: 210, y: 10 }); // end moved
    expect(out.w).toBe(200);
  });

  it('inserts a midpoint, bending the line', () => {
    const a = arrow(0, 0, [0, 0, 100, 0]);
    const out = insertMidpoint(a, 0, { x: 50, y: 40 });
    expect(out.points.length).toBe(6); // 3 points now
  });

  it('deletes a point but keeps a minimum of two', () => {
    const three = arrow(0, 0, [0, 0, 50, 40, 100, 0]);
    expect(deletePoint(three, 1).points.length).toBe(4); // 3 → 2 ok
    const two = arrow(0, 0, [0, 0, 100, 0]);
    expect(deletePoint(two, 0).points.length).toBe(4); // stays 2 (no-op)
  });
});

describe('fixedPoint normalize/denormalize', () => {
  it('round-trips a world point against target bounds', () => {
    const b = { x: 100, y: 100, w: 200, h: 50 };
    const fp = normalizeFixedPoint({ x: 200, y: 125 }, b);
    expect(fp).toEqual([0.5, 0.5]);
    expect(denormalizeFixedPoint(fp, b)).toEqual({ x: 200, y: 125 });
  });
});

describe('binding follows the target', () => {
  it('binds the end tip and re-positions it when the target moves', () => {
    const target = rect('t', 100, 100, 100, 100); // centre 150,150
    let a = arrow(0, 0, [0, 0, 150, 150]); // end tip at world 150,150 = target centre
    a = bindEndpoint(a, 'end', target);
    expect(a.endBinding).toEqual({ elementId: 't', fixedPoint: [0.5, 0.5] });

    const moved = rect('t', 300, 300, 100, 100); // centre 350,350
    const followed = updateBoundEndpoints(a, new Map([['t', moved]]));
    expect(endpointWorld(followed, 'end')).toEqual({ x: 350, y: 350 }); // followed to new centre
  });

  it('follows a resize of the target (fixedPoint is proportional)', () => {
    const target = rect('t', 0, 0, 100, 100);
    let a = arrow(0, 0, [0, 0, 100, 100]); // tip at bottom-right corner → fixedPoint [1,1]
    a = bindEndpoint(a, 'end', target);
    expect(a.endBinding!.fixedPoint).toEqual([1, 1]);
    const bigger = rect('t', 0, 0, 200, 200);
    const followed = updateBoundEndpoints(a, new Map([['t', bigger]]));
    expect(endpointWorld(followed, 'end')).toEqual({ x: 200, y: 200 }); // still the corner
  });

  it('breaks a binding and drops bindings to a deleted target', () => {
    const target = rect('t', 100, 100, 100, 100);
    let a = arrow(0, 0, [0, 0, 150, 150]);
    a = bindEndpoint(a, 'end', target);
    expect(breakBinding(a, 'end').endBinding).toBeUndefined();
    expect(dropBindingsTo(a, 't').endBinding).toBeUndefined();
    expect(dropBindingsTo(a, 'other').endBinding).toBeDefined();
  });
});
