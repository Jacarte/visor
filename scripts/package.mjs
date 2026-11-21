import { packager } from '@electron/packager';
import path from 'node:path';
if (process.platform !== 'darwin' || process.arch !== 'x64') throw new Error('This local target is macOS x64; do not claim untested ARM support.');
const paths = await packager({ dir: path.resolve('build/app'), name: 'Visor', platform: 'darwin', arch: 'x64', electronVersion: '45.4.1', out: path.resolve('release'), overwrite: true, appBundleId: 'local.visor.viewer', appVersion: '0.2.0', prune: false, download: { cacheRoot: path.resolve('.electron-cache') } });
console.log(paths.map(p => path.join(p, 'Visor.app')).join('\n'));
