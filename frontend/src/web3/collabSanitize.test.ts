// @vitest-environment jsdom
/**
 * XSS threat tests for sanitizeNoteHtml (plan 008 U1, KTD8 control 2). Runs under
 * jsdom (DOMPurify needs a DOM). The agent key persisted in the browser is the
 * Seal decrypt identity AND the note signer, so an unsanitized guest/published
 * body would be an XSS path to full-vault decryption + forged notes — these
 * assert real payloads are neutralized, not merely that rendering does not throw.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeNoteHtml } from './collabOps';

describe('sanitizeNoteHtml — neutralizes hostile guest/published bodies', () => {
  it('strips a <script> tag entirely', () => {
    const out = sanitizeNoteHtml('hello <script>alert(document.cookie)</script> world');
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out).not.toContain('alert(document.cookie)');
  });

  it('drops an onerror handler on an injected <img>', () => {
    const out = sanitizeNoteHtml('<img src=x onerror="alert(1)">');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
  });

  it('removes a javascript: href from a markdown link', () => {
    const out = sanitizeNoteHtml('[click me](javascript:alert(1))');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('strips an <iframe> and an inline event handler', () => {
    const out = sanitizeNoteHtml('<iframe src="https://evil.example"></iframe><div onclick="steal()">x</div>');
    expect(out.toLowerCase()).not.toContain('<iframe');
    expect(out.toLowerCase()).not.toContain('onclick');
    expect(out).not.toContain('steal()');
  });

  it('drops an svg/onload vector', () => {
    const out = sanitizeNoteHtml('<svg><script>alert(1)</script></svg><body onload="alert(2)">');
    expect(out.toLowerCase()).not.toContain('onload');
    expect(out.toLowerCase()).not.toContain('<script');
  });

  it('keeps safe markdown formatting (it sanitizes, it does not gut the note)', () => {
    const out = sanitizeNoteHtml('# Title\n\nSome **bold** and a [real link](https://example.com).');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('href="https://example.com"');
    expect(out.toLowerCase()).toContain('title'); // the heading text survives
  });

  it('a script smuggled inside markdown text is still neutralized', () => {
    const out = sanitizeNoteHtml('Normal text\n\n<script>fetch("/steal?"+localStorage.agentKey)</script>');
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out).not.toContain('localStorage.agentKey');
  });
});
