import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
const { callbacks, watchers } = vi.hoisted(() => ({ callbacks: [] as ((event: string, filename: string | null) => void)[], watchers: [] as { close: ReturnType<typeof vi.fn>; emit: (event: string, error: Error) => boolean }[] }));
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), watch: vi.fn((_root, _options, callback) => { const watcher = Object.assign(new EventEmitter(), { close: vi.fn() }); callbacks.push(callback); watchers.push(watcher); return watcher; }) }));
import { FolderIndex } from '../src/folder-index';
let temp: string | undefined; let index: FolderIndex | undefined;
afterEach(async () => { index?.close(); if (temp) await fs.rm(temp, { recursive: true, force: true }); });
it('folder-watch treats null/hostile filenames only as debounced invalidation and reports watcher failure with manual recovery', async () => {
  temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'visor-watch-'))); await fs.writeFile(path.join(temp, 'Map.md'), '# Map');
  index = new FolderIndex([]); await index.select(temp); const firstRevision = index.current().revision;
  await fs.writeFile(path.join(temp, 'Created.md'), '# Created'); callbacks[0]('rename', null); callbacks[0]('change', '../../outside/secret.md');
  await vi.waitFor(() => expect(index!.current().notes.map(n => n.id)).toEqual(['Created.md', 'Map.md']), { timeout: 3000 });
  expect(index.current().revision).toBe(firstRevision + 1);
  watchers[0].emit('error', new Error('simulated watcher error')); expect(watchers[0].close).toHaveBeenCalledOnce(); expect(index.current().issues.join(' ')).toContain('Use Refresh');
  await fs.unlink(path.join(temp, 'Created.md')); await index.refresh(); expect(index.current().notes.map(n => n.id)).toEqual(['Map.md']); expect(index.current().issues.join(' ')).toContain('Use Refresh');
});
