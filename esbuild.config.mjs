import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
await esbuild.build({ entryPoints: ['src/main.tsx'], outfile: 'main.js', bundle: true, format: 'cjs', platform: 'browser', target: 'es2021', minify: true, sourcemap: false,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules, ...builtinModules.map(m => `node:${m}`)], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info' });
await esbuild.build({ entryPoints: ['src/styles.css'], outfile: 'styles.css', bundle: true, minify: true, logLevel: 'info' });
