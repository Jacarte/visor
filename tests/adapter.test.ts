// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { obsidianPreview, vaultSource } from '../src/adapter';
import { fakeApp, MarkdownRenderer, TFile } from './obsidian-mock';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Node } from 'unist';
beforeEach(() => vi.clearAllMocks());
it('vault adapter excludes forbidden paths before cache/read access and uses source-aware resolution', () => {
  const app = fakeApp(); const source = vaultSource(app as unknown as App);
  expect(source.paths()).toEqual(['Map.md']); expect(source.metadata('chats/Private.md')).toBeNull();
  expect(app.metadataCache.getFileCache).not.toHaveBeenCalled();
  source.metadata('Map.md'); expect(app.metadataCache.getFileCache).toHaveBeenCalledWith(app.files[0]);
  expect(source.resolve('chats/Private', 'Map.md')).toBeNull(); expect(app.metadataCache.getFirstLinkpathDest).not.toHaveBeenCalled();
  source.resolve('Map', 'folder/Source.md'); expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('Map', 'folder/Source.md');
  expect(app.vault.cachedRead).not.toHaveBeenCalled();
});
it('preview sanitizes resources without mutating source and opens headings/blocks with modifier intent', async () => {
  const app = fakeApp(); const body = '# Safe\n![[chats/Private#Heading|alias]]\n![Image](https://example.com/x.png)';
  app.vault.cachedRead.mockResolvedValue(body);
  const services = obsidianPreview(app as unknown as App); const host = document.createElement('div');
  const session = services.render({ path: 'Map.md', linktext: 'Map#Heading', sourcePath: 'Other.md' }, host); await session.ready;
  expect(MarkdownRenderer.render).toHaveBeenCalled(); expect(host.textContent).not.toContain('![['); expect(app.vault.cachedRead).toHaveBeenCalledTimes(1); expect(body).toContain('![[chats/Private');
  const link = document.createElement('a'); link.className = 'internal-link'; link.dataset.href = 'Map#^block'; host.append(link);
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
  expect(app.workspace.openLinkText).toHaveBeenCalledWith('Map#^block', 'Map.md', true);
  const forbidden = document.createElement('a'); forbidden.className = 'internal-link'; forbidden.dataset.href = 'chats/Private#Heading'; host.append(forbidden);
  forbidden.click(); expect(app.workspace.openLinkText).toHaveBeenCalledTimes(1);
  session.dispose(); const component = MarkdownRenderer.render.mock.calls[0][4]; expect(component.loaded).toBe(false);
});
it('does not read forbidden previews, and disposal before a read resolves skips renderer', async () => {
  const app = fakeApp(); const services = obsidianPreview(app as unknown as App); const host = document.createElement('div');
  const excluded = services.render({ path: 'chats/Private.md', linktext: 'chats/Private', sourcePath: 'Map.md' }, host);
  await expect(excluded.ready).rejects.toThrow(/excluded/); excluded.dispose(); expect(app.vault.cachedRead).not.toHaveBeenCalled();
  let resolve!: (text: string) => void; app.vault.cachedRead.mockImplementation(() => new Promise<string>(r => { resolve = r; }));
  const session = services.render({ path: 'Map.md', linktext: 'Map', sourcePath: 'Map.md' }, host); session.dispose(); resolve('Late'); await session.ready;
  expect(MarkdownRenderer.render).not.toHaveBeenCalled();
});
it('late renderer completion unloads the preview lifetime again', async () => {
  const app = fakeApp(); let finish!: () => void;
  MarkdownRenderer.render.mockImplementationOnce(async () => new Promise<void>(r => { finish = r; }));
  const services = obsidianPreview(app as unknown as App); const session = services.render({ path: 'Map.md', linktext: 'Map', sourcePath: 'Map.md' }, document.createElement('div'));
  await new Promise(resolve => setTimeout(resolve, 0)); session.dispose(); finish(); await session.ready;
  expect(MarkdownRenderer.render.mock.calls[0][4].unloadCount).toBeGreaterThanOrEqual(2);
});
it('immediately releases late child resources and cleanup registrations from a disposed renderer generation', async () => {
  const app = fakeApp(); let finish!: () => void;
  MarkdownRenderer.render.mockImplementationOnce(async () => new Promise<void>(r => { finish = r; }));
  const services = obsidianPreview(app as unknown as App); const session = services.render({ path: 'Map.md', linktext: 'Map', sourcePath: 'Map.md' }, document.createElement('div'));
  await new Promise(resolve => setTimeout(resolve, 0)); session.dispose();
  const lifetime = MarkdownRenderer.render.mock.calls[0][4];
  const child = new (await import('./obsidian-mock')).Component(); child.load(); lifetime.addChild(child);
  const cleanup = vi.fn(); lifetime.register(cleanup);
  expect(child.loaded).toBe(false); expect(cleanup).toHaveBeenCalledTimes(1); expect(lifetime.children).toHaveLength(0);
  finish(); await session.ready;
});
it('keeps allowed relative/aliased heading links live but blocks stale deletion, unresolved/excluded destinations and note creation', async () => {
  const app = fakeApp(); app.files.push(new TFile('work/Source.md'), new TFile('Shared.md'));
  app.metadataCache.getFirstLinkpathDest.mockImplementation((path, from) => {
    const resolved = path === '../Shared' && from === 'work/Source.md' ? 'Shared.md' : path.endsWith('.md') ? path : `${path}.md`;
    return app.files.find(file => file.path === resolved) ?? null;
  });
  const body = '[[../Shared#Heading|Alias]] [[Absent|Missing]] [[chats/Private|Excluded]] [web](https://example.com)';
  app.vault.cachedRead.mockResolvedValue(body);
  const services = obsidianPreview(app as unknown as App); const host = document.createElement('div');
  const session = services.render({ path: 'work/Source.md', linktext: 'work/Source', sourcePath: 'Map.md' }, host); await session.ready;
  const rendered = MarkdownRenderer.render.mock.calls[0][1];
  expect(rendered).toContain('[[../Shared#Heading|Alias]]'); expect(rendered).toContain('` [[Absent|Missing]] `'); expect(rendered).toContain('` [[chats/Private|Excluded]] `');
  expect(rendered).toContain('[web](https://example.com)');
  const link = document.createElement('a'); link.className = 'internal-link'; link.dataset.href = '../Shared#Heading'; host.append(link);
  link.click(); expect(app.workspace.openLinkText).toHaveBeenCalledWith('../Shared#Heading', 'work/Source.md', false);
  app.files.splice(app.files.findIndex(file => file.path === 'Shared.md'), 1); link.click();
  expect(app.workspace.openLinkText).toHaveBeenCalledTimes(1);
  services.open({ path: 'Absent.md', linktext: 'Absent', sourcePath: 'Map.md' }, false);
  services.open({ path: 'chats/Private.md', linktext: 'chats/Private', sourcePath: 'Map.md' }, false);
  expect(app.workspace.openLinkText).toHaveBeenCalledTimes(1); session.dispose();
});
it('re-evaluates unresolved preview links after metadata refresh without mutating the body', async () => {
  const app = fakeApp(); const body = '[[New note#^block|New]]'; app.vault.cachedRead.mockResolvedValue(body);
  const services = obsidianPreview(app as unknown as App); const dest = { path: 'Map.md', linktext: 'Map', sourcePath: 'Map.md' };
  const first = services.render(dest, document.createElement('div')); await first.ready; first.dispose();
  expect(MarkdownRenderer.render.mock.calls[0][1]).toBe('` [[New note#^block|New]] `');
  app.files.push(new TFile('New note.md'));
  const second = services.render(dest, document.createElement('div')); await second.ready;
  expect(MarkdownRenderer.render.mock.calls[1][1]).toBe(body); second.dispose(); expect(body).toBe('[[New note#^block|New]]');
});
it.each(['[[Absent]]', '![[Absent]]'])('does not activate forbidden duplicate references when an HTTP definition contains %s', async suffix => {
  const app = fakeApp();
  const url = `https://example.com/${suffix}`;
  const body = `[public][p]\n\n> - [p]: ${url}\n\n[p]: chats/Private`;
  app.vault.cachedRead.mockResolvedValue(body);
  const session = obsidianPreview(app as unknown as App).render({ path: 'Map.md', linktext: 'Map', sourcePath: 'Map.md' }, document.createElement('div'));
  await session.ready;
  const rendered = MarkdownRenderer.render.mock.calls[0][1];
  type AstNode = Node & { children?: AstNode[]; identifier?: string; url?: string };
  const definitions = new Map<string, string>(); const references: string[] = [];
  const walk = (node: AstNode) => {
    if (node.type === 'definition' && !definitions.has(node.identifier!)) definitions.set(node.identifier!, node.url!);
    if (node.type === 'linkReference') references.push(node.identifier!);
    node.children?.forEach(walk);
  };
  walk(unified().use(remarkParse).parse(rendered));
  expect(references.map(identifier => definitions.get(identifier))).toEqual([url]);
  expect(rendered).toBe(body);
  expect(app.metadataCache.getFirstLinkpathDest.mock.calls.some(([path]) => path.includes('chats'))).toBe(false);
  expect(app.vault.cachedRead).toHaveBeenCalledTimes(1);
  session.dispose();
});
it('forwards only inert formatted private wiki links/embeds and nested references to the public host renderer', async () => {
  const app = fakeApp();
  const body = '![[chats/Private|*alias*]] [[chats/Private|**alias**]] [[Absent|*missing*]] [[Map#^block|*allowed*]] [private][p] [map][m] [web](https://example.com) [mail](mailto:hello@example.com)\n\n> [p]: chats/Private\n\n- [m]: Map';
  app.vault.cachedRead.mockResolvedValue(body);
  const session = obsidianPreview(app as unknown as App).render({ path: 'Map.md', linktext: 'Map', sourcePath: 'Map.md' }, document.createElement('div'));
  await session.ready;
  expect(MarkdownRenderer.render.mock.calls[0][1]).toBe('[Note embed omitted in Visor preview] ` [[chats/Private|**alias**]] ` ` [[Absent|*missing*]] ` [[Map#^block|*allowed*]] ` [private][p] ` [map][m] [web](https://example.com) [mail](mailto:hello@example.com)\n\n> [p]: chats/Private\n\n- [m]: Map');
  expect(app.vault.cachedRead).toHaveBeenCalledTimes(1);
  expect(app.metadataCache.getFirstLinkpathDest.mock.calls.some(([path]) => path.includes('chats'))).toBe(false);
  expect(body.startsWith('![[chats/Private|*alias*]]')).toBe(true);
  session.dispose();
});
