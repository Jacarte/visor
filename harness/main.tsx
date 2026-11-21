import { createRoot } from 'react-dom/client';
import { GraphApp } from '../src/GraphApp';
import { edgeOverlapSource, fixtureSource } from './fixtures';
import { previewMarkdown } from '../src/preview-markdown';
import type { PreviewServices } from '../src/preview';
import '../src/styles.css';
const params = new URLSearchParams(location.search);
let revision = 0; const source = params.has('edge-overlap') ? edgeOverlapSource() : fixtureSource(params.has('project')); const root = createRoot(document.getElementById('root')!);
const preview: PreviewServices = {
  open(dest, newLeaf) { document.getElementById('navigation')!.textContent = `Opened ${dest.linktext} from ${dest.sourcePath}${newLeaf ? ' in new leaf' : ''}`; },
  render(dest, host) {
    let active = true;
    const ready = new Promise<void>(resolve => setTimeout(() => {
      if (active) {
        const h = document.createElement('h2'); h.textContent = dest.path;
        const p = document.createElement('p'); p.textContent = 'Fixture adapter preview. The graph above is the real shipped GraphApp. The standalone Electron preview is tested separately.';
        const task = document.createElement('input'); task.type = 'checkbox'; task.setAttribute('aria-label', 'Preview task');
        const edit = document.createElement('div'); edit.contentEditable = 'true'; edit.textContent = 'Read-only content'; edit.dataset.testid = 'editable-fixture';
        const a = document.createElement('a'); a.href = 'https://example.com'; a.textContent = 'External reference';
        const context = document.createElement('a'); context.href = '#Overview'; context.textContent = 'Heading link'; context.addEventListener('click', e => { e.preventDefault(); preview.open({ path: 'Example/Context.md', linktext: 'Context#Overview', sourcePath: dest.path }, e.metaKey || e.ctrlKey); });
        const omitted = document.createElement('p'); omitted.textContent = previewMarkdown('![[chats/Forbidden#Heading|alias]] ![image](https://example.com/x.png)').markdown;
        host.append(h, p, task, edit, document.createElement('br'), a, document.createElement('br'), context, omitted);
      }
      resolve();
    }, dest.path.includes('Research') ? 100 : 10));
    return { ready, dispose() { active = false; } };
  }
};
function render() { root.render(<GraphApp source={source} preview={preview} revision={revision} />); }
document.getElementById('refresh')!.addEventListener('click', () => { revision++; render(); });
document.getElementById('arrive')!.addEventListener('click', () => { source.arrive(); revision++; render(); });
document.getElementById('unmount')!.addEventListener('click', () => root.unmount());
render();
