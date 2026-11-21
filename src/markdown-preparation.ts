import { unified } from 'unified';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import type { Root, Element, ElementContent, RootContent } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import type { FolderSnapshot, PreparedPreview } from './contracts';
import { approveLink, headingAnchor, type ApprovedLink } from './links';
import { completeWikiSpan, parseMarkdown, textOf, walkMarkdown, type MarkdownNode } from './markdown-structure';
import { previewMarkdown } from './preview-markdown';
/** Package-generated data never grants rendering or navigation authority. */
export function markdownPolicy(snapshot: FolderSnapshot, source: string, approved: Map<string, ApprovedLink>, headingIds?: Map<number, string>) {
  return () => (tree: MarkdownNode) => {
    const definitions = new Map<string, string>(); const headingCounts = new Map<string, number>();
    walkMarkdown(tree, node => {
      delete node.data;
      if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    });
    const transform = (node: MarkdownNode): MarkdownNode => {
      if (['wikiEmbed', 'image', 'imageReference', 'html'].includes(node.type)) return { type: 'text', value: '[Media / HTML omitted]' };
      if (node.type === 'wikiLink' || node.type === 'link' || node.type === 'linkReference') {
        const raw = node.type === 'wikiLink' ? node.target : node.type === 'link' ? node.url : definitions.get(node.identifier ?? '');
        const target = typeof raw === 'string' ? approveLink(snapshot, raw, source) : null;
        const children = node.type === 'wikiLink' ? [{ type: 'text', value: node.alias ?? node.target ?? '' }] : node.children?.map(transform) ?? [];
        if (!target) return { type: 'text', value: textOf({ ...node, children }) + ' [link unavailable]' };
        const token = `#visor-approved-${approved.size}`; approved.set(token, target);
        return { type: 'link', url: token, children };
      }
      if (node.type === 'heading') {
        const id = headingIds ? headingIds.get(node.position?.start.offset ?? -1) : headingAnchor(textOf(node), headingCounts);
        if (id) node.data = { hProperties: { id } };
      }
      if (node.type === 'paragraph') {
        const block = textOf(node).match(/(?:^|\s)\^([a-zA-Z0-9-]+)$/)?.[1];
        if (block && snapshot.notes.find(n => n.id === source)?.blocks.includes(block)) node.data = { hProperties: { id: `block-${block}` } };
      }
      node.children = node.children?.map(transform); return node;
    };
    transform(tree);
  };
}
const elements = new Set(['p', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'span', 'strong', 'em', 'del', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input']);
/** All parsing, source-range guards, transforms, highlighting and final policy run inside one terminable job. */
export function preparePreview(body: string, snapshot: FolderSnapshot, source: string): PreparedPreview {
  const original = parseMarkdown(body); const counts = new Map<string, number>();
  const identities = new Map<number, string>(); const positions = new Map<number, number>();
  walkMarkdown(original, node => {
    if (node.type === 'heading' && node.position?.start.offset !== undefined) {
      const offset = node.position.start.offset; identities.set(offset, headingAnchor(textOf(node), counts)); positions.set(offset, offset);
    }
  });
  const safe = previewMarkdown(body, raw => approveLink(snapshot, raw, source) !== null, completeWikiSpan, positions);
  const headingIds = new Map([...positions].map(([before, after]) => [after, identities.get(before)!]));
  const tree = parseMarkdown(safe.markdown); const approved = new Map<string, ApprovedLink>();
  markdownPolicy(snapshot, source, approved, headingIds)()(tree);
  const processor = unified().use(remarkRehype).use(rehypeHighlight, { detect: false, ignoreMissing: true });
  const hast = processor.runSync(tree as MdastRoot) as Root;
  // Rebuild a small public HAST subset. No raw HTML, MDX, style, event handlers or resource URLs cross IPC.
  let count = 0; let characters = 0; const anchors = new Set<string>();
  const clean = (node: RootContent, depth: number): ElementContent => {
    if (++count > 30000 || depth > 64) throw new Error('Prepared preview structure limit exceeded');
    if (node.type === 'text') { characters += node.value.length; if (characters > 1024 * 1024) throw new Error('Prepared preview text limit exceeded'); return { type: 'text', value: node.value }; }
    if (node.type !== 'element' || !elements.has(node.tagName)) throw new Error('Unsupported prepared preview element');
    const properties: Element['properties'] = {};
    if (typeof node.properties.id === 'string' && /^(heading|block)-[\p{L}\p{N}_-]+$/u.test(node.properties.id) && !anchors.has(node.properties.id)) { properties.id = node.properties.id; anchors.add(node.properties.id); }
    if (node.tagName === 'a' && typeof node.properties.href === 'string' && approved.has(node.properties.href)) properties.href = node.properties.href;
    if (['code', 'span'].includes(node.tagName) && Array.isArray(node.properties.className)) properties.className = node.properties.className.filter(c => typeof c === 'string' && /^(hljs[\w-]*|language-[\w-]+)$/.test(c));
    if (node.tagName === 'input') { properties.type = 'checkbox'; properties.disabled = true; properties.checked = !!node.properties.checked; }
    if (node.tagName === 'ol' && typeof node.properties.start === 'number' && Number.isSafeInteger(node.properties.start)) properties.start = node.properties.start;
    if (['th', 'td'].includes(node.tagName) && ['left', 'right', 'center'].includes(String(node.properties.align))) properties.align = node.properties.align;
    return { type: 'element', tagName: node.tagName, properties, children: node.children.map(child => clean(child, depth + 1)) };
  };
  const result: Root = { type: 'root', children: hast.children.map(child => clean(child, 0)) };
  // A same-body link must name a real final-render anchor, never a pre-transform guess.
  for (const [token, link] of approved) if (link.kind === 'note' && link.id === source && link.anchor && !anchors.has(link.anchor)) approved.delete(token);
  const prepared: PreparedPreview = { kind: 'formatted', tree: result, links: Object.fromEntries(approved), anchors: [...anchors] };
  if (JSON.stringify(prepared).length > 2 * 1024 * 1024) throw new Error('Prepared preview output limit exceeded');
  return prepared;
}
