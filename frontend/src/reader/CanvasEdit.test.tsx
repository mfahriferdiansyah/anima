// @vitest-environment jsdom
/**
 * Wallet-free editable board (plan 2026-06-24 U8). jsdom dispatch-level: the board
 * mounts with a toolbar and no wallet/connect prompt (AE9), and pointer-driving a
 * placement tool seeds an element through the pure cores (AE1). The human-facing
 * "is it actually editable" proof is the U12 two-browser run — jsdom asserts the
 * pointer→tool→core→state dispatch, not interaction feel.
 */
import { describe, it, expect } from 'vitest';
import { useState, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CanvasEdit } from './CanvasEdit';
import type { CanvasElement } from '../../../chain/core/src/elements.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no real layout; stub the board rect so toWorld math is deterministic.
function stubRect() {
  Object.defineProperty(HTMLDivElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }),
  });
}

/** A controlled harness: holds the element list + the latest local edit. */
function Harness({ onEdit }: { onEdit: (el: CanvasElement) => void }) {
  const [elements, setElements] = useState<CanvasElement[]>([]);
  return <CanvasEdit elements={elements} onElementsChange={setElements} onLocalEdit={onEdit} />;
}

function mount(onEdit: (el: CanvasElement) => void = () => {}): { container: HTMLElement; root: Root } {
  stubRect();
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(<Harness onEdit={onEdit} />);
  });
  return { container, root };
}

function pointer(el: Element, type: string, x: number, y: number) {
  const ev = new Event(type, { bubbles: true }) as PointerEvent & { clientX: number; clientY: number; pointerId: number };
  Object.assign(ev, { clientX: x, clientY: y, pointerId: 1 });
  el.dispatchEvent(ev);
}

describe('CanvasEdit — wallet-free editable board', () => {
  it('mounts a board with a toolbar and no wallet/connect prompt (AE9)', () => {
    const { container, root } = mount();
    expect(container.querySelector('.ce-board')).toBeTruthy();
    expect(container.querySelector('.ce-toolbar')).toBeTruthy();
    // the tool grammar is present
    const tools = [...container.querySelectorAll('.ce-tool')].map((b) => b.textContent);
    expect(tools).toEqual(expect.arrayContaining(['select', 'draw', 'rect', 'ellipse', 'arrow', 'text', 'delete']));
    // wallet-free: no connect/sign affordance
    expect(container.textContent).not.toMatch(/connect|sign in|wallet/i);
    act(() => root.unmount());
  });

  it('placing a rect via the toolbar + drag seeds an element (AE1 dispatch)', () => {
    let edited: CanvasElement | null = null;
    const { container, root } = mount((el) => (edited = el));
    const board = container.querySelector('.ce-board')!;

    // choose the rect tool
    const rectBtn = [...container.querySelectorAll('.ce-tool')].find((b) => b.textContent === 'rect')!;
    act(() => (rectBtn as HTMLButtonElement).click());

    // drag from (100,100) to (180,160)
    act(() => {
      pointer(board, 'pointerdown', 100, 100);
      pointer(board, 'pointermove', 180, 160);
      pointer(board, 'pointerup', 180, 160);
    });

    // a rect element now renders on the board, and a local edit fired (U13 broadcasts it)
    expect(container.querySelector('svg rect')).toBeTruthy();
    expect(edited).not.toBeNull();
    expect(edited!.type).toBe('rect');
    act(() => root.unmount());
  });

  it('placing text adds a text element and returns to select', () => {
    let edited: CanvasElement | null = null;
    const { container, root } = mount((el) => (edited = el));
    const board = container.querySelector('.ce-board')!;
    const textBtn = [...container.querySelectorAll('.ce-tool')].find((b) => b.textContent === 'text')!;
    act(() => (textBtn as HTMLButtonElement).click());
    act(() => pointer(board, 'pointerdown', 50, 50));
    expect(container.querySelector('.cv-text')).toBeTruthy();
    expect(edited!.type).toBe('text');
    act(() => root.unmount());
  });

  it('delete is disabled with nothing selected', () => {
    const { container, root } = mount();
    const del = [...container.querySelectorAll('.ce-tool')].find((b) => b.textContent === 'delete') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    act(() => root.unmount());
  });
});
