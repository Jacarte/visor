import { describe, expect, it, vi } from 'vitest';
import { allowedPath, buildGraph, discoverMaps, parseWiki, resolveDestination, structuralKey, type NoteMetadata, type NoteSource } from '../src/model';
import { layoutGraph } from '../src/layout';
const M = 'maps/Map.md';
function fixture() {
  const records: Record<string, NoteMetadata | null> = {
    [M]: { frontmatter: { labels: ['wayfinder:map'], status: 'active' }, links: [] }
  };
  const lookups: string[] = []; const resolutions: string[] = [];
  const source: NoteSource = {
    paths: () => Object.keys(records),
    metadata: path => { lookups.push(path); return records[path] ?? null; },
    resolve: (path, from) => {
      resolutions.push(path);
      const p = path.replace(/^\.\//, '').replace(/\.md$/, '');
      for (const candidate of [`${from.split('/').slice(0, -1).join('/')}/${p}.md`, `${p}.md`]) if (candidate in records) return candidate;
      return Object.keys(records).filter(k => k.endsWith(`/${p}.md`)).sort()[0] ?? null;
    }
  };
  const ticket = (name: string, overrides: Record<string, unknown> = {}, links: NoteMetadata['links'] = []) => {
    const path = `${name}.md`;
    records[path] = { frontmatter: { labels: ['wayfinder:task'], type: 'permanent', parent: '[[maps/Map|A map]]', status: 'open', assignee: null, 'blocked-by': [], ...overrides }, links };
    return path;
  };
  return { records, source, ticket, lookups, resolutions, graph: () => buildGraph(source, M) };
}
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(immutable); }
  return value;
}
describe('graph membership and canonical link identities', () => {
  it('discovers map labels, all four child types, not permanent/support/body mentions or other parents', () => {
    const f = fixture();
    for (const type of ['research', 'prototype', 'grilling', 'task']) f.ticket(`elsewhere/${type}`, { labels: [`wayfinder:${type}`] });
    f.ticket('Other', { parent: '[[Other map]]' });
    f.ticket('Support', { labels: ['permanent'] });
    f.records[M]!.links = [{ link: 'Support', original: '[[Support]]' }];
    f.records['Other map.md'] = { frontmatter: { labels: ['wayfinder:map'] }, links: [] };
    const graph = f.graph();
    expect(discoverMaps(f.source).maps.map(m => m.path)).toEqual(['Other map.md', M].sort());
    expect(graph.nodes.filter(n => n.kind === 'ticket').map(n => n.title).sort()).toEqual(['grilling', 'prototype', 'research', 'task']);
    expect(graph.nodes.filter(n => n.kind === 'type')).toHaveLength(4);
    expect(graph.nodes.find(n => n.title === 'Support')?.kind).toBe('support');
    expect(graph.nodes.find(n => n.id === M)?.status).toBe('active');
  });
  it('resolves quoted-field contents, aliases, headings, blocks, same-file refs, duplicate basenames and deduplicates semantic edges', () => {
    const f = fixture(); f.ticket('a/Same', {}, [{ link: 'Same#Section', original: '[[Same#Section|Alias]]' }]); f.ticket('b/Same');
    f.records['a/Context.md'] = { links: [] };
    f.records['a/Same.md']!.links = [{ link: 'Context#^why', original: '[[Context#^why|Reason]]' }, { link: 'Context#^why', original: '[[Context#^why|Again]]' }];
    f.ticket('a/Dependent', { 'blocked-by': ['[[Same#Heading|Prerequisite]]', '[[Same|Same]]'] });
    const graph = f.graph();
    expect(graph.nodes.filter(n => n.title === 'Same')).toHaveLength(2);
    expect(graph.edges.filter(e => e.kind === 'dependency')).toHaveLength(1);
    expect(graph.edges.find(e => e.kind === 'dependency')).toMatchObject({ source: 'a/Same.md', target: 'a/Dependent.md' });
    expect(graph.nodes.find(n => n.id === 'a/Context.md')?.destination).toEqual({ path: 'a/Context.md', linktext: 'Context#^why', sourcePath: 'a/Same.md' });
    expect(resolveDestination(f.source, '#Heading', 'a/Same.md')?.path).toBe('a/Same.md');
    expect(parseWiki('[[Folder/Note#Heading|Name]]')).toBe('Folder/Note#Heading');
    expect(parseWiki('[[Folder/Note#^block|Name]]')).toBe('Folder/Note#^block');
  });
  it('expands direct context and external blockers only once, without recursively adding their links/children/blockers', () => {
    const f = fixture(); f.ticket('Child', { 'blocked-by': ['[[External]]'] }, [{ link: 'Support', original: '[[Support]]' }]);
    f.records['External.md'] = { frontmatter: { status: 'closed', 'blocked-by': ['[[Secret]]'] }, links: [{ link: 'Secret', original: '[[Secret]]' }] };
    f.records['Support.md'] = { links: [{ link: 'Secret', original: '[[Secret]]' }] };
    f.records['Secret.md'] = { links: [] };
    const graph = f.graph();
    expect(graph.nodes.map(n => n.id)).not.toContain('Secret.md');
    expect(graph.nodes.find(n => n.title === 'Child')?.readiness).toBe('frontier');
    expect(graph.nodes.find(n => n.title === 'External')?.kind).toBe('external');
  });
  it('never requests metadata or resolves explicit destinations in forbidden directories', () => {
    const f = fixture(); f.records['chats/private.md'] = null; f.records['Javier(me) notes/private.md'] = null;
    f.ticket('Child', { 'blocked-by': ['[[chats/private]]'] }, [{ link: 'Javier(me) notes/private', original: '[[Javier(me) notes/private]]' }]);
    f.graph(); discoverMaps(f.source);
    expect(f.lookups.every(allowedPath)).toBe(true);
    expect(f.resolutions.some(p => /chats|Javier/.test(p))).toBe(false);
    expect(allowedPath('folder/../chats/private.md')).toBe(false);
    expect(allowedPath('nested/CHATS/private.md')).toBe(false);
  });
  it('rejects a resolver result in forbidden folders before metadata access, even for a bare basename', () => {
    const metadata = vi.fn((p: string) => p === M ? { frontmatter: { labels: ['wayfinder:map'] }, links: [{ link: 'private', original: '[[private]]' }] } : null);
    buildGraph({ paths: () => [M], metadata, resolve: () => 'chats/private.md' }, M);
    expect(metadata).toHaveBeenCalledTimes(1);
  });
});
describe('readiness and partial metadata', () => {
  it('distinguishes frontier, assigned, blocked and terminal; closed/done are dimmed flags', () => {
    const f = fixture(); f.ticket('Closed', { status: 'closed' }); f.ticket('Done', { status: 'done' });
    f.ticket('Ready', { 'blocked-by': ['[[Closed]]', '[[Done]]'] });
    f.ticket('Assigned', { assignee: 'Javier', 'blocked-by': ['[[Done]]'] });
    f.ticket('Blocked', { 'blocked-by': ['[[Ready]]'] });
    const byTitle = Object.fromEntries(f.graph().nodes.map(n => [n.title, n]));
    expect(byTitle.Ready.readiness).toBe('frontier'); expect(byTitle.Assigned.readiness).toBe('assigned'); expect(byTitle.Blocked.readiness).toBe('blocked');
    expect(byTitle.Done.terminal).toBe(true); expect(byTitle.Closed.terminal).toBe(true);
  });
  it('missing, unresolved, malformed and cache-null blockers never imply ready', () => {
    const f = fixture(); f.ticket('Missing', { 'blocked-by': ['[[Absent]]'] });
    f.ticket('Malformed', { 'blocked-by': [{ bad: 'shape' }] });
    f.ticket('Null', { 'blocked-by': ['[[Not indexed]]'] }); f.records['Not indexed.md'] = null;
    f.ticket('Open external', { 'blocked-by': ['[[External]]'] }); f.records['External.md'] = { frontmatter: { status: 'open' }, links: [] };
    const graph = f.graph();
    for (const title of ['Missing', 'Malformed', 'Null']) expect(graph.nodes.find(n => n.title === title)?.readiness).toBe('unknown');
    expect(graph.nodes.find(n => n.title === 'Open external')?.readiness).toBe('blocked');
    expect(graph.nodes.filter(n => n.kind === 'missing')).toHaveLength(2);
    expect(graph.warnings.join(' ')).toMatch(/unavailable/);
  });
  it('handles invalid metadata shapes and unknown statuses conservatively without crashing', () => {
    const f = fixture();
    f.ticket('Bad labels', { labels: [7, 'wayfinder:task'] }); f.ticket('Bad parent', { parent: ['[[maps/Map]]', '[[Other]]'] });
    f.ticket('Bad status', { status: 'active' }); f.ticket('Bad assignee', { assignee: 1 }); f.ticket('Bad blockers', { 'blocked-by': null });
    const graph = f.graph();
    expect(graph.nodes.some(n => n.title === 'Bad labels')).toBe(false); expect(graph.nodes.some(n => n.title === 'Bad parent')).toBe(false);
    for (const title of ['Bad status', 'Bad assignee', 'Bad blockers']) expect(graph.nodes.find(n => n.title === title)?.readiness).toBe('unknown');
    f.records[M] = null; expect(f.graph().nodes).toHaveLength(0);
  });
  it('warns for self dependencies and cycles, never calls them frontier', () => {
    const f = fixture(); f.ticket('Self', { 'blocked-by': ['[[Self]]'] }); f.ticket('A', { 'blocked-by': ['[[B]]'] }); f.ticket('B', { 'blocked-by': ['[[A]]'] });
    const graph = f.graph();
    for (const title of ['Self', 'A', 'B']) expect(graph.nodes.find(n => n.title === title)?.readiness).toBe('unknown');
    expect(graph.warnings.filter(w => w.includes('cyclic'))).toHaveLength(3);
  });
  it('does not mutate source metadata, links or path arrays, and refreshes identity/readiness on source changes', () => {
    const f = fixture(); f.ticket('First'); const before = JSON.stringify(f.records); immutable(f.records);
    expect(() => f.graph()).not.toThrow(); expect(JSON.stringify(f.records)).toBe(before);
    const other = fixture(); other.ticket('Old'); const a = other.graph();
    other.records['New.md'] = other.records['Old.md']; delete other.records['Old.md'];
    expect(structuralKey(other.graph())).not.toBe(structuralKey(a));
  });
});
describe('dependency-only deterministic layout', () => {
  it('orders prerequisites above dependents, independent of parent/type/context edges and leaves input unchanged', () => {
    const f = fixture(); f.ticket('A', { status: 'done' }); f.ticket('B', { 'blocked-by': ['[[A]]'] });
    const graph = f.graph(); const before = JSON.stringify(graph); immutable(graph);
    const positions = layoutGraph(graph);
    expect(positions.get('A.md')!.y).toBeLessThan(positions.get('B.md')!.y);
    expect(layoutGraph(graph)).toEqual(positions);
    expect(layoutGraph({ ...graph, edges: graph.edges.filter(e => e.kind === 'dependency') })).toEqual(positions);
    expect(JSON.stringify(graph)).toBe(before);
  });
});
it('preserves source-relative dot paths for the public resolver while rejecting excluded relative destinations first', () => {
  const source: NoteSource = { paths: () => [], metadata: () => null, resolve: vi.fn(() => 'shared/Context.md') };
  expect(resolveDestination(source, '../shared/Context#Heading', 'work/Task.md')).toEqual({ path: 'shared/Context.md', sourcePath: 'work/Task.md', linktext: '../shared/Context#Heading' });
  expect(source.resolve).toHaveBeenCalledWith('../shared/Context', 'work/Task.md');
  expect(resolveDestination(source, '../chats/Private', 'work/Task.md')).toBeNull(); expect(source.resolve).toHaveBeenCalledTimes(1);
});

