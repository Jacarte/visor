import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'visor-electron-')));
const fixture = path.join(temp, 'Project'); const second = path.join(temp, 'Second');
await fs.mkdir(fixture); await fs.mkdir(second);
const map = '---\nlabels: ["wayfinder:map"]\ntitle: Live fixture\n---\n# Overview\n\n[[Task]]';
const task = '---\nlabels: ["wayfinder:task"]\nparent: "[[Map]]"\nstatus: open\nassignee: null\nblocked-by: []\n---\n# Overview\n\n| Link | Result |\n| --- | --- |\n| [[Spec#Details|Specification]] | **ready** |\n\n- [ ] Task box\n\n```js\nconst secure = true;\n```\n\n```unknown-lang\n<escaped>\n```\n\n> [!NOTE] Read only\n\n[External](https://example.com/reference)\n\n![remote](https://evil.invalid/image.png) ![ref][image] ![[Spec]] ![[https://evil.invalid/video]]\n\n[image]: https://evil.invalid/reference.png\n\n<script>window.pwned = 1</script>\n\n<img src="https://evil.invalid/html.png" onerror="window.pwned=1">\n\n[bad](javascript:alert%281%29) [file](file:///etc/passwd) [[Absent]] [[Spec#broken|Stable broken]] [[Spec#^missing]] [[Spec|[bad](https://evil.invalid/alias)]]';
const specification = '# Details\n\nSpecification body\n\nA block ^actual\n\n# [broken](Missing)\n\n# ![omitted](https://evil.invalid/heading.png)\n\n# Duplicate\n\n# Duplicate\n\n# `code` [[Task|Label]]';
await fs.writeFile(path.join(fixture, 'Map.md'), map); await fs.writeFile(path.join(fixture, 'Task.md'), task); await fs.writeFile(path.join(fixture, 'Spec.md'), specification);
await fs.mkdir(path.join(fixture, 'Nested/Nested'), { recursive: true });
await fs.writeFile(path.join(fixture, 'Nested/Map.md'), map.replace('Live fixture', 'Nested map'));
await fs.writeFile(path.join(fixture, 'Nested/Task.md'), '---\nlabels: [wayfinder:task]\nparent: "[[Map]]"\ntitle: Canonical task\n---\n# Canonical\n\n[[Elsewhere]]');
await fs.writeFile(path.join(fixture, 'Nested/Elsewhere.md'), '# Elsewhere');
await fs.writeFile(path.join(fixture, 'Nested/Nested/Task.md'), '---\ntitle: Shadow task\n---\n# Wrong target');
await fs.writeFile(path.join(fixture, '.hidden'), 'DO NOT CHANGE'); await fs.mkdir(path.join(fixture, '.obsidian')); await fs.writeFile(path.join(fixture, '.obsidian', 'config.json'), '{"keep":true}');
await fs.writeFile(path.join(second, 'Map.md'), map.replace('Live fixture', 'Second fixture'));
async function hashes(root) {
  const result = {};
  async function walk(dir) { for (const item of await fs.readdir(dir, { withFileTypes: true })) { const full = path.join(dir, item.name); const relative = path.relative(root, full); if (item.isDirectory()) { result[relative + '/'] = 'directory'; await walk(full); } else result[relative] = createHash('sha256').update(await fs.readFile(full)).digest('hex'); } }
  await walk(root); return result;
}
const before = await hashes(fixture); const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app; let page; const errors = []; const network = [];
try {
  const executablePath = process.env.VISOR_EXECUTABLE || require('electron');
  app = await electron.launch({ executablePath, args: [...(process.env.VISOR_EXECUTABLE ? [] : [path.resolve('build/app')]), `--user-data-dir=${path.join(temp, 'userData')}`], cwd: os.tmpdir(), env, timeout: 30000 });
  app.process().stderr.on('data', data => { const text = data.toString(); if (/Error|Unable to load preload/.test(text)) console.error(text.trim()); });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (!request.url().startsWith('app://bundle/')) network.push(request.url()); });
  await expect(page.getByRole('heading', { name: 'A clear view of your Wayfinder map.' })).toBeVisible();
  const runtime = await app.evaluate(({ BrowserWindow, app }) => ({ versions: process.versions, arch: process.arch, packaged: app.isPackaged, preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences() }));
  assert.equal(runtime.versions.electron, '45.4.1'); assert.equal(runtime.arch, 'x64');
  for (const key of ['contextIsolation', 'sandbox', 'webSecurity']) assert.equal(runtime.preferences[key], true);
  for (const key of ['nodeIntegration', 'webviewTag']) assert.equal(runtime.preferences[key], false);
  const isolated = await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, ipc: typeof window.ipcRenderer, fs: typeof window.fs, bridge: Object.keys(window.visor).sort() }));
  assert.deepEqual(isolated, { require: 'undefined', process: 'undefined', ipc: 'undefined', fs: 'undefined', bridge: ['chooseFolder', 'getSnapshot', 'onUpdate', 'openExternal', 'readNote'] });
  // Test-only automation stubs Electron's native dialog in main; production has no fixture/test IPC route.
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await page.getByRole('button', { name: 'Open Folder…', exact: false }).first().click();
  await expect(page.getByRole('heading', { name: 'A clear view of your Wayfinder map.' })).toBeVisible();
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, fixture);
  await page.getByRole('button', { name: 'Open Folder…', exact: false }).first().click();
  await expect(page.locator('[data-title="Task"]')).toHaveAttribute('data-readiness', 'frontier');
  await page.locator('[data-title="Task"] strong').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.visor-markdown table')).toBeVisible(); await expect(page.locator('.visor-markdown input[type=checkbox]')).toBeDisabled();
  await expect(page.locator('.visor-markdown .hljs-keyword')).toContainText('const'); await expect(page.locator('.visor-markdown')).toContainText('<escaped>');
  assert.equal(await page.locator('.visor-markdown img,.visor-markdown iframe,.visor-markdown script,.visor-markdown textarea,.visor-markdown [contenteditable]').count(), 0);
  assert.equal(await page.evaluate(() => window.pwned), undefined); assert.deepEqual(network, []);
  const snapshot = await page.evaluate(() => window.visor.getSnapshot());
  for (const id of ['../outside.md', '/etc/passwd', 'Absent.md', '%2e%2e/Map.md', 'x'.repeat(5000)]) {
    const denied = await page.evaluate(async ({ id, generation }) => { try { await window.visor.readNote(id, generation); return false; } catch { return true; } }, { id, generation: snapshot.generation }); assert.equal(denied, true);
  }
  await app.evaluate(({ shell }) => { globalThis.__visorOpened = []; shell.openExternal = async url => { globalThis.__visorOpened.push(url); }; });
  assert.deepEqual(await app.evaluate(() => globalThis.__visorOpened), []);
  await page.getByRole('link', { name: 'External ↗' }).hover(); assert.deepEqual(await app.evaluate(() => globalThis.__visorOpened), []);
  await page.getByRole('link', { name: 'External ↗' }).click(); assert.deepEqual(await app.evaluate(() => globalThis.__visorOpened), ['https://example.com/reference']);
  for (const url of ['file:///tmp/x', 'javascript:alert(1)', 'data:text/html,x', 'app://bundle/index.html']) assert.equal(await page.evaluate(async url => { try { await window.visor.openExternal(url); return false; } catch { return true; } }, url), true);
  await page.getByRole('link', { name: 'Specification', exact: true }).click(); await expect(page.locator('.visor-note-path')).toContainText('Spec.md'); await expect(page.locator('.visor-markdown h1').first()).toHaveAttribute('id', 'heading-details');
  assert.deepEqual(await hashes(fixture), before);
  // Remain on the followed note throughout watching and refresh; never briefly jump back to Task.
  await page.evaluate(() => { window.__visorPreviewPaths = []; window.__visorPathObserver = new MutationObserver(() => { const path = document.querySelector('.visor-note-path')?.textContent; if (path) window.__visorPreviewPaths.push(path); }); window.__visorPathObserver.observe(document.querySelector('.visor-preview-body'), { childList: true, subtree: true, characterData: true }); });
  await fs.writeFile(path.join(fixture, 'PreviewArrival.md'), '# Unrelated arrival'); await expect(page.locator('[data-title="PreviewArrival"]')).toHaveCount(1);
  await expect(page.locator('.visor-note-path')).toContainText('Spec.md');
  await fs.writeFile(path.join(fixture, 'Spec.md'), specification.replace('Specification body', 'Specification changed while navigated'));
  await expect(page.locator('.visor-markdown')).toContainText('Specification changed while navigated');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.locator('.visor-markdown')).toContainText('Specification changed while navigated');
  assert.equal((await page.evaluate(() => window.__visorPreviewPaths)).some(value => value.includes('Task.md')), false);
  await fs.unlink(path.join(fixture, 'Spec.md')); await expect(page.locator('.visor-preview [role="alert"]')).toContainText('Unknown note'); await expect(page.locator('.visor-note-path')).toContainText('Spec.md');
  await fs.writeFile(path.join(fixture, 'Spec.md'), specification); await expect(page.locator('.visor-markdown h1').first()).toHaveText('Details');
  await fs.unlink(path.join(fixture, 'PreviewArrival.md')); await expect(page.locator('[data-title="PreviewArrival"]')).toHaveCount(0);
  await page.evaluate(() => window.__visorPathObserver.disconnect());
  // IDs come from the original exact body, not the sanitizer's replacement display text.
  const renderedIds = await page.locator('.visor-markdown h1').evaluateAll(headings => headings.map(h => h.id));
  const anchorSnapshot = await page.evaluate(() => window.visor.getSnapshot());
  assert.deepEqual(renderedIds, anchorSnapshot.notes.find(note => note.id === 'Spec.md').headings.map(heading => heading.anchor));
  assert.deepEqual(renderedIds, ['heading-details', 'heading-broken', 'heading-section', 'heading-duplicate', 'heading-duplicate-1', 'heading-code-label']);
  await page.evaluate(() => { window.__visorScrollTargets = []; const original = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (...args) { window.__visorScrollTargets.push(this.id); return original.apply(this, args); }; });
  await page.locator('[data-title="Task"] strong').click({ position: { x: 5, y: 5 } }); await page.getByRole('link', { name: 'Stable broken', exact: true }).click();
  await expect(page.locator('.visor-note-path')).toContainText('heading-broken'); await expect.poll(() => page.evaluate(() => window.__visorScrollTargets.at(-1))).toBe('heading-broken');
  assert.equal(await page.locator('#heading-broken').count(), 1);
  // Canonical graph IDs must not be resolved a second time relative to Nested/Map.md.
  await page.getByLabel('Map', { exact: true }).selectOption('Nested/Map.md'); await page.locator('[data-title="Canonical task"] strong').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.visor-markdown h1')).toHaveText('Canonical'); await expect(page.locator('.visor-note-path')).toHaveText('Nested/Task.md');
  await expect(page.locator('.visor-markdown')).not.toContainText('referenced heading/block is unavailable');
  await page.getByRole('link', { name: 'Elsewhere', exact: true }).click(); await expect(page.locator('.visor-note-path')).toHaveText('Nested/Elsewhere.md');
  await page.locator('[data-title="Canonical task"] strong').click({ position: { x: 5, y: 5 } }); await expect(page.locator('.visor-markdown h1')).toHaveText('Canonical');
  await page.getByRole('link', { name: 'Elsewhere', exact: true }).click(); await page.getByRole('button', { name: 'Open note ↗', exact: true }).click(); await expect(page.locator('.visor-markdown h1')).toHaveText('Canonical');
  await page.getByLabel('Map', { exact: true }).selectOption('Map.md'); await page.locator('[data-title="Task"] strong').click({ position: { x: 5, y: 5 } }); await expect(page.locator('.visor-markdown table')).toBeVisible();
  assert.deepEqual(await hashes(fixture), before);
  await page.getByRole('button', { name: 'Zoom In', exact: true }).click(); await page.waitForTimeout(400);
  const viewport = page.locator('.react-flow__viewport'); const camera = await viewport.getAttribute('style');
  await fs.writeFile(path.join(fixture, 'Arrival.md'), '# Arrival'); await expect(page.locator('[data-title="Arrival"]')).toHaveCount(1); await expect(viewport).toHaveAttribute('style', camera);
  await expect(page.locator('.react-flow__node.selected [data-title="Task"]')).toHaveCount(1);
  await fs.writeFile(path.join(fixture, '.atomic-save'), task.replace('# Overview', '# Changed live preview')); await fs.rename(path.join(fixture, '.atomic-save'), path.join(fixture, 'Task.md'));
  await expect(page.locator('.visor-markdown h1')).toHaveText('Changed live preview'); await expect(viewport).toHaveAttribute('style', camera);
  await fs.rename(path.join(fixture, 'Arrival.md'), path.join(fixture, 'Renamed.md')); await expect(page.locator('[data-title="Arrival"]')).toHaveCount(0); await expect(page.locator('[data-title="Renamed"]')).toHaveCount(1);
  await fs.unlink(path.join(fixture, 'Renamed.md')); await expect(page.locator('[data-title="Renamed"]')).toHaveCount(0); await expect(viewport).toHaveAttribute('style', camera);
  const expectedAfterControlledWrites = await hashes(fixture);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.locator('.visor-markdown h1')).toHaveText('Changed live preview');
  // Live second-window IPC uses the same trusted URL and preload, but must still be denied.
  const spoof = await app.evaluate(async ({ BrowserWindow }, preload) => {
    const extra = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false } });
    try { await extra.loadURL('app://bundle/index.html'); return await extra.webContents.executeJavaScript('typeof window.visor === "undefined" ? "missing bridge" : window.visor.getSnapshot().then(() => false, () => true)'); } finally { extra.destroy(); }
  }, process.env.VISOR_EXECUTABLE ? path.resolve(process.env.VISOR_EXECUTABLE, '../../Resources/app.asar/preload.cjs') : path.resolve('build/app/preload.cjs')); assert.equal(spoof, true);
  // Actual IPC rejects an about:blank subframe, even with the expected sender webContents.
  await page.evaluate(() => { const frame = document.createElement('iframe'); document.body.append(frame); });
  const subframeDenied = await app.evaluate(async ({ BrowserWindow, ipcMain }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents; const frame = contents.mainFrame.frames[0]; if (!frame) throw new Error('Missing test subframe');
    try { await ipcMain._invokeHandlers.get('visor:getSnapshot')({ sender: contents, senderFrame: frame }); return false; } catch { return true; }
  }); assert.equal(subframeDenied, true); await page.evaluate(() => document.querySelector('iframe')?.remove());
  const beforePopup = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await page.evaluate(() => window.open('https://evil.invalid/popup')); await page.waitForTimeout(150); assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), beforePopup);
  const urlBefore = page.url(); await page.evaluate(() => { location.href = 'https://evil.invalid/navigation'; }); await page.waitForTimeout(150); assert.equal(page.url(), urlBefore);
  assert.deepEqual(network, []);
  const documentResponse = await page.reload(); const csp = documentResponse.headers()['content-security-policy'];
  assert.ok(csp?.includes("script-src 'self'")); assert.ok(csp.includes("connect-src 'none'")); assert.ok(csp.includes("style-src-attr 'unsafe-inline'"));
  const fetchBlocked = await page.evaluate(() => fetch('http://127.0.0.1:9/csp-probe').then(() => false, () => true)); assert.equal(fetchBlocked, true);
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, second);
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); }); await page.bringToFront();
  await app.evaluate(({ BrowserWindow }) => { const contents = BrowserWindow.getAllWindows()[0].webContents; contents.sendInputEvent({ type: 'keyDown', keyCode: 'O', modifiers: ['meta'] }); contents.sendInputEvent({ type: 'keyUp', keyCode: 'O', modifiers: ['meta'] }); });
  await expect(page.locator('[data-title="Second fixture"]')).toHaveCount(1);
  assert.equal(await page.evaluate(async generation => { try { await window.visor.readNote('Task.md', generation); return false; } catch { return true; } }, snapshot.generation), true);
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, fixture);
  for (const entry of await fs.readdir(fixture)) if ((await fs.stat(path.join(fixture, entry))).isFile()) await fs.chmod(path.join(fixture, entry), 0o444);
  await fs.chmod(fixture, 0o555);
  await page.getByRole('button', { name: 'Open Folder…', exact: true }).click(); await page.locator('[data-title="Task"] strong').click({ position: { x: 5, y: 5 } }); await expect(page.locator('.visor-markdown h1')).toHaveText('Changed live preview');
  assert.deepEqual(await hashes(fixture), expectedAfterControlledWrites);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', mode: process.env.VISOR_EXECUTABLE ? 'packaged .app' : 'local static app', electron: runtime.versions.electron, node: runtime.versions.node, chrome: runtime.versions.chrome, arch: runtime.arch, packaged: runtime.packaged, assertions: 'native cancel/select/reselect/Cmd+O; real bridge/isolation/CSP; actual spoof window/subframe; readonly fixture hashes + nonwritable tree; no media network; one external user click; live create/atomic-save/rename/delete + stable camera/selection; navigated Spec preserved through refresh/watch/deletion; authoritative heading IDs and actual scroll; canonical nested node/Open note recovery', sourceFilesUnchanged: true, errors }, null, 2));
} catch (error) {
  if (page) console.error('Renderer diagnostic:', await page.locator('body').innerText().catch(() => '(unavailable)'));
  throw error;
} finally {
  if (app) await app.close(); await fs.chmod(fixture, 0o755).catch(() => {}); await fs.rm(temp, { recursive: true, force: true });
}
