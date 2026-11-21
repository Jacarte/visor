import { ItemView, Plugin, type WorkspaceLeaf } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { GraphApp } from './GraphApp';
import { obsidianPreview, vaultSource } from './adapter';
import { allowedPath } from './model';
import { coalescedRefresh } from './refresh';
const VIEW_TYPE = 'visor-graph';
class VisorView extends ItemView {
  private root?: Root;
  private disposed = false;
  private revision = 0;
  private generation = 0;
  private stopRefresh?: () => void;
  private eventCleanup: (() => void)[] = [];
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Visor'; }
  getIcon() { return 'network'; }
  async onOpen() {
    const generation = ++this.generation;
    this.disposed = false; this.contentEl.classList.add('visor-view'); this.root = createRoot(this.contentEl);
    const preview = obsidianPreview(this.app);
    const refresh = () => {
      if (this.disposed || generation !== this.generation) return;
      this.root?.render(<GraphApp source={vaultSource(this.app)} preview={preview} revision={++this.revision} />);
    };
    const queue = coalescedRefresh(refresh); this.stopRefresh = () => queue.dispose();
    this.register(() => queue.dispose());
    this.app.workspace.onLayoutReady(() => {
      if (this.disposed || generation !== this.generation) return;
      const scoped = (file: { path: string }) => { if (allowedPath(file.path)) queue.request(); };
      const metadataEvent = (ref: ReturnType<typeof this.app.metadataCache.on>) => { this.registerEvent(ref); this.eventCleanup.push(() => this.app.metadataCache.offref(ref)); };
      const vaultEvent = (ref: ReturnType<typeof this.app.vault.on>) => { this.registerEvent(ref); this.eventCleanup.push(() => this.app.vault.offref(ref)); };
      metadataEvent(this.app.metadataCache.on('changed', scoped));
      metadataEvent(this.app.metadataCache.on('resolved', () => queue.request()));
      vaultEvent(this.app.vault.on('create', scoped));
      vaultEvent(this.app.vault.on('delete', scoped));
      vaultEvent(this.app.vault.on('modify', scoped));
      vaultEvent(this.app.vault.on('rename', (file, oldPath) => { if (allowedPath(file.path) || allowedPath(oldPath)) queue.request(); }));
      refresh();
    });
  }
  async onClose() {
    this.disposed = true; this.generation++; this.eventCleanup.splice(0).forEach(cleanup => cleanup()); this.stopRefresh?.(); this.stopRefresh = undefined; this.root?.unmount(); this.root = undefined;
    this.contentEl.replaceChildren();
  }
}
export default class VisorPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, leaf => new VisorView(leaf));
    this.addCommand({ id: 'open-graph', name: 'Open graph', callback: () => { void this.openView(); } });
    this.addRibbonIcon('network', 'Open Visor', () => { void this.openView(); });
  }
  private async openView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf: WorkspaceLeaf = existing ?? this.app.workspace.getLeaf('tab');
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }
}
