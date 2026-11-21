import type { NoteMetadata, NoteSource } from '../src/model';
export function fixtureSource(project = false): NoteSource & { arrive(): void } {
  const records: Record<string, NoteMetadata | null> = {};
  const note = (path: string, frontmatter: Record<string, unknown>, links: NoteMetadata['links'] = []) => { records[path] = { frontmatter, links }; };
  note('Example/Architecture.md', { labels: ['wayfinder:map'], status: 'active' }, [{ link: 'Context#Overview', original: '[[Context#Overview|Background]]' }]);
  const ticket = (name: string, type: string, status: string, blockers: string[], assignee: string | null = null) => note(`Example/${name}.md`, {
    labels: [`wayfinder:${type}`], type: 'permanent', parent: '[[Architecture|Architecture map]]', status, 'blocked-by': blockers, assignee
  }, [{ link: 'Context#^why', original: '[[Context#^why|Why]]' }]);
  ticket('Research', 'research', 'closed', []);
  ticket('Prototype', 'prototype', 'done', ['[[Research|Evidence]]']);
  ticket('Grilling', 'grilling', 'open', ['[[Prototype|Try it]]']);
  ticket('Implementation', 'task', 'open', ['[[Grilling]]']);
  ticket('Claimed task', 'task', 'open', ['[[Research]]'], 'Javier');
  ticket('Missing dependency', 'task', 'open', ['[[Unwritten]]']);
  note('Example/Context.md', {}, [{ link: 'Never expand this', original: '[[Never expand this]]' }]);
  if (project) {
    note('Example/implementation-01.md', { title: 'Card 01: establish foundation', tags: ['implementation-ticket'], status: 'not-started' });
    note('Example/implementation-02.md', { title: 'Card 02: reviewed change', labels: 'implementation:ticket', status: 'done' });
    for (const name of ['Spec', 'Handoff', 'Glossary', 'Conventions', 'Working requirements', 'Implementation index']) {
      note(`Example/${name}.md`, { title: `${name} artifact`, ...(name === 'Implementation index' ? { labels: ['implementation:index'], status: 'active' } : {}) });
    }
    records['Example/Loading.md'] = null;
    note('Example/Nested/Generic.md', { title: 'Nested generic artifact' });
    note('Example/Other map.md', { labels: ['wayfinder:map'] });
    note('Example/Foreign.md', { labels: ['wayfinder:task'], parent: '[[Other map]]', status: 'open', assignee: null, 'blocked-by': [] });
  }
  let arrival = 0;
  return { arrive() {
      arrival++;
      note(`Example/Arrival ${arrival}.md`, {}, [{ link: 'Context', original: '[[Context]]' }]);
      if (project) note('Example/Loading.md', { title: 'Indexed implementation', tags: 'implementation-ticket', status: 'not-started' });
      records['Example/Grilling.md']!.links = [...records['Example/Grilling.md']!.links, { link: `Arrival ${arrival}`, original: `[[Arrival ${arrival}]]` }];
    }, paths: () => Object.keys(records), metadata: path => records[path] ?? null,
    resolve: (link, from) => { const path = link.endsWith('.md') ? link : `${link}.md`; return path in records ? path : `${from.split('/').slice(0, -1).join('/')}/${path}` in records ? `${from.split('/').slice(0, -1).join('/')}/${path}` : null; } };
}
