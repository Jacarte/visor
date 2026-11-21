import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listPackage, extractFile, statFile } from '@electron/asar';
const exec = promisify(execFile);
const bundle = path.resolve('release/Visor-darwin-x64/Visor.app'); const archive = path.join(bundle, 'Contents/Resources/app.asar');
const expected = [];
async function files(dir, prefix = '') { for (const item of await fs.readdir(dir, { withFileTypes: true })) { const id = prefix + item.name; if (item.isDirectory()) await files(path.join(dir, item.name), id + '/'); else { assert.ok(item.isFile()); expected.push('/' + id); } } }
await files('build/app');
const actual = listPackage(archive, { isPack: false }).filter(id => !('files' in statFile(archive, id.slice(1))));
assert.deepEqual(actual.sort(), expected.sort());
for (const id of actual) {
  const packaged = extractFile(archive, id.slice(1));
  const staged = await fs.readFile(path.join('build/app', id.slice(1)));
  if (id === '/package.json') {
    // Packager removes this development-only flag; runtime metadata must still match exactly.
    const metadata = JSON.parse(staged.toString()); delete metadata.private;
    assert.deepEqual(JSON.parse(packaged.toString()), metadata);
  } else assert.deepEqual(packaged, staged);
}
assert.deepEqual(actual.filter(id => !id.startsWith('/licenses/')).sort(), ['/THIRD_PARTY_NOTICES.md', '/index.html', '/main.cjs', '/markdown-worker.cjs', '/package.json', '/preload.cjs', '/renderer.js', '/styles.css']);
assert.equal(JSON.parse(extractFile(archive, 'package.json').toString()).version, '0.2.0');
for (const id of ['licenses/hast-util-to-jsx-runtime/license', 'licenses/remark-rehype/license', 'licenses/@lxcid__remark-wikilink/LICENSE', 'licenses/@lxcid__remark-wikilink/THIRD_PARTY_NOTICES.md', 'licenses/electron/LICENSE', 'licenses/electron/LICENSES.chromium.html']) assert.ok(extractFile(archive, id).length > 500);
assert.match(extractFile(archive, 'preload.cjs').toString(), /require\("electron"\)/); assert.doesNotMatch(extractFile(archive, 'preload.cjs').toString(), /\b(?:Buffer|setImmediate|node:fs)\b/);
const version = await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(bundle, 'Contents/Info.plist')]); assert.equal(version.stdout.trim(), '0.2.0');
const binary = await exec('/usr/bin/file', [path.join(bundle, 'Contents/MacOS/Visor')]); assert.match(binary.stdout, /Mach-O 64-bit executable x86_64/);
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'visor-launchservices-'))); let pid;
try {
  await exec('/usr/bin/open', ['-n', bundle, '--args', `--user-data-dir=${temp}`], { cwd: os.tmpdir() });
  for (let i = 0; i < 50 && !pid; i++) { await new Promise(resolve => setTimeout(resolve, 100)); const processes = (await exec('/bin/ps', ['-axo', 'pid=,command='])).stdout; const line = processes.split('\n').find(line => line.includes(path.join(bundle, 'Contents/MacOS/Visor')) && line.includes(`--user-data-dir=${temp}`)); if (line) pid = Number(line.trim().match(/^\d+/)[0]); }
  assert.ok(pid, 'LaunchServices must launch the generated .app'); await new Promise(resolve => setTimeout(resolve, 1000)); process.kill(pid, 0);
  console.log(JSON.stringify({ result: 'passed', bundle, version: version.stdout.trim(), binary: 'Mach-O x86_64', archiveFiles: actual.length, stagingExactMatch: true, privateFilesPackaged: false, requiredNoticesInsideApp: true, launchServicesFromUnrelatedCwd: true, pid }, null, 2));
} finally {
  if (pid) { process.kill(pid, 'SIGTERM'); await new Promise(resolve => setTimeout(resolve, 1000)); }
  await fs.rm(temp, { recursive: true, force: true });
}
