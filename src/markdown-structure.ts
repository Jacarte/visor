import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkWikiGfm from '@lxcid/remark-wikilink/gfm';
import type { Node } from 'unist';
import { headingAnchor } from './links';
export interface MarkdownNode extends Node {
  children?: MarkdownNode[]; value?: string; target?: string; alias?: string | null;
  url?: string; identifier?: string; data?: Record<string, unknown>; depth?: number;
}
const parser = unified().use(remarkParse).use(remarkWikiGfm);
export const MARKDOWN_NODE_LIMIT = 30000;
export const MARKDOWN_CHARACTER_LIMIT = 256 * 1024;
export function parseMarkdown(body: string): MarkdownNode {
  if (body.length > MARKDOWN_CHARACTER_LIMIT) throw new Error('Markdown parsing limit exceeded (256 Ki characters)');
  return parser.parse(body) as MarkdownNode;
}
export function textOf(node: MarkdownNode): string { return node.value ?? node.alias ?? node.target ?? node.children?.map(textOf).join('') ?? ''; }
export function walkMarkdown(tree: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  const pending = [{ node: tree, depth: 0 }]; let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > MARKDOWN_NODE_LIMIT || depth > 64) throw new Error('Markdown structure limit exceeded');
    visit(node);
    for (const child of [...node.children ?? []].reverse()) pending.push({ node: child, depth: depth + 1 });
  }
}
export function markdownStructure(body: string) {
  const headings: { text: string; anchor: string }[] = []; const blocks: string[] = []; const links: { link: string; original: string }[] = [];
  const counts = new Map<string, number>();
  walkMarkdown(parseMarkdown(body), node => {
    if (node.type === 'heading') { const text = textOf(node); headings.push({ text, anchor: headingAnchor(text, counts) }); }
    if (node.type === 'paragraph') { const block = textOf(node).match(/(?:^|\s)\^([a-zA-Z0-9-]+)$/)?.[1]; if (block && !blocks.includes(block)) blocks.push(block); }
    if ((node.type === 'wikiLink' || node.type === 'wikiEmbed') && typeof node.target === 'string') links.push({ link: node.target, original: `${node.type === 'wikiEmbed' ? '!' : ''}[[${node.target}]]` });
  });
  return { headings, blocks, links };
}
/** Used by the existing source-range guard before the richer parser can roll malformed aliases back. */
export function completeWikiSpan(span: string): boolean {
  const tree = parseMarkdown(span); const paragraph = tree.children?.[0]; const wiki = paragraph?.children?.[0];
  return tree.children?.length === 1 && paragraph?.children?.length === 1 && wiki?.type === 'wikiLink' && wiki.position?.start.offset === 0 && wiki.position?.end.offset === span.length;
}
