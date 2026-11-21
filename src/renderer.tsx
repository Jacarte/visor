import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphApp } from './GraphApp';
import { EMPTY_SNAPSHOT, newerSnapshot, type FolderSnapshot } from './contracts';
import { snapshotSource } from './links';
import { folderPreview } from './markdown-preview';
import './styles.css';
function App() {
  const [snapshot, setSnapshot] = useState<FolderSnapshot>(EMPTY_SNAPSHOT); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const reconcile = (next: FolderSnapshot) => { if (active) setSnapshot(current => newerSnapshot(current, next)); };
    const unsubscribe = window.visor.onUpdate(reconcile);
    void window.visor.getSnapshot().then(reconcile).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const source = useMemo(() => snapshotSource(snapshot), [snapshot]); const preview = useMemo(() => folderPreview(snapshot, window.visor), [snapshot.generation]);
  preview.updateSnapshot(snapshot);
  const run = async (action: () => Promise<FolderSnapshot>) => {
    setBusy(true); setError('');
    try { const next = await action(); setSnapshot(current => newerSnapshot(current, next)); }
    catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  return <div className="visor-window">
    <div className="visor-folderbar"><div><span className="visor-wordmark">Visor</span><span className="visor-foldername">{snapshot.folder ?? 'Your projects, in perspective.'}</span></div>
      <div><button disabled={busy && !snapshot.folder} onClick={() => void run(() => window.visor.chooseFolder())}>Open Folder…</button><button disabled={busy || !snapshot.folder} onClick={() => void run(() => window.visor.getSnapshot())}>Refresh</button></div></div>
    {error && <p className="visor-banner" role="alert">{error}</p>}
    {snapshot.issues.length > 0 && <details className="visor-index-issues"><summary>{snapshot.issues.length} indexing notice(s) · incomplete metadata stays unknown</summary><ul>{snapshot.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></details>}
    {!snapshot.folder ? <main className="visor-welcome"><div className="visor-welcome-mark">V</div><h1>A clear view of your Wayfinder map.</h1><p>Open a project folder to explore decisions, dependencies and all its Markdown artifacts.</p><button disabled={busy} onClick={() => void run(() => window.visor.chooseFolder())}>Open Folder… <kbd>⌘O</kbd></button><p className="visor-welcome-policy">Local · read only · no editor or source-folder settings.<br />Images and transclusions are not loaded. Private folders and symlinks are excluded.</p></main> : <GraphApp key={snapshot.generation} source={source} preview={preview} revision={snapshot.revision} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
