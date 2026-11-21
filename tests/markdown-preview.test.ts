// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SafeMarkdown } from '../src/markdown-preview';
import { markdownPolicy, preparePreview } from '../src/markdown-preparation';
import type { PreparedPreview } from '../src/contracts';
import type { FolderSnapshot } from '../src/contracts';
import type { MarkdownNode } from '../src/markdown-structure';
const snapshot: FolderSnapshot = { generation: 1, revision: 1, folder: 'Fixture', issues: [], notes: ['Map.md', 'Shared.md'].map(id => ({ id, metadata: { links: [] }, headings: [{ text: 'Overview', anchor: 'heading-overview' }, { text: 'Overview', anchor: 'heading-overview-1' }], blocks: ['actual'] })) };
function prepare(body: string): PreparedPreview { try { return preparePreview(body, snapshot, 'Map.md'); } catch { return { kind: 'plain', reason: 'Markdown preparation failed' }; } }
function render(body: string): HTMLDivElement { const host = document.createElement('div'); host.innerHTML = renderToStaticMarkup(createElement(SafeMarkdown, { body, preview: prepare(body), onNavigate() {}, onExternal() {} })); return host; }
it('markdown-preview renders nice GFM tables, plain aliases, duplicate heading anchors, highlighted/fallback code and disabled tasks', () => {
  const host = render('# Overview\n\n# Overview\n\n| Link | Value |\n| --- | --- |\n| [[Shared#Overview|A label]] | **bold** |\n\n- [ ] Read-only task\n\n> [!NOTE] A blockquote\n\n```js\nconst x = 1;\n```\n\n```unknown-language\n<safe>\n```\n\nA block ^actual');
  expect(host.querySelectorAll('table td')).toHaveLength(2); expect(host.querySelector('table a')?.textContent).toBe('A label');
  expect(host.querySelectorAll('h1')[0].id).toBe('heading-overview'); expect(host.querySelectorAll('h1')[1].id).toBe('heading-overview-1');
  expect(host.querySelector('input')?.disabled).toBe(true); expect(host.querySelector('.hljs-keyword')?.textContent).toBe('const'); expect(host.textContent).toContain('<safe>');
  expect(host.querySelector('#block-actual')).not.toBeNull(); expect(host.querySelector('textarea,[contenteditable]')).toBeNull();
});
it('markdown-preview final DOM has no executable HTML, automatic media, dangerous links or forms', () => {
  const host = render('<script>alert(1)</script>\n\n<img src="https://evil.test/x" onerror="alert(1)">\n\n<iframe src="file:///secret"></iframe>\n\n![inline](https://evil.test/x) ![ref][x] ![[Shared]] ![[https://evil.test/video]]\n\n[x]: https://evil.test/ref\n\n[bad](javascript:alert%281%29) [bad2](data:text/html,x) [file](file:///secret) [app](app://bundle/index.html) [custom](custom:run)\n\n[[Absent]] [[Shared#Absent]] [[Shared#^absent]] [[chats/Secret]]');
  expect(host.querySelectorAll('script,img,iframe,video,audio,object,embed,form,textarea,[contenteditable]')).toHaveLength(0);
  expect(host.querySelectorAll('a')).toHaveLength(0); expect(host.querySelector('[onerror],[onclick]')).toBeNull(); expect(host.textContent).toContain('unavailable');
});
it.each(['[[Absent|**alias** [web](https://evil.test)]]', '[[Shared|**alias** [web](https://evil.test)]]', '[[Shared|[ref][p]]]\n\n[p]: https://evil.test', '[[Shared|![[Absent]]]]', '![[Shared|`code`]]', '[[Shared|line\nbreak]]'])('markdown-preview preserves whole-wiki protection through final reparse: %s', input => {
  expect(render(input).querySelectorAll('a,img')).toHaveLength(0);
});
it('markdown-preview first reference definition wins and the final parsed destination is approved again', () => {
  expect(render('[private][p]\n\n> [p]: Absent\n\n[p]: https://example.com').querySelectorAll('a')).toHaveLength(0);
  expect(render('[public][p]\n\n[p]: https://example.com/[[Absent]]\n\n[p]: javascript:x').querySelectorAll('a')).toHaveLength(1);
  expect(render('[internal][p]\n\n[p]: Shared#Overview\n\n[p]: Absent').querySelectorAll('a')).toHaveLength(1);
  expect(render('`[[Shared]]`\n\n```md\n![[Shared]]\n```\n\n    [[Shared]]').querySelectorAll('a')).toHaveLength(0);
});
it('markdown-preview discards injected hName/hProperties/hChildren rather than calling package handlers', () => {
  const tree: MarkdownNode = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'wikiLink', target: 'Shared', alias: 'Safe alias', data: { hName: 'iframe', hProperties: { src: 'https://evil.test', href: 'javascript:x' }, hChildren: [{ type: 'raw', value: '<script>x</script>' }] } }, { type: 'wikiEmbed', target: 'Shared', data: { hName: 'a', hProperties: { href: 'https://evil.test' } } }] }] };
  const links = new Map(); markdownPolicy(snapshot, 'Map.md', links)()(tree);
  expect(JSON.stringify(tree)).not.toMatch(/iframe|javascript|evil\.test|hChildren/); expect(links.size).toBe(1); expect(tree.children?.[0].children?.[0].url).toBe('#visor-approved-0'); expect(tree.children?.[0].children?.[1].type).toBe('text');
});
it('markdown-preview navigation/external opening happens only on an explicit click, never render or hover', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const onExternal = vi.fn(); const onNavigate = vi.fn();
  try {
    await act(async () => root.render(createElement(SafeMarkdown, { body: '[[Shared#Overview|Internal]] [Web](https://example.com)', preview: prepare('[[Shared#Overview|Internal]] [Web](https://example.com)'), onNavigate, onExternal })));
    expect(onExternal).not.toHaveBeenCalled(); expect(onNavigate).not.toHaveBeenCalled();
    const links = [...host.querySelectorAll('a')]; links[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); expect(onExternal).not.toHaveBeenCalled();
    await act(async () => links[1].click()); expect(onExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/');
    await act(async () => links[0].click()); expect(onNavigate).toHaveBeenCalledExactlyOnceWith({ kind: 'note', id: 'Shared.md', anchor: 'heading-overview' });
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
it('markdown-preview bounded formatting failure is plain inert text, not a crash or active second parser', () => {
  const host = render('[x](https://evil.test)'.repeat(20000)); expect(host.textContent).toContain('Formatting unavailable'); expect(host.querySelectorAll('a')).toHaveLength(0);
});
