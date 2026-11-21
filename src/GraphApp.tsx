import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, EdgeChangeset, Handle, MarkerType, NodeChangeset, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { buildGraph, discoverMaps, structuralKey, ticketTypes, type Graph, type GraphNode, type NoteSource } from './model';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './layout';
import { mountPreview, type PreviewServices } from './preview';
export interface GraphAppProps { source: NoteSource; preview: PreviewServices; revision: number }
type CanvasNode = Node<{ record: GraphNode; filtered: boolean }, 'visor'>;
function NoteNode({ data, selected }: NodeProps<CanvasNode>) {
  const n = data.record;
  return <div className={`visor-node visor-kind-${n.kind} ${n.terminal ? 'visor-terminal' : ''} ${data.filtered ? 'visor-filtered' : ''} ${selected ? 'visor-selected' : ''}`}
    data-kind={n.kind} data-readiness={n.readiness} data-title={n.title} title={n.destination?.path ?? n.title}>
    <Handle type="target" position={Position.Top} isConnectable={false} />
    <div className="visor-node-kind">{n.kind === 'external' ? 'External blocker' : n.kind}</div>
    <strong>{n.title}</strong>
    <div className="visor-types">{n.types.map(t => <span key={t} className={`visor-type-${t}`}>{t}</span>)}</div>
    {n.kind !== 'type' && <div className="visor-state">{n.unavailable ? 'Metadata indexing / unavailable' : `${n.status} · ${n.readiness}`}{n.assignee ? ` · ${n.assignee}` : ''}</div>}
    {n.folder && <div className="visor-origin">Folder: {n.folder}</div>}
    <Handle type="source" position={Position.Bottom} isConnectable={false} />
  </div>;
}
const nodeTypes = { visor: NoteNode };
const edgeStyles = {
  dependency: { stroke: 'var(--visor-dependency, #b34c45)', strokeWidth: 2.2 },
  parent: { stroke: 'var(--visor-muted, #8a8a8a)', strokeDasharray: '7 5', opacity: 0.6 },
  folder: { stroke: 'var(--visor-context, #7b8198)', strokeDasharray: '1 7', opacity: 0.4 },
  context: { stroke: 'var(--visor-context, #7b8198)', strokeDasharray: '2 5', opacity: 0.7 },
  type: { stroke: 'var(--visor-muted, #8a8a8a)', strokeDasharray: '2 3', opacity: 0.4 }
};
function toEdges(graph: Graph): Edge[] { return graph.edges.map(e => ({ ...e, type: 'smoothstep', deletable: false, reconnectable: false,
  selectable: true, style: edgeStyles[e.kind], markerEnd: e.kind === 'dependency' ? { type: MarkerType.ArrowClosed, color: '#b34c45' } : undefined,
  label: e.kind === 'dependency' ? 'blocks' : e.kind === 'parent' ? 'parent' : e.kind === 'folder' ? 'folder context' : e.kind === 'context' ? 'context' : 'type',
  labelStyle: { fontSize: 10 }, labelBgStyle: { fill: 'var(--background-primary, #fff)' } })); }
