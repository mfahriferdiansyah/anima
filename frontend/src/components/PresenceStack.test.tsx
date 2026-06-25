// @vitest-environment jsdom
/**
 * The avatar stack (plan 2026-06-24 U9). Proves AE6-shape rendering: a circle per
 * member with a deterministic glyph, the owner distinct, and a "+N" overflow chip
 * past the visible cap so a crowded room stays legible.
 */
import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PresenceStack, type PresenceMember } from './PresenceStack';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(members: PresenceMember[]): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(<PresenceStack members={members} />);
  });
  return { container, root };
}

describe('PresenceStack', () => {
  it('renders nothing for an empty room', () => {
    const { container, root } = render([]);
    expect(container.querySelector('.pstack')).toBeNull();
    act(() => root.unmount());
  });

  it('renders one circle per member with a 2-char glyph (AE6)', () => {
    const { container, root } = render([
      { id: 'p1', label: 'Guest A3' },
      { id: 'p2', label: 'Guest B7' },
    ]);
    const dots = container.querySelectorAll('.pstack-dot');
    expect(dots).toHaveLength(2);
    expect(dots[0].textContent).toMatch(/^[A-HJ-NP-Z2-9]{2}$/);
    act(() => root.unmount());
  });

  it('renders the verified owner distinctly and first', () => {
    const { container, root } = render([
      { id: 'g1', label: 'Guest' },
      { id: 'owner1', label: 'Owner', isOwner: true },
    ]);
    const dots = container.querySelectorAll('.pstack-dot');
    expect(dots[0].classList.contains('pstack-owner')).toBe(true); // owner sorted first
    expect(dots[0].getAttribute('title')).toBe('Owner');
    act(() => root.unmount());
  });

  it('collapses past the visible cap to a "+N" chip (crowded room stays legible)', () => {
    const members = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, label: `Guest ${i}` }));
    const { container, root } = render(members);
    const more = container.querySelector('.pstack-more');
    expect(more).toBeTruthy();
    expect(more!.textContent).toBe('+4'); // 9 members, 5 visible → +4
    act(() => root.unmount());
  });

  it('a member always carries a visible label (collisions disambiguate by label)', () => {
    const { container, root } = render([{ id: 'p1', label: 'Guest A3' }]);
    expect(container.querySelector('.pstack-dot')!.getAttribute('aria-label')).toBe('Guest A3');
    act(() => root.unmount());
  });
});
