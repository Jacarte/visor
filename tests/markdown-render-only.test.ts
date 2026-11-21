// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const forbidden = vi.hoisted(() => vi.fn(() => { throw new Error('A parser/highlighter ran in render-only preview'); }));
vi.mock('../src/markdown-structure', () => ({ parseMarkdown: forbidden, completeWikiSpan: forbidden, walkMarkdown: forbidden }));
vi.mock('../src/preview-markdown', () => ({ previewMarkdown: forbidden }));
vi.mock('../src/markdown-preparation', () => ({ preparePreview: forbidden }));
vi.mock('react-markdown', () => ({ default: forbidden }));
vi.mock('rehype-highlight', () => ({ default: forbidden }));
import { SafeMarkdown } from '../src/markdown-preview';
it.each(['> '.repeat(20000) + 'x', '['.repeat(120000) + ']'.repeat(120000), '[[x|'.repeat(40000) + ']]', '<script>window.pwned=1</script><img src="https://evil.test">[click](https://evil.test)'])('markdown-render-only plain fallback bypasses every parser, sanitizer and highlighter (%#)', body => {
  const host = document.createElement('div'); host.innerHTML = renderToStaticMarkup(createElement(SafeMarkdown, { body, preview: { kind: 'plain', reason: 'deadline exceeded' }, onNavigate() {}, onExternal() {} }));
  expect(host.querySelector('pre')?.textContent).toBe(body.slice(0, 256 * 1024)); expect(host.querySelectorAll('a,img,script,.hljs')).toHaveLength(0); expect(forbidden).not.toHaveBeenCalled();
});
