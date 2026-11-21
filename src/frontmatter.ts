import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { INDEX_LIMITS } from './index-limits';
import { markdownStructure } from './markdown-structure';
import type { NoteMetadata } from './model';
export function frontmatter(markdown: string): { body: string; metadata: Record<string, unknown>; links: NoteMetadata['links'] } {
  const normalized = markdown.replace(/^\uFEFF/, '');
  if (!/^---\r?\n/.test(normalized)) return { body: normalized, metadata: {}, links: [] };
  const close = /^---[ \t]*\r?$/gm; close.lastIndex = normalized.indexOf('\n') + 1; const end = close.exec(normalized);
  if (!end || Buffer.byteLength(normalized.slice(0, end.index)) > INDEX_LIMITS.frontmatterBytes) throw new Error('Missing or oversized YAML frontmatter');
  const yaml = normalized.slice(normalized.indexOf('\n') + 1, end.index);
  // Bound indentation/flow nesting before the library constructs its AST.
  if (yaml.split('\n').some(line => /^\s*/.exec(line)![0].length > INDEX_LIMITS.yamlDepth * 2)) throw new Error('YAML depth limit exceeded');
  let flowDepth = 0; let quote = ''; let comment = false;
  for (let i = 0; i < yaml.length; i++) {
    const c = yaml[i]; if (c === '\n') comment = false;
    if (comment) continue;
    if (quote) { if (c === '\\' && quote === '"') i++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#') comment = true;
    else if (c === '[' || c === '{') { if (++flowDepth > INDEX_LIMITS.yamlDepth) throw new Error('YAML depth limit exceeded'); }
    else if (c === ']' || c === '}') flowDepth--;
  }
  const doc = parseDocument(yaml, { version: '1.2', schema: 'core', customTags: [], resolveKnownTags: false, merge: false, uniqueKeys: true, strict: true, stringKeys: true });
  if (doc.errors.length || doc.warnings.length) throw new Error('Invalid or unsupported YAML');
  let count = 0; const links: { link: string; original: string; key: string }[] = [];
  const inspect = (node: unknown, depth: number, key = ''): void => {
    if (++count > INDEX_LIMITS.yamlNodes || depth > INDEX_LIMITS.yamlDepth) throw new Error('YAML structure limit exceeded');
    if (!node) return;
    if (isAlias(node) || (typeof node === 'object' && ('tag' in node && node.tag || 'anchor' in node && node.anchor))) throw new Error('YAML tags, anchors and aliases are unavailable');
    if (isMap(node)) for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new Error('YAML keys must be strings');
      inspect(pair.key, depth + 1); inspect(pair.value, depth + 1, key ? `${key}.${pair.key.value}` : pair.key.value);
    }
    else if (isSeq(node)) node.items.forEach((item, i) => inspect(item, depth + 1, `${key}[${i}]`));
    else if (key && isScalar(node) && typeof node.value === 'string' && node.value.includes('[[')) links.push(...markdownStructure(node.value).links.map(link => ({ ...link, key })));
  };
  inspect(doc.contents, 0);
  if (doc.contents !== null && !isMap(doc.contents)) throw new Error('YAML frontmatter must be a map');
  const map = doc.toJS({ maxAliasCount: 0, mapAsMap: true }) as Map<string, unknown> | null;
  const metadata: Record<string, unknown> = Object.create(null);
  // Only graph-domain fields cross IPC. Unknown/nested metadata grants no authority.
  for (const key of ['title', 'labels', 'tags', 'status', 'assignee', 'parent', 'blocked-by']) {
    const value = map?.get(key);
    if (value === undefined) continue;
    if (value === null || typeof value === 'string' && value.length <= 4096 || Array.isArray(value) && value.length <= 256 && value.every(v => typeof v === 'string' && v.length <= 4096)) metadata[key] = value;
    else throw new Error(`Unsupported ${key} metadata`);
  }
  return { body: normalized.slice(end.index + end[0].length).replace(/^\r?\n/, ''), metadata, links };
}