function Preview({ node, services, revision }: { node?: GraphNode; services: PreviewServices; revision: number }) {
  const container = useRef<HTMLDivElement>(null); const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    if (!node?.destination || !container.current) return;
    return mountPreview(services, node.destination, container.current, setError);
  }, [node?.id, node?.destination?.linktext, services, revision]);
  return <aside className="visor-preview" aria-label="Note preview">
    <div className="visor-preview-heading"><strong>{node?.title ?? 'Select a node'}</strong>
      {node?.destination && <button onClick={e => services.open(node.destination!, e.metaKey || e.ctrlKey || e.shiftKey)}>Open note ↗</button>}</div>
    {!node && <p>Click an artifact to preview it. Drag nodes temporarily; nothing is saved.</p>}
    {node?.folder && <p className="visor-provenance">Project folder: {node.folder} (folder context is not decision membership).</p>}
    {node?.parent && <p className="visor-provenance">Stored parent: {node.parent}</p>}
    {node?.unavailable && <p>Metadata indexing / unavailable. This artifact will update when indexed.</p>}
    {node?.kind === 'type' && <p>Type badge: {node.title}. The type filter is now selected. This badge is not a note.</p>}
    {node?.kind === 'missing' && <p>This blocker cannot be resolved. Its dependent cannot be marked ready.</p>}
    {error && <p role="alert">{error}</p>}
    <div ref={container} className="visor-preview-body" hidden={!node?.destination} />
  </aside>;
}
function Canvas({ source, preview, revision }: GraphAppProps) {
  const discovery = useMemo(() => discoverMaps(source), [source, revision]);
  const [map, setMap] = useState('');
  const selectedMap = discovery.maps.some(m => m.path === map) ? map : discovery.maps[0]?.path ?? '';
  const graph = useMemo(() => selectedMap ? buildGraph(source, selectedMap) : { nodes: [], edges: [], warnings: [], mapPath: '' } as Graph, [source, selectedMap, revision]);
  const structure = structuralKey(graph); const previousStructure = useRef(''); const previousMap = useRef('');
  const [nodes, setNodes] = useState<CanvasNode[]>([]); const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [search, setSearch] = useState(''); const [type, setType] = useState('all'); const [status, setStatus] = useState('all');
  const flow = useReactFlow<CanvasNode>();
  const fitPending = useRef(false);
  useEffect(() => {
    const changed = previousStructure.current !== structure; previousStructure.current = structure;
    const positions = changed ? layoutGraph(graph) : null;
    setNodes(previous => graph.nodes.map(record => {
      const prior = previous.find(n => n.id === record.id);
      return { id: record.id, type: 'visor', position: positions?.get(record.id) ?? prior?.position ?? { x: 0, y: 0 },
        width: NODE_WIDTH, height: NODE_HEIGHT, selected: prior?.selected ?? false,
        deletable: false, connectable: false, draggable: true, data: { record, filtered: false } };
    }));
    setEdges(previous => toEdges(graph).map(e => ({ ...e, selected: previous.find(p => p.id === e.id)?.selected ?? false })));
    if (previousMap.current !== graph.mapPath) { fitPending.current = true; previousMap.current = graph.mapPath; }
    if (changed) setSelectedId(id => graph.nodes.some(n => n.id === id) ? id : undefined);
  }, [graph, structure]);
  useEffect(() => {
    if (!nodes.length || !fitPending.current) return;
    const frame = requestAnimationFrame(() => { fitPending.current = false; void flow.fitView({ padding: 0.15, duration: 0 }); });
    return () => cancelAnimationFrame(frame);
  }, [nodes, flow]);
  const displayed = useMemo(() => nodes.map(n => {
    const r = n.data.record; const isArtifact = !!r.destination;
    const match = (type === 'all' || (type === 'implementation' ? r.kind === 'implementation' : type === 'support' ? r.kind === 'support' : r.types.includes(type as typeof ticketTypes[number]))) &&
      (status === 'all' || (status === 'terminal' ? r.terminal : status === 'frontier' || status === 'assigned' ? r.readiness === status : r.status.toLowerCase().trim() === status)) &&
      (!search || `${r.title} ${r.id}`.toLowerCase().includes(search.toLowerCase()));
    return { ...n, data: { record: r, filtered: isArtifact && !match } };
  }), [nodes, type, status, search]);
  const selected = graph.nodes.find(n => n.id === selectedId);
  const reset = () => { const positions = layoutGraph(graph); setNodes(old => old.map(n => ({ ...n, position: positions.get(n.id)! }))); fitPending.current = true; };
  return <div className="visor-app">
    <header className="visor-toolbar">
      <strong>Visor</strong><span className="visor-readonly">Read only · local</span>
      <label>Map <select aria-label="Map" value={selectedMap} onChange={e => { setMap(e.target.value); setSelectedId(undefined); }}>
        {!discovery.maps.length && <option value="">No maps indexed</option>}{discovery.maps.map(m => <option key={m.path} value={m.path}>{m.path}</option>)}</select></label>
      <label>Search <input aria-label="Search" placeholder="Title or path" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>Type <select aria-label="Type" value={type} onChange={e => setType(e.target.value)}><option value="all">All types</option>{ticketTypes.map(t => <option key={t}>{t}</option>)}<option value="implementation">Implementation</option><option value="support">Note / support</option></select></label>
      <label>Status <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value)}>
        <option value="all">Full history</option><option value="open">Open</option><option value="terminal">Closed / done</option><option value="frontier">Frontier</option><option value="assigned">Assigned & unblocked</option></select></label>
      <button onClick={() => void flow.fitView({ padding: 0.15 })}>Fit</button><button onClick={reset}>Reset layout</button>
    </header>
    <div className="visor-legend" aria-label="Legend"><span>Filters dim nonmatches; blockers stay visible.</span>{ticketTypes.map(t => <span key={t} className={`visor-type-${t}`}>{t}</span>)}
      <span className="visor-type-implementation">implementation</span><span>note / support = other artifacts</span>
      <span>→ prerequisite → dependent</span><span>-- parent · ⋯ folder context / context / type</span><span>faded = closed/done</span>
      <span>Decision frontier = open, unassigned, all direct blockers terminal; other artifacts have no inferred readiness</span></div>
    {(graph.warnings.length > 0 || discovery.unavailable > 0) && <details className="visor-warnings"><summary>{graph.warnings.length} graph warning(s){discovery.unavailable ? ` · ${discovery.unavailable} cache(s) indexing/unavailable` : ''}</summary>
      <ul>{graph.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
    <div className="visor-main"><div className="visor-canvas" aria-label="Map graph">
      {!selectedMap && <div className="visor-empty">No wayfinder:map notes are currently indexed in allowed folders. Visor refreshes when metadata becomes available.</div>}
      <ReactFlow<CanvasNode> nodes={displayed} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={changes => {
          const allowed = new NodeChangeset<CanvasNode>(changes.toArray().filter(c => c.type === 'position' || c.type === 'select' || c.type === 'dimensions'));
          setNodes(old => allowed.applyTo(old));
        }}
        onEdgesChange={changes => { const allowed = new EdgeChangeset(changes.toArray().filter(c => c.type === 'select')); setEdges(old => allowed.applyTo(old)); }}
        onNodeClick={(_, node) => { setSelectedId(node.id); if (node.data.record.kind === 'type') setType(node.data.record.title); }}
        nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} onBeforeDelete={async () => false}
        nodesDraggable elementsSelectable panOnDrag zoomOnScroll zoomOnPinch minZoom={0.08} maxZoom={2.5}>
        <Background /><Controls showInteractive={false} />
      </ReactFlow>
    </div><Preview node={selected} services={preview} revision={revision} /></div>
  </div>;
}
export function GraphApp(props: GraphAppProps) { return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>; }
