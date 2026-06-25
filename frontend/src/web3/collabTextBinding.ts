/**
 * Y.Text ↔ editable-surface binding (plan 2026-06-24 U3) — the caret-preserving
 * bridge between the markdown SOURCE string in a `Y.Text` and an uncontrolled
 * editing surface. Loaded behind the dynamic collab chunk (imports yjs).
 *
 * Two surface shapes, one binding: the guest editor is a `<textarea>` (flat
 * `value` + `selectionStart` offsets); the in-app NoteEditor is a source-mode
 * `contenteditable` whose caret is a DOM Selection/Range. The `EditableSurface`
 * adapter abstracts "read text + get/set caret offset" over both, so U4/U5 share
 * one binding rather than writing two.
 *
 * Contenteditable model: the surface is kept FLAT (a single text node;
 * `white-space:pre-wrap` and Enter inserts a `\n` rather than a block), so the
 * caret offset is a plain index into `textContent`. The offset walk still tolerates
 * multiple text nodes if the browser fragments, but the source-mode editor never
 * needs blocks.
 *
 * Caret preservation: before applying a REMOTE change we capture the caret as a
 * `Y.RelativePosition` (which rebases through concurrent inserts/deletes above the
 * caret); after the change we resolve it back to an absolute index. Raw integer
 * offsets would drift the instant text shifts above the cursor — relative
 * positions are the whole point.
 *
 * Local edits diff the surface against the `Y.Text` (`fast-diff`) and apply the
 * MINIMAL insert/delete run in one transaction — never `delete(0,len)+insert(all)`,
 * which would destroy every peer's concurrent edits and caret.
 */
import * as Y from 'yjs';
import diff from 'fast-diff';

/** A pluggable editing surface: a textarea or a source-mode contenteditable. */
export interface EditableSurface {
  getText(): string;
  setText(text: string): void;
  getCaret(): { start: number; end: number };
  setCaret(start: number, end: number): void;
  /** Subscribe to user input; returns an unsubscribe. */
  onInput(handler: () => void): () => void;
}

// ── pure diff application ────────────────────────────────────────────────────

/**
 * Apply the minimal edits that transform `yText`'s current string into `next`,
 * as in-place `insert`/`delete` runs. Pure given a Y.Text (no caret, no DOM).
 * `pos` walks the LIVE (mutating) Y.Text: EQUAL advances it, DELETE removes at it
 * (content shifts so the next char lands at the same `pos`), INSERT adds at it.
 */
export function applyTextDiff(yText: Y.Text, next: string): void {
  const prev = yText.toString();
  if (prev === next) return;
  const ops = diff(prev, next);
  let pos = 0;
  for (const [op, str] of ops) {
    if (op === diff.EQUAL) {
      pos += str.length;
    } else if (op === diff.DELETE) {
      yText.delete(pos, str.length);
    } else {
      // diff.INSERT
      yText.insert(pos, str);
      pos += str.length;
    }
  }
}

// ── surface adapters ─────────────────────────────────────────────────────────

/** A `<textarea>` adapter — flat `value` + `selectionStart/End`. */
export function textareaSurface(el: HTMLTextAreaElement): EditableSurface {
  return {
    getText: () => el.value,
    setText: (t) => {
      el.value = t;
    },
    getCaret: () => ({ start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 }),
    setCaret: (start, end) => el.setSelectionRange(start, end),
    onInput: (handler) => {
      el.addEventListener('input', handler);
      return () => el.removeEventListener('input', handler);
    },
  };
}

/**
 * Walk the text nodes under `root`, summing lengths, to convert a DOM
 * `(node, offset)` selection point into a flat index into the concatenated text.
 * Pure given a DOM subtree.
 */
export function caretIndexOf(root: Node, node: Node | null, offset: number): number {
  if (!node) return 0;
  let index = 0;
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  while (n) {
    if (n === node) return index + offset;
    index += (n.textContent ?? '').length;
    n = walker.nextNode();
  }
  // The anchor is an element node (e.g. the root itself): offset counts child nodes.
  return index;
}

