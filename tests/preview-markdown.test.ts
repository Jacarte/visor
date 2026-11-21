import { expect, it } from 'vitest';
import { previewMarkdown } from '../src/preview-markdown';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Node } from 'unist';
function activeSyntax(markdown: string) {
  const nodes: (Node & { children?: Node[]; value?: string; url?: string; identifier?: string })[] = [];
  const walk = (node: Node & { children?: Node[] }) => { nodes.push(node); node.children?.forEach(walk); };
  walk(unified().use(remarkParse).parse(markdown));
  let outsideCode = markdown;
  for (const node of nodes.filter(n => n.type === 'code' || n.type === 'inlineCode').reverse()) {
    outsideCode = outsideCode.slice(0, node.position!.start.offset) + outsideCode.slice(node.position!.end.offset);
  }
  return { nodes, outsideCode };
}
it('omits aliased/heading/relative wiki embeds and inline/reference Markdown images only in preview', () => {
  const source = 'Hello ![[../chats/Note#Heading|Alias]] ![[Javier(me) notes/Note#^block]]\n\n![alt](https://example.com/a.png "Title") ![ref][id]\n\n[id]: https://example.com/b.png\n\n[[Support#Heading|link]] [web](https://example.com)';
  const output = previewMarkdown(source);
  expect(output.omitted).toBe(true); expect(output.markdown).not.toContain('![[ ');
  expect(output.markdown).not.toContain('![['); expect(output.markdown).not.toContain('![alt]'); expect(output.markdown).not.toContain('![ref]');
  expect(output.markdown).toContain('[[Support#Heading|link]] [web](https://example.com)');
  expect(source).toContain('![[../chats/Note#Heading|Alias]]');
});
it('escapes raw HTML forms/media/resources as text, including multiline HTML', () => {
  const output = previewMarkdown('<form><input value="x"><img src="https://example.com/x"></form>\n\n<video src="x"></video>');
  expect(output.omitted).toBe(true); expect(output.markdown).toContain('` <form>'); expect(output.markdown).toContain('` <video');
});
it('keeps code examples, escaped wiki embeds, ordinary Markdown and tasks unchanged', () => {
  const source = '# Title\n\n- [ ] Task\n\n`![[chats/Example]]`\n\n```md\n![[chats/Example]]\n<img src="x">\n```\n\n\\![[Escaped]]';
  expect(previewMarkdown(source)).toEqual({ markdown: source, omitted: false });
});

it('makes HTML attribute wiki/image syntax inert inside code spans, even with embedded backticks', () => {
  const result = previewMarkdown('<img title="` ![[chats/Private]] ![a](https://example.com/a.png)">');
  expect(result.markdown).toMatch(/^`` /);
  expect(previewMarkdown(result.markdown).omitted).toBe(false);
});
it('makes excluded wiki, inline Markdown and reference links inert without reinterpreting code or changing allowed links', () => {
  const source = '[[chats/Private#Heading|Alias]] [private](Javier(me)%20notes/Private) [ref][p] [[Support]] [web](https://example.com)\n\n[p]: chats/Private';
  const result = previewMarkdown(source, text => text === 'Support' || text.startsWith('https:'));
  expect(result.markdown).toContain('` [[chats/Private#Heading|Alias]] `');
  expect(result.markdown).toContain('` [private](Javier(me)%20notes/Private) `');
  expect(result.markdown).toContain('` [ref][p] `');
  expect(result.markdown).toContain('[[Support]] [web](https://example.com)');
});

