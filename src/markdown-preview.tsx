import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { FolderSnapshot, NoteBody, PreparedPreview, VisorBridge } from './contracts';
import type { Destination } from './model';
import type { PreviewServices } from './preview';
import { canonicalDestination } from './links';
type Target = { id: string; anchor?: string };
/** Render-only: fallback never enters a Markdown parser, sanitizer or highlighter. */
export function SafeMarkdown({ body, preview, onNavigate, onExternal }: { body: string; preview: PreparedPreview; onNavigate: (target: Target) => void; onExternal: (url: string) => void }) {
  if (preview.kind === 'plain') return <><p className="visor-preview-notice">Formatting unavailable: {preview.reason}. Plain text only (first 256 Ki characters).</p><pre>{body.slice(0, 256 * 1024)}</pre></>;
  return <>
    <p className="visor-preview-notice">Read-only preview. Images, transclusions and HTML are omitted or inert. Missing, ambiguous, outside-folder and unavailable heading/block links stay text. Links resolve source-relative, exact, then unique basename; not full Obsidian parity.</p>
    {toJsxRuntime(preview.tree, { Fragment, jsx, jsxs, components: {
      a: ({ href, children }) => {
        const target = preview.links[href ?? ''];
        if (!target) return <span>{children}</span>;
        return <a href={href} onClick={event => { event.preventDefault(); event.stopPropagation(); if (target.kind === 'note') onNavigate(target); else onExternal(target.url); }} onAuxClick={event => event.preventDefault()}>{children}{target.kind === 'external' ? ' ↗' : ''}</a>;
      },
      input: ({ checked }) => <input type="checkbox" disabled readOnly checked={!!checked} />
    } })}
  </>;
}
function NotePreview({ destination, initialTarget, snapshot, bridge, register, remember }: { destination: Destination; initialTarget?: Target; snapshot: FolderSnapshot; bridge: VisorBridge; register: (navigate: (dest: Destination) => void) => void; remember: (target: Target) => void }) {
  const initial = canonicalDestination(snapshot.notes, destination);
  const [target, setTarget] = useState<Target>(initialTarget ?? initial ?? { id: destination.path });
  const [notice, setNotice] = useState(initial || initialTarget ? '' : 'The referenced heading/block is unavailable. This graph artifact is shown as a whole note; no anchor was guessed.');
  const [note, setNote] = useState<NoteBody | null>(null); const [error, setError] = useState(''); const host = useRef<HTMLDivElement>(null);
  const currentNote = note?.id === target.id && note.generation === snapshot.generation && note.revision === snapshot.revision ? note : null;
  const navigate = (next: Target) => { remember(next); setNotice(''); setTarget(next); };
  useEffect(() => { register(dest => {
    const resolved = canonicalDestination(snapshot.notes, dest);
    if (resolved) navigate(resolved); else setNotice('Link unavailable. No navigation or file creation occurred.');
  }); }, [register, snapshot]);
  useEffect(() => {
    let active = true; setNote(null); setError('');
    void bridge.readNote(target.id, snapshot.generation).then(next => {
      if (active && next.generation === snapshot.generation && next.revision === snapshot.revision && next.id === target.id) setNote(next);
      else if (active) setError('Note changed. Use Refresh to reconcile.');
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [target.id, snapshot, bridge]);
  useEffect(() => {
    if (!currentNote || !target.anchor) return;
    const element = [...host.current?.querySelectorAll('[id]') ?? []].find(el => el.id === target.anchor);
    if (currentNote.preview.kind === 'formatted' && currentNote.preview.anchors.includes(target.anchor) && element) { setNotice(''); element.scrollIntoView({ block: 'start' }); }
    else setNotice('The referenced heading/block is unavailable in this content version. No scroll target was guessed.');
  }, [currentNote, target.anchor]);
  return <div ref={host}><p className="visor-note-path">{target.id}{target.anchor ? ` · ${target.anchor}` : ''}</p>
    {notice && <p className="visor-preview-notice">{notice}</p>}{error && <p role="alert">{error}</p>}{currentNote === null && !error && <p>Reading note…</p>}
    {currentNote !== null && <SafeMarkdown body={currentNote.body} preview={currentNote.preview} onNavigate={navigate} onExternal={url => { void bridge.openExternal(url).catch(reason => setError(String(reason))); }} />}
  </div>;
}
export function folderPreview(initialSnapshot: FolderSnapshot, bridge: VisorBridge): PreviewServices & { updateSnapshot(snapshot: FolderSnapshot): void } {
  let snapshot = initialSnapshot; let selection = ''; let selectedId: string | undefined; let target: Target | undefined;
  let navigate: ((dest: Destination) => void) | undefined;
  const register = (next: (dest: Destination) => void) => { navigate = next; };
  return {
    updateSnapshot(next) { snapshot = next; },
    selectionChanged(id) { if (selectedId !== id) { selectedId = id; selection = ''; target = undefined; } },
    open(destination) { navigate?.(destination); },
    render(destination, host) {
      const key = JSON.stringify([destination.path, destination.linktext, destination.sourcePath]);
      if (selection !== key) { selection = key; target = undefined; }
      const root = createRoot(host); let disposed = false;
      root.render(<NotePreview destination={destination} initialTarget={target} snapshot={snapshot} bridge={bridge} register={register} remember={next => { target = next; }} />);
      return { ready: Promise.resolve(), dispose() { if (disposed) return; disposed = true; navigate = undefined; root.unmount(); } };
    }
  };
}
