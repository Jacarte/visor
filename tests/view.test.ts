// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { fakeApp, Plugin } from './obsidian-mock';
const { roots } = vi.hoisted(() => ({ roots: [] as { render: ReturnType<typeof vi.fn>; unmount: ReturnType<typeof vi.fn> }[] }));
vi.mock('react-dom/client', () => ({ createRoot: () => { const root = { render: vi.fn(), unmount: vi.fn() }; roots.push(root); return root; } }));
import VisorPlugin from '../src/main';
afterEach(() => { vi.useRealTimers(); roots.length = 0; });
async function create(ready = true) {
  const app = fakeApp(ready); const plugin = new VisorPlugin(app as unknown as App, {} as never);
  await plugin.onload(); const fixturePlugin = plugin as unknown as Plugin;
  const view = fixturePlugin.views.get('visor-graph')!({ app }) as any;
  await view.onOpen(); return { app, plugin, view, root: roots.at(-1)! };
}
it('seeds after layout readiness, coalesces all live events, ignores forbidden changes and cleans up on close', async () => {
  vi.useFakeTimers(); const { app, view, root } = await create(false);
  expect(root.render).not.toHaveBeenCalled(); expect(app.vault.refs).toHaveLength(0);
  app.layoutCallbacks[0](); expect(root.render).toHaveBeenCalledTimes(1);
  app.metadataCache.emit('changed', { path: 'Map.md' }); app.metadataCache.emit('resolved');
  for (const name of ['create', 'delete', 'modify', 'rename']) app.vault.emit(name, { path: 'Map.md' }, 'Old.md');
  vi.advanceTimersByTime(60); expect(root.render).toHaveBeenCalledTimes(2);
  app.metadataCache.emit('changed', { path: 'chats/Private.md' }); vi.advanceTimersByTime(60); expect(root.render).toHaveBeenCalledTimes(2);
  app.vault.emit('rename', { path: 'New.md' }, 'Map.md'); await view.onClose(); vi.runAllTimers();
  expect(root.unmount).toHaveBeenCalledTimes(1); expect(root.render).toHaveBeenCalledTimes(2);
  expect(app.vault.refs).toHaveLength(0); expect(app.metadataCache.refs).toHaveLength(0);
});
it('closing before layout readiness prevents late subscriptions and rendering', async () => {
  const { app, view, root } = await create(false); await view.onClose(); app.layoutCallbacks[0]();
  expect(root.render).not.toHaveBeenCalled(); expect(app.vault.refs).toHaveLength(0); expect(app.metadataCache.refs).toHaveLength(0);
});
it('open command reveals an existing leaf instead of duplicating the view', async () => {
  const { app, plugin } = await create(); const existing = { setViewState: vi.fn() }; app.workspace.getLeavesOfType.mockReturnValue([existing]);
  (plugin as unknown as Plugin).commands[0].callback(); await Promise.resolve();
  expect(app.workspace.revealLeaf).toHaveBeenCalledWith(existing); expect(app.workspace.getLeaf).not.toHaveBeenCalled();
  plugin.onunload(); expect(app.workspace.detachLeavesOfType).toHaveBeenCalledWith('visor-graph');
});
it('reopening a closed view rejects callbacks from its old pending layout generation', async () => {
  const { app, view, root: oldRoot } = await create(false); await view.onClose(); await view.onOpen();
  app.layoutCallbacks.forEach(callback => callback());
  expect(oldRoot.render).not.toHaveBeenCalled(); expect(roots.at(-1)!.render).toHaveBeenCalledTimes(1);
  expect(app.metadataCache.refs).toHaveLength(2); expect(app.vault.refs).toHaveLength(4); await view.onClose();
});