it.each(['*alias*', '**bold**', '_emphasis_', '~~strike~~', '`code`', 'punctuation: (a), !?', 'line\nbreak'])('recognizes whole wiki links/embeds with %s aliases before host rendering', alias => {
  for (const prefix of ['!', '']) {
    const source = `${prefix}[[../chats/Private#^block|${alias}]]`;
    const result = previewMarkdown(source, () => false);
    expect(result.omitted).toBe(true);
    const active = activeSyntax(result.markdown);
    expect(active.outsideCode).not.toContain('[[');
    expect(active.outsideCode).not.toContain('![[');
    expect(result.markdown).toBe(prefix ? '[Note embed omitted in Visor preview]' : `${alias.includes('`') ? '``' : '`'} ${source.replaceAll('\n', ' ')} ${alias.includes('`') ? '``' : '`'}`);
    expect(previewMarkdown(result.markdown, () => false).omitted).toBe(false);
  }
});
it('preserves resolved formatted wiki links and makes nested Markdown images inert without creating embeds', () => {
  const source = '[[../Shared#Heading|*alias*]] [[Shared#^block|**bold**]]';
  expect(previewMarkdown(source, () => true)).toEqual({ markdown: source, omitted: false });
  const result = previewMarkdown('![[Shared|![x](https://example.com/x)]] [[Absent|![x](https://example.com/x)]]', () => false);
  expect(result.markdown).toBe('[Note embed omitted in Visor preview] ` [[Absent|![x](https://example.com/x)]] `');
  expect(activeSyntax(result.markdown).nodes.some(n => n.type === 'image')).toBe(false);
});
it('does not scan wiki-looking code, escaped literals or incomplete wiki syntax across formatting boundaries', () => {
  const source = '`![[chats/Private|*alias*]]`\n\n```md\n[[chats/Private|**alias**]]\n```\n\n    ![[chats/Private|*alias*]]\n\n\\![[Private|*alias*]] \\[[Private|**alias**]] [[incomplete';
  expect(previewMarkdown(source, () => false)).toEqual({ markdown: source, omitted: false });
  const evenEscape = previewMarkdown('\\\\![[chats/Private|*alias*]]', () => false);
  expect(evenEscape.markdown).toBe('\\\\[Note embed omitted in Visor preview]');
});
it.each(['> [p]: chats/Private', '- [p]: chats/Private', '> - [p]: chats/Private'])('checks recursively nested definitions: %s', definition => {
  const source = `[private][p] [p][] [p]\n\n${definition}`;
  const result = previewMarkdown(source, () => false);
  expect(result.markdown).toBe('` [private][p] ` ` [p][] ` ` [p] `\n\n' + definition);
  expect(activeSyntax(result.markdown).nodes.some(n => n.type === 'linkReference')).toBe(false);
});
it('uses normalized identifiers and the first valid definition, including nested duplicates', () => {
  const blockedFirst = '[private][ A\n B ]\n\n> [a b]: chats/Private\n\n[A B]: Shared';
  const result = previewMarkdown(blockedFirst, text => text === 'Shared');
  expect(result.markdown.startsWith('` [private][ A  B ] `')).toBe(true);
  expect(activeSyntax(result.markdown).nodes.some(n => n.type === 'linkReference')).toBe(false);
  const allowedFirst = '[public][ A  B ]\n\n- [a b]: Shared\n\n[A B]: chats/Private';
  expect(previewMarkdown(allowedFirst, text => text === 'Shared')).toEqual({ markdown: allowedFirst, omitted: false });
});
it('omits all reference image forms with nested definitions while retaining allowed links and unresolved reference text', () => {
  const source = '![image][p] ![p][] ![p]\n\n> [p]: https://example.com/image.png';
  const result = previewMarkdown(source, () => true);
  expect(result.markdown).toBe('[Image omitted in Visor preview] [Image omitted in Visor preview] [Image omitted in Visor preview]\n\n> [p]: https://example.com/image.png');
  expect(activeSyntax(result.markdown).nodes.some(n => n.type === 'imageReference')).toBe(false);
  const allowed = '[internal][s] [web][w] [mail][m]\n\n> [s]: Shared\n> [w]: https://example.com\n> [m]: mailto:hello@example.com';
  expect(previewMarkdown(allowed, text => text === 'Shared' || /^(https:|mailto:)/.test(text))).toEqual({ markdown: allowed, omitted: false });
  const missing = '[private][unknown] [unknown][] [unknown]';
  const unknown = previewMarkdown(missing, () => false);
  expect(activeSyntax(unknown.markdown).nodes.some(n => n.type === 'linkReference' || n.type === 'link')).toBe(false);
});
it('keeps overlapping wiki/HTML/code edits inert and never exposes nested embeds through reconstruction', () => {
  for (const source of [
    '[[Absent|<img title="]] ![[chats/Private]]">',
    '[[Absent|`]]` ![[chats/Private|*alias*]]',
    '[[Shared|![[chats/Private|*alias*]]]]',
    '![[Shared|[[chats/Private|*alias*]]]]',
    '`[[incomplete` ![[chats/Private|*alias*]]',
    '[[Absent|line\r\n\r\nbreak]] ![[chats/Private]]',
    '[[Absent|line\r\rbreak]] ![[chats/Private]]'
  ]) {
    const result = previewMarkdown(source, text => text === 'Shared');
    const active = activeSyntax(result.markdown);
    expect(active.outsideCode).not.toContain('![[');
    expect(active.outsideCode).not.toContain('chats/Private');
    expect(active.nodes.some(n => n.type === 'html' || n.type === 'image' || n.type === 'imageReference')).toBe(false);
    expect(previewMarkdown(result.markdown, text => text === 'Shared').omitted).toBe(false);
  }
});
it.each(['[[Absent]]', '![[Absent]]'])('preserves effective HTTP reference destinations containing %s before forbidden duplicates', suffix => {
  const url = `https://example.com/${suffix}`;
  for (const prefix of ['', '> ', '- ', '> - ']) {
    const source = `[public][p]\n\n${prefix}[p]: ${url}\n\n[p]: chats/Private`;
    const result = previewMarkdown(source, text => /^https?:/.test(text));
    const { nodes } = activeSyntax(result.markdown);
    const definitions = new Map<string, string>();
    for (const node of nodes) if (node.type === 'definition' && !definitions.has(node.identifier!)) definitions.set(node.identifier!, node.url!);
    const destinations = nodes.filter(node => node.type === 'linkReference').map(node => definitions.get(node.identifier!));
    expect(destinations).toEqual([url]);
    expect(destinations.every(destination => /^https?:/.test(destination!))).toBe(true);
    expect(result).toEqual({ markdown: source, omitted: false });
  }
});
it.each(['[[Absent]]', '![[Absent]]'])('preserves inline/autolink URL syntax containing %s while sanitizing rendered labels and prose', suffix => {
  const url = `https://example.com/${suffix}`;
  const source = `[public](${url}) <${url}> [public [[Absent|**hidden**]]](${url}) [[Absent|*prose*]]`;
  const result = previewMarkdown(source, text => /^https?:/.test(text));
  expect(activeSyntax(result.markdown).nodes.filter(node => node.type === 'link').map(node => node.url)).toEqual([url, url, url]);
  expect(result.markdown).toBe(`[public](${url}) <${url}> [public \` [[Absent|**hidden**]] \`](${url}) \` [[Absent|*prose*]] \``);
});
it('still sanitizes formatted wiki aliases containing a whole rendered Markdown link', () => {
  const source = '[[Absent|**alias** [web](https://example.com)]]';
  const result = previewMarkdown(source, text => /^https?:/.test(text));
  expect(result.markdown).toBe('` ' + source + ' `');
  expect(activeSyntax(result.markdown).nodes.some(node => node.type === 'link')).toBe(false);
});
it('applies first-definition precedence at root and fails closed for unresolved internal reference destinations', () => {
  const source = '[private][p]\n\n[p]: Absent\n\n[p]: Shared';
  const result = previewMarkdown(source, text => text === 'Shared');
  expect(result.markdown).toBe('` [private][p] `\n\n[p]: Absent\n\n[p]: Shared');
  expect(activeSyntax(result.markdown).nodes.some(n => n.type === 'linkReference')).toBe(false);
});
