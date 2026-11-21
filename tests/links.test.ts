import { expect, it } from 'vitest';
import { approveLink, externalURL, resolveNote, snapshotSource } from '../src/links';
import { newerSnapshot, type FolderSnapshot, type IndexedNote } from '../src/contracts';
const note = (id: string): IndexedNote => ({ id, metadata: { links: [] }, headings: [{ text: 'A heading', anchor: 'heading-a-heading' }, { text: 'A heading', anchor: 'heading-a-heading-1' }], blocks: ['actual'] });
const snapshot: FolderSnapshot = { generation: 1, revision: 2, folder: 'fixture', issues: [], notes: ['Project/Map.md', 'Project/Local.md', 'Local.md', 'Shared/Unique.md', 'A/Duplicate.md', 'B/Duplicate.md', 'Project/Ünicode name.md'].map(note) };
it('links uses source-relative, exact, unique basename, canonical IDs and actual headings/blocks only', () => {
  expect(resolveNote(snapshot.notes, 'Local', 'Project/Map.md')?.id).toBe('Project/Local.md');
  expect(resolveNote(snapshot.notes, '../Local.md', 'Project/Map.md')?.id).toBe('Local.md');
  expect(resolveNote(snapshot.notes, 'Unique', 'Project/Map.md')?.id).toBe('Shared/Unique.md');
  expect(resolveNote(snapshot.notes, 'Duplicate', 'Project/Map.md')).toBeNull();
  expect(resolveNote(snapshot.notes, '#A%20heading', 'Project/Map.md')).toEqual({ id: 'Project/Map.md', anchor: 'heading-a-heading' });
  expect(resolveNote(snapshot.notes, '#heading-a-heading-1', 'Project/Map.md')?.anchor).toBe('heading-a-heading-1');
  expect(resolveNote(snapshot.notes, '#^actual', 'Project/Map.md')?.anchor).toBe('block-actual');
  for (const fragment of ['#Absent', '#^absent']) expect(resolveNote(snapshot.notes, fragment, 'Project/Map.md')).toBeNull();
  expect(resolveNote(snapshot.notes, 'Ünicode%20name.md', 'Project/Map.md')?.id).toBe('Project/Ünicode name.md');
  expect(snapshotSource(snapshot).resolve('Local', 'Project/Map.md')).toBe('Project/Local.md');
});
it('links rejects encoded traversal/separators, schemes, private paths, unknown source and ambiguous notes', () => {
  for (const raw of ['../../Local', '/Local', '//host/Local', 'C:\\Local', 'file:Local', 'javascript:x', 'data:x', '%252e%252e/Local', '..%2fLocal', 'chats/Private', '../Javier(me) notes/Private', '%00', '%zz', 'Local?x', 'Local\\x']) expect(resolveNote(snapshot.notes, raw, 'Project/Map.md'), raw).toBeNull();
  expect(resolveNote(snapshot.notes, 'Local', 'Unknown.md')).toBeNull();
});
it('externalURL allows only bounded explicit web/mail links, never file/custom/dangerous URLs', () => {
  for (const raw of ['https://example.com', 'http://example.com/path', 'mailto:hello@example.com']) expect(externalURL(raw)).not.toBeNull();
  for (const raw of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/a', 'app://bundle/index.html', '//example.com', 'https://user:password@example.com', 'https://example.com\n', 'x'.repeat(4097), null]) expect(externalURL(raw)).toBeNull();
  expect(approveLink(snapshot, 'Absent', 'Project/Map.md')).toBeNull();
});
it('snapshot reconciliation drops old revisions and old-root responses after subscribing first', () => {
  expect(newerSnapshot(snapshot, { ...snapshot, revision: 1 })).toBe(snapshot);
  const switched = { ...snapshot, generation: 2, revision: 3 };
  expect(newerSnapshot(switched, { ...snapshot, revision: 100 })).toBe(switched);
  expect(newerSnapshot(snapshot, switched)).toBe(switched);
});
