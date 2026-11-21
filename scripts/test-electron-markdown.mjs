import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'visor-markdown-electron-')));
const attacks = ['> '.repeat(20000) + 'x', '['.repeat(120000) + ']'.repeat(120000), '[[x|'.repeat(40000) + ']]'];
const map = '---\nlabels: [wayfinder:map]\n---\n# Map';
const roots = [];
async function fixture(name, body) { const root = path.join(temp, name); await fs.mkdir(root); await fs.writeFile(path.join(root, 'Map.md'), map); await fs.writeFile(path.join(root, 'Bad.md'), body); roots.push(root); return root; }
const bad = await Promise.all(attacks.map((body, i) => fixture(`Attack${i}`, body)));
const yaml = await fixture('AttackYaml', `---\ncontext: ${JSON.stringify('> '.repeat(20000) + 'x [[Bad]]')}\n---\n# Safe-looking body`);
const highlighting = await fixture('HighlightOutputLimit', '```js\n' + 'const value = 1;\n'.repeat(10000) + '```');
const resources = await fixture('AttackResources', '<script>window.pwned=1</script>\n\n![remote](https://evil.invalid/image.png) ![[Bad]]\n\n' + attacks[1]);
const healthy = await fixture('Healthy', '# Healthy\n\n**Nicely formatted**');
const section = '\n## Details\n\nA **formatted** specification with `code`, [[Bad#Overview|a self link]], and [reference][ref].\n\n| Item | Value |\n| --- | --- |\n| Safe | **yes** |\n\n- [ ] Disabled task\n\n```js\nconst specification = true;\n```\n\n> A useful quotation.\n';
const complexBody = '# Overview\n\n[ref]: https://example.com/spec\n' + section.repeat(Math.ceil(62 * 1024 / section.length));
const complex = await fixture('Complex', complexBody);
const aggregate = await fixture('Aggregate', attacks[1]);
for (let i = 0; i < 12; i++) await fs.writeFile(path.join(aggregate, `Bad${i}.md`), attacks[1]);
async function hashes() { const result = {}; for (const root of roots) for (const file of await fs.readdir(root)) result[path.basename(root) + '/' + file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex'); return result; }
const before = await hashes(); const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app; let page; const errors = []; const network = []; const timings = [];
try {
  app = await electron.launch({ executablePath: process.env.VISOR_EXECUTABLE || require('electron'), args: [...(process.env.VISOR_EXECUTABLE ? [] : [path.resolve('build/app')]), `--user-data-dir=${path.join(temp, 'userData')}`], cwd: os.tmpdir(), env, timeout: 30000 });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (!request.url().startsWith('app://bundle/')) network.push(request.url()); });
  // Test-side instrumentation only: count real built-in Worker lifetimes and main-loop heartbeat.
  await app.evaluate(() => {
    const threads = process.getBuiltinModule('worker_threads'); const Original = threads.Worker;
    globalThis.__workers = { active: 0, maximum: 0, started: 0, filenames: [] }; globalThis.__ticks = 0;
    threads.Worker = class extends Original {
      constructor(filename, options) { super(filename, options); const stats = globalThis.__workers; stats.active++; stats.started++; stats.maximum = Math.max(stats.maximum, stats.active); stats.filenames.push(String(filename)); this.once('exit', () => { stats.active--; }); }
    };
    globalThis.__heartbeat = setInterval(() => { globalThis.__ticks++; }, 10);
  });
  async function choose(root) {
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, root);
    return page.evaluate(() => window.visor.chooseFolder());
  }
  for (const root of [...bad, resources, yaml, highlighting]) {
    const start = performance.now(); const snapshot = await choose(root); timings.push({ folder: path.basename(root), ms: Math.round(performance.now() - start) });
    assert.ok(performance.now() - start < 3500);
    await page.locator('[data-title="Bad"]').click(); await expect(page.locator('.visor-markdown')).toContainText('Formatting unavailable');
    assert.equal(await page.locator('.visor-markdown a,.visor-markdown img,.visor-markdown script,.visor-markdown .hljs').count(), 0);
    const note = await page.evaluate(generation => window.visor.readNote('Bad.md', generation), snapshot.generation); assert.equal(note.preview.kind, 'plain');
    const unavailable = await page.evaluate(() => window.visor.getSnapshot()); assert.equal(unavailable.notes.find(n => n.id === 'Bad.md').metadata, null); assert.match(unavailable.issues.join(' '), /unavailable/);
    assert.ok(await app.evaluate(() => globalThis.__ticks) > 20); assert.equal(await page.evaluate(() => window.pwned), undefined);
  }
  // Switch while pathological parsing is actually in flight. Cancellation must settle both IPCs and reclaim capacity.
  for (let i = 0; i < 4; i++) {
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, bad[1]);
    await page.evaluate(() => { window.__oldSelection = window.visor.chooseFolder().then(() => 'settled', () => 'cancelled'); });
    await page.waitForTimeout(160);
    const ticks = await app.evaluate(() => globalThis.__ticks); const pingStart = performance.now(); await app.evaluate(() => process.versions.node); assert.ok(performance.now() - pingStart < 500);
    await page.waitForTimeout(80); assert.ok(await app.evaluate(() => globalThis.__ticks) > ticks);
    const start = performance.now(); const snapshot = await choose(healthy); timings.push({ switch: i, ms: Math.round(performance.now() - start) }); assert.ok(performance.now() - start < 1800);
    await page.evaluate(() => window.__oldSelection); await page.locator('[data-title="Bad"]').click(); await expect(page.locator('.visor-markdown h1')).toHaveText('Healthy');
    assert.equal((await page.evaluate(generation => window.visor.readNote('Bad.md', generation), snapshot.generation)).preview.kind, 'formatted');
  }
  await choose(complex); await page.locator('[data-title="Bad"]').click(); await expect(page.locator('.visor-markdown table').first()).toBeVisible(); await expect(page.locator('.visor-markdown .hljs-keyword').first()).toHaveText('const'); await expect(page.locator('.visor-markdown input').first()).toBeDisabled();
  assert.ok(await page.locator('.visor-markdown h2').count() > 200);
  // Change a safe indexed body to an attack before requesting it: stale index metadata is not a formatting certificate.
  const old = await choose(healthy); await fs.writeFile(path.join(healthy, 'Bad.md'), attacks[1]);
  const fresh = await page.evaluate(async generation => { try { return await window.visor.readNote('Bad.md', generation); } catch { return null; } }, old.generation);
  if (fresh) assert.equal(fresh.preview.kind, 'plain');
  const afterChange = await page.evaluate(() => window.visor.getSnapshot());
  const unsafe = await page.evaluate(generation => window.visor.readNote('Bad.md', generation), afterChange.generation); assert.equal(unsafe.preview.kind, 'plain');
  await page.locator('[data-title="Bad"]').click(); await expect(page.locator('.visor-markdown')).toContainText('Formatting unavailable'); assert.equal(await page.locator('.visor-markdown a,.visor-markdown .hljs').count(), 0);
  await fs.writeFile(path.join(healthy, 'Bad.md'), '# Healthy\n\n**Nicely formatted**');
  const aggregateStart = performance.now(); const limited = await choose(aggregate); assert.ok(performance.now() - aggregateStart < 10500); assert.match(limited.issues.join(' '), /budget/); assert.equal(limited.notes.filter(n => n.id !== 'Map.md').every(n => n.metadata === null), true);
  await choose(healthy); await expect.poll(() => app.evaluate(() => globalThis.__workers.active)).toBe(1);
  const workers = await app.evaluate(() => globalThis.__workers); assert.equal(workers.maximum, 1); assert.ok(workers.started >= 10); assert.equal(workers.filenames.every(filename => filename.endsWith('/markdown-worker.cjs')), true);
  if (process.env.VISOR_EXECUTABLE) assert.equal(workers.filenames.every(filename => filename.includes('/app.asar/')), true);
  assert.deepEqual(await hashes(), before); assert.deepEqual(network, []); assert.deepEqual(errors, []);
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, bad[1]);
  await page.evaluate(() => { void window.visor.chooseFolder().catch(() => {}); }); await page.waitForTimeout(160);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await expect.poll(() => app.evaluate(() => globalThis.__workers.active)).toBe(0);
  const reopening = app.waitForEvent('window'); await app.evaluate(({ app }) => { app.emit('activate'); }); page = await reopening;
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (!request.url().startsWith('app://bundle/')) network.push(request.url()); });
  await expect(page.getByRole('heading', { name: 'A clear view of your Wayfinder map.' })).toBeVisible();
  await choose(healthy); await expect.poll(() => app.evaluate(() => globalThis.__workers.active)).toBe(1); assert.equal(await app.evaluate(() => globalThis.__workers.maximum), 1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await expect.poll(() => app.evaluate(() => globalThis.__workers.active)).toBe(0);
  const finalWorkers = await app.evaluate(() => globalThis.__workers); assert.deepEqual(await hashes(), before); assert.deepEqual(network, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', mode: process.env.VISOR_EXECUTABLE ? 'packaged ASAR' : 'static app', timings, workers: { ...finalWorkers, filenames: [...new Set(finalWorkers.filenames)] }, complexCharacters: complexBody.length, mainHeartbeat: true, exactAttacks: attacks.map(body => body.length), freshBodyRevalidated: true, aggregateBudget: true, sourceFilesUnchanged: true, parserFreePlainPreview: true, noNetwork: true }, null, 2));
} finally { if (app) await app.close(); await fs.rm(temp, { recursive: true, force: true }); }