it('marks every member of an overlapping SCC unknown, including a would-be frontier ticket', () => {
  const f = fixture();
  f.ticket('A', { status: 'done', 'blocked-by': ['[[B]]', '[[C]]'] });
  f.ticket('B', { status: 'done', 'blocked-by': ['[[A]]'] });
  f.ticket('C', { 'blocked-by': ['[[B]]'] });
  const graph = f.graph();
  for (const title of ['A', 'B', 'C']) {
    expect(graph.nodes.find(n => n.title === title)?.readiness).toBe('unknown');
    expect(graph.warnings).toContain(`${title}.md: cyclic or self dependency; readiness unknown.`);
  }
  expect(graph.nodes.some(n => n.readiness === 'frontier')).toBe(false);
  expect(f.graph()).toEqual(graph);
  expect(layoutGraph(f.graph())).toEqual(layoutGraph(graph));
});
it('isolates disconnected SCCs and self-loops without overflagging an acyclic shared diamond or external dependencies', () => {
  const f = fixture();
  f.ticket('A', { status: 'done', 'blocked-by': ['[[B]]', '[[C]]'] });
  f.ticket('B', { status: 'done', 'blocked-by': ['[[A]]'] });
  f.ticket('C', { 'blocked-by': ['[[B]]'] });
  f.ticket('D', { 'blocked-by': ['[[E]]'] }); f.ticket('E', { 'blocked-by': ['[[D]]'] });
  f.ticket('Self', { status: 'closed', 'blocked-by': ['[[Self]]'] });
  f.ticket('Root', { status: 'done' });
  f.ticket('Left', { status: 'closed', 'blocked-by': ['[[Root]]'] });
  f.ticket('Right', { status: 'done', 'blocked-by': ['[[Root]]'] });
  f.ticket('Tip', { 'blocked-by': ['[[Left]]', '[[Right]]'] });
  f.ticket('Direct', { 'blocked-by': ['[[External]]'] });
  f.records['External.md'] = { frontmatter: { status: 'done', 'blocked-by': ['[[Direct]]'] }, links: [] };
  const graph = f.graph();
  for (const title of ['A', 'B', 'C', 'D', 'E', 'Self']) expect(graph.nodes.find(n => n.title === title)?.readiness).toBe('unknown');
  for (const title of ['Root', 'Left', 'Right']) expect(graph.nodes.find(n => n.title === title)?.readiness).toBe('terminal');
  for (const title of ['Tip', 'Direct']) expect(graph.nodes.find(n => n.title === title)?.readiness).toBe('frontier');
  expect(graph.warnings.filter(w => w.includes('cyclic'))).toHaveLength(6);
});

