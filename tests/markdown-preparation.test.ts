// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { preparePreview } from '../src/markdown-preparation';
import { SafeMarkdown } from '../src/markdown-preview';
import { canonicalDestination, resolveNote } from '../src/links';
import { markdownStructure } from '../src/markdown-structure';
import type { FolderSnapshot } from '../src/contracts';
it('markdown-preparation preserves original authoritative IDs through omitted media and unavailable links', () => {
  const body = '# [broken](Missing)\n\n# ![alt](https://evil.test/img)\n\n# Duplicate\n\n# Duplicate\n\n# `code` [[Target|Label]]';
  const structure = markdownStructure(body); const snapshot: FolderSnapshot = { generation: 1, revision: 1, folder: 'Fixture', issues: [], notes: [{ id: 'Target.md', metadata: { links: [] }, ...structure }] };
  const preview = preparePreview(body, snapshot, 'Target.md');
  const host = document.createElement('div'); host.innerHTML = renderToStaticMarkup(createElement(SafeMarkdown, { body, preview, onNavigate() {}, onExternal() {} }));
  expect([...host.querySelectorAll('h1')].map(h => h.id)).toEqual(structure.headings.map(h => h.anchor));
  expect(resolveNote(snapshot.notes, 'Target#broken', 'Target.md')?.anchor).toBe(host.querySelector('h1')?.id);
  expect(host.querySelectorAll('img')).toHaveLength(0);
});
it.each([
  { body: '[broken](Missing)\n===\n', anchor: 'heading-broken' },
  { body: '![alt](https://example.com/x)\n===\n', anchor: 'heading-section' },
])('markdown-preparation preserves Setext identity at an edit start: $anchor', ({ body, anchor }) => {
  const structure = markdownStructure(body); const snapshot: FolderSnapshot = { generation: 1, revision: 1, folder: 'Fixture', issues: [], notes: [{ id: 'Note.md', metadata: { links: [] }, ...structure }] };
  const preview = preparePreview(body, snapshot, 'Note.md');
  const host = document.createElement('div'); host.innerHTML = renderToStaticMarkup(createElement(SafeMarkdown, { body, preview, onNavigate() {}, onExternal() {} }));
  expect(structure.headings.map(h => h.anchor)).toEqual([anchor]);
  expect([...host.querySelectorAll('h1')].map(h => h.id)).toEqual(structure.headings.map(h => h.anchor));
  expect(host.querySelectorAll('img')).toHaveLength(0);
});
it('markdown-preparation maps duplicate Setext identities after earlier edits without assigning removed headings', () => {
  const body = '![first](https://example.com/first)\n\n[broken](Missing)\n===\n\n[broken](Missing)\n===\n\n![[Missing|label\n\n# Removed\n\n]]\n\n# After';
  const structure = markdownStructure(body); const snapshot: FolderSnapshot = { generation: 1, revision: 1, folder: 'Fixture', issues: [], notes: [{ id: 'Note.md', metadata: { links: [] }, ...structure }] };
  expect(structure.headings.map(h => h.anchor)).toEqual(['heading-broken', 'heading-broken-1', 'heading-removed', 'heading-after']);
  const preview = preparePreview(body, snapshot, 'Note.md');
  const host = document.createElement('div'); host.innerHTML = renderToStaticMarkup(createElement(SafeMarkdown, { body, preview, onNavigate() {}, onExternal() {} }));
  expect([...host.querySelectorAll('h1')].map(h => h.id)).toEqual(structure.headings.filter(h => h.text !== 'Removed').map(h => h.anchor));
  expect(host.querySelectorAll('img, #heading-removed')).toHaveLength(0);
});
it('canonical graph destination is identity, not authored source-relative text', () => {
  const notes = ['Project/Map.md', 'Project/Task.md', 'Project/Project/Task.md', 'Other/Task.md'].map(id => ({ id, metadata: { links: [] }, headings: [{ text: 'Right', anchor: 'heading-right' }], blocks: [] }));
  notes[2].headings = [{ text: 'Wrong', anchor: 'heading-wrong' }];
  const destination = { path: 'Project/Task.md', linktext: 'Project/Task.md#Right', sourcePath: 'Project/Map.md' };
  expect(canonicalDestination(notes, destination)).toEqual({ id: 'Project/Task.md', anchor: 'heading-right' });
  expect(resolveNote(notes, 'Project/Task.md#Wrong', 'Project/Map.md')).toEqual({ id: 'Project/Project/Task.md', anchor: 'heading-wrong' });
});
