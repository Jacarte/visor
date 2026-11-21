import { vi } from 'vitest';
export class Component {
  children: Component[] = []; cleanups: (() => void)[] = []; loaded = false; unloadCount = 0;
  load() { this.loaded = true; }
  unload() { this.loaded = false; this.unloadCount++; this.children.splice(0).forEach(c => c.unload()); this.cleanups.splice(0).forEach(f => f()); }
  addChild<T extends Component>(c: T): T { this.children.push(c); if (this.loaded) c.load(); return c; }
  register(f: () => void) { this.cleanups.push(f); }
  registerEvent(ref: { owner: Emitter }) { this.register(() => ref.owner.offref(ref)); }
}
export class TFile { constructor(public path: string) {} }
export class Emitter {
  refs: { owner: Emitter; name: string; callback: (...args: any[]) => void }[] = [];
  on(name: string, callback: (...args: any[]) => void) { const ref = { owner: this, name, callback }; this.refs.push(ref); return ref; }
  offref(ref: object) { this.refs = this.refs.filter(r => r !== ref); }
  emit(name: string, ...args: unknown[]) { this.refs.filter(r => r.name === name).forEach(r => r.callback(...args)); }
}
export const MarkdownRenderer = { render: vi.fn(async (_app: unknown, markdown: string, host: HTMLElement, _path: string, _component: Component) => { host.textContent = markdown; }) };
export class ItemView extends Component {
  app: ReturnType<typeof fakeApp>; contentEl = document.createElement('div');
  constructor(leaf: { app: ReturnType<typeof fakeApp> }) { super(); this.app = leaf.app; }
}
export class Plugin extends Component {
  views = new Map<string, (leaf: unknown) => unknown>(); commands: { id: string; callback: () => void }[] = [];
  constructor(public app: ReturnType<typeof fakeApp>) { super(); }
  registerView(type: string, factory: (leaf: unknown) => unknown) { this.views.set(type, factory); }
  addCommand(command: { id: string; callback: () => void }) { this.commands.push(command); }
  addRibbonIcon() {}
}
export function fakeApp(ready = true) {
  const cache: Record<string, any> = { 'Map.md': { frontmatter: { labels: ['wayfinder:map'] } } };
  const files = [new TFile('Map.md'), new TFile('chats/Private.md'), new TFile('Javier(me) notes/Private.md')];
  const layoutCallbacks: (() => void)[] = [];
  const metadataCache = Object.assign(new Emitter(), {
    getFileCache: vi.fn((file: TFile) => cache[file.path] ?? null),
    getFirstLinkpathDest: vi.fn((path: string, _source: string) => files.find(f => f.path === `${path}.md` || f.path === path) ?? null)
  });
  const vault = Object.assign(new Emitter(), {
    getMarkdownFiles: vi.fn(() => files),
    getAbstractFileByPath: vi.fn((path: string) => files.find(f => f.path === path) ?? null),
    cachedRead: vi.fn(async (_file: TFile) => '# Example\n- [ ] Task')
  });
  const workspace = {
    onLayoutReady: vi.fn((callback: () => void) => { if (ready) callback(); else layoutCallbacks.push(callback); }),
    openLinkText: vi.fn(async () => {}), getLeavesOfType: vi.fn(() => [] as unknown[]),
    getLeaf: vi.fn(), revealLeaf: vi.fn(async () => {}), detachLeavesOfType: vi.fn()
  };
  return { metadataCache, vault, workspace, files, cache, layoutCallbacks };
}
