import { build } from 'esbuild';
export default async function () {
  await build({ entryPoints: ['src/markdown-worker.ts'], outfile: 'build/app/markdown-worker.cjs', bundle: true, format: 'cjs', platform: 'node', target: 'node24' });
}
