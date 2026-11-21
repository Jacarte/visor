import type { FolderSnapshot, IndexedNote } from './contracts';
import type { Destination, NoteSource } from './model';
export type ApprovedLink = { kind: 'note'; id: string; anchor?: string } | { kind: 'external'; url: string };
export function externalURL(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) return null;
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname) return null;
    return url.href;
  } catch { return null; }
}
function decoded(value: string): string | null {
  try {
    // Decode once. Reject nested encodings, separators and controls rather than guessing.
    if (/%(?:2f|5c|00)/i.test(value)) return null;
    const text = decodeURIComponent(value);
    return /[%\\\u0000-\u001f\u007f]/.test(text) ? null : text;
  } catch { return null; }
}
function normalize(parts: string[]): string | null {
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!result.length) return null; result.pop(); }
    else if (['chats', 'javier(me) notes'].includes(part.toLowerCase())) return null;
    else result.push(part);
  }
  return result.join('/');
}
/** One source-relative → exact → unique-basename policy for index, preview and navigation. */
export function resolveNote(notes: readonly IndexedNote[], raw: string, source: string): { id: string; anchor?: string } | null {
  if (raw.length > 4096 || !notes.some(n => n.id === source)) return null;
  const text = decoded(raw.trim());
  if (text === null || /^(?:\/|[a-z][a-z\d+.-]*:)/i.test(text) || text.includes('?')) return null;
  const hash = text.indexOf('#'); const path = hash < 0 ? text : text.slice(0, hash); const fragment = hash < 0 ? '' : text.slice(hash + 1);
  const ids = new Set(notes.map(n => n.id));
  const candidates = (id: string | null) => id === null ? [] : /\.md$/i.test(id) ? [id] : [id + '.md'];
  let id: string | undefined;
  if (!path) id = source;
  else {
    const relative = normalize([...source.split('/').slice(0, -1), ...path.split('/')]);
    const exact = normalize(path.split('/'));
    id = candidates(relative).find(c => ids.has(c));
    if (!id && !path.startsWith('.')) id = candidates(exact).find(c => ids.has(c));
    if (!id && !path.includes('/')) {
      const basename = candidates(path)[0]; const matches = notes.filter(n => n.id.split('/').at(-1) === basename);
      if (matches.length === 1) id = matches[0].id;
    }
  }
  if (!id) return null;
  const note = notes.find(n => n.id === id)!;
  if (!fragment) return { id };
  if (fragment.startsWith('^')) return note.blocks.includes(fragment.slice(1)) ? { id, anchor: `block-${fragment.slice(1)}` } : null;
  const heading = note.headings.find(h => h.text.toLowerCase() === fragment.toLowerCase() || h.anchor === fragment);
  return heading ? { id, anchor: heading.anchor } : null;
}
/** Generated graph paths already are canonical known IDs, not authored relative link text. */
export function canonicalDestination(notes: readonly IndexedNote[], destination: Destination): { id: string; anchor?: string } | null {
  const note = notes.find(n => n.id === destination.path); if (!note) return null;
  const hash = destination.linktext.indexOf('#');
  if (hash < 0 || destination.linktext === destination.path) return { id: note.id };
  return resolveNote(notes, destination.linktext.slice(hash), note.id);
}
export function approveLink(snapshot: FolderSnapshot, raw: string, source: string): ApprovedLink | null {
  const external = externalURL(raw); if (external) return { kind: 'external', url: external };
  const note = resolveNote(snapshot.notes, raw, source); return note ? { kind: 'note', ...note } : null;
}
export function snapshotSource(snapshot: FolderSnapshot): NoteSource {
  const notes = new Map(snapshot.notes.map(n => [n.id, n]));
  return { paths: () => [...notes.keys()], metadata: id => notes.get(id)?.metadata ?? null,
    resolve: (raw, source) => resolveNote(snapshot.notes, raw, source)?.id ?? null };
}
export function headingAnchor(text: string, counts: Map<string, number>): string {
  const base = 'heading-' + (text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-') || 'section');
  const count = counts.get(base) ?? 0; counts.set(base, count + 1); return count ? `${base}-${count}` : base;
}
