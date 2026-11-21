import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Node } from 'unist';
const parser = unified().use(remarkParse);
/** Tokenize first so code examples and escaped embeds remain text, not preview resources. */
export function previewMarkdown(markdown: string, allowLink?: (linktext: string) => boolean, allowWikiSpan?: (span: string) => boolean, sourcePositions?: Map<number, number>): { markdown: string; omitted: boolean } {
  const tree = parser.parse(markdown);
  type Span = { start: number; end: number };
  type Edit = Span & { text: string };
  type AstNode = Node & { children?: AstNode[]; url?: string; identifier?: string };
  const edits: Edit[] = []; const code: Span[] = [];
  const destinationSyntax: (Span & { link?: Span })[] = [];
  const definitions = new Map<string, string>();
  const collect = (node: AstNode) => {
    const start = node.position?.start.offset; const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      // Definitions must survive reparsing unchanged, including duplicates and nested definitions.
      if (node.type === 'definition') destinationSyntax.push({ start, end });
      if (node.type === 'link' || node.type === 'linkReference') {
        // Labels remain scannable; an autolink's displayed URL is also its destination syntax.
        const labelEnd = markdown[start] === '<' ? start : node.children?.at(-1)?.position?.end.offset ?? start;
        destinationSyntax.push({ start: labelEnd, end, link: { start, end } });
      }
    }
    // remark normalizes identifiers; document-order traversal preserves CommonMark's first definition.
    if (node.type === 'definition' && node.identifier !== undefined && node.url !== undefined && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url);
    }
    if ((node.type === 'code' || node.type === 'inlineCode') && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      code.push({ start: node.position.start.offset, end: node.position.end.offset });
    }
    node.children?.forEach(collect);
  };
  collect(tree);
  const codeText = (text: string) => {
    const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
    const delimiter = '`'.repeat(longest + 1);
    return `${delimiter} ${text.replace(/[\r\n]/g, ' ')} ${delimiter}`;
  };
  const walk = (node: AstNode) => {
    const start = node.position?.start.offset; const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === 'image' || node.type === 'imageReference') {
      edits.push({ start, end, text: '[Image omitted in Visor preview]' }); return;
    }
    const link = node.type === 'link' || node.type === 'linkReference';
    const url = node.type === 'link' ? node.url : definitions.get(node.identifier ?? '');
    if (link && (url === undefined || (allowLink && !allowLink(url)))) {
      edits.push({ start, end, text: codeText(markdown.slice(start, end)) }); return;
    }
    if (node.type === 'html') {
      // A code span also prevents wiki/image syntax inside HTML attributes from being reinterpreted.
      edits.push({ start, end, text: codeText(markdown.slice(start, end)) }); return;
    }
    node.children?.forEach(walk);
  };
  walk(tree);
  // Wiki syntax can span emphasis, code aliases and soft breaks: text nodes are not token boundaries.
  // Scan every opening (including nested openings), but never interpret an opening inside code.
  for (const match of markdown.matchAll(/!?\[\[/g)) {
    const start = match.index;
    if (code.some(span => span.start <= start && start < span.end)) continue;
    let slashes = 0; for (let i = start - 1; i >= 0 && markdown[i] === '\\'; i--) slashes++;
    if (slashes % 2 !== 0) continue;
    const close = markdown.indexOf(']]', start + match[0].length);
    if (close < 0) continue;
    const end = close + 2; const embed = match[0].startsWith('!');
    // A whole link inside a wiki alias can be made inert, but never rewrite only its destination.
    if (destinationSyntax.some(span => start < span.end && span.start < end &&
      !(span.link && start <= span.link.start && span.link.end <= end))) continue;
    const linktext = markdown.slice(start + match[0].length, close).split('|')[0];
    if (embed || (allowLink && !allowLink(linktext)) || (allowWikiSpan && !allowWikiSpan(markdown.slice(start, end)))) {
      edits.push({ start, end, text: embed ? '[Note embed omitted in Visor preview]' : codeText(markdown.slice(start, end)) });
    }
  }
  // Never cut a code delimiter in half, nor apply overlapping edits with stale source offsets.
  for (const edit of edits) for (const span of code) {
    if (edit.start < span.end && span.start < edit.end && (edit.start > span.start || edit.end < span.end)) {
      edit.start = Math.min(edit.start, span.start); edit.end = Math.max(edit.end, span.end);
      edit.text = codeText(markdown.slice(edit.start, edit.end));
    }
  }
  const disjoint: Edit[] = [];
  for (const edit of edits.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const previous = disjoint.at(-1);
    if (previous && edit.start < previous.end) {
      if (edit.end > previous.end) {
        previous.end = edit.end; previous.text = codeText(markdown.slice(previous.start, previous.end));
      }
    } else disjoint.push(edit);
  }
  // Edit starts can remain heading starts; only strictly interior source identities are removed.
  for (const position of sourcePositions?.keys() ?? []) {
    if (disjoint.some(edit => edit.start < position && position < edit.end)) sourcePositions!.delete(position);
    else sourcePositions!.set(position, position + disjoint.filter(edit => edit.end <= position).reduce((shift, edit) => shift + edit.text.length - (edit.end - edit.start), 0));
  }
  let output = markdown;
  for (const edit of disjoint.reverse()) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return { markdown: output, omitted: edits.length > 0 };
}
