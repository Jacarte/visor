import esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
await fs.rm('build/app', { recursive: true, force: true });
await fs.mkdir('build/app/licenses', { recursive: true });
await esbuild.build({ entryPoints: ['src/electron-main.ts'], outfile: 'build/app/main.cjs', bundle: true, format: 'cjs', platform: 'node', target: 'node24', external: ['electron'], logLevel: 'info' });
await esbuild.build({ entryPoints: ['src/markdown-worker.ts'], outfile: 'build/app/markdown-worker.cjs', bundle: true, format: 'cjs', platform: 'node', target: 'node24', logLevel: 'info' });
await esbuild.build({ entryPoints: ['src/preload.cts'], outfile: 'build/app/preload.cjs', bundle: true, format: 'cjs', platform: 'node', target: 'es2022', external: ['electron'], logLevel: 'info' });
await esbuild.build({ entryPoints: ['src/renderer.tsx'], outfile: 'build/app/renderer.js', bundle: true, format: 'esm', platform: 'browser', target: 'chrome156', minify: true, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info' });
await fs.rename('build/app/renderer.css', 'build/app/styles.css');
await fs.writeFile('build/app/index.html', '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visor</title><link rel="stylesheet" href="styles.css"></head><body><div id="root"></div><script type="module" src="renderer.js"></script></body></html>\n');
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
await fs.writeFile('build/app/package.json', JSON.stringify({ name: pkg.name, productName: 'Visor', version: pkg.version, description: pkg.description, main: 'main.cjs', private: true }, null, 2) + '\n');
const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
const notices = ['# Third-party notices', '', 'Visor bundles the following runtime packages. License and notice files are in licenses/. Electron and Chromium notices are also preserved in the Electron distribution.', ''];
for (const [location, info] of Object.entries(lock.packages)) {
  if (!location || info.dev) continue;
  const name = location.slice(location.lastIndexOf('node_modules/') + 13); const dest = path.join('build/app/licenses', name.replaceAll('/', '__'));
  const files = (await fs.readdir(location)).filter(file => /^(license|copying|notice|third_party_notices)/i.test(file));
  await fs.mkdir(dest, { recursive: true });
  if (!files.length) {
    // This upstream React package omits LICENSE, but its shipped source explicitly names Meta's root MIT license.
    if (name !== 'react-compiler-runtime' || !((await fs.readFile(path.join(location, 'src/index.ts'), 'utf8')).includes('Copyright (c) Meta Platforms, Inc. and affiliates.'))) throw new Error(`Missing runtime license: ${location}`);
    await fs.copyFile('node_modules/react/LICENSE', path.join(dest, 'LICENSE'));
    await fs.writeFile(path.join(dest, 'NOTICE.txt'), 'react-compiler-runtime source identifies the Meta MIT license at the React repository root. The same-upstream React LICENSE is preserved here because this published package omits its own copy.\n');
  }
  for (const file of files) if ((await fs.stat(path.join(location, file))).isFile()) await fs.copyFile(path.join(location, file), path.join(dest, file));
  notices.push(`- ${name}@${info.version} (${info.license ?? 'see license files'})`);
}
// Packager leaves these beside the .app; also retain them inside it so the app can stand alone.
await fs.mkdir('build/app/licenses/electron', { recursive: true });
await fs.copyFile('node_modules/electron/dist/LICENSE', 'build/app/licenses/electron/LICENSE');
await fs.copyFile('node_modules/electron/dist/LICENSES.chromium.html', 'build/app/licenses/electron/LICENSES.chromium.html');
await fs.copyFile('THIRD_PARTY_NOTICES.md', 'build/app/THIRD_PARTY_NOTICES.md');
await fs.writeFile('build/app/licenses/INDEX.md', notices.join('\n') + '\n');
console.log('Built standalone static app: build/app (no Vite server).');
