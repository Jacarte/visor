import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkWiki, { wikilink, wikilinkFromMarkdown } from '@lxcid/remark-wikilink';
import remarkWikiGfm from '@lxcid/remark-wikilink/gfm';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
assert.equal(typeof wikilink, 'function'); assert.equal(typeof wikilinkFromMarkdown, 'function');
const tree = unified().use(remarkParse).use(remarkWiki).parse('[[Note#Heading|Alias]] ![[Note]]');
assert.equal(tree.children[0].children[0].type, 'wikiLink'); assert.equal(tree.children[0].children[0].alias, 'Alias'); assert.equal(tree.children[0].children[2].type, 'wikiEmbed');
const table = unified().use(remarkParse).use(remarkWikiGfm).parse('| Name |\n| --- |\n| [[Note|Alias]] |');
assert.equal(table.children[0].type, 'table'); assert.equal(table.children[0].children[1].children.length, 1); assert.equal(table.children[0].children[1].children[0].children[0].type, 'wikiLink');
await fs.mkdir('build', { recursive: true });
await build({ entryPoints: ['src/markdown-preview.tsx'], outfile: 'build/wiki-export-check.mjs', bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node24' });
await build({ entryPoints: ['src/markdown-preparation.ts'], outfile: 'build/wiki-preparation-check.mjs', bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node24' });
const { SafeMarkdown } = await import('../build/wiki-export-check.mjs');
const { preparePreview } = await import('../build/wiki-preparation-check.mjs');
const snapshot = { generation: 1, revision: 1, folder: 'fixture', issues: [], notes: ['Map.md', 'Note.md'].map(id => ({ id, metadata: { links: [] }, headings: [], blocks: [] })) };
for (const body of ['[[Note|[bad](https://evil.test)]]', '[[Absent|**alias** [bad](https://evil.test)]]', '![[Note]]', '![ref][x]\n\n[x]: https://evil.test/x', '[bad][x]\n\n[x]: Absent\n\n[x]: https://evil.test']) {
  const html = renderToStaticMarkup(createElement(SafeMarkdown, { body, preview: preparePreview(body, snapshot, 'Map.md'), onNavigate() {}, onExternal() {} })); assert.doesNotMatch(html, /<(a|img|iframe)\b/);
}
console.log(`Wiki exports + final Markdown policy passed (${process.execArgv.includes('--conditions=development') ? 'development' : 'default'} condition): 10 assertions/cases.`);
