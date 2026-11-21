import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
// @ts-expect-error This artifact-only Node script is intentionally plain JavaScript.
import { installArtifacts } from '../scripts/install.mjs';
let root: string; let artifacts: string; let vault: string;
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'visor-installer-')));
  artifacts = path.join(root, 'artifacts'); vault = path.join(root, 'vault');
  await fs.mkdir(artifacts); await fs.mkdir(path.join(vault, '.obsidian', 'plugins'), { recursive: true });
  await fs.writeFile(path.join(artifacts, 'main.js'), 'built JavaScript'); await fs.writeFile(path.join(artifacts, 'styles.css'), 'built CSS');
  await fs.writeFile(path.join(artifacts, 'manifest.json'), JSON.stringify({ id: 'visor', isDesktopOnly: true }));
  await fs.writeFile(path.join(vault, '.obsidian', 'community-plugins.json'), '["other-plugin"]');
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });
it('installs exactly three hash/size-verified artifacts without editing settings or notes', async () => {
  const result = await installArtifacts(artifacts, vault);
  expect(await fs.readdir(result.target)).toEqual(['main.js', 'manifest.json', 'styles.css']);
  for (const artifact of result.artifacts) { expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/); expect((await fs.stat(path.join(result.target, artifact.name))).size).toBe(artifact.size); }
  expect(await fs.readFile(path.join(vault, '.obsidian', 'community-plugins.json'), 'utf8')).toBe('["other-plugin"]');
});
it('stops on any existing target without overwrite', async () => {
  const target = path.join(vault, '.obsidian', 'plugins', 'visor'); await fs.mkdir(target); await fs.writeFile(path.join(target, 'user-data'), 'keep');
  await expect(installArtifacts(artifacts, vault)).rejects.toThrow(/Installation stopped/);
  expect(await fs.readFile(path.join(target, 'user-data'), 'utf8')).toBe('keep');
});
it('rejects symlink ancestors and artifact symlinks', async () => {
  const alias = path.join(root, 'alias'); await fs.symlink(vault, alias);
  await expect(installArtifacts(artifacts, alias)).rejects.toThrow(/Unsafe directory/);
  await fs.unlink(path.join(artifacts, 'main.js')); await fs.symlink(path.join(artifacts, 'styles.css'), path.join(artifacts, 'main.js'));
  await expect(installArtifacts(artifacts, vault)).rejects.toThrow(/Not a regular artifact/);
});
it('rolls back only newly owned unchanged files after a write/open failure', async () => {
  const realOpen = fs.open.bind(fs); let count = 0;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    if (++count === 2) throw new Error('simulated disk failure');
    return realOpen(...args);
  });
  await expect(installArtifacts(artifacts, vault)).rejects.toThrow(/simulated disk failure/);
  expect(await fs.readdir(path.join(vault, '.obsidian', 'plugins'))).toEqual([]);
});
it('retains externally modified owned files and unexpected files on rollback', async () => {
  const realOpen = fs.open.bind(fs); let count = 0;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    if (++count === 2) {
      const target = path.join(vault, '.obsidian', 'plugins', 'visor');
      await fs.writeFile(path.join(target, 'main.js'), 'changed by user'); await fs.writeFile(path.join(target, 'new-data'), 'keep');
      throw new Error('simulated conflict');
    }
    return realOpen(...args);
  });
  await expect(installArtifacts(artifacts, vault)).rejects.toThrow(/retained changed\/uncertain paths/);
  expect(await fs.readFile(path.join(vault, '.obsidian', 'plugins', 'visor', 'main.js'), 'utf8')).toBe('changed by user');
  expect(await fs.readFile(path.join(vault, '.obsidian', 'plugins', 'visor', 'new-data'), 'utf8')).toBe('keep');
});