describe('selected project-folder artifacts', () => {
  it('includes implementation tag/label and unlabelled artifacts with canonical identities, titles and no inferred readiness', () => {
    const f = fixture();
    f.records['maps/implementation-01.md'] = { frontmatter: { title: 'Card 01: foundation', tags: 'implementation-ticket', status: 'not-started' }, links: [{ link: 'maps/spec', original: '[[maps/spec|Required approved dependency]]' }] };
    f.records['maps/implementation-02.md'] = { frontmatter: { labels: ['implementation:ticket', 'implementation:approved-change'], status: 'not-started', assignee: 'Someone' }, links: [] };
    for (const name of ['spec', 'handoff', 'glossary', 'conventions', 'working-requirements', 'implementation-index', 'generic']) {
      f.records[`maps/${name}.md`] = { frontmatter: name === 'implementation-index' ? { labels: 'implementation:index', status: 'active' } : {}, links: [] };
    }
    f.records['maps/done.md'] = { frontmatter: { tags: ['implementation-ticket'], status: 'Done' }, links: [] };
    const graph = f.graph();
    expect(graph.nodes.find(n => n.id === 'maps/implementation-01.md')).toMatchObject({ title: 'Card 01: foundation', kind: 'implementation', status: 'not-started', readiness: 'unknown', assignee: null });
    expect(graph.nodes.find(n => n.id === 'maps/implementation-02.md')).toMatchObject({ kind: 'implementation', readiness: 'unknown' });
    expect(graph.nodes.filter(n => n.kind === 'support')).toHaveLength(7);
    expect(graph.nodes.find(n => n.id === 'maps/done.md')).toMatchObject({ terminal: true, status: 'Done', readiness: 'terminal' });
    expect(graph.edges.some(e => e.kind === 'dependency')).toBe(false);
    expect(graph.nodes.some(n => ['frontier', 'assigned'].includes(n.readiness))).toBe(false);
    expect(graph.warnings).toEqual([]);
  });
  it('bounds the folder tree, expands every folder artifact once, retains outside decision children and excludes forbidden paths', () => {
    const f = fixture(); f.ticket('outside/Decision');
    f.records['maps/nested/Spec.md'] = { links: [{ link: 'outside/Reference', original: '[[outside/Reference]]' }] };
    f.records['outside/Reference.md'] = { links: [{ link: 'outside/Do not expand', original: '[[outside/Do not expand]]' }] };
    f.records['outside/Do not expand.md'] = { links: [] };
    f.records['maps-sibling/Hidden.md'] = { links: [] };
    f.records['maps/chats/private.md'] = null; f.records['maps/Javier(me) notes/private.md'] = null;
    const graph = f.graph();
    expect(graph.nodes.map(n => n.id)).toEqual(expect.arrayContaining(['maps/nested/Spec.md', 'outside/Decision.md', 'outside/Reference.md']));
    for (const path of ['outside/Do not expand.md', 'maps-sibling/Hidden.md', 'maps/chats/private.md', 'maps/Javier(me) notes/private.md']) expect(graph.nodes.some(n => n.id === path)).toBe(false);
    expect(graph.edges).toContainEqual(expect.objectContaining({ kind: 'folder', source: M, target: 'maps/nested/Spec.md' }));
    expect(f.lookups.every(allowedPath)).toBe(true);
  });
  it('shows null-cache artifacts immediately and updates their canonical node when metadata and new notes arrive', () => {
    const f = fixture(); f.records['maps/Loading.md'] = null;
    expect(f.graph().nodes.find(n => n.id === 'maps/Loading.md')).toMatchObject({ kind: 'support', unavailable: true, readiness: 'unknown' });
    f.records['maps/Loading.md'] = { frontmatter: { tags: ['implementation-ticket'], title: 'Indexed title' }, links: [] };
    f.records['maps/New.md'] = { links: [] };
    const graph = f.graph();
    expect(graph.nodes.filter(n => n.id === 'maps/Loading.md')).toHaveLength(1);
    expect(graph.nodes.find(n => n.id === 'maps/Loading.md')).toMatchObject({ kind: 'implementation', title: 'Indexed title', unavailable: false });
    expect(graph.nodes.some(n => n.id === 'maps/New.md')).toBe(true);
  });
  it('keeps explicit selected-map decisions stronger than implementation metadata; foreign/malformed parents remain folder artifacts only', () => {
    const f = fixture();
    f.ticket('maps/Decision', { labels: ['wayfinder:task', 'implementation:ticket'], tags: ['implementation-ticket'] });
    f.ticket('maps/Foreign', { parent: '[[maps/Other]]', tags: ['implementation-ticket'] });
    f.ticket('maps/Malformed', { parent: { bad: true } });
    f.ticket('maps/Absent', { parent: undefined });
    f.records['maps/Other.md'] = { frontmatter: { labels: ['wayfinder:map'] }, links: [] };
    const graph = f.graph();
    expect(graph.nodes.find(n => n.id === 'maps/Decision.md')).toMatchObject({ kind: 'ticket', readiness: 'frontier' });
    for (const name of ['Foreign', 'Malformed', 'Absent']) {
      const path = `maps/${name}.md`;
      expect(graph.nodes.find(n => n.id === path)).toMatchObject({ readiness: 'unknown', folder: 'maps/', types: [] });
      expect(graph.edges.some(e => e.kind === 'parent' && e.target === path)).toBe(false);
      expect(graph.edges.some(e => e.kind === 'folder' && e.target === path)).toBe(true);
    }
    expect(graph.nodes.find(n => n.id === 'maps/Foreign.md')).toMatchObject({ kind: 'implementation', parent: '[[maps/Other]]' });
    expect(buildGraph(f.source, 'maps/Other.md').nodes.find(n => n.id === 'maps/Foreign.md')?.kind).toBe('ticket');
  });
  it('uses optional explicit artifact blockers only, warns on malformed ones, and never infers execution approval', () => {
    const f = fixture();
    f.records['maps/A.md'] = { frontmatter: { tags: ['implementation-ticket'], 'blocked-by': ['[[maps/B]]'], status: 'not-started' }, links: [] };
    f.records['maps/B.md'] = { frontmatter: { status: 'closed' }, links: [] };
    f.records['maps/Bad.md'] = { frontmatter: { 'blocked-by': 7 }, links: [] };
    const graph = f.graph();
    expect(graph.edges.filter(e => e.kind === 'dependency')).toEqual([expect.objectContaining({ source: 'maps/B.md', target: 'maps/A.md' })]);
    expect(graph.nodes.find(n => n.id === 'maps/A.md')?.readiness).toBe('unknown');
    expect(graph.warnings).toEqual(['maps/Bad.md: blocked-by must be a wikilink or list (use [] for none).']);
  });
  it('accepts scalar labels but not malformed lists and falls back from blank/nonstring titles', () => {
    const f = fixture();
    f.records[M]!.frontmatter = { labels: 'wayfinder:map', title: '  Project title  ' };
    f.records['maps/Blank.md'] = { frontmatter: { title: ' ', labels: [1, 'implementation:ticket'] }, links: [] };
    expect(discoverMaps(f.source).maps).toEqual([{ path: M, title: 'Project title' }]);
    expect(f.graph().nodes.find(n => n.id === 'maps/Blank.md')).toMatchObject({ title: 'Blank', kind: 'support' });
  });
});
it('layouts implementation and explicit generic dependencies without overlapping map headers or missing positions', () => {
  const f = fixture();
  f.records['maps/Other.md'] = { frontmatter: { labels: ['wayfinder:map'] }, links: [] };
  f.records['maps/Prerequisite.md'] = { frontmatter: { status: 'done' }, links: [] };
  f.records['maps/Implementation.md'] = { frontmatter: { tags: ['implementation-ticket'], 'blocked-by': ['[[maps/Prerequisite]]'] }, links: [] };
  f.records['maps/Bad.md'] = { frontmatter: { status: 'done', 'blocked-by': 1 }, links: [] };
  const graph = f.graph(); const positions = layoutGraph(graph);
  expect(positions.size).toBe(graph.nodes.length);
  expect(positions.get('maps/Prerequisite.md')!.y).toBeLessThan(positions.get('maps/Implementation.md')!.y);
  expect(positions.get('maps/Other.md')).not.toEqual(positions.get(M));
  expect(graph.nodes.find(n => n.id === 'maps/Bad.md')?.readiness).toBe('unknown');
});
