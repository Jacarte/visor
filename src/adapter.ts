import { App, Component, MarkdownRenderer, TFile } from 'obsidian';
import { allowedLinkpath, allowedPath, resolveDestination, type NoteMetadata, type NoteSource, type Destination } from './model';
import type { PreviewServices } from './preview';
import { previewMarkdown } from './preview-markdown';
/** No note bodies are needed for graph discovery. Forbidden paths are rejected before cache access. */
export function vaultSource(app: App): NoteSource {
  const files = new Map(app.vault.getMarkdownFiles().filter(f => allowedPath(f.path)).map(f => [f.path, f]));
  return {
    paths: () => [...files.keys()],
    metadata(path): NoteMetadata | null {
      if (!allowedPath(path)) return null;
      const file = files.get(path); if (!file) return null;
      const cache = app.metadataCache.getFileCache(file); if (!cache) return null;
      return { frontmatter: cache.frontmatter,
        links: [...(cache.links ?? []), ...(cache.embeds ?? []), ...(cache.frontmatterLinks ?? [])] };
    },
    resolve(linkpath, sourcePath) {
      if (!allowedLinkpath(linkpath, sourcePath) || !allowedPath(sourcePath)) return null;
      const dest = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
      return dest && allowedPath(dest.path) ? dest.path : null;
    }
  };
}
/** Obsidian rendering cannot be cancelled; late children/cleanup registrations must not outlive a generation. */
class PreviewComponent extends Component {
  private disposed = false;
  dispose() { this.disposed = true; this.unload(); }
  addChild<T extends Component>(child: T): T {
    if (this.disposed) { child.unload(); return child; }
    return super.addChild(child);
  }
  register(cleanup: () => unknown) { if (this.disposed) cleanup(); else super.register(cleanup); }
}
function openDestination(app: App, dest: Destination, newLeaf: boolean) {
  const resolved = resolveDestination(vaultSource(app), dest.linktext, dest.sourcePath);
  if (resolved && allowedPath(dest.path)) void app.workspace.openLinkText(dest.linktext, dest.sourcePath, newLeaf);
}
export function obsidianPreview(app: App): PreviewServices {
  return {
    open: (dest, newLeaf) => openDestination(app, dest, newLeaf),
    render(destination, host) {
      let active = true; const component = new PreviewComponent(); component.load();
      const click = (event: MouseEvent) => {
        const target = event.target instanceof host.ownerDocument.defaultView!.Element ? event.target.closest('a.internal-link') : null;
        if (!target) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const text = target.getAttribute('data-href') ?? target.getAttribute('href');
        if (!text) return;
        const dest = resolveDestination(vaultSource(app), text, destination.path);
        if (dest) openDestination(app, dest, event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1);
      };
      host.addEventListener('click', click, true); host.addEventListener('auxclick', click, true);
      const dispose = () => { active = false; host.removeEventListener('click', click, true); host.removeEventListener('auxclick', click, true); component.dispose(); };
      const ready = (async () => {
        if (!allowedPath(destination.path)) throw new Error('This path is excluded from Visor.');
        const file = app.vault.getAbstractFileByPath(destination.path);
        if (!(file instanceof TFile)) throw new Error('Note is no longer available.');
        const markdown = await app.vault.cachedRead(file);
        if (!active) return;
        const source = vaultSource(app);
        const safe = previewMarkdown(markdown, linktext => {
          if (/^(https?:|mailto:)/i.test(linktext)) return true;
          if (/^[a-z][a-z\d+.-]*:/i.test(linktext)) return false;
          let decoded: string; try { decoded = decodeURIComponent(linktext); } catch { return false; }
          if (!allowedLinkpath(decoded.split('#')[0], destination.path)) return false;
          // Inactivate unresolved/ambiguous destinations too, before the host renderer can inspect them.
          return resolveDestination(source, decoded, destination.path) !== null;
        });
        if (safe.omitted) { const notice = host.ownerDocument.createElement('p'); notice.className = 'visor-preview-notice'; notice.textContent = 'Preview only: embeds/media omitted; HTML and excluded/unresolved links shown as text.'; host.append(notice); }
        try { await MarkdownRenderer.render(app, safe.markdown, host, destination.path, component); }
        finally { if (!active) component.dispose(); }
      })();
      return { ready, dispose };
    }
  };
}
