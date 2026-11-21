import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FolderIndex } from '../src/folder-index';
import { MarkdownJobs, MarkdownCapacityError } from '../src/markdown-jobs';
const attacks = ['> '.repeat(20000) + 'x', '['.repeat(120000) + ']'.repeat(120000), '[[x|'.repeat(40000) + ']]'];
const indexes: FolderIndex[] = []; const dirs: string[] = [];
afterEach(async () => { for (const index of indexes.splice(0)) index.close(); for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function fixture(body: string) { const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'visor-isolation-'))); dirs.push(dir); await fs.writeFile(path.join(dir, 'Note.md'), body); return dir; }
function index() { const value = new FolderIndex([]); indexes.push(value); return value; }
it.each(attacks)('markdown-isolation terminates the entire job and returns inert exact-body fallback (%#)', async body => {
  const root = await fixture(body); const value = index(); let ticks = 0; const heartbeat = setInterval(() => ticks++, 20); const start = performance.now();
  try {
    const snapshot = await value.select(root);
    expect(performance.now() - start).toBeLessThan(3500); expect(ticks).toBeGreaterThan(5);
    const selected = await value.readNote('Note.md', snapshot.generation);
    expect(value.current().notes[0].metadata).toBeNull(); expect(value.current().issues.join(' ')).toMatch(/unavailable/);
    expect(selected.preview.kind).toBe('plain'); expect(selected.body).toBe(body.slice(0, 256 * 1024));
  } finally { clearInterval(heartbeat); }
}, 10000);
it('markdown-isolation includes Markdown inside YAML values in the same terminable job', async () => {
  const body = `---\ncontext: ${JSON.stringify('> '.repeat(20000) + 'x [[Note]]')}\n---\n# Safe-looking body`;
  const root = await fixture(body); const value = index(); let ticks = 0; const heartbeat = setInterval(() => ticks++, 20);
  try { const selected = await value.select(root); expect(selected.notes[0].metadata).toBeNull(); expect(ticks).toBeGreaterThan(5); expect((await value.readNote('Note.md', selected.generation)).preview.kind).toBe('plain'); }
  finally { clearInterval(heartbeat); }
}, 10000);
it('markdown-isolation bounds final highlighting/output even after a cheap successful index parse', async () => {
  const root = await fixture('```js\n' + 'const value = 1;\n'.repeat(10000) + '```'); const value = index(); const selected = await value.select(root);
  expect(selected.notes[0].metadata).not.toBeNull(); const note = await value.readNote('Note.md', selected.generation);
  expect(note.preview.kind).toBe('plain'); expect(value.current().notes[0].metadata).toBeNull(); expect(value.current().issues.join(' ')).toMatch(/unavailable/);
}, 10000);
it('markdown-isolation cancels obsolete work before a healthy root, including repeated cancellation', async () => {
  const bad = await fixture(attacks[1]); const good = await fixture('# Healthy\n\n**Formatted**'); const value = index();
  for (let i = 0; i < 4; i++) {
    const old = value.select(bad); await new Promise(resolve => setTimeout(resolve, 100)); const start = performance.now();
    const healthy = await value.select(good); await old;
    expect(performance.now() - start).toBeLessThan(1500); expect(value.current().generation).toBe(healthy.generation);
    expect((await value.readNote('Note.md', healthy.generation)).preview.kind).toBe('formatted');
  }
}, 15000);
it('markdown-isolation validates a fresh body rather than trusting old safe index metadata', async () => {
  const root = await fixture('# Safe'); const value = index(); const selected = await value.select(root);
  await fs.writeFile(path.join(root, 'Note.md'), attacks[1]);
  const note = await value.readNote('Note.md', selected.generation).catch(() => null);
  if (note) expect(note.preview.kind).toBe('plain');
  else { const current = await value.refresh(); expect((await value.readNote('Note.md', current.generation)).preview.kind).toBe('plain'); }
}, 10000);
it('markdown-isolation keeps a healthy complex 62 KiB specification formatted', async () => {
  const section = '\n## Details\n\nA **formatted** specification with `code`, [[Note#Overview|a self link]], and [reference][ref].\n\n| Item | Value |\n| --- | --- |\n| Safe | **yes** |\n\n- [ ] Disabled task\n\n```js\nconst specification = true;\n```\n\n> A useful quotation.\n';
  const body = '# Overview\n\n[ref]: https://example.com/spec\n' + section.repeat(Math.ceil(62 * 1024 / section.length));
  const root = await fixture(body); const value = index(); const selected = await value.select(root);
  expect(selected.notes[0].metadata).not.toBeNull();
  const note = await value.readNote('Note.md', selected.generation); expect(note.preview.kind).toBe('formatted');
  if (note.preview.kind === 'formatted') { expect(JSON.stringify(note.preview.tree)).toContain('hljs-keyword'); expect(note.preview.anchors.length).toBeGreaterThan(200); }
}, 10000);
it('markdown-isolation does not permanently cache transient capacity pressure as an unsafe body', async () => {
  const root = await fixture('# Healthy'); const jobs = new MarkdownJobs(path.resolve('build/app/markdown-worker.cjs')); const value = new FolderIndex([], undefined, jobs); indexes.push(value);
  const selected = await value.select(root); const run = vi.spyOn(jobs, 'run').mockRejectedValueOnce(new MarkdownCapacityError('Markdown preparation queue full'));
  expect((await value.readNote('Note.md', selected.generation)).preview.kind).toBe('plain'); run.mockRestore();
  const refreshed = await value.refresh(); expect(refreshed.notes[0].metadata).not.toBeNull(); expect((await value.readNote('Note.md', refreshed.generation)).preview.kind).toBe('formatted');
}, 10000);
it('markdown-isolation bounds aggregate indexing rather than spending a timeout on every file', async () => {
  const root = await fixture(attacks[1]); for (let i = 0; i < 12; i++) await fs.writeFile(path.join(root, `Bad${i}.md`), attacks[1]);
  const start = performance.now(); const snapshot = await index().select(root);
  expect(performance.now() - start).toBeLessThan(10000); expect(snapshot.notes).toHaveLength(13); expect(snapshot.notes.every(n => n.metadata === null)).toBe(true); expect(snapshot.issues.join(' ')).toMatch(/budget/);
}, 15000);
