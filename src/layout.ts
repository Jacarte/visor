import dagre from '@dagrejs/dagre';
import type { Graph } from './model';
export const NODE_WIDTH = 230, NODE_HEIGHT = 112;
export function layoutGraph(graph: Graph): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 65, ranksep: 90, marginx: 0, marginy: 0 });
  const dependencyIds = new Set(graph.edges.filter(e => e.kind === 'dependency').flatMap(e => [e.source, e.target]));
  const ranked = graph.nodes.filter(n => n.id !== graph.mapPath && n.kind !== 'type' &&
    (['ticket', 'implementation', 'external', 'missing'].includes(n.kind) || dependencyIds.has(n.id)));
  for (const n of ranked) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of graph.edges) if (e.kind === 'dependency' && g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of ranked) { const p = g.node(n.id); positions.set(n.id, { x: p.x - NODE_WIDTH / 2 + 300, y: p.y - NODE_HEIGHT / 2 + 220 }); }
  const maxX = Math.max(300, ...[...positions.values()].map(p => p.x));
  let typeIndex = 0, supportIndex = 0;
  for (const n of graph.nodes) {
    if (n.id === graph.mapPath) positions.set(n.id, { x: 300, y: 0 });
    if (n.kind === 'type') positions.set(n.id, { x: 0, y: 220 + typeIndex++ * 155 });
    if ((n.kind === 'support' || n.kind === 'map') && n.id !== graph.mapPath && !positions.has(n.id)) positions.set(n.id, { x: maxX + 330, y: 220 + supportIndex++ * 155 });
  }
  return positions;
}
