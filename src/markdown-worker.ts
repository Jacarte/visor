import { parentPort } from 'node:worker_threads';
import { frontmatter } from './frontmatter';
import { markdownStructure } from './markdown-structure';
import { preparePreview } from './markdown-preparation';
import type { FolderSnapshot, IndexedNote, PreparedPreview } from './contracts';
export type MarkdownRequest = { kind: 'index'; markdown: string } | { kind: 'preview'; markdown: string; snapshot: FolderSnapshot; id: string };
export interface MarkdownResult { record: Omit<IndexedNote, 'id'>; body: string; preview?: PreparedPreview }
parentPort!.on('message', ({ token, request }: { token: number; request: MarkdownRequest }) => {
  try {
    const parsed = frontmatter(request.markdown); const structure = markdownStructure(parsed.body);
    const record = { metadata: { frontmatter: parsed.metadata, links: [...parsed.links, ...structure.links] }, headings: structure.headings, blocks: structure.blocks };
    const result: MarkdownResult = { record, body: parsed.body };
    if (request.kind === 'preview') {
      const snapshot = { ...request.snapshot, notes: request.snapshot.notes.map(note => note.id === request.id ? { id: note.id, ...record } : note) };
      result.preview = preparePreview(parsed.body, snapshot, request.id);
    }
    parentPort!.postMessage({ token, result });
  } catch (error) { parentPort!.postMessage({ token, error: error instanceof Error ? error.message : 'Markdown preparation failed' }); }
});