/** Resolve a flat index back to a DOM `(node, offset)` within `root`. */
export function caretNodeAt(root: Node, index: number): { node: Node; offset: number } {
  let remaining = index;
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  let last: Node | null = null;
  while (n) {
    const len = (n.textContent ?? '').length;
    if (remaining <= len) return { node: n, offset: remaining };
    remaining -= len;
    last = n;
    n = walker.nextNode();
  }
  if (last) return { node: last, offset: (last.textContent ?? '').length };
  return { node: root, offset: 0 };
}

/** A source-mode `contenteditable` adapter — flat `textContent` + a Selection/Range caret. */
export function contentEditableSurface(el: HTMLElement): EditableSurface {
  return {
    getText: () => el.textContent ?? '',
    setText: (t) => {
      el.textContent = t;
    },
    getCaret: () => {
      const sel = el.ownerDocument.getSelection();
      if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
      const start = caretIndexOf(el, sel.anchorNode, sel.anchorOffset);
      const end = caretIndexOf(el, sel.focusNode, sel.focusOffset);
      return { start: Math.min(start, end), end: Math.max(start, end) };
    },
    setCaret: (start, end) => {
      const sel = el.ownerDocument.getSelection();
      if (!sel) return;
      const a = caretNodeAt(el, start);
      const b = caretNodeAt(el, end);
      const range = el.ownerDocument.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      sel.removeAllRanges();
      sel.addRange(range);
    },
    onInput: (handler) => {
      el.addEventListener('input', handler);
      return () => el.removeEventListener('input', handler);
    },
  };
}

// ── the binding ──────────────────────────────────────────────────────────────

/** Origin tag for edits this binding pushed from the surface — the re-entrancy guard. */
const SURFACE_EDIT = Symbol('collab-surface-edit');

/**
 * Shift a caret index by a Y.Text change delta so it lands on the SAME character
 * after a remote insert/delete. Walks the delta (retain / insert / delete): an
 * insert before the caret pushes it right; a delete before it pulls it left; an
 * edit after the caret leaves it untouched. Pure — the caret-preservation core.
 */
export function shiftCaret(
  caret: number,
  delta: { retain?: number; insert?: string | object; delete?: number }[],
): number {
  let pos = 0;
  let result = caret;
  for (const d of delta) {
    if (d.retain != null) {
      pos += d.retain;
    } else if (d.insert != null) {
      const len = typeof d.insert === 'string' ? d.insert.length : 1;
      if (pos <= caret) result += len; // inserted at or before the caret → push right
      pos += len;
    } else if (d.delete != null) {
      if (pos < caret) result -= Math.min(d.delete, caret - pos); // deleted before the caret → pull left
      // `pos` does not advance on delete (the delta indexes the pre-change string)
    }
  }
  return Math.max(0, result);
}

/**
 * Bind a `Y.Text` to an editable surface. Returns an unbind function.
 *  - user input → minimal Y.Text edits (one transaction tagged SURFACE_EDIT).
 *  - any OTHER Y.Text change (a remote update, the owner's own edits, a seed) →
 *    re-render the surface, preserving the local caret via a relative position.
 *    Our own surface-origin edits do NOT re-render (the surface is already
 *    current) — the re-entrancy guard. Note `transaction.local` can't be used:
 *    Yjs marks every transaction on THIS doc as local regardless of who caused
 *    it, so we discriminate on our own origin sentinel instead.
 */
export function bindYText(yText: Y.Text, surface: EditableSurface): () => void {
  // Seed the surface from the doc.
  surface.setText(yText.toString());

  const offInput = surface.onInput(() => {
    yText.doc?.transact(() => applyTextDiff(yText, surface.getText()), SURFACE_EDIT);
  });

  const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
    // Skip the edits we just pushed from the surface — it is already current.
    if (transaction.origin === SURFACE_EDIT) return;
    // The caret is read AFTER the Y.Text already changed (the observer fires
    // post-mutation), so a raw index would point at the wrong character. Shift the
    // caret by the net length change that occurred at-or-before it, walking the
    // event delta — this is what keeps the caret on the same character when a
    // remote peer inserts/deletes above it.
    const { start, end } = surface.getCaret();
    surface.setText(yText.toString());
    surface.setCaret(shiftCaret(start, event.delta), shiftCaret(end, event.delta));
  };
  yText.observe(observer);

  return () => {
    offInput();
    yText.unobserve(observer);
  };
}
