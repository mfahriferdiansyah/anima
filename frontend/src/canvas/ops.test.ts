import { describe, it, expect } from 'vitest';
import type { CanvasElement } from '../../../chain/core/src/elements.js';
import { endpointWorld, type BindableLinear } from './linear';
import { addElement, moveElements, deleteElements, duplicateElements, reorder } from './ops';

const b = { angle: 0, version: 1, versionNonce: 1 };
const note = (id: string, x: number, y: number, index = 0): CanvasElement => ({ ...b, id, type: 'note', noteId: `note-${id}`, x, y, w: 100, h: 100, index });
const rect = (id: string, index: number): CanvasElement => ({ ...b, id, type: 'rect', x: 0, y: 0, w: 10, h: 10, index });
const boundArrow = (id: string, target: string): BindableLinear => ({ ...b, id, type: 'arrow', x: 0, y: 0, w: 150, h: 150, index: 1, points: [0, 0, 150, 150], endBinding: { elementId: target, fixedPoint: [0.5, 0.5] } });

describe('addElement', () => {
  it('appends on top with the next z-index', () => {
    const out = addElement([rect('a', 0), rect('b', 1)], rect('c', 99));
    expect(out[2].index).toBe(2);
  });
});

describe('moveElements', () => {
  it('translates the selection', () => {
    const [n] = moveElements([note('n', 100, 100)], ['n'], 50, -20);
    expect({ x: n.x, y: n.y }).toEqual({ x: 150, y: 80 });
  });

  it('a bound arrow follows a moved target', () => {
    const n = note('n', 100, 100); // centre 150,150
    const a = boundArrow('a', 'n'); // end bound to n centre
    const out = moveElements([n, a], ['n'], 50, 50); // move note → centre 200,200
    const movedArrow = out.find((e) => e.id === 'a') as BindableLinear;
    expect(endpointWorld(movedArrow, 'end')).toEqual({ x: 200, y: 200 });
  });
});

describe('deleteElements', () => {
  it('removes the selection and drops arrows bound to it', () => {
    const n = note('n', 100, 100);
    const a = boundArrow('a', 'n');
    const out = deleteElements([n, a], ['n']);
    expect(out.map((e) => e.id)).toEqual(['a']);
    expect((out[0] as BindableLinear).endBinding).toBeUndefined(); // floats, not broken
  });
});

describe('duplicateElements', () => {
  it('clones with new ids, an offset, and reset version', () => {
    const { elements, newIds } = duplicateElements([note('n', 100, 100)], ['n'], 12, 12);
    expect(elements).toHaveLength(2);
    expect(newIds).toHaveLength(1);
    const clone = elements[1];
    expect(clone.id).not.toBe('n');
    expect({ x: clone.x, y: clone.y, version: clone.version }).toEqual({ x: 112, y: 112, version: 1 });
  });
});

describe('reorder (z-order)', () => {
  const els = [rect('a', 0), rect('b', 1), rect('c', 2)];
  it('brings to front / sends to back', () => {
    expect(reorder(els, ['a'], 'front').find((e) => e.id === 'a')!.index).toBe(2);
    expect(reorder(els, ['c'], 'back').find((e) => e.id === 'c')!.index).toBe(0);
  });
  it('steps one layer forward/backward', () => {
    expect(reorder(els, ['a'], 'forward').find((e) => e.id === 'a')!.index).toBe(1); // a swaps with b
    expect(reorder(els, ['c'], 'backward').find((e) => e.id === 'c')!.index).toBe(1);
  });
});
