import fs from 'node:fs/promises';
import { watch, constants, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MarkdownJobs, MarkdownCapacityError, MARKDOWN_BUDGET } from './markdown-jobs';
import type { FolderSnapshot, IndexedNote, NoteBody } from './contracts';
import { EMPTY_SNAPSHOT } from './contracts';
import type { NoteMetadata } from './model';
import { INDEX_LIMITS } from './index-limits';
export { INDEX_LIMITS } from './index-limits';
export function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate); return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
export function privatePath(candidate: string): boolean { return candidate.split(path.sep).some(p => ['chats', 'javier(me) notes'].includes(p.toLowerCase())); }
function validId(id: string): boolean { return id.length > 0 && id.length <= 4096 && !/[\\%\u0000-\u001f\u007f]/.test(id) && !path.isAbsolute(id) && !id.split('/').some(p => p === '..' || p === '.') && !privatePath(id); }
interface Root { canonical: string; dev: number; ino: number; generation: number }
/** Main-process-only, read-only index. It reads bounded bodies for metadata; only a selected body crosses IPC. */
export class FolderIndex {
  private root: Root | null = null;
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private revision = 0;
  private choosing = 0;
  private scanning: { root: Root; dirty: boolean; promise: Promise<FolderSnapshot> } | null = null;
  private records = new Map<string, IndexedNote>();
  private snapshot: FolderSnapshot = EMPTY_SNAPSHOT;
  private readonly jobs: MarkdownJobs;
  private failures = new Map<string, { hash: string; reason: string }>();
  constructor(private readonly ownPaths: string[], private readonly publish: (snapshot: FolderSnapshot) => void = () => {}, jobs = new MarkdownJobs(path.resolve('build/app/markdown-worker.cjs'))) { this.jobs = jobs; }
  current(): FolderSnapshot { return this.snapshot; }
  private stopWatcher() { clearTimeout(this.timer); this.watcher?.close(); this.watcher = null; }
  close() { this.choosing++; this.stopWatcher(); this.jobs.cancel(); this.root = null; this.records.clear(); this.failures.clear(); this.generation++; }
  async select(candidate: string): Promise<FolderSnapshot> {
    const request = ++this.choosing;
    if (typeof candidate !== 'string' || candidate.length > 8192 || !path.isAbsolute(candidate) || privatePath(candidate)) throw new Error('Folder is private or invalid');
    const canonical = await fs.realpath(candidate); const stat = await fs.lstat(canonical);
    if (!stat.isDirectory() || stat.isSymbolicLink() || privatePath(canonical)) throw new Error('Folder is private or unavailable');
    for (const own of this.ownPaths) {
      const absolute = path.resolve(own); const real = await fs.realpath(absolute).catch(() => absolute);
      if (contained(canonical, real) || contained(real, canonical)) throw new Error('Choose a folder separate from Visor application, cache and build paths');
    }
    if (request !== this.choosing) throw new Error('Folder selection superseded');
    this.stopWatcher(); this.jobs.cancel(); this.records.clear(); this.failures.clear(); this.scanning = null;
    this.root = { canonical, dev: stat.dev, ino: stat.ino, generation: ++this.generation };
    this.snapshot = { generation: this.generation, revision: ++this.revision, folder: path.basename(canonical), notes: [], issues: ['Indexing folder…'] };
    this.publish(this.snapshot);
    const root = this.root;
    try {
      this.watcher = watch(canonical, { recursive: true }, () => this.invalidate(root));
      this.watcher.on('error', () => {
        if (this.root !== root) return;
        this.stopWatcher(); this.snapshot = { ...this.snapshot, revision: ++this.revision, issues: [...this.snapshot.issues, 'Live watching unavailable. Use Refresh.'] }; this.publish(this.snapshot);
      });
    } catch { this.snapshot.issues.push('Live watching unavailable. Use Refresh.'); }
    return this.refresh();
  }
  /** A watcher filename, including null, is only invalidation—not path authority. */
  private invalidate(root: Root) {
    if (this.root !== root) return;
    clearTimeout(this.timer); this.timer = setTimeout(() => { void this.refresh().catch(() => {}); }, 140);
  }
  private async validateRoot(root: Root) {
    if (this.root !== root) throw new Error('Stale folder generation');
    const real = await fs.realpath(root.canonical); const stat = await fs.lstat(root.canonical);
    if (real !== root.canonical || !stat.isDirectory() || stat.isSymbolicLink() || stat.ino !== root.ino || stat.dev !== root.dev || privatePath(real)) throw new Error('Selected folder changed or is unavailable');
  }
  private async safeRead(root: Root, id: string): Promise<string> {
    if (!validId(id)) throw new Error('Invalid note ID');
    await this.validateRoot(root);
    const filename = path.join(root.canonical, id);
    if (!contained(root.canonical, filename)) throw new Error('Outside selected folder');
    let current = root.canonical;
    for (const part of id.split('/')) {
      current = path.join(current, part); const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || (current === filename ? !stat.isFile() : !stat.isDirectory())) throw new Error('Nonregular or linked note is unavailable');
    }
    if (await fs.realpath(filename) !== filename) throw new Error('Linked note is unavailable');
    const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > INDEX_LIMITS.fileBytes) throw new Error('Note exceeds file limit or is not regular');
      const buffer = Buffer.alloc(INDEX_LIMITS.fileBytes + 1); let bytes = 0;
      while (bytes < buffer.length) { const read = await handle.read(buffer, bytes, buffer.length - bytes, null); if (!read.bytesRead) break; bytes += read.bytesRead; }
      if (bytes > INDEX_LIMITS.fileBytes) throw new Error('Note exceeds file limit');
      const after = await handle.stat(); const named = await fs.lstat(filename);
      await this.validateRoot(root);
      if (await fs.realpath(filename) !== filename || !named.isFile() || named.isSymbolicLink() || named.ino !== after.ino || named.dev !== after.dev || before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('Note changed while reading');
      return buffer.subarray(0, bytes).toString('utf8');
    } finally { await handle.close(); }
  }
  refresh(): Promise<FolderSnapshot> {
    if (!this.root) return Promise.resolve(this.snapshot);
    // At most one scan and one dirty flag: IPC bursts cannot allocate an unbounded work queue.
    const root = this.root;
    if (this.scanning?.root === root) { this.scanning.dirty = true; return this.scanning.promise; }
    const state = { root, dirty: false, promise: Promise.resolve(this.snapshot) }; this.scanning = state;
    state.promise = (async () => {
      const deadline = performance.now() + MARKDOWN_BUDGET.indexMs;
      do { state.dirty = false; await this.scan(root, deadline); } while (this.root === root && state.dirty && performance.now() < deadline);
      return this.snapshot;
    })();
    void state.promise.finally(() => { if (this.scanning === state) this.scanning = null; }).catch(() => {});
    return state.promise;
  }
  private async scan(root: Root, deadline: number): Promise<FolderSnapshot> {
    const records = new Map<string, IndexedNote>(); const issues: string[] = []; let entries = 0; let total = 0; let stopped = false;
    const addIssue = (message: string) => { if (issues.length < 100) issues.push(message); };
    const crawl = async (directory: string, depth: number): Promise<void> => {
      if (stopped || this.root !== root) return;
      if (depth > INDEX_LIMITS.directoryDepth) { addIssue('Directory depth limit reached; index incomplete.'); return; }
      // Revalidate every traversed directory before enumeration; never follow symlink entries.
      if (!contained(root.canonical, directory) || privatePath(directory) || await fs.realpath(directory) !== directory || !(await fs.lstat(directory)).isDirectory()) return;
      const dir = await fs.opendir(directory);
      for await (const entry of dir) {
        if (this.root !== root || stopped) break;
        if (++entries > INDEX_LIMITS.entries) { stopped = true; addIssue('Entry limit reached; index incomplete.'); break; }
        const full = path.join(directory, entry.name); if (privatePath(full) || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { if (!['.git', '.obsidian', 'node_modules'].includes(entry.name)) await crawl(full, depth + 1).catch(() => addIssue('Directory unreadable; index incomplete.')); }
        else if (entry.isFile() && /\.md$/i.test(entry.name)) {
          const id = path.relative(root.canonical, full).split(path.sep).join('/');
          if (!validId(id)) { addIssue('Unsupported filename omitted.'); continue; }
          if (records.size >= INDEX_LIMITS.files || total >= INDEX_LIMITS.totalBytes) { stopped = true; addIssue('File/byte limit reached; index incomplete.'); break; }
          let metadata: NoteMetadata | null = null; let headings: IndexedNote['headings'] = []; let blocks: string[] = [];
          let hash: string | undefined;
          try {
            if (performance.now() >= deadline) throw new Error('Markdown indexing budget exceeded');
            const markdown = await this.safeRead(root, id);
            if (this.root !== root) return;
            total += Buffer.byteLength(markdown);
            if (total > INDEX_LIMITS.totalBytes) throw new Error('Total index byte limit reached');
            hash = createHash('sha256').update(markdown).digest('hex');
            const failed = this.failures.get(id); if (failed?.hash === hash) throw new Error(failed.reason);
            const result = await this.jobs.run({ kind: 'index', markdown }, deadline);
            metadata = result.record.metadata; headings = result.record.headings; blocks = result.record.blocks;
            if (this.root === root) this.failures.delete(id);
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'read failed';
            if (this.root === root && hash && performance.now() < deadline && !(error instanceof MarkdownCapacityError)) this.failures.set(id, { hash, reason });
            addIssue(`${id}: metadata unavailable (${reason}).`);
          }
          records.set(id, { id, metadata, headings, blocks });
        }
      }
    };
    try { await this.validateRoot(root); await crawl(root.canonical, 0); await this.validateRoot(root); }
    catch { addIssue('Folder unreadable or changed; metadata is unavailable.'); records.clear(); }
    if (this.root !== root) return this.snapshot;
    this.records = records;
    for (const id of this.failures.keys()) if (!records.has(id)) this.failures.delete(id);
    this.snapshot = { generation: root.generation, revision: ++this.revision, folder: path.basename(root.canonical), notes: [...records.values()].sort((a, b) => a.id.localeCompare(b.id)), issues };
    if (!this.watcher) this.snapshot.issues.push('Live watching unavailable. Use Refresh.');
    this.publish(this.snapshot); return this.snapshot;
  }
  async readNote(id: string, generation: number): Promise<NoteBody> {
    if (typeof id !== 'string' || !Number.isSafeInteger(generation) || !validId(id) || !this.records.has(id) || this.root?.generation !== generation) throw new Error('Unknown note or stale folder generation');
    const root = this.root; const revision = this.snapshot.revision;
    const markdown = await this.safeRead(root, id);
    if (this.root !== root || this.snapshot.revision !== revision || !this.records.has(id)) throw new Error('Note changed; refresh and select again');
    const hash = createHash('sha256').update(markdown).digest('hex');
    let result: NoteBody; let failureReason: string | undefined; let cacheFailure = true;
    try {
      const failed = this.failures.get(id); if (failed?.hash === hash) throw new Error(failed.reason);
      const knownNotes = { ...this.snapshot, notes: this.snapshot.notes.map(note => ({ id: note.id, metadata: null, headings: note.headings, blocks: note.blocks })) };
      const prepared = await this.jobs.run({ kind: 'preview', markdown, snapshot: knownNotes, id });
      result = { id, generation, revision, body: prepared.body, preview: prepared.preview! };
    } catch (error) {
      failureReason = error instanceof Error ? error.message : 'Markdown preparation failed';
      cacheFailure = !(error instanceof MarkdownCapacityError);
      result = { id, generation, revision, body: markdown.slice(0, 256 * 1024), preview: { kind: 'plain', reason: failureReason } };
    }
    if (this.root !== root || this.snapshot.revision !== revision || !this.records.has(id)) throw new Error('Note changed; refresh and select again');
    if (failureReason) {
      if (cacheFailure) this.failures.set(id, { hash, reason: failureReason });
      if (this.records.get(id)!.metadata !== null) {
        const unavailable = { id, metadata: null, headings: [], blocks: [] };
        this.records.set(id, unavailable);
        this.snapshot = { ...this.snapshot, revision: ++this.revision, notes: this.snapshot.notes.map(note => note.id === id ? unavailable : note), issues: [...this.snapshot.issues.slice(0, 99), `${id}: metadata / formatting unavailable (${failureReason}).`] };
        result.revision = this.snapshot.revision; this.publish(this.snapshot);
      }
    }
    return result;
  }
}
