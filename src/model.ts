/** Canonical vault paths, not titles or aliases, are graph identities. */
export const ticketTypes = ['research', 'prototype', 'grilling', 'task'] as const;
export type TicketType = typeof ticketTypes[number];
export interface NoteMetadata {
  frontmatter?: Record<string, unknown>;
  links: readonly { link: string; original?: string; key?: string }[];
  /** GFM task-list items in the note body; absent when the note's metadata is unavailable. */
  tasks?: TaskCounts;
}
export interface TaskCounts { done: number; total: number }
export interface NoteSource {
  paths(): readonly string[];
  metadata(path: string): NoteMetadata | null;
  resolve(linkpath: string, sourcePath: string): string | null;
}
export interface Destination { path: string; linktext: string; sourcePath: string }
export interface GraphNode {
  id: string; title: string; kind: 'map' | 'ticket' | 'implementation' | 'type' | 'support' | 'external' | 'missing';
  types: TicketType[]; status: string; terminal: boolean; assignee: string | null;
  readiness: 'frontier' | 'assigned' | 'blocked' | 'unknown' | 'terminal' | 'context';
  destination?: Destination;
  folder?: string; parent?: string; unavailable?: boolean; tasks?: TaskCounts;
}
export interface GraphEdge { id: string; source: string; target: string; kind: 'parent' | 'folder' | 'dependency' | 'context' | 'type' }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; warnings: string[]; mapPath: string }
export interface MapOption { path: string; title: string }
export interface Discovery { maps: MapOption[]; unavailable: number }
export function allowedPath(path: string): boolean {
  const parts = path.replaceAll('\\', '/').toLowerCase().split('/');
  return !parts.some(p => p === 'chats' || p === 'javier(me) notes') && !path.startsWith('/') && !parts.includes('..');
}
function title(path: string, meta?: NoteMetadata | null): string {
  const value = meta?.frontmatter?.title;
  return typeof value === 'string' && value.trim() ? value.trim() : path.split('/').at(-1)!.replace(/\.md$/i, '');
}
/** Obsidian labels/tags may be a scalar string or a YAML list of strings. */
function strings(value: unknown): string[] {
  return typeof value === 'string' ? [value] : Array.isArray(value) && value.every(v => typeof v === 'string') ? value : [];
}
function labels(meta: NoteMetadata | null): string[] { return strings(meta?.frontmatter?.labels); }
function implementation(meta: NoteMetadata | null): boolean {
  return labels(meta).includes('implementation:ticket') || strings(meta?.frontmatter?.tags).includes('implementation-ticket');
}
function types(meta: NoteMetadata | null): TicketType[] { return ticketTypes.filter(t => labels(meta).includes(`wayfinder:${t}`)); }
export function discoverMaps(source: NoteSource): Discovery {
  const maps: MapOption[] = []; let unavailable = 0;
  for (const path of [...source.paths()].sort()) {
    if (!allowedPath(path)) continue;
    const meta = source.metadata(path);
    if (!meta) unavailable++;
    if (labels(meta).includes('wayfinder:map')) maps.push({ path, title: title(path, meta) });
  }
  return { maps, unavailable };
}
/** Accept the actual raw YAML wikilinks; cached references already have brackets/aliases removed. */
export function parseWiki(value: unknown, raw = true): string | null {
  if (typeof value !== 'string') return null;
  let text = value.trim();
  if (raw) {
    if (!text.startsWith('[[') || !text.endsWith(']]')) return null;
    text = text.slice(2, -2);
  }
  text = text.split('|')[0].trim();
  return text && !text.includes('[[') && !text.includes(']]') && !/^[a-z][a-z\d+.-]*:/i.test(text) ? text : null;
}
export function allowedLinkpath(path: string, from: string): boolean {
  const parts = path.replaceAll('\\', '/').toLowerCase().split('/');
  if (path.startsWith('/') || parts.some(p => p === 'chats' || p === 'javier(me) notes')) return false;
  // Resolve dot segments for the boundary check, while passing the original path to Obsidian.
  const base = path.startsWith('.') ? from.split('/').slice(0, -1) : [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '..') { if (!base.length) return false; base.pop(); }
    else if (part && part !== '.') base.push(part);
  }
  return allowedPath(base.join('/'));
}
export function resolveDestination(source: NoteSource, text: string, from: string): Destination | null {
  const path = text.split('#')[0];
  if (!allowedPath(from) || !allowedLinkpath(path, from)) return null;
  const resolved = path ? source.resolve(path, from) : from;
  return resolved && allowedPath(resolved) ? { path: resolved, linktext: text, sourcePath: from } : null;
}
function linkValues(value: unknown): unknown[] { return Array.isArray(value) ? value : [value]; }
const normalizedStatus = (status: string) => status.toLowerCase().trim();
const terminal = (status: string) => ['closed', 'done'].includes(normalizedStatus(status));
export function buildGraph(source: NoteSource, mapPath: string): Graph {
  const folder = mapPath.slice(0, mapPath.lastIndexOf('/') + 1);
  const inFolder = (path: string) => path.startsWith(folder) && /\.md$/i.test(path);
  const nodes = new Map<string, GraphNode>(); const edges = new Map<string, GraphEdge>();
  const warnings = new Set<string>();
  const warn = (s: string) => warnings.add(s);
  const metadata = new Map<string, NoteMetadata | null>();
  const read = (path: string) => {
    if (!allowedPath(path)) return null;
    if (!metadata.has(path)) metadata.set(path, source.metadata(path));
    return metadata.get(path)!;
  };
  const edge = (kind: GraphEdge['kind'], a: string, b: string) => {
    const id = JSON.stringify([kind, a, b]); edges.set(id, { id, source: a, target: b, kind });
  };
  const note = (path: string, kind: GraphNode['kind'], destination?: Destination): GraphNode => {
    const existing = nodes.get(path); if (existing) return existing;
    const meta = read(path); const fm = meta?.frontmatter;
    if ((kind === 'support' || kind === 'external') && implementation(meta)) kind = 'implementation';
    const status = typeof fm?.status === 'string' ? fm.status : 'unknown';
    const assignee = typeof fm?.assignee === 'string' && fm.assignee.trim() ? fm.assignee.trim() : null;
    const parents = linkValues(fm?.parent);
    const node: GraphNode = { id: path, title: title(path, meta), kind, types: kind === 'ticket' ? types(meta) : [], status, terminal: terminal(status), assignee,
      readiness: terminal(status) ? 'terminal' : kind === 'implementation' || kind === 'support' ? 'unknown' : 'context',
      folder: inFolder(path) ? folder || '/' : undefined,
      parent: fm?.parent === undefined ? undefined : parents.length === 1 && typeof parents[0] === 'string' ? parents[0] : 'Malformed parent metadata',
      unavailable: !meta,
      tasks: meta?.tasks && meta.tasks.total > 0 ? meta.tasks : undefined,
      destination: destination ?? { path, linktext: path, sourcePath: mapPath } };
    nodes.set(path, node); return node;
  };
  if (!allowedPath(mapPath) || !labels(read(mapPath)).includes('wayfinder:map')) {
    return { nodes: [], edges: [], warnings: ['Selected map metadata is unavailable or is no longer labelled wayfinder:map.'], mapPath };
  }
  note(mapPath, 'map');
  const tickets: string[] = []; const artifacts: string[] = []; let unavailable = 0;
  for (const path of [...source.paths()].sort()) {
    if (!allowedPath(path) || path === mapPath) continue;
    const meta = read(path); if (!meta) unavailable++;
    let member = false;
    if (types(meta).length) {
      const parents = linkValues(meta?.frontmatter?.parent);
      const link = parents.length === 1 ? parseWiki(parents[0]) : null;
      if (!link) warn(`${path}: invalid parent wikilink; omitted from membership.`);
      else member = resolveDestination(source, link, path)?.path === mapPath;
    }
    if (member) { tickets.push(path); note(path, 'ticket'); edge('parent', mapPath, path); }
    else if (inFolder(path)) {
      artifacts.push(path);
      note(path, implementation(meta) ? 'implementation' : labels(meta).includes('wayfinder:map') ? 'map' : 'support');
      edge('folder', mapPath, path);
    }
  }
  if (unavailable) warn(`${unavailable} allowed note cache(s) unavailable; membership may be incomplete while indexing.`);
  const blockerIds = new Map<string, string[]>(); const invalid = new Set<string>();
  for (const path of [...tickets, ...artifacts]) {
    const decision = tickets.includes(path);
    const node = nodes.get(path)!; const fm = read(path)?.frontmatter;
    if (decision && normalizedStatus(node.status) !== 'open' && !node.terminal) { invalid.add(path); warn(`${path}: unknown ticket status.`); }
    if (decision && !(fm?.assignee === null || typeof fm?.assignee === 'string')) {
      invalid.add(path); warn(`${path}: assignee metadata unavailable or malformed.`);
    }
    for (const t of node.types) {
      const id = `type:${t}`;
      nodes.set(id, { id, title: t, kind: 'type', types: [t], status: '', terminal: false, assignee: null, readiness: 'context' });
      edge('type', id, path);
    }
    const ids: string[] = []; if (decision) blockerIds.set(path, ids);
    const raw = fm?.['blocked-by'];
    if (!decision && raw === undefined) continue;
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : null;
    if (!values) { invalid.add(path); warn(`${path}: blocked-by must be a wikilink or list (use [] for none).`); continue; }
    values.forEach((value, index) => {
      const link = parseWiki(value); const dest = link ? resolveDestination(source, link, path) : null;
      if (!dest) {
        invalid.add(path); const id = `missing:${JSON.stringify([path, link ?? index])}`;
        nodes.set(id, { id, title: link ?? 'Malformed blocker', kind: 'missing', types: [], status: 'unknown', terminal: false, assignee: null, readiness: 'unknown' });
        edge('dependency', id, path); warn(`${path}: unresolved, excluded, or malformed blocker ${link ?? index + 1}.`); return;
      }
      const blocker = note(dest.path, tickets.includes(dest.path) ? 'ticket' : 'external', dest);
      ids.push(blocker.id); edge('dependency', blocker.id, path);
      if (decision && (!read(dest.path) || !['open', 'closed', 'done'].includes(normalizedStatus(blocker.status)))) {
        invalid.add(path); warn(`${path}: blocker status unavailable (${dest.path}).`);
      }
    });
  }
  for (const path of artifacts) if (invalid.has(path)) nodes.get(path)!.readiness = 'unknown';
  // Only membership-ticket dependencies participate; external blockers are deliberately not traversed.
  const cyclic = new Set<string>(); const stack: string[] = []; const onStack = new Set<string>();
  const indices = new Map<string, number>(); const lowlinks = new Map<string, number>(); let nextIndex = 0;
  // Tarjan's SCC traversal includes overlapping cycles, not just vertices on the first back-edge path.
  const visit = (path: string) => {
    indices.set(path, nextIndex); lowlinks.set(path, nextIndex++);
    stack.push(path); onStack.add(path);
    for (const blocker of blockerIds.get(path) ?? []) {
      if (!blockerIds.has(blocker)) continue;
      if (!indices.has(blocker)) {
        visit(blocker); lowlinks.set(path, Math.min(lowlinks.get(path)!, lowlinks.get(blocker)!));
      } else if (onStack.has(blocker)) lowlinks.set(path, Math.min(lowlinks.get(path)!, indices.get(blocker)!));
    }
    if (lowlinks.get(path) !== indices.get(path)) return;
    const component: string[] = []; let member: string;
    do { member = stack.pop()!; onStack.delete(member); component.push(member); } while (member !== path);
    if (component.length > 1 || blockerIds.get(path)?.includes(path)) component.forEach(p => cyclic.add(p));
  };
  for (const path of tickets) if (!indices.has(path)) visit(path);
  for (const path of tickets) {
    const node = nodes.get(path)!;
    if (cyclic.has(path)) { invalid.add(path); warn(`${path}: cyclic or self dependency; readiness unknown.`); }
    node.readiness = invalid.has(path) ? 'unknown' : node.terminal ? 'terminal' :
      (blockerIds.get(path) ?? []).some(id => !nodes.get(id)!.terminal) ? 'blocked' : node.assignee ? 'assigned' : 'frontier';
  }
  // Expand one hop from project-folder artifacts and actual decision children, never from outside references.
  for (const path of [mapPath, ...tickets, ...artifacts]) {
    for (const ref of read(path)?.links ?? []) {
      if (/^parent(?:[.\[]|$)/.test(ref.key ?? '') || ref.key?.startsWith('blocked-by')) continue;
      if (ref.original && !/^!?\[\[/.test(ref.original)) continue;
      const link = parseWiki(ref.link, false); if (!link) continue;
      const dest = resolveDestination(source, link, path);
      if (!dest || dest.path === path) continue;
      note(dest.path, 'support', dest); edge('context', path, dest.path);
    }
  }
  return { nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)), warnings: [...warnings].sort(), mapPath };
}
export interface TicketProgress { total: number; closed: number; frontier: number; assigned: number; blocked: number; unknown: number }
/** Decision tickets only. Closed is the terminal flag; open tickets are partitioned by readiness, so the buckets sum to total. */
export function ticketProgress(graph: Graph): TicketProgress {
  const progress: TicketProgress = { total: 0, closed: 0, frontier: 0, assigned: 0, blocked: 0, unknown: 0 };
  for (const node of graph.nodes) {
    if (node.kind !== 'ticket') continue;
    progress.total++;
    if (node.terminal) progress.closed++;
    else if (node.readiness === 'frontier' || node.readiness === 'assigned' || node.readiness === 'blocked') progress[node.readiness]++;
    else progress.unknown++;
  }
  return progress;
}
/** Approximate: sums task counts over distinct one-hop context sources; a source linked to several notes counts under each. */
export function linkedTaskTotals(graph: Graph): Map<string, TaskCounts> {
  const tasks = new Map(graph.nodes.map(n => [n.id, n.tasks] as const));
  const sources = new Map<string, Set<string>>();
  for (const e of graph.edges) if (e.kind === 'context') sources.set(e.target, (sources.get(e.target) ?? new Set()).add(e.source));
  const totals = new Map<string, TaskCounts>();
  for (const [target, from] of sources) {
    let found = false; const sum = { done: 0, total: 0 };
    for (const source of from) { const t = tasks.get(source); if (t) { found = true; sum.done += t.done; sum.total += t.total; } }
    if (found) totals.set(target, sum);
  }
  return totals;
}
export function structuralKey(graph: Graph): string {
  return JSON.stringify([graph.mapPath, graph.nodes.map(n => [n.id, n.kind]), graph.edges.map(e => e.id)]);
}
