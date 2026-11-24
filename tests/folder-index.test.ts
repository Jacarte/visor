import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { FolderIndex, contained, INDEX_LIMITS } from '../src/folder-index';
import { MarkdownJobs } from '../src/markdown-jobs';
import { frontmatter } from '../src/frontmatter';
import { snapshotSource } from '../src/links';
import { buildGraph } from '../src/model';
let temp: string; let root: string; let index: FolderIndex;
const map = '---\nlabels: ["wayfinder:map"]\ntitle: Fixture map\n---\n# Overview\n\n[[Spec]]';
const ticket = '---\nlabels: ["wayfinder:task"]\nparent: "[[Map]]"\nstatus: open\nassignee: null\nblocked-by: []\n---\n# Detail\n\nA block ^actual';
beforeEach(async () => { temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'visor-folder-'))); root = path.join(temp, 'Project'); await fs.mkdir(root); index = new FolderIndex([path.join(temp, 'application')]); });
afterEach(async () => { index.close(); await fs.chmod(root, 0o755).catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); vi.restoreAllMocks(); });
async function write(id: string, body: string) { await fs.mkdir(path.dirname(path.join(root, id)), { recursive: true }); await fs.writeFile(path.join(root, id), body); }
async function hashes(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const visit = async (dir: string) => { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); const id = path.relative(directory, full); if (entry.isDirectory()) { result[id + '/'] = 'directory'; await visit(full); } else if (entry.isFile()) result[id] = createHash('sha256').update(await fs.readFile(full)).digest('hex'); else if (entry.isSymbolicLink()) result[id] = 'symlink:' + await fs.readlink(full); } };
  await visit(directory); return result;
}
it('folder-index builds real YAML/Markdown records, all artifacts and conservative graph without writing any fixture file', async () => {
  await write('Map.md', map); await write('Task.md', ticket); await write('Spec.md', '# Specification\n\nGeneric artifact'); await write('nested/Handoff.md', '# Handoff'); await write('.hidden', 'hidden stays unchanged'); await write('.obsidian/config.json', '{"keep":true}');
  const before = await hashes(root); const snapshot = await index.select(root);
  expect(snapshot.notes.map(n => n.id)).toEqual(['Map.md', 'nested/Handoff.md', 'Spec.md', 'Task.md']);
  const graph = buildGraph(snapshotSource(snapshot), 'Map.md');
  expect(graph.nodes.find(n => n.id === 'Task.md')).toMatchObject({ kind: 'ticket', readiness: 'frontier' });
  expect(graph.nodes.find(n => n.id === 'Spec.md')?.kind).toBe('support');
  expect(snapshot.notes.find(n => n.id === 'Task.md')).toMatchObject({ blocks: ['actual'], headings: [{ text: 'Detail', anchor: 'heading-detail' }] });
  expect((await index.readNote('Task.md', snapshot.generation)).body).toContain('A block ^actual');
  expect((await index.readNote('Task.md', snapshot.generation)).body).not.toContain('blocked-by');
  await index.refresh(); expect(await hashes(root)).toEqual(before);
});
it('folder-index counts GFM task checkboxes per note, including nested and ordered items, but not fenced code or plain bullets', async () => {
  await write('Tasks.md', '# Plan\n\n- [ ] open\n- [x] done\n  - [X] nested done\n- plain\n\n1. [ ] ordered open\n2. [x] ordered done\n\n```md\n- [ ] in code\n```\n');
  await write('Plain.md', '# None\n\n- item');
  const snapshot = await index.select(root);
  expect(snapshot.notes.find(n => n.id === 'Tasks.md')?.metadata?.tasks).toEqual({ done: 3, total: 5 });
  expect(snapshot.notes.find(n => n.id === 'Plain.md')?.metadata?.tasks).toEqual({ done: 0, total: 0 });
});
it('folder-index refuses private selected roots AND their absolute ancestors before crawling; skips private/symlink descendants', async () => {
  await write('Map.md', map); await write('chats/Private.md', 'secret'); await write('Javier(me) notes/Never.md', 'secret');
  const outside = path.join(temp, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'Secret.md'), 'OUTSIDE');
  await fs.symlink(outside, path.join(root, 'link-dir')); await fs.symlink(path.join(outside, 'Secret.md'), path.join(root, 'link.md'));
  const snapshot = await index.select(root); expect(snapshot.notes.map(n => n.id)).toEqual(['Map.md']);
  for (const selected of [path.join(root, 'chats'), path.join(root, 'chats', 'nested'), path.join(root, 'Javier(me) notes')]) await expect(index.select(selected)).rejects.toThrow(/private/);
  const alias = path.join(temp, 'alias'); await fs.symlink(path.join(root, 'chats'), alias); await expect(index.select(alias)).rejects.toThrow(/private/);
  await expect(index.readNote('link.md', snapshot.generation)).rejects.toThrow(/Unknown/);
});
it('folder-index denies stale/unknown/traversal IDs, sibling-prefix and symlink replacements', async () => {
  await write('Map.md', map); const selected = await index.select(root);
  const sibling = root + '-sibling'; await fs.mkdir(sibling); await fs.writeFile(path.join(sibling, 'Map.md'), 'OUTSIDE');
  expect(contained(root, path.join(sibling, 'Map.md'))).toBe(false);
  for (const id of ['../Project-sibling/Map.md', '/etc/passwd', 'Unknown.md', '%2e%2e/Map.md', 'C:\\secret', 'Map.md\u0000']) await expect(index.readNote(id, selected.generation)).rejects.toThrow();
  await fs.unlink(path.join(root, 'Map.md')); await fs.symlink(path.join(sibling, 'Map.md'), path.join(root, 'Map.md')); await expect(index.readNote('Map.md', selected.generation)).rejects.toThrow(/linked|regular/);
  const second = path.join(temp, 'Second'); await fs.mkdir(second); await fs.writeFile(path.join(second, 'Map.md'), map);
  await index.select(second); await expect(index.readNote('Map.md', selected.generation)).rejects.toThrow(/stale/);
});
it('folder-index rejects overlap with app/userData/build locations in either direction', async () => {
  await fs.mkdir(path.join(temp, 'application')); await expect(index.select(temp)).rejects.toThrow(/separate/);
  await expect(index.select(path.join(temp, 'application'))).rejects.toThrow(/separate/);
  await fs.mkdir(path.join(temp, 'application', 'nested')); await expect(index.select(path.join(temp, 'application', 'nested'))).rejects.toThrow(/separate/);
});
it('folder-index genuinely reads a nonwritable tree without adding notes, config or cache', async () => {
  await write('Map.md', map); await write('.hidden', 'keep'); await fs.chmod(path.join(root, 'Map.md'), 0o444); await fs.chmod(path.join(root, '.hidden'), 0o444); await fs.chmod(root, 0o555);
  const before = await hashes(root); const snapshot = await index.select(root); expect((await index.readNote('Map.md', snapshot.generation)).body).toContain('Overview'); expect(await hashes(root)).toEqual(before);
});
it('folder-index live watches create/modify/atomic rename/delete and closes the prior root watcher', async () => {
  await write('Map.md', map); await index.select(root);
  await write('Created.md', '# Created'); await vi.waitFor(() => expect(index.current().notes.some(n => n.id === 'Created.md')).toBe(true), { timeout: 5000 });
  await write('Created.md', '# Modified'); await vi.waitFor(() => expect(index.current().notes.find(n => n.id === 'Created.md')?.headings[0].text).toBe('Modified'), { timeout: 5000 });
  await write('.atomic', '# Atomic'); await fs.rename(path.join(root, '.atomic'), path.join(root, 'Created.md')); await vi.waitFor(() => expect(index.current().notes.find(n => n.id === 'Created.md')?.headings[0].text).toBe('Atomic'), { timeout: 5000 });
  await fs.rename(path.join(root, 'Created.md'), path.join(root, 'Renamed.md')); await vi.waitFor(() => expect(index.current().notes.some(n => n.id === 'Renamed.md')).toBe(true), { timeout: 5000 });
  await fs.unlink(path.join(root, 'Renamed.md')); await vi.waitFor(() => expect(index.current().notes.some(n => n.id === 'Renamed.md')).toBe(false), { timeout: 5000 });
  const watcher = (index as unknown as { watcher: { close(): void } }).watcher; const close = vi.spyOn(watcher, 'close');
  const second = path.join(temp, 'Second'); await fs.mkdir(second); await fs.writeFile(path.join(second, 'Map.md'), map); const switched = await index.select(second);
  expect(close).toHaveBeenCalledOnce();
  await write('Old.md', '# Old'); await new Promise(resolve => setTimeout(resolve, 350)); expect(index.current().generation).toBe(switched.generation); expect(index.current().notes).toEqual(switched.notes);
});
it('folder-index discards an old-root read and scan when switching roots during awaited I/O', async () => {
  await write('Map.md', map); const selected = await index.select(root);
  const realOpen = fs.open.bind(fs); let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; }); let entered!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; });
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => { if (args[0] === path.join(root, 'Map.md')) { entered(); await blocked; } return realOpen(...args); });
  const read = index.readNote('Map.md', selected.generation); const rejection = expect(read).rejects.toThrow(/Stale|changed/); await waiting;
  const second = path.join(temp, 'Second'); await fs.mkdir(second); await fs.writeFile(path.join(second, 'Other.md'), '# Other'); await index.select(second); release(); await rejection;
});
it.each(['close', 'switch'] as const)('folder-index never enqueues an obsolete scan after final handle close during %s', async action => {
  await write('Note.md', '# OLD_BODY');
  const second = path.join(temp, 'Second'); await fs.mkdir(second); await fs.writeFile(path.join(second, 'Healthy.md'), '# HEALTHY_BODY');
  const events: string[] = []; const publish = vi.fn(); const jobs = new MarkdownJobs('unused-worker.cjs');
  vi.spyOn(jobs, 'cancel').mockImplementation(() => { events.push('cancel'); });
  const run = vi.spyOn(jobs, 'run').mockImplementation(async request => {
    events.push(`run:${request.markdown}`);
    return { record: { metadata: { links: [] }, headings: [], blocks: [] }, body: request.markdown };
  });
  index.close(); index = new FolderIndex([], publish, jobs);
  let release!: () => void; let enter!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { enter = resolve; });
  const realOpen = fs.open.bind(fs); let gated = false;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await realOpen(...args);
    if (!gated && args[0] === path.join(root, 'Note.md')) {
      gated = true; const realClose = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementationOnce(async () => { enter(); await gate; await realClose(); });
    }
    return handle;
  });
  const oldSelection = index.select(root);
  try {
    await entered;
    expect(run).not.toHaveBeenCalled();
    expect(events).toEqual(['cancel']);
    if (action === 'close') index.close();
    else await index.select(second);
    const current = index.current(); const publications = publish.mock.calls.length;
    release(); await oldSelection;
    expect(events).toEqual(action === 'close' ? ['cancel', 'cancel'] : ['cancel', 'cancel', 'run:# HEALTHY_BODY']);
    expect(publish).toHaveBeenCalledTimes(publications);
    expect(index.current()).toBe(current);
    if (action === 'close') await index.select(second);
    expect(run.mock.calls.map(([request]) => request.markdown)).toEqual(['# HEALTHY_BODY']);
    expect(index.current().notes).toMatchObject([{ id: 'Healthy.md', metadata: { links: [] } }]);
  } finally { release(); await oldSelection; }
});
it('folder-index coalesces refresh bursts into bounded work while preserving the last invalidation', async () => {
  await write('Map.md', map); await index.select(root);
  const realOpen = fs.open.bind(fs); let release!: () => void; let enter!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { enter = resolve; }); let block = true;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => { if (block) { block = false; enter(); await gate; } return realOpen(...args); });
  const first = index.refresh(); await entered;
  for (let i = 0; i < 100; i++) expect(index.refresh()).toBe(first);
  release(); await first; expect(index.current().notes[0].id).toBe('Map.md');
});
it('frontmatter preserves bounded keyed YAML wiki context links without projecting arbitrary fields', () => {
  const parsed = frontmatter('---\nlabels: [wayfinder:map]\ncontext:\n  - "[[Spec|Specification]]"\n---\nbody');
  expect(parsed.links).toEqual([{ link: 'Spec', original: '[[Spec]]', key: 'context[0]' }]); expect(parsed.metadata.context).toBeUndefined();
});
it('frontmatter enforces core YAML/string unique keys, no tags/aliases/anchors and concrete structural limits', () => {
  expect(frontmatter('---\ntitle: Hello\nlabels: [wayfinder:map]\n---\n# Body').metadata.title).toBe('Hello');
  for (const yaml of ['title: one\ntitle: two', 'title: !!js/function function(){}', 'title: !custom x', 'title: &a x\nstatus: *a', 'title: [a, {nested: value}]', '? [a, b]\n: value', 'title: ' + '['.repeat(30) + 'x' + ']'.repeat(30), 'title: ' + 'x'.repeat(INDEX_LIMITS.frontmatterBytes), 'nested:\n' + ' '.repeat(100) + 'x: y']) expect(() => frontmatter(`---\n${yaml}\n---\nbody`), yaml.slice(0, 50)).toThrow();
});
it('folder-index oversized/bad metadata is visibly unavailable, never a satisfied blocker', async () => {
  await write('Map.md', map); await write('Task.md', ticket.replace('blocked-by: []', 'blocked-by: ["[[Bad]]"]')); await write('Bad.md', '---\nstatus: done\nstatus: open\n---\nbody'); await write('Huge.md', 'x'.repeat(INDEX_LIMITS.fileBytes + 1));
  const snapshot = await index.select(root); expect(snapshot.issues.length).toBe(2); expect(snapshot.notes.find(n => n.id === 'Bad.md')?.metadata).toBeNull();
  expect(buildGraph(snapshotSource(snapshot), 'Map.md').nodes.find(n => n.id === 'Task.md')?.readiness).toBe('unknown');
});
