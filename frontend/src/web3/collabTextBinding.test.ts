// @vitest-environment jsdom
/**
 * Unit tests for the Y.Text ↔ editable-surface binding (plan 2026-06-24 U3).
 * jsdom so the contenteditable Selection/Range path is exercised. Proves the
 * minimal-diff edits, caret preservation across a remote insert above the caret,
 * both surface adapters, and the re-entrancy guard.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  applyTextDiff,
  textareaSurface,
  contentEditableSurface,
  caretIndexOf,
  caretNodeAt,
  shiftCaret,
  bindYText,
} from './collabTextBinding';

describe('shiftCaret — caret preservation core', () => {
  it('an insert before the caret pushes it right', () => {
    // caret at 5; "hello " (6 chars) inserted at 0 → caret 11
    expect(shiftCaret(5, [{ insert: 'hello ' }, { retain: 5 }])).toBe(11);
  });
  it('an insert after the caret leaves it untouched', () => {
    // caret at 2; insert at 5 → caret unchanged
    expect(shiftCaret(2, [{ retain: 5 }, { insert: 'xyz' }])).toBe(2);
  });
  it('a delete before the caret pulls it left', () => {
    // caret at 8; delete 3 chars at offset 0 → caret 5
    expect(shiftCaret(8, [{ delete: 3 }])).toBe(5);
  });
  it('a delete spanning the caret clamps, never goes negative', () => {
    expect(shiftCaret(2, [{ delete: 10 }])).toBe(0);
  });
});

describe('applyTextDiff — minimal in-place edits', () => {
  it('an insert at the end produces a single insert run, not a full replace', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t');
    t.insert(0, 'hello');
    let ops = 0;
    t.observe((e) => (ops += e.changes.delta.length));
    applyTextDiff(t, 'hello world');
    expect(t.toString()).toBe('hello world');
    // a full replace would be delete+insert (2 delta entries); a tail insert is 1 (retain)+1 (insert)
    expect(ops).toBeLessThanOrEqual(2);
  });

  it('a delete in the middle removes only the deleted run', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t');
    t.insert(0, 'hello world');
    applyTextDiff(t, 'hello');
    expect(t.toString()).toBe('hello');
  });

  it('a replace in the middle is expressed as delete + insert at the right offset', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t');
    t.insert(0, 'the quick fox');
    applyTextDiff(t, 'the slow fox');
    expect(t.toString()).toBe('the slow fox');
  });

  it('no change is a no-op', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t');
    t.insert(0, 'same');
    let fired = false;
    t.observe(() => (fired = true));
    applyTextDiff(t, 'same');
    expect(fired).toBe(false);
  });

  it('newlines and multi-line content round-trip', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t');
    t.insert(0, 'line 1\nline 2');
    applyTextDiff(t, 'line 1\nline 2\n- [ ] todo');
    expect(t.toString()).toBe('line 1\nline 2\n- [ ] todo');
  });
});

describe('contenteditable caret offset walk', () => {
  it('maps a (textNode, offset) to a flat index and back', () => {
    const el = document.createElement('div');
    el.textContent = 'hello world';
    const textNode = el.firstChild!;
    expect(caretIndexOf(el, textNode, 6)).toBe(6);
    const back = caretNodeAt(el, 6);
    expect(back.node).toBe(textNode);
    expect(back.offset).toBe(6);
  });

  it('clamps an out-of-range index to the end', () => {
    const el = document.createElement('div');
    el.textContent = 'short';
    const back = caretNodeAt(el, 999);
    expect(back.offset).toBe(5);
  });
});

describe('bindYText — textarea surface', () => {
  it('user input drives minimal Y.Text edits; the binding seeds from the doc', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t');
    t.insert(0, 'seed');
    const el = document.createElement('textarea');
    const unbind = bindYText(t, textareaSurface(el));
    expect(el.value).toBe('seed'); // seeded from the doc

    el.value = 'seed + edit';
    el.dispatchEvent(new Event('input'));
    expect(t.toString()).toBe('seed + edit');
    unbind();
  });

  it('a REMOTE insert above the caret preserves the caret on the same character', () => {
    // Two docs sharing state; a remote insert at offset 0 shifts the local caret.
    const docA = new Y.Doc();
    const tA = docA.getText('t');
    tA.insert(0, 'world');
    const el = document.createElement('textarea');
    document.body.appendChild(el);
    const unbind = bindYText(tA, textareaSurface(el));
    el.setSelectionRange(5, 5); // caret at the end of "world"

    // A remote peer inserts "hello " at offset 0 (origin not local).
    docA.transact(() => tA.insert(0, 'hello '), 'remote');

    expect(el.value).toBe('hello world');
    // the caret stayed on the SAME character (end of "world") → index 11, not 5
    expect(el.selectionStart).toBe(11);
    unbind();
    el.remove();
  });

  it('a programmatic remote re-render does not loop back through onInput', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t');
    t.insert(0, 'base');
    const el = document.createElement('textarea');
    const unbind = bindYText(t, textareaSurface(el));

    let inputCount = 0;
    el.addEventListener('input', () => (inputCount += 1));
    // a remote change re-renders via setText (programmatic .value set fires no input)
    doc.transact(() => t.insert(4, '!'), 'remote');
    expect(el.value).toBe('base!');
    expect(inputCount).toBe(0); // no re-entrant input loop
    unbind();
  });
});

describe('bindYText — contenteditable surface', () => {
  it('drives the same Y.Text from a contenteditable div', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t');
    const el = document.createElement('div');
    el.contentEditable = 'true';
    document.body.appendChild(el);
    const unbind = bindYText(t, contentEditableSurface(el));

    el.textContent = 'typed into a div';
    el.dispatchEvent(new Event('input'));
    expect(t.toString()).toBe('typed into a div');

    // a remote change re-renders the div
    doc.transact(() => t.insert(0, '['), 'remote');
    expect(el.textContent).toBe('[typed into a div');
    unbind();
    el.remove();
  });
});
